import { Router } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { Response, Request } from "express";
import type { Role } from "@nepal-hand-pay/shared-types";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/errors.js";
import {
  hashToken,
  randomToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../lib/auth.js";
import { audit, securityEvent } from "../lib/audit.js";
import { config } from "../config.js";
import {
  CustomerProfile,
  Merchant,
  Notification,
  RefreshToken,
  User,
  type UserDocument,
  Wallet,
} from "../models/index.js";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { publicId } from "../lib/ids.js";
import { revokeAccessToken, revokeSession } from "../lib/redis.js";
import { permissionsFor } from "../lib/permissions.js";
import { emailService } from "../services/email.js";
import { emitNotification } from "../lib/realtime.js";

const router = Router();
const password = z
  .string()
  .min(10, "Must be at least 10 characters")
  .max(128, "Must be no more than 128 characters")
  .regex(/[A-Z]/, "Must include an uppercase letter")
  .regex(/[a-z]/, "Must include a lowercase letter")
  .regex(/[0-9]/, "Must include a number");

const registerSchema = z
  .object({
    email: z
      .string()
      .email("Enter a valid email address")
      .transform((value) => value.toLowerCase()),
    password,
    displayName: z.string().trim().min(2, "Enter at least 2 characters").max(100),
    phone: z.string().trim().max(30, "Enter no more than 30 characters").optional(),
    role: z.enum(["CUSTOMER", "MERCHANT"]).default("CUSTOMER"),
    businessName: z.string().trim().min(2, "Enter at least 2 characters").max(160).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.role === "MERCHANT" && !value.businessName)
      ctx.addIssue({
        code: "custom",
        path: ["businessName"],
        message: "Business name is required.",
      });
  });

type SessionUserSource = Pick<
  UserDocument,
  "_id" | "email" | "displayName" | "role" | "emailVerified" | "status"
>;

function publicUser(user: SessionUserSource) {
  const role = user.role as Role;
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    role,
    emailVerified: user.emailVerified,
    status: user.status,
    permissions: permissionsFor(role),
  };
}

async function issueSession(
  req: Request,
  res: Response,
  user: SessionUserSource,
  rotatedFromJti?: string,
) {
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
    lastActiveAt: new Date(),
    rotatedFromJti,
  });
  res.cookie("nhp_refresh", refreshToken, {
    httpOnly: true,
    secure: config.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/api/v1/auth",
    maxAge: config.JWT_REFRESH_TTL_DAYS * 86_400_000,
  });
  return { accessToken: signAccessToken(safe, jti), user: safe };
}

function describeDevice(userAgent = "") {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Unknown browser";
  const device = /Android/i.test(userAgent)
    ? "Android device"
    : /iPhone|iPad/i.test(userAgent)
      ? "Apple mobile device"
      : /Windows/i.test(userAgent)
        ? "Windows device"
        : /Mac OS/i.test(userAgent)
          ? "Mac device"
          : /Linux/i.test(userAgent)
            ? "Linux device"
            : "Unknown device";
  return { browser, device };
}

