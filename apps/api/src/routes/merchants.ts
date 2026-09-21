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
import { Merchant, Notification, Refund, Transaction } from "../models/index.js";
import { paymentProvider } from "../services/payment-provider.js";

const router = Router();
router.use(authenticate, authorize("MERCHANT"));

async function ownMerchant(userId: string) {
  const merchant: any = await Merchant.findOne({ userId });
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

router.post("/refunds", validate(z.object({ transactionId: z.string().min(10), amount: z.number().positive(), reason: z.string().trim().min(4).max(300) })), asyncHandler(async (req, res) => {
  const merchant = await ownMerchant(req.auth!.userId);
  const transaction: any = await Transaction.findOne({ transactionId: req.body.transactionId, merchantId: merchant._id });
  if (!transaction || !["SUCCESS", "REFUNDED"].includes(transaction.status)) throw new AppError(409, "NOT_REFUNDABLE", "Transaction is not refundable.");
  const amountPaisa = toPaisa(req.body.amount);
  if (transaction.refundedAmountPaisa + amountPaisa > transaction.amountPaisa) throw new AppError(400, "INVALID_REFUND_AMOUNT", "Refund exceeds the remaining refundable amount.");
  const refund: any = await Refund.create({ refundId: publicId("RFND"), transactionId: transaction._id, merchantId: merchant._id, amountPaisa, reason: req.body.reason, status: "PROCESSING" });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await paymentProvider.refund(transaction.customerId.toString(), merchant._id.toString(), amountPaisa, session);
      transaction.refundedAmountPaisa += amountPaisa;
      if (transaction.refundedAmountPaisa === transaction.amountPaisa) transaction.status = "REFUNDED";
      await transaction.save({ session });
      refund.status = "REFUNDED"; refund.processedAt = new Date(); await refund.save({ session });
      await Notification.create([{ userId: transaction.customerId, type: "REFUND_COMPLETED", title: "Refund completed", message: `NPR ${fromPaisa(amountPaisa).toLocaleString()} was returned to your demo wallet.`, metadata: { transactionId: transaction.transactionId } }], { session });
    });
  } catch (error) { refund.status = "FAILED"; await refund.save(); throw error; } finally { await session.endSession(); }
  await audit(req, "REFUND_REQUESTED", { type: "Refund", id: refund.refundId }, { amountPaisa });
  res.status(201).json({ success: true, data: { refundId: refund.refundId, status: refund.status, amount: fromPaisa(amountPaisa) } });
}));

export default router;
