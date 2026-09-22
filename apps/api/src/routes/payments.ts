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
import { assertIdempotentReplay, requestHash, requireIdempotencyKey } from "../lib/idempotency.js";
import { deleteTemporary, getTemporary, incrementCounter, setTemporary, withDistributedLock } from "../lib/redis.js";
import { config } from "../config.js";
import { FraudAlert, Merchant, Notification, PalmEnrollment, PalmVerification, PaymentRequest, Transaction, User, Wallet } from "../models/index.js";
import { palmClient } from "../services/palm-client.js";
import { assessPaymentRisk } from "../services/risk.js";
import { paymentProvider } from "../services/payment-provider.js";
import { transitionPayment } from "../services/payment-state.js";

const router = Router();
router.use(authenticate, authorize("MERCHANT"));

const dataImage = z.string().regex(/^data:image\/(jpeg|png|webp);base64,/, "A JPEG, PNG, or WebP data URL is required.").max(1_500_000);
const idParams = z.object({ id: z.string().regex(/^NHPR-[A-Z0-9-]{10,}$/) });

async function getMerchant(userId: string) {
  const merchant: any = await Merchant.findOne({ userId });
  if (!merchant) throw new AppError(404, "MERCHANT_NOT_FOUND", "Merchant profile was not found.");
  if (merchant.approvalStatus !== "APPROVED") throw new AppError(403, "MERCHANT_NOT_APPROVED", "Merchant must be approved before accepting payments.");
  return merchant;
}

function paymentData(payment: any, extra: Record<string, unknown> = {}) {
  return {
    id: payment.publicId,
    state: payment.state,
    amount: fromPaisa(payment.amountPaisa),
    currency: payment.currency,
    expiresAt: payment.expiresAt,
    orderReference: payment.orderReference,
    providerMode: "MOCK",
    ...extra,
  };
}

async function existingTransactionResult(payment: any) {
  const transaction: any = await Transaction.findOne({ paymentRequestId: payment._id }).lean();
  if (!transaction) return null;
  const wallet: any = await Wallet.findOne({ ownerType: "CUSTOMER", ownerId: payment.customerId }).lean();
  return {
    state: payment.state,
    transactionId: transaction.transactionId,
    amount: fromPaisa(payment.amountPaisa),
    remainingBalance: wallet ? fromPaisa(wallet.balancePaisa) : undefined,
    replayed: true,
  };
}