router.post(
  "/register",
  rateLimit(10, 60_000),
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const existing = await User.exists({ email: req.body.email });
    if (existing)
      throw new AppError(
        409,
        "EMAIL_EXISTS",
        "An account already exists for this email.",
      );
    const verificationToken = randomToken();
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const mongoSession = await mongoose.startSession();
    let user: UserDocument | undefined;
    try {
      await mongoSession.withTransaction(async () => {
        const createdUsers = await User.create(
          [
            {
              email: req.body.email,
              passwordHash,
              displayName: req.body.displayName,
              phone: req.body.phone,
              role: req.body.role,
              status: "ACTIVE",
              emailVerificationTokenHash: hashToken(verificationToken),
              emailVerificationExpiresAt: new Date(
                Date.now() + config.EMAIL_VERIFICATION_TTL_HOURS * 3_600_000,
              ),
            },
          ],
          { session: mongoSession },
        );
        const createdUser = createdUsers[0];
        if (!createdUser)
          throw new AppError(
            500,
            "USER_PROVISIONING_FAILED",
            "User account could not be provisioned.",
          );
        user = createdUser;
        if (req.body.role === "CUSTOMER") {
          await CustomerProfile.create([{ userId: user._id }], {
            session: mongoSession,
          });
          await Wallet.create(
            [
              {
                walletId: publicId("NHPW"),
                ownerType: "CUSTOMER",
                ownerId: user._id,
                balancePaisa: 0,
              },
            ],
            { session: mongoSession },
          );
        } else {
          const [merchant] = await Merchant.create(
            [
              {
                userId: user._id,
                businessName: req.body.businessName,
                approvalStatus: "DRAFT",
              },
            ],
            { session: mongoSession },
          );
          if (!merchant)
            throw new AppError(
              500,
              "MERCHANT_PROVISIONING_FAILED",
              "Merchant profile could not be provisioned.",
            );
          await Wallet.create(
            [
              {
                walletId: publicId("NHPMW"),
                ownerType: "MERCHANT",
                ownerId: merchant._id,
                balancePaisa: 0,
              },
            ],
            { session: mongoSession },
          );
        }
      });
    } finally {
      await mongoSession.endSession();
    }
    if (!user)
      throw new AppError(
        500,
        "USER_PROVISIONING_FAILED",
        "User account could not be provisioned.",
      );
    req.auth = {
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    };
    await audit(req, "USER_REGISTERED", {
      type: "User",
      id: user._id.toString(),
    });
    const emailDelivery = await emailService.sendVerification({
      to: user.email,
      displayName: user.displayName,
      token: verificationToken,
    });
    const session = await issueSession(req, res, user);
    res
      .status(201)
      .json({
        success: true,
        data: {
           ...session,
          emailDelivery,
          ...(config.NODE_ENV !== "production"
            ? { developmentVerificationToken: verificationToken }
            : {}),
        },
      });
  }),
);

router.post(
  "/login",
  rateLimit(8, 15 * 60_000),
  validate(
    z.object({ email: z.string().email(), password: z.string().min(1) }),
  ),
  asyncHandler(async (req, res) => {
    const email = req.body.email.toLowerCase();
    const user = await User.findOne({ email }).select("+passwordHash");
    if (user?.lockUntil && user.lockUntil > new Date()) {
      await securityEvent(req, {
        userId: user._id.toString(),
        category: "AUTHENTICATION",
        action: "LOGIN_BLOCKED_ACCOUNT_LOCKED",
        severity: "HIGH",
        success: false,
      });
      throw new AppError(
        423,
        "AUTH_ACCOUNT_LOCKED",
        "Account is temporarily locked after repeated failed attempts.",
      );
    }
    const passwordValid = user
      ? await bcrypt.compare(req.body.password, user.passwordHash)
      : false;
    if (!user || !passwordValid) {
      let lockedNow = false;
      if (user) {
        user.failedLoginAttempts += 1;
        if (user.failedLoginAttempts >= 5) {
          user.lockUntil = new Date(Date.now() + 15 * 60_000);
          lockedNow = true;
        }
        await user.save();
      }
      await securityEvent(req, {
        userId: user?._id?.toString(),
        category: "AUTHENTICATION",
        action: "LOGIN_FAILED",
        severity: "WARNING",
        success: false,
      });
      await audit(
        req,
        "LOGIN_FAILED",
        user ? { type: "User", id: user._id.toString() } : undefined,
      );
      if (lockedNow && user) {
        await securityEvent(req, {
          userId: user._id.toString(),
          category: "AUTHENTICATION",
          action: "ACCOUNT_LOCKED",
          severity: "HIGH",
          success: false,
          metadata: { reason: "REPEATED_LOGIN_FAILURES" },
        });
        throw new AppError(
          423,
          "AUTH_ACCOUNT_LOCKED",
          "Account is temporarily locked after repeated failed attempts.",
        );
      }
      throw new AppError(
        401,
        "AUTH_INVALID_CREDENTIALS",
        "Invalid email or password.",
      );
    }
    if (["FROZEN", "SUSPENDED"].includes(user.status))
      throw new AppError(
        403,
        "AUTH_ACCOUNT_UNAVAILABLE",
        "This account is not available for sign-in.",
      );
    if (!user.emailVerified)
      throw new AppError(
        403,
        "AUTH_EMAIL_NOT_VERIFIED",
        "Verify your email before signing in.",
      );
    const knownDevice = await RefreshToken.exists({
      userId: user._id,
      userAgent: req.header("user-agent"),
      ip: req.ip,
    });
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    user.lastLoginAt = new Date();
    user.lastLoginIp = req.ip;
    user.lastLoginUserAgent = req.header("user-agent");
    await user.save();
    req.auth = {
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    };
    await securityEvent(req, {
      userId: user._id.toString(),
      category: "AUTHENTICATION",
      action: knownDevice ? "USER_LOGIN" : "NEW_DEVICE_LOGIN",
      severity: knownDevice ? "INFO" : "WARNING",
      success: true,
    });
    if (!knownDevice) {
      const device = describeDevice(req.header("user-agent")).device;
      const notification = await Notification.create({
        userId: user._id,
        type: "SECURITY_ALERT",
        category: "SECURITY",
        severity: "HIGH",
        title: "New device sign-in",
        message: `A new ${device.toLowerCase()} signed in to your account.`,
      });
      emitNotification(user._id.toString(), notification.toObject());
      await emailService.sendSecurityAlert({
        to: user.email,
        displayName: user.displayName,
        device,
        occurredAt: new Date(),
      });
    }
    await audit(req, "USER_LOGIN", { type: "User", id: user._id.toString() });
    res.json({ success: true, data: await issueSession(req, res, user) });
  }),
);

