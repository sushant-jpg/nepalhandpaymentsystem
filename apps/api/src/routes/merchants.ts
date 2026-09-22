import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { fromPaisa, toPaisa } from "../lib/money.js";
import { publicId } from "../lib/ids.js";
import { Merchant, Notification, PaymentRequest, Refund, type RefundDocument, Transaction } from "../models/index.js";
import { paymentProvider } from "../services/payment-provider.js";
import { assertIdempotentReplay, requestHash, requireIdempotencyKey } from "../lib/idempotency.js";
import { withDistributedLock } from "../lib/redis.js";
import { rateLimit } from "../middleware/rate-limit.js";

const router = Router();
router.use(authenticate, authorize("MERCHANT"));

async function ownMerchant(userId: string) {
  const merchant = await Merchant.findOne({ userId });
  if (!merchant) throw new AppError(404, "MERCHANT_NOT_FOUND", "Merchant profile was not found.");
  return merchant;
}

router.get("/dashboard", asyncHandler(async (req, res) => {
  const merchant = await ownMerchant(req.auth!.userId);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
  const [today, monthly, refunds, recent] = await Promise.all([
    Transaction.aggregate([{ $match: { merchantId: merchant._id, status: "SUCCESS", createdAt: { $gte: dayStart } } }, { $group: { _id: null, revenue: { $sum: "$amountPaisa" }, count: { $sum: 1 }, customers: { $addToSet: "$customerId" } } }]),
    Transaction.aggregate([{ $match: { merchantId: merchant._id, status: "SUCCESS", createdAt: { $gte: monthStart } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kathmandu" } }, value: { $sum: "$amountPaisa" } } }, { $sort: { _id: 1 } }]),
    Refund.countDocuments({ merchantId: merchant._id, status: "REFUNDED", createdAt: { $gte: dayStart } }),
    Transaction.find({ merchantId: merchant._id }).populate("customerId", "displayName").sort({ createdAt: -1 }).limit(6).lean(),
  ]);
  const metrics = today[0] ?? { revenue: 0, count: 0, customers: [] };
  res.json({ success: true, data: { merchant: { businessName: merchant.businessName, approvalStatus: merchant.approvalStatus }, metrics: { revenue: fromPaisa(metrics.revenue), transactions: metrics.count, customers: metrics.customers.length, refunds }, chart: monthly.map((x) => ({ date: x._id, value: fromPaisa(x.value) })), recent: recent.map((t: any) => ({ transactionId: t.transactionId, customerName: t.customerId?.displayName, amount: fromPaisa(t.amountPaisa), status: t.status, createdAt: t.createdAt })) } });
}));

router.patch("/profile", validate(z.object({ businessName: z.string().trim().min(2).max(160).optional(), registrationNumber: z.string().trim().max(80).optional(), panNumber: z.string().trim().max(40).optional(), category: z.string().trim().max(80).optional(), address: z.string().trim().max(300).optional() })), asyncHandler(async (req, res) => {
  const merchant = await ownMerchant(req.auth!.userId);
  Object.assign(merchant, req.body); await merchant.save();
  await audit(req, "MERCHANT_PROFILE_UPDATED", { type: "Merchant", id: merchant._id.toString() });
  res.json({ success: true, data: merchant });
}));

router.post("/refunds", rateLimit(10, 60_000), validate(z.object({ transactionId: z.string().min(10), amount: z.number().positive(), reason: z.string().trim().min(4).max(300) })), asyncHandler(async (req, res) => {
  const merchant = await ownMerchant(req.auth!.userId);
  const idempotencyKey = requireIdempotencyKey(req);
  const bodyHash = requestHash(req.body);
  const existing = await Refund.findOne({ merchantId: merchant._id, idempotencyKey }).select("+idempotencyRequestHash").lean();
  if (existing) {
    assertIdempotentReplay(existing.idempotencyRequestHash, bodyHash);
    return res.json({ success: true, data: { refundId: existing.refundId, status: existing.status, amount: fromPaisa(existing.amountPaisa), replayed: true } });
  }
  const transaction = await Transaction.findOne({ transactionId: req.body.transactionId, merchantId: merchant._id });
  if (!transaction || !["SUCCESS", "PARTIALLY_REFUNDED"].includes(transaction.status)) throw new AppError(409, "NOT_REFUNDABLE", "Transaction is not refundable.");
  const amountPaisa = toPaisa(req.body.amount);
  if (transaction.refundedAmountPaisa + amountPaisa > transaction.amountPaisa) throw new AppError(400, "INVALID_REFUND_AMOUNT", "Refund exceeds the remaining refundable amount.");
  let refund: RefundDocument | null = null;
  try {
    refund = await Refund.create({ refundId: publicId("RFND"), transactionId: transaction._id, merchantId: merchant._id, amountPaisa, reason: req.body.reason, idempotencyKey, idempotencyRequestHash: bodyHash, status: "PROCESSING" });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      const raced = await Refund.findOne({ merchantId: merchant._id, idempotencyKey }).select("+idempotencyRequestHash").lean();
      if (raced) {
        assertIdempotentReplay(raced.idempotencyRequestHash, bodyHash);
        return res.json({ success: true, data: { refundId: raced.refundId, status: raced.status, amount: fromPaisa(raced.amountPaisa), replayed: true } });
      }
    }
    throw error;
  }
  if (!refund) throw new AppError(500, "REFUND_CREATE_FAILED", "Refund could not be created.");
  try {
    await withDistributedLock(`refund:${transaction.transactionId}`, 30_000, async () => {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const current = await Transaction.findById(transaction._id).session(session);
          if (!current || !["SUCCESS", "PARTIALLY_REFUNDED"].includes(current.status)) throw new AppError(409, "NOT_REFUNDABLE", "Transaction is not refundable.");
          if (current.refundedAmountPaisa + amountPaisa > current.amountPaisa) throw new AppError(400, "INVALID_REFUND_AMOUNT", "Refund exceeds the remaining refundable amount.");
          const provider = await paymentProvider.refundPayment(current.customerId.toString(), merchant._id.toString(), amountPaisa, session);
          const nextRefunded = current.refundedAmountPaisa + amountPaisa;
          const nextStatus = nextRefunded === current.amountPaisa ? "REFUNDED" : "PARTIALLY_REFUNDED";
          const changed = await Transaction.updateOne(
            { _id: current._id, refundedAmountPaisa: current.refundedAmountPaisa, status: current.status },
            { $inc: { refundedAmountPaisa: amountPaisa }, $set: { status: nextStatus } },
            { session },
          );
          if (changed.modifiedCount !== 1) throw new AppError(409, "REFUND_RACE", "Another refund changed this transaction. Retry safely with the same key.");
          await Refund.updateOne({ _id: refund._id, status: "PROCESSING" }, { $set: { status: "REFUNDED", processedAt: new Date(), providerReference: provider.providerReference } }, { session });
          await PaymentRequest.updateOne({ _id: current.paymentRequestId }, { $set: { state: nextStatus } }, { session });
          await Notification.create([{ userId: current.customerId, type: "REFUND_COMPLETED", title: "Refund completed", message: `NPR ${fromPaisa(amountPaisa).toLocaleString()} was returned to your demo wallet.`, metadata: { transactionId: current.transactionId } }], { session });
        });
      } finally {
        await session.endSession();
      }
    });
  } catch (error) {
    await Refund.updateOne({ _id: refund._id, status: "PROCESSING" }, { $set: { status: "FAILED" } });
    throw error;
  }
  await audit(req, "REFUND_COMPLETED", { type: "Refund", id: refund.refundId }, { amountPaisa, providerMode: "MOCK" });
  res.status(201).json({ success: true, data: { refundId: refund.refundId, status: "REFUNDED", amount: fromPaisa(amountPaisa), providerMode: "MOCK" } });
}));

export default router;
