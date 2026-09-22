import { Router } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { Response, Request } from "express";
import { roles, type Role } from "@nepal-hand-pay/shared-types";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/errors.js";
import { hashToken, randomToken, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from "../lib/auth.js";
import { audit, securityEvent } from "../lib/audit.js";
import { config } from "../config.js";
import { CustomerProfile, Merchant, RefreshToken, User, type UserDocument, Wallet } from "../models/index.js";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { publicId } from "../lib/ids.js";
import { revokeAccessToken } from "../lib/redis.js";

const router = Router();
const password = z.string().min(10).max(128).regex(/[A-Z]/, "Must include an uppercase letter").regex(/[a-z]/, "Must include a lowercase letter").regex(/[0-9]/, "Must include a number");

const registerSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password,
  displayName: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional(),
  role: z.enum(["CUSTOMER", "MERCHANT"]).default("CUSTOMER"),
  businessName: z.string().trim().min(2).max(160).optional(),
}).superRefine((value, ctx) => {
  if (value.role === "MERCHANT" && !value.businessName) ctx.addIssue({ code: "custom", path: ["businessName"], message: "Business name is required." });
});

type SessionUserSource = Pick<UserDocument, "_id" | "email" | "displayName" | "role" | "emailVerified" | "status">;

function publicUser(user: SessionUserSource) {
  return { id: user._id.toString(), email: user.email, displayName: user.displayName, role: user.role as Role, emailVerified: user.emailVerified, status: user.status };
}

async function issueSession(req: Request, res: Response, user: SessionUserSource) {
  const safe = publicUser(user);
  const jti = nanoid(32);
  const refreshToken = signRefreshToken(safe, jti);
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    jti,
    expiresAt: new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 86_400_000),
    ip: req.ip,
    userAgent: req.header("user-agent"),
  });
  res.cookie("nhp_refresh", refreshToken, {
    httpOnly: true,
    secure: config.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/api/v1/auth",
    maxAge: config.JWT_REFRESH_TTL_DAYS * 86_400_000,
  });
  return { accessToken: signAccessToken(safe), user: safe };
}

router.post("/register", rateLimit(10, 60_000), validate(registerSchema), asyncHandler(async (req, res) => {
  const existing = await User.exists({ email: req.body.email });
  if (existing) throw new AppError(409, "EMAIL_EXISTS", "An account already exists for this email.");
  const verificationToken = randomToken();
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const mongoSession = await mongoose.startSession();
  let user: UserDocument | undefined;
  try {
    await mongoSession.withTransaction(async () => {
      const createdUsers = await User.create([{
        email: req.body.email,
        passwordHash,
        displayName: req.body.displayName,
        phone: req.body.phone,
        role: req.body.role,
        status: "ACTIVE",
        emailVerificationTokenHash: hashToken(verificationToken),
        emailVerificationExpiresAt: new Date(Date.now() + 24 * 3_600_000),
      }], { session: mongoSession });
      const createdUser = createdUsers[0];
      if (!createdUser) throw new AppError(500, "USER_PROVISIONING_FAILED", "User account could not be provisioned.");
      user = createdUser;
      if (req.body.role === "CUSTOMER") {
        await CustomerProfile.create([{ userId: user._id }], { session: mongoSession });
        await Wallet.create([{ walletId: publicId("NHPW"), ownerType: "CUSTOMER", ownerId: user._id, balancePaisa: 0 }], { session: mongoSession });
      } else {
        const [merchant] = await Merchant.create([{ userId: user._id, businessName: req.body.businessName, approvalStatus: "PENDING" }], { session: mongoSession });
        if (!merchant) throw new AppError(500, "MERCHANT_PROVISIONING_FAILED", "Merchant profile could not be provisioned.");
        await Wallet.create([{ walletId: publicId("NHPMW"), ownerType: "MERCHANT", ownerId: merchant._id, balancePaisa: 0 }], { session: mongoSession });
      }
    });
  } finally {
    await mongoSession.endSession();
  }
  if (!user) throw new AppError(500, "USER_PROVISIONING_FAILED", "User account could not be provisioned.");
  req.auth = { userId: user._id.toString(), role: user.role, email: user.email };
  await audit(req, "USER_REGISTERED", { type: "User", id: user._id.toString() });
  const session = await issueSession(req, res, user);
  res.status(201).json({ success: true, data: { ...session, ...(config.NODE_ENV !== "production" ? { developmentVerificationToken: verificationToken } : {}) } });
}));

