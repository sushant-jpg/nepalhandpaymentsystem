import { Router } from "express";
import mongoose, { type FilterQuery } from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { fromPaisa, toPaisa } from "../lib/money.js";
import { FraudAlert, Merchant, Notification, PalmEnrollment, PalmVerification, PaymentRequest, Refund, SecurityEvent, SystemConfig, Transaction, User, Wallet, type UserRecord, type WalletDocument } from "../models/index.js";
import { beginIdempotentOperation, completeIdempotentOperation, failIdempotentOperation, requestHash, requireIdempotencyKey } from "../lib/idempotency.js";
import { rateLimit } from "../middleware/rate-limit.js";

const router = Router();
router.use(authenticate, authorize("ADMIN"));

router.get("/dashboard", asyncHandler(async (_req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [totalUsers, activeCustomers, merchants, activeEnrollments, paymentsToday, volume, failed, pending, refunds, blockedAccounts, failedPalms, suspicious, daily, risk] = await Promise.all([
    User.countDocuments(), User.countDocuments({ role: "CUSTOMER", status: "ACTIVE" }), Merchant.countDocuments(),
    PalmEnrollment.countDocuments({ status: "ACTIVE" }),
    Transaction.countDocuments({ status: "SUCCESS", createdAt: { $gte: start } }),
    Transaction.aggregate([{ $match: { status: "SUCCESS", createdAt: { $gte: start } } }, { $group: { _id: null, value: { $sum: "$amountPaisa" } } }]),
    Transaction.countDocuments({ status: "FAILED", createdAt: { $gte: start } }),
    PaymentRequest.countDocuments({ state: { $in: ["CREATED", "AWAITING_PALM", "CUSTOMER_IDENTIFIED", "RISK_CHECK", "AWAITING_CONFIRMATION", "AWAITING_PIN", "PROCESSING"] } }),
    Refund.countDocuments({ status: "REFUNDED", createdAt: { $gte: start } }),
    User.countDocuments({ status: { $in: ["FROZEN", "SUSPENDED"] } }),
    PalmVerification.countDocuments({ matched: false, createdAt: { $gte: start } }),
    FraudAlert.countDocuments({ status: "OPEN" }),
    Transaction.aggregate([{ $match: { status: "SUCCESS", createdAt: { $gte: new Date(Date.now() - 14 * 86_400_000) } } }, { $group: { _id: { $dateToString: { format: "%m/%d", date: "$createdAt", timezone: "Asia/Kathmandu" } }, value: { $sum: "$amountPaisa" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Transaction.aggregate([{ $group: { _id: "$riskLevel", value: { $sum: 1 } } }]),
  ]);
  res.json({ success: true, data: { metrics: { totalUsers, activeCustomers, merchants, activeEnrollments, paymentsToday, transactionVolume: fromPaisa(volume[0]?.value ?? 0), failedTransactions: failed, pendingPayments: pending, refundsToday: refunds, blockedAccounts, failedPalmScans: failedPalms, suspiciousTransactions: suspicious }, daily: daily.map((x) => ({ label: x._id, value: fromPaisa(x.value), count: x.count })), risk: risk.map((x) => ({ name: x._id, value: x.value })) } });
}));

router.get("/users", asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter: FilterQuery<UserRecord> = req.query.role ? { role: req.query.role } : {};
  const [items, total] = await Promise.all([User.find(filter).select("-passwordHash").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(filter)]);
  res.json({ success: true, data: { items, pagination: { page, limit, total } } });
}));

router.patch("/users/:id/status", validate(z.object({ status: z.enum(["ACTIVE", "FROZEN", "SUSPENDED"]) })), asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { new: true });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found.");
  let walletOwnerId = user._id;
  if (user.role === "MERCHANT") {
    const merchantProfile = await Merchant.findOne({ userId: user._id }).select("_id").lean();
    walletOwnerId = merchantProfile?._id ?? user._id;
  }
  if (["CUSTOMER", "MERCHANT"].includes(user.role)) await Wallet.updateOne({ ownerType: user.role, ownerId: walletOwnerId }, { $set: { status: req.body.status === "ACTIVE" ? "ACTIVE" : "FROZEN" } });
  await audit(req, "ADMIN_ACTION", { type: "User", id: user._id.toString() }, { action: "STATUS_CHANGE", status: req.body.status });
  res.json({ success: true, data: { id: user._id, status: user.status } });
}));

