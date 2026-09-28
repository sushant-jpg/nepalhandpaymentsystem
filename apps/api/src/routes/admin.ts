import { Router } from "express";
import mongoose, { type FilterQuery } from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { fromPaisa, toPaisa } from "../lib/money.js";
import {
  FraudAlert,
  CustomerProfile,
  Merchant,
  Notification,
  PalmEnrollment,
  PalmVerification,
  PaymentRequest,
  RefreshToken,
  Refund,
  SystemConfig,
  Transaction,
  User,
  Wallet,
  type UserRecord,
  type WalletDocument,
} from "../models/index.js";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  failIdempotentOperation,
  requestHash,
  requireIdempotencyKey,
} from "../lib/idempotency.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { postDemoCreditJournal } from "../services/ledger.js";
import { revokeSession } from "../lib/redis.js";
import { config } from "../config.js";
import { getServiceHealth } from "../services/health.js";
import { emitNotification } from "../lib/realtime.js";

const router = Router();
router.use(authenticate);

router.get(
  "/system-health",
  requirePermission("platform.read"),
  asyncHandler(async (_req, res) => {
    const health = await getServiceHealth();
    res.status(health.ready ? 200 : 207).json({ success: true, data: health });
  }),
);

router.get(
  "/dashboard",
  requirePermission("platform.read"),
  asyncHandler(async (_req, res) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [
      totalUsers,
      activeCustomers,
      merchants,
      activeEnrollments,
      paymentsToday,
      volume,
      failed,
      pending,
      refunds,
      blockedAccounts,
      failedPalms,
      suspicious,
      daily,
      risk,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "CUSTOMER", status: "ACTIVE" }),
      Merchant.countDocuments(),
      PalmEnrollment.countDocuments({ status: "ACTIVE" }),
      Transaction.countDocuments({
        status: "SUCCESS",
        createdAt: { $gte: start },
      }),
      Transaction.aggregate([
        { $match: { status: "SUCCESS", createdAt: { $gte: start } } },
        { $group: { _id: null, value: { $sum: "$amountPaisa" } } },
      ]),
      Transaction.countDocuments({
        status: "FAILED",
        createdAt: { $gte: start },
      }),
      PaymentRequest.countDocuments({
        state: {
          $in: [
            "CREATED",
            "AWAITING_PALM",
            "CUSTOMER_IDENTIFIED",
            "RISK_CHECK",
            "AWAITING_CONFIRMATION",
            "AWAITING_PIN",
            "PROCESSING",
          ],
        },
      }),
      Refund.countDocuments({ status: "REFUNDED", createdAt: { $gte: start } }),
      User.countDocuments({ status: { $in: ["FROZEN", "SUSPENDED"] } }),
      PalmVerification.countDocuments({
        matched: false,
        createdAt: { $gte: start },
      }),
      FraudAlert.countDocuments({ status: "OPEN" }),
      Transaction.aggregate([
        {
          $match: {
            status: "SUCCESS",
            createdAt: { $gte: new Date(Date.now() - 14 * 86_400_000) },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%m/%d",
                date: "$createdAt",
                timezone: "Asia/Kathmandu",
              },
            },
            value: { $sum: "$amountPaisa" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Transaction.aggregate([
        { $group: { _id: "$riskLevel", value: { $sum: 1 } } },
      ]),
    ]);
    res.json({
      success: true,
      data: {
        metrics: {
          totalUsers,
          activeCustomers,
          merchants,
          activeEnrollments,
          paymentsToday,
          transactionVolume: fromPaisa(volume[0]?.value ?? 0),
          failedTransactions: failed,
          pendingPayments: pending,
          refundsToday: refunds,
          blockedAccounts,
          failedPalmScans: failedPalms,
          suspiciousTransactions: suspicious,
        },
        daily: daily.map((x) => ({
          label: x._id,
          value: fromPaisa(x.value),
          count: x.count,
        })),
        risk: risk.map((x) => ({ name: x._id, value: x.value })),
      },
    });
  }),
);