router.post(
  "/refresh",
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const token = req.cookies?.nhp_refresh as string | undefined;
    if (!token)
      throw new AppError(
        401,
        "REFRESH_REQUIRED",
        "Refresh session is missing.",
      );
    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw new AppError(
        401,
        "INVALID_REFRESH",
        "Refresh session has expired.",
      );
    }
    const saved = await RefreshToken.findOneAndUpdate(
      {
        tokenHash: hashToken(token),
        jti: payload.jti,
        revokedAt: { $exists: false },
      },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason: "ROTATED",
          lastActiveAt: new Date(),
        },
      },
      { new: true },
    );
    if (!saved) {
      const active = await RefreshToken.find({
        userId: payload.sub,
        revokedAt: { $exists: false },
      })
        .select("jti expiresAt")
        .lean();
      await RefreshToken.updateMany(
        { userId: payload.sub, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date(), revokedReason: "REUSE_DETECTED" } },
      );
      await Promise.all(
        active.map((item) =>
          revokeSession(
            item.jti,
            Math.max(
              1,
              Math.ceil((item.expiresAt.getTime() - Date.now()) / 1000),
            ),
          ),
        ),
      );
      await securityEvent(req, {
        userId: payload.sub,
        category: "AUTHENTICATION",
        action: "TOKEN_REUSE",
        severity: "CRITICAL",
        success: false,
      });
      throw new AppError(
        401,
        "AUTH_REFRESH_REUSED",
        "Refresh session is no longer valid. All sessions were revoked.",
      );
    }
    const user = await User.findById(payload.sub);
    if (!user || user.status !== "ACTIVE")
      throw new AppError(401, "ACCOUNT_UNAVAILABLE", "Account is unavailable.");
    await revokeSession(
      saved.jti,
      Math.max(1, Math.ceil((saved.expiresAt.getTime() - Date.now()) / 1000)),
    );
    res.json({
      success: true,
      data: await issueSession(req, res, user, saved.jti),
    });
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.nhp_refresh as string | undefined;
    if (token) {
      const session = await RefreshToken.findOneAndUpdate(
        { tokenHash: hashToken(token), revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date(), revokedReason: "LOGOUT" } },
        { new: true },
      );
      if (session)
        await revokeSession(
          session.jti,
          Math.max(
            1,
            Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000),
          ),
        );
    }
    const accessToken = req.header("authorization")?.startsWith("Bearer ")
      ? req.header("authorization")!.slice(7)
      : undefined;
    if (accessToken) {
      try {
        const payload = verifyAccessToken(accessToken);
        req.auth = {
          userId: payload.sub,
          role: payload.role,
          email: payload.email,
          tokenJti: payload.jti,
          tokenExpiresAt: payload.exp,
          sessionId: payload.sid,
        };
        if (payload.jti)
          await revokeAccessToken(
            payload.jti,
            Math.max(
              1,
              (payload.exp ?? Math.floor(Date.now() / 1000) + 60) -
                Math.floor(Date.now() / 1000),
            ),
          );
      } catch {
        /* an invalid access token does not prevent refresh-token logout */
      }
    }
    res.clearCookie("nhp_refresh", { path: "/api/v1/auth" });
    await audit(req, "USER_LOGOUT");
    res.json({ success: true, data: { message: "Signed out." } });
  }),
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth!.userId);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found.");
    res.json({ success: true, data: publicUser(user) });
  }),
);