router.get("/merchants", asyncHandler(async (_req, res) => {
  const items = await Merchant.find().populate("userId", "email displayName status").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, data: items });
}));

router.patch("/merchants/:id/approval", validate(z.object({ status: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]) })), asyncHandler(async (req, res) => {
  const merchant = await Merchant.findByIdAndUpdate(req.params.id, { $set: { approvalStatus: req.body.status, approvedAt: req.body.status === "APPROVED" ? new Date() : undefined, approvedBy: req.auth!.userId } }, { new: true });
  if (!merchant) throw new AppError(404, "MERCHANT_NOT_FOUND", "Merchant not found.");
  await Notification.create({ userId: merchant.userId, type: "MERCHANT_STATUS", title: `Merchant ${req.body.status.toLowerCase()}`, message: `Your merchant application is now ${req.body.status.toLowerCase()}.` });
  await audit(req, "MERCHANT_APPROVED", { type: "Merchant", id: merchant._id.toString() }, { status: req.body.status });
  res.json({ success: true, data: merchant });
}));

router.post("/demo-funds", rateLimit(10, 60_000), validate(z.object({ userId: z.string().min(12), amount: z.number().positive().max(1_000_000) })), asyncHandler(async (req, res) => {
  const idempotency = await beginIdempotentOperation({
    idempotencyKey: requireIdempotencyKey(req),
    userId: req.auth!.userId,
    endpoint: "POST /api/v1/admin/demo-funds",
    requestHash: requestHash(req.body),
  });
  if (idempotency.kind === "replay") return res.status(idempotency.statusCode).json(idempotency.response);
  const user = await User.findOne({ _id: req.body.userId, role: "CUSTOMER" });
  if (!user) {
    await failIdempotentOperation(idempotency.recordId);
    throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer not found.");
  }
  const session = await mongoose.startSession();
  let wallet: WalletDocument | undefined;
  const response = { success: true, data: { walletId: "", balance: 0 } };
  try {
    wallet = await session.withTransaction(async () => {
      const creditedWallet = await Wallet.findOneAndUpdate({ ownerType: "CUSTOMER", ownerId: user._id }, { $inc: { balancePaisa: toPaisa(req.body.amount), version: 1 } }, { new: true, session });
      if (!creditedWallet) throw new AppError(404, "WALLET_NOT_FOUND", "Customer wallet was not found.");
      await Notification.create([{ userId: user._id, type: "DEMO_CREDIT", title: "Demo funds added", message: `NPR ${req.body.amount.toLocaleString()} was added by an administrator.` }], { session });
      response.data = { walletId: creditedWallet.walletId, balance: fromPaisa(creditedWallet.balancePaisa) };
      await completeIdempotentOperation(idempotency.recordId, response, 200, session);
      return creditedWallet;
    });
  } catch (error) {
    await failIdempotentOperation(idempotency.recordId);
    throw error;
  } finally {
    await session.endSession();
  }
  if (!wallet) throw new AppError(500, "WALLET_NOT_FOUND", "Customer wallet was not found after crediting.");
  await audit(req, "DEMO_FUNDS_CREDITED", { type: "Wallet", id: wallet.walletId }, { amountPaisa: toPaisa(req.body.amount) });
  res.json(response);
}));

router.put("/configuration/:key", validate(z.object({ value: z.unknown(), description: z.string().max(300).optional() })), asyncHandler(async (req, res) => {
  const item = await SystemConfig.findOneAndUpdate({ key: req.params.key }, { $set: { value: req.body.value, description: req.body.description, updatedBy: req.auth!.userId } }, { upsert: true, new: true });
  await audit(req, "SYSTEM_CONFIGURATION_UPDATED", { type: "SystemConfig", id: item.key });
  res.json({ success: true, data: item });
}));

export default router;
