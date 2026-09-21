import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { CustomerProfile, Notification, User, Wallet } from "../models/index.js";
import { fromPaisa } from "../lib/money.js";

const router = Router();
router.use(authenticate);

router.get("/profile", asyncHandler(async (req, res) => {
  const user: any = await User.findById(req.auth!.userId).lean();
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found.");
  const profile = req.auth!.role === "CUSTOMER" ? await CustomerProfile.findOne({ userId: user._id }).lean() : null;
  res.json({ success: true, data: { id: user._id, email: user.email, displayName: user.displayName, phone: user.phone, role: user.role, emailVerified: user.emailVerified, status: user.status, profile } });
}));

router.patch("/profile", validate(z.object({ displayName: z.string().trim().min(2).max(100).optional(), phone: z.string().trim().max(30).optional(), address: z.string().trim().max(300).optional(), district: z.string().trim().max(80).optional(), preferredLanguage: z.enum(["en", "ne"]).optional() })), asyncHandler(async (req, res) => {
  const { address, district, preferredLanguage, ...userFields } = req.body;
  if (Object.keys(userFields).length) await User.updateOne({ _id: req.auth!.userId }, { $set: userFields });
  if (req.auth!.role === "CUSTOMER" && (address !== undefined || district !== undefined || preferredLanguage !== undefined)) {
    await CustomerProfile.updateOne({ userId: req.auth!.userId }, { $set: { ...(address !== undefined ? { address } : {}), ...(district !== undefined ? { district } : {}), ...(preferredLanguage !== undefined ? { preferredLanguage } : {}) } });
  }
  await audit(req, "PROFILE_UPDATED", { type: "User", id: req.auth!.userId });
  res.json({ success: true, data: { updated: true } });
}));

router.post("/payment-pin", authorize("CUSTOMER"), validate(z.object({ password: z.string().min(1), pin: z.string().regex(/^\d{4,8}$/) })), asyncHandler(async (req, res) => {
  const user: any = await User.findById(req.auth!.userId).select("+passwordHash +paymentPinHash");
  if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) throw new AppError(401, "INVALID_PASSWORD", "Password is incorrect.");
  user.paymentPinHash = await bcrypt.hash(req.body.pin, 12);
  user.securityChangedAt = new Date();
  await user.save();
  await audit(req, "PAYMENT_PIN_CHANGED", { type: "User", id: req.auth!.userId });
  res.json({ success: true, data: { updated: true } });
}));

router.post("/freeze", authorize("CUSTOMER"), validate(z.object({ freeze: z.boolean() })), asyncHandler(async (req, res) => {
  await Promise.all([
    User.updateOne({ _id: req.auth!.userId }, { $set: { status: req.body.freeze ? "FROZEN" : "ACTIVE" } }),
    Wallet.updateOne({ ownerType: "CUSTOMER", ownerId: req.auth!.userId }, { $set: { status: req.body.freeze ? "FROZEN" : "ACTIVE" } }),
  ]);
  await audit(req, req.body.freeze ? "ACCOUNT_FROZEN" : "ACCOUNT_UNFROZEN", { type: "User", id: req.auth!.userId });
  res.json({ success: true, data: { status: req.body.freeze ? "FROZEN" : "ACTIVE" } });
}));

router.get("/notifications", asyncHandler(async (req, res) => {
  const items = await Notification.find({ userId: req.auth!.userId }).sort({ createdAt: -1 }).limit(30).lean();
  res.json({ success: true, data: items });
}));

router.patch("/notifications/:id/read", asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, userId: req.auth!.userId }, { $set: { readAt: new Date() } });
  res.json({ success: true, data: { read: true } });
}));

router.get("/wallet", authorize("CUSTOMER", "MERCHANT"), asyncHandler(async (req, res) => {
  let ownerId = req.auth!.userId;
  if (req.auth!.role === "MERCHANT") {
    const { Merchant } = await import("../models/index.js");
    const merchant: any = await Merchant.findOne({ userId: req.auth!.userId }).lean();
    ownerId = merchant?._id?.toString() ?? "missing";
  }
  const wallet: any = await Wallet.findOne({ ownerType: req.auth!.role, ownerId }).lean();
  if (!wallet) throw new AppError(404, "WALLET_NOT_FOUND", "Wallet was not found.");
  res.json({ success: true, data: { walletId: wallet.walletId, balance: fromPaisa(wallet.balancePaisa), currency: wallet.currency, status: wallet.status } });
}));

export default router;