router.get(
  "/sessions",
  authenticate,
  asyncHandler(async (req, res) => {
    const sessions = await RefreshToken.find({
      userId: req.auth!.userId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    })
      .select("jti ip userAgent createdAt lastActiveAt expiresAt")
      .sort({ lastActiveAt: -1 })
      .lean();
    res.json({
      success: true,
      data: sessions.map((session) => ({
        id: session._id.toString(),
          ...describeDevice(session.userAgent ?? undefined),
        ip: session.ip,
        loginTime: session.createdAt,
        lastActive: session.lastActiveAt,
        expiresAt: session.expiresAt,
        current: session.jti === req.auth!.sessionId,
      })),
    });
  }),
);

router.delete(
  "/sessions/:id",
  authenticate,
  validate(z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }), "params"),
  asyncHandler(async (req, res) => {
    const session = await RefreshToken.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.auth!.userId,
        revokedAt: { $exists: false },
      },
      { $set: { revokedAt: new Date(), revokedReason: "USER_REVOKED" } },
      { new: true },
    );
    if (!session)
      throw new AppError(
        404,
        "SESSION_NOT_FOUND",
        "Active session was not found.",
      );
    await revokeSession(
      session.jti,
      Math.max(1, Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000)),
    );
    await audit(req, "SESSION_REVOKED", {
      type: "RefreshToken",
      id: session._id.toString(),
    });
    res.json({
      success: true,
      data: { revoked: true, current: session.jti === req.auth!.sessionId },
    });
  }),
);

router.post(
  "/logout-all",
  authenticate,
  asyncHandler(async (req, res) => {
    const sessions = await RefreshToken.find({
      userId: req.auth!.userId,
      revokedAt: { $exists: false },
    })
      .select("jti expiresAt")
      .lean();
    await RefreshToken.updateMany(
      { userId: req.auth!.userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokedReason: "LOGOUT_ALL" } },
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
    if (req.auth!.tokenJti && req.auth!.tokenExpiresAt)
      await revokeAccessToken(
        req.auth!.tokenJti,
        Math.max(1, req.auth!.tokenExpiresAt - Math.floor(Date.now() / 1000)),
      );
    res.clearCookie("nhp_refresh", { path: "/api/v1/auth" });
    await audit(req, "ALL_SESSIONS_REVOKED", {
      type: "User",
      id: req.auth!.userId,
    });
    res.json({ success: true, data: { revoked: sessions.length } });
  }),
);

