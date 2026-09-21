import crypto from "node:crypto";
import { Router } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import { toPaisa, fromPaisa } from "../lib/money.js";
import { publicId } from "../lib/ids.js";
import { hashToken, randomToken } from "../lib/auth.js";
import { audit, securityEvent } from "../lib/audit.js";
import { emitPayment } from "../lib/realtime.js";
import { FraudAlert, Merchant, Notification, PalmEnrollment, PalmVerification, PaymentRequest, Transaction, User, Wallet } from "../models/index.js";
import { palmClient } from "../services/palm-client.js";
import { assessPaymentRisk } from "../services/risk.js";
import { paymentProvider } from "../services/payment-provider.js";
import { transitionPayment } from "../services/payment-state.js";

const router = Router();
router.use(authenticate, authorize("MERCHANT"));
const dataImage = z.string().startsWith("data:image/").max(5_000_000);

async function getMerchant(userId: string) {
  const merchant: any = await Merchant.findOne({ userId });
  if (!merchant) throw new AppError(404, "MERCHANT_NOT_FOUND", "Merchant profile was not found.");
  if (merchant.approvalStatus !== "APPROVED") throw new AppError(403, "MERCHANT_NOT_APPROVED", "Merchant must be approved before accepting payments.");
  return merchant;
}

