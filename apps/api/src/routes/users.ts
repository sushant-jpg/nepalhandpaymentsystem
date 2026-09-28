import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import {
  CustomerProfile,
  Notification,
  User,
  Wallet,
} from "../models/index.js";
import { fromPaisa } from "../lib/money.js";
import { emitNotification } from "../lib/realtime.js";

const router = Router();
router.use(authenticate);

const documentReference = z.object({
  kind: z.string().trim().min(2).max(60),
  fileName: z.string().trim().min(1).max(180),
  reference: z.string().trim().min(3).max(240),
});

const kycDraftSchema = z.object({
  legalFullName: z.string().trim().min(2).max(160).optional(),
  dateOfBirth: z.coerce.date().max(new Date()).optional(),
  address: z.string().trim().min(5).max(300).optional(),
  district: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(7).max(30).optional(),
  documentType: z
    .enum(["CITIZENSHIP", "PASSPORT", "DRIVING_LICENSE", "OTHER"])
    .optional(),
  documentNumber: z.string().trim().min(3).max(80).optional(),
  documents: z.array(documentReference).max(5).optional(),
  selfieReference: z.string().trim().min(3).max(240).optional(),
});

router.get(
  "/kyc",
  authorize("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const profile = await CustomerProfile.findOne({ userId: req.auth!.userId })
      .select("+documentNumber +selfieReference")
      .lean();
    if (!profile)
      throw new AppError(404, "KYC_PROFILE_NOT_FOUND", "KYC profile was not found.");
    res.json({ success: true, data: profile });
  }),
);

router.put(
  "/kyc",
  authorize("CUSTOMER"),
  validate(kycDraftSchema),
  asyncHandler(async (req, res) => {
    const profile = await CustomerProfile.findOne({ userId: req.auth!.userId });
    if (!profile)
      throw new AppError(404, "KYC_PROFILE_NOT_FOUND", "KYC profile was not found.");
    if (!["NOT_STARTED", "DRAFT", "REJECTED", "REQUIRES_UPDATE"].includes(profile.kycStatus)) {
      throw new AppError(409, "KYC_NOT_EDITABLE", "KYC details cannot be edited while they are under review.");
    }
    Object.assign(profile, req.body, { kycStatus: "DRAFT" });
    await profile.save();
    await audit(req, "KYC_DRAFT_SAVED", { type: "CustomerProfile", id: profile._id.toString() });
    res.json({ success: true, data: { status: profile.kycStatus } });
  }),
);

router.post(
  "/kyc/submit",
  authorize("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const [profile, user] = await Promise.all([
      CustomerProfile.findOne({ userId: req.auth!.userId }).select("+documentNumber"),
      User.findById(req.auth!.userId).select("emailVerified"),
    ]);
    if (!profile)
      throw new AppError(404, "KYC_PROFILE_NOT_FOUND", "KYC profile was not found.");
    if (!user?.emailVerified)
      throw new AppError(403, "AUTH_EMAIL_NOT_VERIFIED", "Verify your email before submitting KYC.");
    if (!["DRAFT", "REJECTED", "REQUIRES_UPDATE"].includes(profile.kycStatus))
      throw new AppError(409, "KYC_NOT_SUBMITTABLE", "KYC is not in a submittable state.");
    const complete = profile.legalFullName && profile.dateOfBirth && profile.address && profile.district && profile.phone && profile.documentType && profile.documentNumber && profile.documents.length;
    if (!complete)
      throw new AppError(400, "KYC_INCOMPLETE", "Complete all required identity and document fields before submitting.");
    profile.kycStatus = "PENDING";
    profile.submittedAt = new Date();
    profile.rejectionReason = undefined;
    await profile.save();
    await audit(req, "KYC_SUBMITTED", { type: "CustomerProfile", id: profile._id.toString() });
    res.json({ success: true, data: { status: profile.kycStatus, submittedAt: profile.submittedAt } });
  }),
);

router.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth!.userId).lean();
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found.");
    const profile =
      req.auth!.role === "CUSTOMER"
        ? await CustomerProfile.findOne({ userId: user._id }).lean()
        : null;
    res.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        phone: user.phone,
        role: user.role,
        emailVerified: user.emailVerified,
        status: user.status,
        profile,
      },
    });
  }),
);

