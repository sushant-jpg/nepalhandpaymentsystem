import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request } from "express";
import { config } from "../config.js";
import { securityEvent } from "../lib/audit.js";
import { hashToken } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { deleteTemporary, getTemporary, setTemporary } from "../lib/redis.js";
import { User, type UserDocument } from "../models/index.js";
import { emailService } from "./email.js";

export async function verifyPaymentPin(input: {
  req: Request;
  userId: string;
  paymentId: string;
  pin?: string;
}): Promise<UserDocument> {
  const user = await User.findById(input.userId).select(
    "+paymentPinHash +failedPinAttempts +pinLockUntil",
  );
  if (!user || user.status !== "ACTIVE")
    throw new AppError(
      403,
      "CUSTOMER_UNAVAILABLE",
      "Customer account is unavailable.",
    );
  if (user.pinLockUntil && user.pinLockUntil > new Date())
    throw new AppError(
      423,
      "PAYMENT_PIN_LOCKED",
      "Payment PIN is temporarily locked.",
    );
  if (
    !user.paymentPinHash ||
    !input.pin ||
    !(await bcrypt.compare(input.pin, user.paymentPinHash))
  ) {
    user.failedPinAttempts = (user.failedPinAttempts ?? 0) + 1;
    if (user.failedPinAttempts >= config.PIN_MAX_ATTEMPTS)
      user.pinLockUntil = new Date(
        Date.now() + config.PIN_LOCKOUT_SECONDS * 1_000,
      );
    await user.save();
    await securityEvent(input.req, {
      userId: input.userId,
      category: "PAYMENT",
      action: "PAYMENT_PIN_FAILED",
      severity: "HIGH",
      success: false,
      metadata: {
        paymentId: input.paymentId,
        attempts: user.failedPinAttempts,
      },
    });
    throw new AppError(
      user.pinLockUntil ? 423 : 401,
      user.pinLockUntil ? "PAYMENT_PIN_LOCKED" : "INVALID_PAYMENT_PIN",
      user.pinLockUntil
        ? "Payment PIN is temporarily locked."
        : "Payment PIN is incorrect.",
    );
  }
  user.failedPinAttempts = 0;
  user.pinLockUntil = undefined;
  await user.save();
  return user;
}

function otpKey(paymentId: string): string {
  return `payment:otp:${paymentId}`;
}

export async function issuePaymentOtp(input: {
  paymentId: string;
  customer: Pick<UserDocument, "email" | "displayName">;
  merchantName: string;
}): Promise<{ developmentOtp?: string }> {
  const otp = crypto.randomInt(100_000, 1_000_000).toString();
  await setTemporary(
    otpKey(input.paymentId),
    hashToken(otp),
    config.OTP_TTL_SECONDS,
  );
  const delivery = await emailService.sendPaymentOtp({
    to: input.customer.email,
    displayName: input.customer.displayName,
    code: otp,
    merchantName: input.merchantName,
  });
  if (config.NODE_ENV === "production" && delivery !== "sent") {
    await deleteTemporary(otpKey(input.paymentId));
    throw new AppError(
      503,
      "OTP_DELIVERY_FAILED",
      "The payment confirmation code could not be delivered.",
    );
  }
  return config.NODE_ENV === "production" ? {} : { developmentOtp: otp };
}

export async function verifyPaymentOtp(
  paymentId: string,
  otp?: string,
): Promise<void> {
  const stored = await getTemporary(otpKey(paymentId));
  if (!stored)
    throw new AppError(410, "OTP_EXPIRED", "The one-time code has expired.");
  if (!otp || hashToken(otp) !== stored)
    throw new AppError(
      401,
      "INVALID_OTP",
      "The one-time code is incorrect.",
    );
}

export async function consumePaymentOtp(paymentId: string): Promise<void> {
  await deleteTemporary(otpKey(paymentId));
}