router.post("/requests", validate(z.object({ amount: z.number().positive().max(1_000_000), description: z.string().trim().max(180).optional(), idempotencyKey: z.string().min(8).max(100) })), asyncHandler(async (req, res) => {
  const merchant = await getMerchant(req.auth!.userId);
  const existing: any = await PaymentRequest.findOne({ merchantId: merchant._id, idempotencyKey: req.body.idempotencyKey }).lean();
  if (existing) return res.json({ success: true, data: { id: existing.publicId, state: existing.state, amount: fromPaisa(existing.amountPaisa), expiresAt: existing.expiresAt, duplicate: true } });
  const payment: any = await PaymentRequest.create({
    publicId: publicId("NHPR"), merchantId: merchant._id, amountPaisa: toPaisa(req.body.amount), description: req.body.description,
    state: "PALM_PENDING", idempotencyKey: req.body.idempotencyKey, expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  await audit(req, "PAYMENT_REQUESTED", { type: "PaymentRequest", id: payment.publicId }, { amountPaisa: payment.amountPaisa });
  emitPayment(payment.publicId, "PALM_PENDING");
  res.status(201).json({ success: true, data: { id: payment.publicId, state: payment.state, amount: fromPaisa(payment.amountPaisa), expiresAt: payment.expiresAt } });
}));

router.post("/requests/:id/identify", validate(z.object({ id: z.string().min(10) }), "params"), validate(z.object({ image: dataImage })), asyncHandler(async (req, res) => {
  const merchant = await getMerchant(req.auth!.userId);
  const payment: any = await PaymentRequest.findOne({ publicId: req.params.id, merchantId: merchant._id }).select("+confirmationTokenHash");
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment request was not found.");
  if (payment.expiresAt < new Date()) { transitionPayment(payment, "EXPIRED"); await payment.save(); emitPayment(payment.publicId, "EXPIRED"); throw new AppError(410, "PAYMENT_EXPIRED", "Payment request has expired."); }
  if (payment.state !== "PALM_PENDING") throw new AppError(409, "INVALID_PAYMENT_STATE", `Palm scan is not allowed while payment is ${payment.state}.`);
  emitPayment(payment.publicId, "VERIFYING");
  const match = await palmClient.identify(req.body.image);
  const verification: any = await PalmVerification.create({
    verificationId: publicId("PV"), userId: match.userId, paymentRequestId: payment._id, matched: match.matched,
    similarity: match.similarity, threshold: match.threshold, algorithmVersion: match.algorithmVersion,
    failureReason: match.matched ? undefined : "NO_CONFIDENT_MATCH", ip: req.ip,
  });
  if (!match.matched || !match.userId) {
    await securityEvent(req, { category: "PALM", action: "PALM_IDENTIFICATION_FAILED", severity: "WARNING", success: false, metadata: { paymentId: payment.publicId, similarity: match.similarity } });
    emitPayment(payment.publicId, "PALM_PENDING", { message: "No confident match. Try again." });
    throw new AppError(401, "PALM_NOT_RECOGNIZED", "Palm could not be confidently recognized.");
  }
  const [customer, enrollment] = await Promise.all([
    User.findOne({ _id: match.userId, role: "CUSTOMER", status: "ACTIVE" }),
    PalmEnrollment.findOne({ userId: match.userId, status: "ACTIVE" }),
  ]);
  if (!customer || !enrollment) throw new AppError(403, "CUSTOMER_UNAVAILABLE", "Matched customer account is unavailable.");
  const risk = await assessPaymentRisk(match.userId, payment.amountPaisa, merchant.createdAt);
  payment.customerId = customer._id;
  payment.palmVerificationId = verification._id;
  payment.riskScore = risk.score;
  payment.riskLevel = risk.level;
  payment.requiresPin = risk.requiresPin;
  if (risk.level === "CRITICAL") {
    transitionPayment(payment, "DECLINED");
    await payment.save();
    await FraudAlert.create({ userId: customer._id, paymentRequestId: payment._id, riskScore: risk.score, riskLevel: risk.level, indicators: risk.indicators, status: "BLOCKED" });
    emitPayment(payment.publicId, "DECLINED", { riskLevel: risk.level });
    throw new AppError(403, "PAYMENT_BLOCKED", "Payment was blocked by the risk policy.");
  }
  const confirmationToken = randomToken();
  payment.confirmationTokenHash = hashToken(confirmationToken);
  transitionPayment(payment, "PALM_VERIFIED");
  emitPayment(payment.publicId, "PALM_VERIFIED");
  transitionPayment(payment, "CUSTOMER_CONFIRMATION");
  await payment.save();
  if (risk.level !== "LOW") await FraudAlert.create({ userId: customer._id, paymentRequestId: payment._id, riskScore: risk.score, riskLevel: risk.level, indicators: risk.indicators });
  await securityEvent(req, { userId: customer._id.toString(), category: "PALM", action: "PALM_VERIFICATION_SUCCESS", success: true, metadata: { paymentId: payment.publicId, similarity: match.similarity } });
  const parts = customer.displayName.trim().split(/\s+/);
  const minimalName = `${parts[0]}${parts.length > 1 ? ` ${parts.at(-1)?.[0]}.` : ""}`;
  emitPayment(payment.publicId, "CUSTOMER_CONFIRMATION", { customerName: minimalName, riskLevel: risk.level });
  res.json({ success: true, data: { paymentId: payment.publicId, customerName: minimalName, amount: fromPaisa(payment.amountPaisa), merchantName: merchant.businessName, similarity: match.similarity, riskLevel: risk.level, requiresPin: risk.requiresPin, confirmationToken } });
}));

router.post("/requests/:id/confirm", validate(z.object({ id: z.string().min(10) }), "params"), validate(z.object({ confirmationToken: z.string().min(20), decision: z.enum(["CONFIRM", "DECLINE"]), pin: z.string().regex(/^\d{4,8}$/).optional() })), asyncHandler(async (req, res) => {
  const merchant = await getMerchant(req.auth!.userId);
  const payment: any = await PaymentRequest.findOne({ publicId: req.params.id, merchantId: merchant._id }).select("+confirmationTokenHash");
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment request was not found.");
  if (payment.state !== "CUSTOMER_CONFIRMATION") throw new AppError(409, "INVALID_PAYMENT_STATE", `Payment cannot be confirmed while ${payment.state}.`);
  if (payment.expiresAt < new Date()) { transitionPayment(payment, "EXPIRED"); await payment.save(); emitPayment(payment.publicId, "EXPIRED"); throw new AppError(410, "PAYMENT_EXPIRED", "Payment request has expired."); }
  const provided = Buffer.from(hashToken(req.body.confirmationToken));
  const expected = Buffer.from(payment.confirmationTokenHash ?? "");
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) throw new AppError(401, "INVALID_CONFIRMATION", "Confirmation session is invalid.");
  if (req.body.decision === "DECLINE") {
    transitionPayment(payment, "DECLINED"); payment.confirmationTokenHash = undefined; await payment.save();
    await audit(req, "PAYMENT_DECLINED", { type: "PaymentRequest", id: payment.publicId });
    emitPayment(payment.publicId, "DECLINED");
    return res.json({ success: true, data: { state: "DECLINED" } });
  }
  if (payment.requiresPin) {
    const customer: any = await User.findById(payment.customerId).select("+paymentPinHash");
    if (!customer?.paymentPinHash || !req.body.pin || !(await bcrypt.compare(req.body.pin, customer.paymentPinHash))) {
      await securityEvent(req, { userId: payment.customerId.toString(), category: "PAYMENT", action: "PAYMENT_PIN_FAILED", severity: "HIGH", success: false, metadata: { paymentId: payment.publicId } });
      throw new AppError(401, "INVALID_PAYMENT_PIN", "Payment PIN is incorrect.");
    }
  }
  await paymentProvider.authorize(payment.customerId.toString(), payment.amountPaisa);
  transitionPayment(payment, "PROCESSING"); payment.confirmedAt = new Date(); payment.confirmationTokenHash = undefined; await payment.save();
  emitPayment(payment.publicId, "PROCESSING");
  const session = await mongoose.startSession();
  let transaction: any;
  try {
    await session.withTransaction(async () => {
      const existing = await Transaction.findOne({ paymentRequestId: payment._id }).session(session);
      if (existing) { transaction = existing; return; }
      await paymentProvider.capture(payment.customerId.toString(), merchant._id.toString(), payment.amountPaisa, session);
      [transaction] = await Transaction.create([{
        transactionId: publicId("NHP"), customerId: payment.customerId, merchantId: merchant._id, paymentRequestId: payment._id,
        amountPaisa: payment.amountPaisa, type: "PAYMENT", status: "SUCCESS", palmVerificationId: payment.palmVerificationId,
        riskLevel: payment.riskLevel, riskScore: payment.riskScore, description: payment.description, completedAt: new Date(),
      }], { session });
      transitionPayment(payment, "SUCCESS");
      await payment.save({ session });
      await Notification.create([{
        userId: payment.customerId, type: "PAYMENT_SUCCESS", title: "Payment successful",
        message: `NPR ${fromPaisa(payment.amountPaisa).toLocaleString()} paid to ${merchant.businessName}.`, metadata: { transactionId: transaction.transactionId },
      }], { session });
    });
  } catch (error) {
    transitionPayment(payment, "FAILED"); await payment.save(); emitPayment(payment.publicId, "FAILED"); throw error;
  } finally { await session.endSession(); }
  const wallet: any = await Wallet.findOne({ ownerType: "CUSTOMER", ownerId: payment.customerId }).lean();
  await audit(req, "PAYMENT_CONFIRMED", { type: "Transaction", id: transaction.transactionId }, { amountPaisa: payment.amountPaisa });
  emitPayment(payment.publicId, "SUCCESS", { transactionId: transaction.transactionId });
  res.json({ success: true, data: { state: "SUCCESS", transactionId: transaction.transactionId, amount: fromPaisa(payment.amountPaisa), remainingBalance: fromPaisa(wallet.balancePaisa) } });
}));

router.post("/requests/:id/cancel", validate(z.object({ id: z.string().min(10) }), "params"), asyncHandler(async (req, res) => {
  const merchant = await getMerchant(req.auth!.userId);
  const payment: any = await PaymentRequest.findOne({ publicId: req.params.id, merchantId: merchant._id });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment request was not found.");
  if (["SUCCESS", "PROCESSING", "DECLINED", "CANCELLED"].includes(payment.state)) throw new AppError(409, "INVALID_PAYMENT_STATE", "This payment can no longer be cancelled.");
  transitionPayment(payment, "CANCELLED"); await payment.save(); emitPayment(payment.publicId, "CANCELLED");
  res.json({ success: true, data: { state: "CANCELLED" } });
}));

export default router;