router.patch(
  "/profile",
  validate(
    z.object({
      displayName: z.string().trim().min(2).max(100).optional(),
      phone: z.string().trim().max(30).optional(),
      address: z.string().trim().max(300).optional(),
      district: z.string().trim().max(80).optional(),
      preferredLanguage: z.enum(["en", "ne"]).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { address, district, preferredLanguage, ...userFields } = req.body;
    if (Object.keys(userFields).length)
      await User.updateOne({ _id: req.auth!.userId }, { $set: userFields });
    if (
      req.auth!.role === "CUSTOMER" &&
      (address !== undefined ||
        district !== undefined ||
        preferredLanguage !== undefined)
    ) {
      await CustomerProfile.updateOne(
        { userId: req.auth!.userId },
        {
          $set: {
            ...(address !== undefined ? { address } : {}),
            ...(district !== undefined ? { district } : {}),
            ...(preferredLanguage !== undefined ? { preferredLanguage } : {}),
          },
        },
      );
    }
    await audit(req, "PROFILE_UPDATED", { type: "User", id: req.auth!.userId });
    res.json({ success: true, data: { updated: true } });
  }),
);

router.post(
  "/payment-pin",
  authorize("CUSTOMER"),
  validate(
    z.object({
      password: z.string().min(1),
      pin: z.string().regex(/^\d{4,8}$/),
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth!.userId).select(
      "+passwordHash +paymentPinHash",
    );
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash)))
      throw new AppError(401, "INVALID_PASSWORD", "Password is incorrect.");
    user.paymentPinHash = await bcrypt.hash(req.body.pin, 12);
    user.securityChangedAt = new Date();
    await user.save();
    await audit(req, "PAYMENT_PIN_CHANGED", {
      type: "User",
      id: req.auth!.userId,
    });
    const notification = await Notification.create({
      userId: req.auth!.userId,
      type: "PAYMENT_PIN_CHANGED",
      category: "SECURITY",
      severity: "MEDIUM",
      title: "Payment PIN changed",
      message: "Your payment PIN was changed. Review active sessions if this was not you.",
    });
    emitNotification(req.auth!.userId, notification.toObject());
    res.json({ success: true, data: { updated: true } });
  }),
);

router.post(
  "/freeze",
  authorize("CUSTOMER"),
  validate(z.object({ freeze: z.boolean() })),
  asyncHandler(async (req, res) => {
    await Promise.all([
      User.updateOne(
        { _id: req.auth!.userId },
        { $set: { status: req.body.freeze ? "FROZEN" : "ACTIVE" } },
      ),
      Wallet.updateOne(
        { ownerType: "CUSTOMER", ownerId: req.auth!.userId },
        { $set: { status: req.body.freeze ? "FROZEN" : "ACTIVE" } },
      ),
    ]);
    await audit(req, req.body.freeze ? "ACCOUNT_FROZEN" : "ACCOUNT_UNFROZEN", {
      type: "User",
      id: req.auth!.userId,
    });
    res.json({
      success: true,
      data: { status: req.body.freeze ? "FROZEN" : "ACTIVE" },
    });
  }),
);

router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        unreadOnly: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
      })
      .parse(req.query);
    const filter = {
      userId: req.auth!.userId,
      ...(query.unreadOnly ? { readAt: { $exists: false } } : {}),
    };
    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({
        userId: req.auth!.userId,
        readAt: { $exists: false },
      }),
    ]);
    res.json({
      success: true,
      data: {
        items,
        unreadCount,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit),
        },
      },
    });
  }),
);

router.patch(
  "/notifications/:id/read",
  validate(z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }), "params"),
  asyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.auth!.userId },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!notification)
      throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification was not found.");
    res.json({ success: true, data: { read: true } });
  }),
);

router.post(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    const result = await Notification.updateMany(
      { userId: req.auth!.userId, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
    res.json({ success: true, data: { updated: result.modifiedCount } });
  }),
);

router.get(
  "/wallet",
  authorize("CUSTOMER", "MERCHANT"),
  asyncHandler(async (req, res) => {
    let ownerId = req.auth!.userId;
    if (req.auth!.role === "MERCHANT") {
      const { Merchant } = await import("../models/index.js");
      const merchant = await Merchant.findOne({
        userId: req.auth!.userId,
      }).lean();
      ownerId = merchant?._id?.toString() ?? "missing";
    }
    const wallet = await Wallet.findOne({
      ownerType: req.auth!.role,
      ownerId,
    }).lean();
    if (!wallet)
      throw new AppError(404, "WALLET_NOT_FOUND", "Wallet was not found.");
    res.json({
      success: true,
      data: {
        walletId: wallet.walletId,
        balance: fromPaisa(wallet.balancePaisa),
        currency: wallet.currency,
        status: wallet.status,
      },
    });
  }),
);

export default router;