router.get(
  "/users",
  requirePermission("user.read"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter: FilterQuery<UserRecord> = req.query.role
      ? { role: req.query.role }
      : {};
    const [items, total] = await Promise.all([
      User.find(filter)
        .select("-passwordHash")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: { items, pagination: { page, limit, total } },
    });
  }),
);

router.patch(
  "/users/:id/status",
  requirePermission("user.freeze"),
  validate(z.object({ status: z.enum(["ACTIVE", "FROZEN", "SUSPENDED"]) })),
  asyncHandler(async (req, res) => {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { status: req.body.status } },
      { new: true },
    );
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found.");
    let walletOwnerId = user._id;
    if (user.role === "MERCHANT") {
      const merchantProfile = await Merchant.findOne({ userId: user._id })
        .select("_id")
        .lean();
      walletOwnerId = merchantProfile?._id ?? user._id;
    }
    if (["CUSTOMER", "MERCHANT"].includes(user.role))
      await Wallet.updateOne(
        { ownerType: user.role, ownerId: walletOwnerId },
        {
          $set: { status: req.body.status === "ACTIVE" ? "ACTIVE" : "FROZEN" },
        },
      );
    if (req.body.status !== "ACTIVE") {
      const sessions = await RefreshToken.find({
        userId: user._id,
        revokedAt: { $exists: false },
      })
        .select("jti expiresAt")
        .lean();
      await RefreshToken.updateMany(
        { userId: user._id, revokedAt: { $exists: false } },
        {
          $set: {
            revokedAt: new Date(),
            revokedReason: `ADMIN_${req.body.status}`,
          },
        },
      );
      await Promise.all(
        sessions.map((session) =>
          revokeSession(
            session.jti,
            Math.max(
              1,
              Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000),
            ),
          ),
        ),
      );
    }
    await audit(
      req,
      "ADMIN_ACTION",
      { type: "User", id: user._id.toString() },
      { action: "STATUS_CHANGE", status: req.body.status },
    );
    res.json({ success: true, data: { id: user._id, status: user.status } });
  }),
);

router.get(
  "/merchants",
  requirePermission("merchant.read"),
  asyncHandler(async (_req, res) => {
    const items = await Merchant.find()
      .populate("userId", "email displayName status")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, data: items });
  }),
);