router.post("/requests", validate(z.object({
  amount: z.number().positive().max(1_000_000),
  description: z.string().trim().max(180).optional(),
  orderReference: z.string().trim().min(1).max(80).optional(),
})), asyncHandler(async (req, res) => {
  const merchant = await getMerchant(req.auth!.userId);
  const idempotencyKey = requireIdempotencyKey(req);
  const bodyHash = requestHash(req.body);
  const existing: any = await PaymentRequest.findOne({ merchantId: merchant._id, idempotencyKey }).select("+idempotencyRequestHash").lean();
  if (existing) {
    assertIdempotentReplay(existing.idempotencyRequestHash, bodyHash);
    return res.json({ success: true, data: paymentData(existing, { duplicate: true }) });
  }

  const paymentId = publicId("NHPR");
  const provider = await paymentProvider.createPayment({ paymentId, amountPaisa: toPaisa(req.body.amount), currency: "NPR" });
  let payment: any;
  try {
    payment = await PaymentRequest.create({
      publicId: paymentId,
      merchantId: merchant._id,
      amountPaisa: toPaisa(req.body.amount),
      description: req.body.description,
      orderReference: req.body.orderReference,
      state: "CREATED",
      idempotencyKey,
      idempotencyRequestHash: bodyHash,
      providerReference: provider.providerReference,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      const raced: any = await PaymentRequest.findOne({ merchantId: merchant._id, idempotencyKey }).select("+idempotencyRequestHash").lean();
      if (raced) {
        assertIdempotentReplay(raced.idempotencyRequestHash, bodyHash);
        return res.json({ success: true, data: paymentData(raced, { duplicate: true }) });
      }
    }
    throw error;
  }
  transitionPayment(payment, "AWAITING_PALM");
  await payment.save();
  await setTemporary(`payment:session:${payment.publicId}`, JSON.stringify({ merchantId: merchant._id, state: payment.state }), 300);
  await audit(req, "PAYMENT_CREATED", { type: "PaymentRequest", id: payment.publicId }, { amountPaisa: payment.amountPaisa, providerMode: "MOCK" });
  emitPayment(payment.publicId, payment.state);
  res.status(201).json({ success: true, data: paymentData(payment) });
}));

router.get("/requests/:id", validate(idParams, "params"), asyncHandler(async (req, res) => {
  const merchant = await getMerchant(req.auth!.userId);
  const payment: any = await PaymentRequest.findOne({ publicId: req.params.id, merchantId: merchant._id }).lean();
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment request was not found.");
  const transaction: any = await Transaction.findOne({ paymentRequestId: payment._id }).select("transactionId status").lean();
  res.json({ success: true, data: paymentData(payment, { transactionId: transaction?.transactionId, transactionStatus: transaction?.status }) });
}));

router.post("/requests/:id/identify", validate(idParams, "params"), validate(z.object({ image: dataImage })), asyncHandler(async (req, res) => {
  const merchant = await getMerchant(req.auth!.userId);
  await withDistributedLock(`identify:${req.params.id}`, 20_000, async () => {
    const payment: any = await PaymentRequest.findOne({ publicId: req.params.id, merchantId: merchant._id }).select("+confirmationTokenHash");
    if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment request was not found.");
    if (payment.expiresAt < new Date()) {
      if (payment.state === "AWAITING_PALM") {
        transitionPayment(payment, "EXPIRED");
        await payment.save();
      }
      emitPayment(payment.publicId, "EXPIRED");
      throw new AppError(410, "PAYMENT_EXPIRED", "Payment request has expired.");
    }
    if (payment.state !== "AWAITING_PALM") throw new AppError(409, "INVALID_PAYMENT_STATE", `Palm scan is not allowed while payment is ${payment.state}.`);

    const failureKey = `palm:fail:${payment.publicId}`;
    const previousFailures = Number(await getTemporary(failureKey) ?? "0");
    if (previousFailures >= config.PALM_MAX_ATTEMPTS) throw new AppError(423, "PALM_SCAN_LOCKED", "Palm scanning is temporarily locked after repeated failed matches.");

    emitPayment(payment.publicId, "VERIFYING");
    const match = await palmClient.identify(req.body.image);
    const verification: any = await PalmVerification.create({
      verificationId: publicId("PV"), userId: match.userId, paymentRequestId: payment._id, matched: match.matched,
      similarity: match.similarity, threshold: match.threshold, algorithmVersion: match.algorithmVersion,
      failureReason: match.matched ? undefined : "NO_CONFIDENT_MATCH", ip: req.ip,
    });
    if (!match.matched || !match.userId) {
      const failures = await incrementCounter(failureKey, config.PALM_LOCKOUT_SECONDS);
      await securityEvent(req, { category: "PALM", action: "PALM_IDENTIFICATION_FAILED", severity: failures >= config.PALM_MAX_ATTEMPTS ? "HIGH" : "WARNING", success: false, metadata: { paymentId: payment.publicId, similarity: match.similarity, failures } });
      emitPayment(payment.publicId, "AWAITING_PALM", { message: "No confident match. Try again." });
      if (failures >= config.PALM_MAX_ATTEMPTS) throw new AppError(423, "PALM_SCAN_LOCKED", "Palm scanning is temporarily locked after repeated failed matches.");
      throw new AppError(401, "PALM_NOT_RECOGNIZED", "Palm could not be confidently recognized.");
    }
    await deleteTemporary(failureKey);

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
    payment.requiresOtp = risk.requiresOtp;
    if (risk.level === "BLOCKED") {
      transitionPayment(payment, "FAILED");
      payment.failureCode = "RISK_BLOCKED";
      await payment.save();
      await FraudAlert.create({ userId: customer._id, paymentRequestId: payment._id, riskScore: risk.score, riskLevel: risk.level, indicators: risk.indicators, status: "BLOCKED" });
      emitPayment(payment.publicId, "FAILED", { riskLevel: risk.level });
      throw new AppError(403, "PAYMENT_BLOCKED", "Payment was blocked by the risk policy.");
    }

    const confirmationToken = randomToken();
    payment.confirmationTokenHash = hashToken(confirmationToken);
    transitionPayment(payment, "CUSTOMER_IDENTIFIED");
    emitPayment(payment.publicId, "CUSTOMER_IDENTIFIED");
    transitionPayment(payment, "AWAITING_CONFIRMATION");
    await payment.save();

    let developmentOtp: string | undefined;
    if (risk.requiresOtp) {
      const otp = crypto.randomInt(100_000, 1_000_000).toString();
      await setTemporary(`payment:otp:${payment.publicId}`, hashToken(otp), config.OTP_TTL_SECONDS);
      if (config.NODE_ENV !== "production") developmentOtp = otp;
    }
    await setTemporary(`palm:match:${payment.publicId}`, JSON.stringify({ userId: customer._id.toString(), verificationId: verification._id.toString() }), 90);
    if (risk.level !== "LOW") await FraudAlert.create({ userId: customer._id, paymentRequestId: payment._id, riskScore: risk.score, riskLevel: risk.level, indicators: risk.indicators });
    await securityEvent(req, { userId: customer._id.toString(), category: "PALM", action: "PALM_VERIFICATION_SUCCESS", success: true, metadata: { paymentId: payment.publicId, similarity: match.similarity } });

    const parts = customer.displayName.trim().split(/\s+/);
    const minimalName = `${parts[0]}${parts.length > 1 ? ` ${parts.at(-1)?.[0]}.` : ""}`;
    emitPayment(payment.publicId, "AWAITING_CONFIRMATION", { riskLevel: risk.level });
    res.json({ success: true, data: {
      paymentId: payment.publicId, customerName: minimalName, amount: fromPaisa(payment.amountPaisa), merchantName: merchant.businessName,
      similarity: match.similarity, riskLevel: risk.level, requiresPin: risk.requiresPin, requiresOtp: risk.requiresOtp,
      confirmationToken, ...(developmentOtp ? { developmentOtp } : {}),
    } });
  });
}));

router.post("/requests/:id/confirm", validate(idParams, "params"), validate(z.object({
  confirmationToken: z.string().min(20), decision: z.enum(["CONFIRM", "DECLINE"]),
  pin: z.string().regex(/^\d{4,8}$/).optional(), otp: z.string().regex(/^\d{6}$/).optional(),
})), asyncHandler(async (req, res) => {
  const merchant = await getMerchant(req.auth!.userId);
  const idempotencyKey = requireIdempotencyKey(req);
  const processHash = requestHash({ paymentId: req.params.id, decision: req.body.decision });
  let payment: any = await PaymentRequest.findOne({ publicId: req.params.id, merchantId: merchant._id }).select("+confirmationTokenHash +processIdempotencyKey +processRequestHash");
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment request was not found.");

  if (["SUCCESS", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.state)) {
    if (payment.processIdempotencyKey && payment.processIdempotencyKey !== idempotencyKey) throw new AppError(409, "PAYMENT_ALREADY_PROCESSED", "This payment has already been processed.");
    assertIdempotentReplay(payment.processRequestHash, processHash);
    const replay = await existingTransactionResult(payment);
    if (replay) return res.json({ success: true, data: replay });
  }
  if (payment.processIdempotencyKey && payment.processIdempotencyKey !== idempotencyKey) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "A different processing key already owns this payment.");
  assertIdempotentReplay(payment.processRequestHash, processHash);
  if (payment.state === "PROCESSING") return res.status(202).json({ success: true, data: paymentData(payment, { message: "Payment is still processing." }) });
  if (payment.state !== "AWAITING_CONFIRMATION") throw new AppError(409, "INVALID_PAYMENT_STATE", `Payment cannot be confirmed while ${payment.state}.`);
  if (payment.expiresAt < new Date()) {
    transitionPayment(payment, "EXPIRED");
    await payment.save();
    emitPayment(payment.publicId, "EXPIRED");
    throw new AppError(410, "PAYMENT_EXPIRED", "Payment request has expired.");
  }

  const provided = Buffer.from(hashToken(req.body.confirmationToken));
  const expected = Buffer.from(payment.confirmationTokenHash ?? "");
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) throw new AppError(401, "INVALID_CONFIRMATION", "Confirmation session is invalid.");

  if (req.body.decision === "DECLINE") {
    const declined = await PaymentRequest.findOneAndUpdate(
      { _id: payment._id, state: "AWAITING_CONFIRMATION", confirmationTokenHash: payment.confirmationTokenHash },
      { $set: { state: "CANCELLED", processIdempotencyKey: idempotencyKey, processRequestHash: processHash }, $unset: { confirmationTokenHash: 1 } },
      { new: true },
    );
    if (!declined) throw new AppError(409, "OPERATION_IN_PROGRESS", "This payment is already being updated.");
    await audit(req, "PAYMENT_CANCELLED", { type: "PaymentRequest", id: payment.publicId }, { customerDecision: true });
    emitPayment(payment.publicId, "CANCELLED");
    return res.json({ success: true, data: { state: "CANCELLED" } });
  }

  const customer: any = await User.findById(payment.customerId).select("+paymentPinHash +failedPinAttempts +pinLockUntil");
  if (!customer) throw new AppError(403, "CUSTOMER_UNAVAILABLE", "Customer account is unavailable.");
  if (payment.requiresPin) {
    if (customer.pinLockUntil && customer.pinLockUntil > new Date()) throw new AppError(423, "PAYMENT_PIN_LOCKED", "Payment PIN is temporarily locked.");
    if (!customer.paymentPinHash || !req.body.pin || !(await bcrypt.compare(req.body.pin, customer.paymentPinHash))) {
      customer.failedPinAttempts = (customer.failedPinAttempts ?? 0) + 1;
      if (customer.failedPinAttempts >= config.PIN_MAX_ATTEMPTS) customer.pinLockUntil = new Date(Date.now() + config.PIN_LOCKOUT_SECONDS * 1000);
      await customer.save();
      await securityEvent(req, { userId: payment.customerId.toString(), category: "PAYMENT", action: "PAYMENT_PIN_FAILED", severity: "HIGH", success: false, metadata: { paymentId: payment.publicId, attempts: customer.failedPinAttempts } });
      throw new AppError(customer.pinLockUntil ? 423 : 401, customer.pinLockUntil ? "PAYMENT_PIN_LOCKED" : "INVALID_PAYMENT_PIN", customer.pinLockUntil ? "Payment PIN is temporarily locked." : "Payment PIN is incorrect.");
    }
    customer.failedPinAttempts = 0;
    customer.pinLockUntil = undefined;
    await customer.save();
  }
  if (payment.requiresOtp) {
    const otpHash = await getTemporary(`payment:otp:${payment.publicId}`);
    if (!otpHash) throw new AppError(410, "OTP_EXPIRED", "The one-time code has expired.");
    if (!req.body.otp || hashToken(req.body.otp) !== otpHash) throw new AppError(401, "INVALID_OTP", "The one-time code is incorrect.");
  }

  await paymentProvider.verifyPayment(payment.customerId.toString(), payment.amountPaisa);
  payment = await PaymentRequest.findOneAndUpdate(
    { _id: payment._id, state: "AWAITING_CONFIRMATION", confirmationTokenHash: payment.confirmationTokenHash },
    { $set: { state: "PROCESSING", confirmedAt: new Date(), processingStartedAt: new Date(), processIdempotencyKey: idempotencyKey, processRequestHash: processHash, ...(payment.requiresOtp ? { otpVerifiedAt: new Date() } : {}) }, $unset: { confirmationTokenHash: 1 } },
    { new: true },
  );
  if (!payment) {
    const current: any = await PaymentRequest.findOne({ publicId: req.params.id, merchantId: merchant._id }).select("+processIdempotencyKey +processRequestHash");
    if (current?.processIdempotencyKey === idempotencyKey) {
      const replay = await existingTransactionResult(current);
      if (replay) return res.json({ success: true, data: replay });
      return res.status(202).json({ success: true, data: paymentData(current, { message: "Payment is still processing." }) });
    }
    throw new AppError(409, "OPERATION_IN_PROGRESS", "This payment is already being processed.");
  }
  if (payment.requiresOtp) await deleteTemporary(`payment:otp:${payment.publicId}`);
  emitPayment(payment.publicId, "PROCESSING");

  let transaction: any;
  try {
    await withDistributedLock(`payment:${payment.publicId}`, 30_000, async () => {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const existing = await Transaction.findOne({ paymentRequestId: payment._id }).session(session);
          if (existing) {
            transaction = existing;
            await PaymentRequest.updateOne({ _id: payment._id, state: "PROCESSING" }, { $set: { state: "SUCCESS" } }, { session });
            return;
          }
          const capture = await paymentProvider.capturePayment(payment.customerId.toString(), merchant._id.toString(), payment.amountPaisa, session);
          [transaction] = await Transaction.create([{
            transactionId: publicId("NHP"), customerId: payment.customerId, merchantId: merchant._id, paymentRequestId: payment._id,
            amountPaisa: payment.amountPaisa, type: "PAYMENT", status: "SUCCESS", palmVerificationId: payment.palmVerificationId,
            riskLevel: payment.riskLevel, riskScore: payment.riskScore, description: payment.description, orderReference: payment.orderReference,
            providerReference: capture.providerReference, providerMode: capture.mode, completedAt: new Date(),
          }], { session });
          const completed = await PaymentRequest.updateOne({ _id: payment._id, state: "PROCESSING" }, { $set: { state: "SUCCESS", providerReference: capture.providerReference } }, { session });
          if (completed.modifiedCount !== 1) throw new AppError(409, "PAYMENT_STATE_RACE", "Payment state changed during processing.");
          await Notification.create([{ userId: payment.customerId, type: "PAYMENT_SUCCESS", title: "Payment successful", message: `NPR ${fromPaisa(payment.amountPaisa).toLocaleString()} paid to ${merchant.businessName}.`, metadata: { transactionId: transaction.transactionId } }], { session });
        });
      } finally {
        await session.endSession();
      }
    });
  } catch (error) {
    await PaymentRequest.updateOne({ _id: payment._id, state: "PROCESSING" }, { $set: { state: "FAILED", failureCode: error instanceof AppError ? error.code : "PROCESSING_ERROR" } });
    emitPayment(payment.publicId, "FAILED");
    throw error;
  }

  const wallet: any = await Wallet.findOne({ ownerType: "CUSTOMER", ownerId: payment.customerId }).lean();
  await audit(req, "PAYMENT_SUCCESS", { type: "Transaction", id: transaction.transactionId }, { amountPaisa: payment.amountPaisa, providerMode: "MOCK" });
  emitPayment(payment.publicId, "SUCCESS", { transactionId: transaction.transactionId });
  res.json({ success: true, data: { state: "SUCCESS", transactionId: transaction.transactionId, amount: fromPaisa(payment.amountPaisa), remainingBalance: fromPaisa(wallet.balancePaisa), providerMode: "MOCK" } });
}));

router.post("/requests/:id/cancel", validate(idParams, "params"), asyncHandler(async (req, res) => {
  const merchant = await getMerchant(req.auth!.userId);
  const payment: any = await PaymentRequest.findOne({ publicId: req.params.id, merchantId: merchant._id });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment request was not found.");
  if (!["CREATED", "AWAITING_PALM", "CUSTOMER_IDENTIFIED", "AWAITING_CONFIRMATION"].includes(payment.state)) throw new AppError(409, "INVALID_PAYMENT_STATE", "This payment can no longer be cancelled.");
  const previousState = payment.state;
  transitionPayment(payment, "CANCELLED");
  const changed = await PaymentRequest.updateOne({ _id: payment._id, state: previousState }, { $set: { state: "CANCELLED" } });
  if (changed.modifiedCount !== 1) throw new AppError(409, "OPERATION_IN_PROGRESS", "This payment is already being updated.");
  await audit(req, "PAYMENT_CANCELLED", { type: "PaymentRequest", id: payment.publicId });
  emitPayment(payment.publicId, "CANCELLED");
  res.json({ success: true, data: { state: "CANCELLED" } });
}));

export default router;