router.post("/login", rateLimit(8, 15 * 60_000), validate(z.object({ email: z.string().email(), password: z.string().min(1) })), asyncHandler(async (req, res) => {
  const email = req.body.email.toLowerCase();
  const user = await User.findOne({ email }).select("+passwordHash");
  const passwordValid = user ? await bcrypt.compare(req.body.password, user.passwordHash) : false;
  if (!user || !passwordValid) {
    if (user) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) user.lockUntil = new Date(Date.now() + 15 * 60_000);
      await user.save();
    }
    await securityEvent(req, { userId: user?._id?.toString(), category: "AUTHENTICATION", action: "LOGIN_FAILED", severity: "WARNING", success: false });
    await audit(req, "LOGIN_FAILED", user ? { type: "User", id: user._id.toString() } : undefined);
    throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  if (user.lockUntil && user.lockUntil > new Date()) throw new AppError(423, "ACCOUNT_LOCKED", "Account is temporarily locked after repeated failed attempts.");
  if (["FROZEN", "SUSPENDED"].includes(user.status)) throw new AppError(403, "ACCOUNT_UNAVAILABLE", "This account is not available for sign-in.");
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  req.auth = { userId: user._id.toString(), role: user.role, email: user.email };
  await securityEvent(req, { userId: user._id.toString(), category: "AUTHENTICATION", action: "USER_LOGIN", success: true });
  await audit(req, "USER_LOGIN", { type: "User", id: user._id.toString() });
  res.json({ success: true, data: await issueSession(req, res, user) });
}));

router.post("/refresh", rateLimit(30, 60_000), asyncHandler(async (req, res) => {
  const token = req.cookies?.nhp_refresh as string | undefined;
  if (!token) throw new AppError(401, "REFRESH_REQUIRED", "Refresh session is missing.");
  let payload;
  try { payload = verifyRefreshToken(token); } catch { throw new AppError(401, "INVALID_REFRESH", "Refresh session has expired."); }
  const saved = await RefreshToken.findOneAndUpdate(
    { tokenHash: hashToken(token), jti: payload.jti, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
    { new: true },
  );
  if (!saved) {
    await RefreshToken.updateMany({ userId: payload.sub, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
    throw new AppError(401, "REFRESH_REUSED", "Refresh session is no longer valid. All refresh sessions were revoked.");
  }
  const user = await User.findById(payload.sub);
  if (!user || user.status !== "ACTIVE") throw new AppError(401, "ACCOUNT_UNAVAILABLE", "Account is unavailable.");
  res.json({ success: true, data: await issueSession(req, res, user) });
}));

router.post("/logout", asyncHandler(async (req, res) => {
  const token = req.cookies?.nhp_refresh as string | undefined;
  if (token) await RefreshToken.updateOne({ tokenHash: hashToken(token) }, { $set: { revokedAt: new Date() } });
  const accessToken = req.header("authorization")?.startsWith("Bearer ") ? req.header("authorization")!.slice(7) : undefined;
  if (accessToken) {
    try {
      const payload = verifyAccessToken(accessToken);
      req.auth = { userId: payload.sub, role: payload.role, email: payload.email, tokenJti: payload.jti, tokenExpiresAt: payload.exp };
      if (payload.jti) await revokeAccessToken(payload.jti, Math.max(1, (payload.exp ?? Math.floor(Date.now() / 1000) + 60) - Math.floor(Date.now() / 1000)));
    } catch { /* an invalid access token does not prevent refresh-token logout */ }
  }
  res.clearCookie("nhp_refresh", { path: "/api/v1/auth" });
  await audit(req, "USER_LOGOUT");
  res.json({ success: true, data: { message: "Signed out." } });
}));

router.get("/me", authenticate, asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found.");
  res.json({ success: true, data: publicUser(user) });
}));

router.post("/verify-email", validate(z.object({ token: z.string().min(20) })), asyncHandler(async (req, res) => {
  const user = await User.findOne({ emailVerificationTokenHash: hashToken(req.body.token), emailVerificationExpiresAt: { $gt: new Date() } }).select("+emailVerificationTokenHash");
  if (!user) throw new AppError(400, "INVALID_TOKEN", "Verification token is invalid or expired.");
  user.emailVerified = true;
  user.emailVerificationTokenHash = undefined;
  user.emailVerificationExpiresAt = undefined;
  await user.save();
  res.json({ success: true, data: { message: "Email verified." } });
}));

router.post("/forgot-password", rateLimit(5, 60_000), validate(z.object({ email: z.string().email() })), asyncHandler(async (req, res) => {
  const resetToken = randomToken();
  await User.updateOne({ email: req.body.email.toLowerCase() }, { $set: { passwordResetTokenHash: hashToken(resetToken), passwordResetExpiresAt: new Date(Date.now() + 3_600_000) } });
  res.json({ success: true, data: { message: "If an account exists, reset instructions have been created.", ...(config.NODE_ENV !== "production" ? { developmentResetToken: resetToken } : {}) } });
}));

router.post("/reset-password", rateLimit(5, 60_000), validate(z.object({ token: z.string().min(20), password })), asyncHandler(async (req, res) => {
  const user = await User.findOne({ passwordResetTokenHash: hashToken(req.body.token), passwordResetExpiresAt: { $gt: new Date() } }).select("+passwordHash +passwordResetTokenHash");
  if (!user) throw new AppError(400, "INVALID_TOKEN", "Reset token is invalid or expired.");
  user.passwordHash = await bcrypt.hash(req.body.password, 12);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.securityChangedAt = new Date();
  await user.save();
  await RefreshToken.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  req.auth = { userId: user._id.toString(), role: user.role, email: user.email };
  await audit(req, "PASSWORD_RESET", { type: "User", id: user._id.toString() });
  res.json({ success: true, data: { message: "Password reset successfully." } });
}));

export default router;