router.get(
  "/kyc",
  requirePermission("kyc.read"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const filter = status ? { kycStatus: status } : {};
    const [items, total] = await Promise.all([
      CustomerProfile.find(filter)
        .select("+documentNumber +selfieReference +adminNotes")
        .populate("userId", "email displayName status emailVerified")
        .sort({ submittedAt: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CustomerProfile.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  }),
);

router.patch(
  "/kyc/:userId/review",
  requirePermission("kyc.review"),
  validate(z.object({
    status: z.enum(["APPROVED", "REJECTED", "REQUIRES_UPDATE"]),
    rejectionReason: z.string().trim().min(5).max(500).optional(),
    adminNotes: z.string().trim().max(1000).optional(),
  }).superRefine((value, ctx) => {
    if (value.status !== "APPROVED" && !value.rejectionReason) ctx.addIssue({ code: "custom", path: ["rejectionReason"], message: "A reason is required." });
  })),
  asyncHandler(async (req, res) => {
    const profile = await CustomerProfile.findOneAndUpdate(
      { userId: req.params.userId, kycStatus: { $in: ["PENDING", "UNDER_REVIEW"] } },
      { $set: { kycStatus: req.body.status, reviewedAt: new Date(), reviewedBy: req.auth!.userId, rejectionReason: req.body.rejectionReason, adminNotes: req.body.adminNotes } },
      { new: true },
    );
    if (!profile) throw new AppError(409, "KYC_NOT_REVIEWABLE", "KYC case was not found in a reviewable state.");
    const notification = await Notification.create({ userId: profile.userId, type: "KYC_STATUS", category: "KYC", severity: req.body.status === "APPROVED" ? "INFO" : "MEDIUM", title: `KYC ${req.body.status.toLowerCase().replaceAll("_", " ")}`, message: req.body.status === "APPROVED" ? "Your demo identity review was approved." : `Your demo identity review needs attention: ${req.body.rejectionReason}` });
    emitNotification(profile.userId.toString(), notification.toObject());
    await audit(req, "KYC_REVIEWED", { type: "CustomerProfile", id: profile._id.toString() }, { status: req.body.status });
    res.json({ success: true, data: { status: profile.kycStatus, reviewedAt: profile.reviewedAt } });
  }),
);

router.get(
  "/kyb",
  requirePermission("kyb.read"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const filter = status ? { approvalStatus: status } : {};
    const [items, total] = await Promise.all([
      Merchant.find(filter)
        .select("+reviewNotes")
        .populate("userId", "email displayName status emailVerified")
        .sort({ submittedAt: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Merchant.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  }),
);

router.patch(
  "/kyb/:id/review",
  requirePermission("kyb.review"),
  validate(z.object({
    status: z.enum(["APPROVED", "REJECTED"]),
    rejectionReason: z.string().trim().min(5).max(500).optional(),
    reviewNotes: z.string().trim().max(1000).optional(),
  }).superRefine((value, ctx) => {
    if (value.status === "REJECTED" && !value.rejectionReason) ctx.addIssue({ code: "custom", path: ["rejectionReason"], message: "A rejection reason is required." });
  })),
  asyncHandler(async (req, res) => {
    const merchant = await Merchant.findOneAndUpdate(
      { _id: req.params.id, approvalStatus: { $in: ["SUBMITTED", "UNDER_REVIEW"] } },
      { $set: { approvalStatus: req.body.status, reviewedAt: new Date(), approvedAt: req.body.status === "APPROVED" ? new Date() : undefined, approvedBy: req.auth!.userId, rejectionReason: req.body.rejectionReason, reviewNotes: req.body.reviewNotes } },
      { new: true },
    );
    if (!merchant) throw new AppError(409, "KYB_NOT_REVIEWABLE", "KYB case was not found in a reviewable state.");
    const notification = await Notification.create({ userId: merchant.userId, type: "MERCHANT_STATUS", category: "MERCHANT", severity: req.body.status === "APPROVED" ? "INFO" : "MEDIUM", title: `Merchant ${req.body.status.toLowerCase()}`, message: req.body.status === "APPROVED" ? "Your demo merchant account was approved." : `Your business verification was rejected: ${req.body.rejectionReason}` });
    emitNotification(merchant.userId.toString(), notification.toObject());
    await audit(req, "KYB_REVIEWED", { type: "Merchant", id: merchant._id.toString() }, { status: req.body.status });
    res.json({ success: true, data: { status: merchant.approvalStatus, reviewedAt: merchant.reviewedAt } });
  }),
);

router.patch(
  "/merchants/:id/approval",
  requirePermission("merchant.approve"),
  validate(z.object({ status: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]) })),
  asyncHandler(async (req, res) => {
    const merchant = await Merchant.findById(req.params.id);
    if (!merchant)
      throw new AppError(404, "MERCHANT_NOT_FOUND", "Merchant not found.");
    if (req.body.status === "SUSPENDED" && merchant.approvalStatus !== "APPROVED")
      throw new AppError(409, "MERCHANT_NOT_APPROVED", "Only an approved merchant can be suspended.");
    if (req.body.status === "APPROVED" && merchant.approvalStatus !== "SUSPENDED")
      throw new AppError(409, "KYB_REVIEW_REQUIRED", "Use the KYB review workflow to approve a merchant.");
    merchant.approvalStatus = req.body.status;
    merchant.approvedAt = req.body.status === "APPROVED" ? new Date() : undefined;
    merchant.approvedBy = new mongoose.Types.ObjectId(req.auth!.userId);
    await merchant.save();
    const notification = await Notification.create({
      userId: merchant.userId,
      type: "MERCHANT_STATUS",
      category: "MERCHANT",
      severity: req.body.status === "APPROVED" ? "INFO" : "HIGH",
      title: `Merchant ${req.body.status.toLowerCase()}`,
      message: `Your merchant application is now ${req.body.status.toLowerCase()}.`,
    });
    emitNotification(merchant.userId.toString(), notification.toObject());
    await audit(
      req,
      "MERCHANT_APPROVED",
      { type: "Merchant", id: merchant._id.toString() },
      { status: req.body.status },
    );
    res.json({ success: true, data: merchant });
  }),
);

router.post(
  "/demo-funds",
  requirePermission("wallet.adjust"),
  rateLimit(10, 60_000),
  validate(
    z.object({
      userId: z.string().min(12),
      amount: z.number().positive().max(1_000_000),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (config.DEMO_MODE !== "true") {
      throw new AppError(
        403,
        "DEMO_MODE_DISABLED",
        "Simulated wallet funding is disabled in this environment.",
      );
    }
    const idempotency = await beginIdempotentOperation({
      idempotencyKey: requireIdempotencyKey(req),
      userId: req.auth!.userId,
      endpoint: "POST /api/v1/admin/demo-funds",
      requestHash: requestHash(req.body),
    });
    if (idempotency.kind === "replay")
      return res.status(idempotency.statusCode).json(idempotency.response);
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
        const creditedWallet = await Wallet.findOneAndUpdate(
          { ownerType: "CUSTOMER", ownerId: user._id },
          { $inc: { balancePaisa: toPaisa(req.body.amount), version: 1 } },
          { new: true, session },
        );
        if (!creditedWallet)
          throw new AppError(
            404,
            "WALLET_NOT_FOUND",
            "Customer wallet was not found.",
          );
        await postDemoCreditJournal(
          {
            operationId: idempotency.recordId,
            customerId: user._id.toString(),
            amountPaisa: toPaisa(req.body.amount),
            requestId: req.requestId,
          },
          session,
        );
        await Notification.create(
          [
            {
              userId: user._id,
              type: "DEMO_CREDIT",
              title: "Demo funds added",
              message: `NPR ${req.body.amount.toLocaleString()} was added by an administrator.`,
            },
          ],
          { session },
        );
        response.data = {
          walletId: creditedWallet.walletId,
          balance: fromPaisa(creditedWallet.balancePaisa),
        };
        await completeIdempotentOperation(
          idempotency.recordId,
          response,
          200,
          session,
        );
        return creditedWallet;
      });
    } catch (error) {
      await failIdempotentOperation(idempotency.recordId);
      throw error;
    } finally {
      await session.endSession();
    }
    if (!wallet)
      throw new AppError(
        500,
        "WALLET_NOT_FOUND",
        "Customer wallet was not found after crediting.",
      );
    await audit(
      req,
      "DEMO_FUNDS_CREDITED",
      { type: "Wallet", id: wallet.walletId },
      { amountPaisa: toPaisa(req.body.amount) },
    );
    res.json(response);
  }),
);

router.put(
  "/configuration/:key",
  requirePermission("configuration.write"),
  validate(
    z.object({
      value: z.unknown(),
      description: z.string().max(300).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const item = await SystemConfig.findOneAndUpdate(
      { key: req.params.key },
      {
        $set: {
          value: req.body.value,
          description: req.body.description,
          updatedBy: req.auth!.userId,
        },
      },
      { upsert: true, new: true },
    );
    await audit(req, "SYSTEM_CONFIGURATION_UPDATED", {
      type: "SystemConfig",
      id: item.key,
    });
    res.json({ success: true, data: item });
  }),
);

export default router;