router.post(
  "/verify-email",
  validate(z.object({ token: z.string().min(20) })),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({
      emailVerificationTokenHash: hashToken(req.body.token),
      emailVerificationExpiresAt: { $gt: new Date() },
    }).select("+emailVerificationTokenHash");
    if (!user)
      throw new AppError(
        400,
        "INVALID_TOKEN",
        "Verification token is invalid or expired.",
      );
    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpiresAt = undefined;
    await user.save();
    req.auth = {
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    };
    await audit(req, "EMAIL_VERIFIED", {
      type: "User",
      id: user._id.toString(),
    });
    res.json({ success: true, data: { message: "Email verified." } });
  }),
);

router.post(
  "/resend-verification",
  rateLimit(5, 60_000),
  validate(z.object({ email: z.string().email() })),
  asyncHandler(async (req, res) => {
    const verificationToken = randomToken();
    const user = await User.findOne({
      email: req.body.email.toLowerCase(),
      emailVerified: false,
    });
    if (user) {
      user.emailVerificationTokenHash = hashToken(verificationToken);
      user.emailVerificationExpiresAt = new Date(
        Date.now() + config.EMAIL_VERIFICATION_TTL_HOURS * 3_600_000,
      );
      await user.save();
    }
    const emailDelivery = user
      ? await emailService.sendVerification({
          to: user.email,
          displayName: user.displayName,
          token: verificationToken,
        })
      : undefined;
    res.json({
      success: true,
      data: {
        message:
          "If an unverified account exists, new verification instructions have been created.",
        ...(emailDelivery ? { emailDelivery } : {}),
        ...(config.NODE_ENV !== "production" && user
          ? { developmentVerificationToken: verificationToken }
          : {}),
      },
    });
  }),
);

router.post(
  "/forgot-password",
  rateLimit(5, 60_000),
  validate(z.object({ email: z.string().email() })),
  asyncHandler(async (req, res) => {
    const resetToken = randomToken();
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    let emailDelivery: Awaited<ReturnType<typeof emailService.sendPasswordReset>> | undefined;
    if (user) {
      user.passwordResetTokenHash = hashToken(resetToken);
      user.passwordResetExpiresAt = new Date(
        Date.now() + config.PASSWORD_RESET_TTL_MINUTES * 60_000,
      );
      await user.save();
      emailDelivery = await emailService.sendPasswordReset({
        to: user.email,
        displayName: user.displayName,
        token: resetToken,
      });
    }
    res.json({
      success: true,
      data: {
        message: "If an account exists, reset instructions have been created.",
        ...(emailDelivery ? { emailDelivery } : {}),
        ...(config.NODE_ENV !== "production"
          ? { developmentResetToken: resetToken }
          : {}),
      },
    });
  }),
);

router.post(
  "/reset-password",
  rateLimit(5, 60_000),
  validate(z.object({ token: z.string().min(20), password })),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({
      passwordResetTokenHash: hashToken(req.body.token),
      passwordResetExpiresAt: { $gt: new Date() },
    }).select("+passwordHash +passwordResetTokenHash");
    if (!user)
      throw new AppError(
        400,
        "INVALID_TOKEN",
        "Reset token is invalid or expired.",
      );
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    user.securityChangedAt = new Date();
    await user.save();
    const sessions = await RefreshToken.find({
      userId: user._id,
      revokedAt: { $exists: false },
    })
      .select("jti expiresAt")
      .lean();
    await RefreshToken.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokedReason: "PASSWORD_RESET" } },
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
    req.auth = {
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    };
    await audit(req, "PASSWORD_RESET", {
      type: "User",
      id: user._id.toString(),
    });
    const notification = await Notification.create({
      userId: user._id,
      type: "PASSWORD_CHANGED",
      category: "SECURITY",
      severity: "HIGH",
      title: "Password changed",
      message: "Your password was reset and all active sessions were revoked.",
    });
    emitNotification(user._id.toString(), notification.toObject());
    res.json({
      success: true,
      data: { message: "Password reset successfully." },
    });
  }),
);

export default router;
