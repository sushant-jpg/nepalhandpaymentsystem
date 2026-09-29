import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import { toPaisa, fromPaisa } from "../lib/money.js";
import { publicId } from "../lib/ids.js";
import { hashToken, randomToken } from "../lib/auth.js";
import { audit, securityEvent } from "../lib/audit.js";
import { emitNotification, emitPayment } from "../lib/realtime.js";
import {
  assertIdempotentReplay,
  requestHash,
  requireIdempotencyKey,
} from "../lib/idempotency.js";
import {
  deleteTemporary,
  getTemporary,
  incrementCounter,
  setTemporary,
  withDistributedLock,
} from "../lib/redis.js";
import { config } from "../config.js";
import {
  FraudAlert,
  CustomerProfile,
  Merchant,
  PalmEnrollment,
  PalmVerification,
  PaymentRequest,
  type PaymentRequestDocument,
  Transaction,
  User,
  Wallet,
} from "../models/index.js";
import { palmClient } from "../services/palm-client.js";
import { assessPaymentRisk } from "../services/risk.js";
import { paymentProvider } from "../services/payment-provider.js";
import { transitionPayment } from "../services/payment-state.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { emailService } from "../services/email.js";
import { executeWalletPayment } from "../services/payment-execution.js";
import {
  consumePaymentOtp,
  issuePaymentOtp,
  verifyPaymentOtp,
  verifyPaymentPin,
} from "../services/payment-authorization.js";

const router = Router();
router.use(authenticate, requirePermission("payment.create"));

const dataImage = z
  .string()
  .regex(
    /^data:image\/(jpeg|png|webp);base64,/,
    "A JPEG, PNG, or WebP data URL is required.",
  )
  .max(1_500_000);
const idParams = z.object({ id: z.string().regex(/^NHPR-[A-Z0-9-]{10,}$/) });

async function getMerchant(userId: string) {
  const merchant = await Merchant.findOne({ userId });
  if (!merchant)
    throw new AppError(
      404,
      "MERCHANT_NOT_FOUND",
      "Merchant profile was not found.",
    );
  if (merchant.approvalStatus !== "APPROVED")
    throw new AppError(
      403,
      "MERCHANT_NOT_APPROVED",
      "Merchant must be approved before accepting payments.",
    );
  return merchant;
}

function paymentData(
  payment: Pick<
    PaymentRequestDocument,
    | "publicId"
    | "state"
    | "amountPaisa"
    | "currency"
    | "expiresAt"
    | "orderReference"
  >,
  extra: Record<string, unknown> = {},
) {
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

async function existingTransactionResult(
  payment: Pick<
    PaymentRequestDocument,
    "_id" | "state" | "amountPaisa" | "customerId"
  >,
) {
  const transaction = await Transaction.findOne({
    paymentRequestId: payment._id,
  }).lean();
  if (!transaction) return null;
  const wallet = await Wallet.findOne({
    ownerType: "CUSTOMER",
    ownerId: payment.customerId,
  }).lean();
  return {
    state: payment.state,
    transactionId: transaction.transactionId,
    amount: fromPaisa(payment.amountPaisa),
    remainingBalance: wallet ? fromPaisa(wallet.balancePaisa) : undefined,
    replayed: true,
  };
}

router.post(
  "/requests",
  rateLimit(60, 60_000),
  validate(
    z.object({
      amount: z.number().positive().max(1_000_000),
      description: z.string().trim().max(180).optional(),
      orderReference: z.string().trim().min(1).max(80).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const merchant = await getMerchant(req.auth!.userId);
    const idempotencyKey = requireIdempotencyKey(req);
    const bodyHash = requestHash(req.body);
    const existing = await PaymentRequest.findOne({
      merchantId: merchant._id,
      idempotencyKey,
    })
      .select("+idempotencyRequestHash")
      .lean();
    if (existing) {
      assertIdempotentReplay(existing.idempotencyRequestHash, bodyHash);
      return res.json({
        success: true,
        data: paymentData(existing, { duplicate: true }),
      });
    }

    const paymentId = publicId("NHPR");
    const provider = await paymentProvider.createPayment({
      paymentId,
      amountPaisa: toPaisa(req.body.amount),
      currency: "NPR",
    });
    let payment: PaymentRequestDocument;
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
        paymentMethod: "PALM",
        expiresAt: new Date(Date.now() + 5 * 60_000),
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      ) {
        const raced = await PaymentRequest.findOne({
          merchantId: merchant._id,
          idempotencyKey,
        })
          .select("+idempotencyRequestHash")
          .lean();
        if (raced) {
          assertIdempotentReplay(raced.idempotencyRequestHash, bodyHash);
          return res.json({
            success: true,
            data: paymentData(raced, { duplicate: true }),
          });
        }
      }
      throw error;
    }
    transitionPayment(payment, "AWAITING_PALM");
    await payment.save();
    await setTemporary(
      `payment:session:${payment.publicId}`,
      JSON.stringify({ merchantId: merchant._id, state: payment.state }),
      300,
    );
    await audit(
      req,
      "PAYMENT_CREATED",
      { type: "PaymentRequest", id: payment.publicId },
      { amountPaisa: payment.amountPaisa, providerMode: "MOCK" },
    );
    emitPayment(payment.publicId, payment.state);
    res.status(201).json({ success: true, data: paymentData(payment) });
  }),
);

router.get(
  "/requests/:id",
  validate(idParams, "params"),
  asyncHandler(async (req, res) => {
    const merchant = await getMerchant(req.auth!.userId);
    const payment = await PaymentRequest.findOne({
      publicId: req.params.id,
      merchantId: merchant._id,
    }).lean();
    if (!payment)
      throw new AppError(
        404,
        "PAYMENT_NOT_FOUND",
        "Payment request was not found.",
      );
    const transaction = await Transaction.findOne({
      paymentRequestId: payment._id,
    })
      .select("transactionId status")
      .lean();
    res.json({
      success: true,
      data: paymentData(payment, {
        transactionId: transaction?.transactionId,
        transactionStatus: transaction?.status,
      }),
    });
  }),
);

router.post(
  "/requests/:id/quality",
  rateLimit(12, 60_000),
  validate(idParams, "params"),
  validate(z.object({ samples: z.array(dataImage).length(3) })),
  asyncHandler(async (req, res) => {
    const merchant = await getMerchant(req.auth!.userId);
    const payment = await PaymentRequest.findOne({
      publicId: req.params.id,
      merchantId: merchant._id,
    }).lean();
    if (!payment)
      throw new AppError(
        404,
        "PAYMENT_NOT_FOUND",
        "Payment request was not found.",
      );
    if (payment.expiresAt < new Date())
      throw new AppError(
        410,
        "PAYMENT_EXPIRED",
        "Payment request has expired.",
      );
    if (payment.state !== "AWAITING_PALM")
      throw new AppError(
        409,
        "INVALID_PAYMENT_STATE",
        `Palm quality cannot be assessed while payment is ${payment.state}.`,
      );
    const result = await palmClient.quality(req.body.samples);
    res.json({ success: true, data: result });
  }),
);

router.post(
  "/requests/:id/identify",
  rateLimit(10, 60_000),
  validate(idParams, "params"),
  validate(z.object({ image: dataImage })),
  asyncHandler(async (req, res) => {
    const merchant = await getMerchant(req.auth!.userId);
    await withDistributedLock(`identify:${req.params.id}`, 20_000, async () => {
      const payment = await PaymentRequest.findOne({
        publicId: req.params.id,
        merchantId: merchant._id,
      }).select("+confirmationTokenHash");
      if (!payment)
        throw new AppError(
          404,
          "PAYMENT_NOT_FOUND",
          "Payment request was not found.",
        );
      if (payment.expiresAt < new Date()) {
        if (payment.state === "AWAITING_PALM") {
          transitionPayment(payment, "EXPIRED");
          await payment.save();
        }
        emitPayment(payment.publicId, "EXPIRED");
        throw new AppError(
          410,
          "PAYMENT_EXPIRED",
          "Payment request has expired.",
        );
      }
      if (payment.state !== "AWAITING_PALM")
        throw new AppError(
          409,
          "INVALID_PAYMENT_STATE",
          `Palm scan is not allowed while payment is ${payment.state}.`,
        );

      const failureKey = `palm:fail:${payment.publicId}`;
      const previousFailures = Number((await getTemporary(failureKey)) ?? "0");
      if (previousFailures >= config.PALM_MAX_ATTEMPTS)
        throw new AppError(
          423,
          "PALM_SCAN_LOCKED",
          "Palm scanning is temporarily locked after repeated failed matches.",
        );

      emitPayment(payment.publicId, "VERIFYING");
      const match = await palmClient.identify(req.body.image);
      const verification = await PalmVerification.create({
        verificationId: publicId("PV"),
        userId: match.userId,
        paymentRequestId: payment._id,
        matched: match.matched,
        similarity: match.similarity,
        threshold: match.threshold,
        algorithmVersion: match.algorithmVersion,
        failureReason: match.matched ? undefined : "NO_CONFIDENT_MATCH",
        ip: req.ip,
      });
      if (!match.matched || !match.userId) {
        const failures = await incrementCounter(
          failureKey,
          config.PALM_LOCKOUT_SECONDS,
        );
        await securityEvent(req, {
          category: "PALM",
          action: "PALM_IDENTIFICATION_FAILED",
          severity: failures >= config.PALM_MAX_ATTEMPTS ? "HIGH" : "WARNING",
          success: false,
          metadata: {
            paymentId: payment.publicId,
            similarity: match.similarity,
            failures,
          },
        });
        emitPayment(payment.publicId, "AWAITING_PALM", {
          message: "No confident match. Try again.",
        });
        if (failures >= config.PALM_MAX_ATTEMPTS)
          throw new AppError(
            423,
            "PALM_SCAN_LOCKED",
            "Palm scanning is temporarily locked after repeated failed matches.",
          );
        throw new AppError(
          401,
          "PALM_NOT_RECOGNIZED",
          "Palm could not be confidently recognized.",
        );
      }
      await deleteTemporary(failureKey);

      const [customer, enrollment, customerProfile] = await Promise.all([
        User.findOne({ _id: match.userId, role: "CUSTOMER", status: "ACTIVE" }),
        PalmEnrollment.findOne({ userId: match.userId, status: "ACTIVE" }),
        CustomerProfile.findOne({ userId: match.userId }).select("kycStatus"),
      ]);
      if (!customer || !enrollment)
        throw new AppError(
          403,
          "CUSTOMER_UNAVAILABLE",
          "Matched customer account is unavailable.",
        );
      if (customerProfile?.kycStatus !== "APPROVED")
        throw new AppError(
          403,
          "KYC_REQUIRED",
          "The matched customer has not completed demo identity verification.",
        );

      const risk = await assessPaymentRisk(
        match.userId,
        payment.amountPaisa,
        merchant.createdAt,
      );
      payment.customerId = customer._id;
      payment.palmVerificationId = verification._id;
      transitionPayment(payment, "CUSTOMER_IDENTIFIED");
      transitionPayment(payment, "RISK_CHECK");
      payment.riskScore = risk.score;
      payment.riskLevel = risk.level;
      payment.requiresPin = risk.requiresPin;
      payment.requiresOtp = risk.requiresOtp;
      if (risk.level === "BLOCKED") {
        transitionPayment(payment, "BLOCKED");
        payment.failureCode = "RISK_BLOCKED";
        await payment.save();
        await FraudAlert.create({
          userId: customer._id,
          paymentRequestId: payment._id,
          riskScore: risk.score,
          riskLevel: risk.level,
          indicators: risk.indicators,
          status: "BLOCKED",
        });
        emitPayment(payment.publicId, "BLOCKED", { riskLevel: risk.level });
        throw new AppError(
          403,
          "PAYMENT_BLOCKED",
          "Payment was blocked by the risk policy.",
        );
      }

      const confirmationToken = randomToken();
      payment.confirmationTokenHash = hashToken(confirmationToken);
      transitionPayment(payment, "AWAITING_CONFIRMATION");
      await payment.save();

      let developmentOtp: string | undefined;
      if (risk.requiresOtp) {
        ({ developmentOtp } = await issuePaymentOtp({
          paymentId: payment.publicId,
          customer,
          merchantName: merchant.businessName,
        }));
      }
      await setTemporary(
        `palm:match:${payment.publicId}`,
        JSON.stringify({
          userId: customer._id.toString(),
          verificationId: verification._id.toString(),
        }),
        90,
      );
      if (risk.level !== "LOW")
        await FraudAlert.create({
          userId: customer._id,
          paymentRequestId: payment._id,
          riskScore: risk.score,
          riskLevel: risk.level,
          indicators: risk.indicators,
        });
      await securityEvent(req, {
        userId: customer._id.toString(),
        category: "PALM",
        action: "PALM_VERIFICATION_SUCCESS",
        success: true,
        metadata: { paymentId: payment.publicId, similarity: match.similarity },
      });

      const parts = customer.displayName.trim().split(/\s+/);
      const minimalName = `${parts[0]}${parts.length > 1 ? ` ${parts.at(-1)?.[0]}.` : ""}`;
      emitPayment(payment.publicId, "AWAITING_CONFIRMATION", {
        riskLevel: risk.level,
      });
      res.json({
        success: true,
        data: {
          paymentId: payment.publicId,
          customerName: minimalName,
          amount: fromPaisa(payment.amountPaisa),
          merchantName: merchant.businessName,
          similarity: match.similarity,
          riskLevel: risk.level,
          requiresPin: risk.requiresPin,
          requiresOtp: risk.requiresOtp,
          confirmationToken,
          ...(developmentOtp ? { developmentOtp } : {}),
        },
      });
    });
  }),
);

router.post(
  "/requests/:id/confirm",
  rateLimit(20, 60_000),
  validate(idParams, "params"),
  validate(
    z.object({
      confirmationToken: z.string().min(20),
      decision: z.enum(["CONFIRM", "DECLINE"]),
      pin: z
        .string()
        .regex(/^\d{4,8}$/)
        .optional(),
      otp: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const merchant = await getMerchant(req.auth!.userId);
    const idempotencyKey = requireIdempotencyKey(req);
    const processHash = requestHash({
      paymentId: req.params.id,
      decision: req.body.decision,
    });
    let payment = await PaymentRequest.findOne({
      publicId: req.params.id,
      merchantId: merchant._id,
    }).select(
      "+confirmationTokenHash +processIdempotencyKey +processRequestHash",
    );
    if (!payment)
      throw new AppError(
        404,
        "PAYMENT_NOT_FOUND",
        "Payment request was not found.",
      );
    if (
      !payment.customerId ||
      payment.riskLevel === undefined ||
      payment.riskScore === undefined
    ) {
      throw new AppError(
        409,
        "PAYMENT_NOT_AUTHORIZED",
        "Payment does not have a completed customer and risk authorization.",
      );
    }

    if (["SUCCESS", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.state)) {
      if (
        payment.processIdempotencyKey &&
        payment.processIdempotencyKey !== idempotencyKey
      )
        throw new AppError(
          409,
          "PAYMENT_ALREADY_PROCESSED",
          "This payment has already been processed.",
        );
      assertIdempotentReplay(
        payment.processRequestHash ?? undefined,
        processHash,
      );
      const replay = await existingTransactionResult(payment);
      if (replay) return res.json({ success: true, data: replay });
    }
    if (
      payment.processIdempotencyKey &&
      payment.processIdempotencyKey !== idempotencyKey
    )
      throw new AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "A different processing key already owns this payment.",
      );
    assertIdempotentReplay(
      payment.processRequestHash ?? undefined,
      processHash,
    );
    if (payment.state === "PROCESSING")
      return res
        .status(202)
        .json({
          success: true,
          data: paymentData(payment, {
            message: "Payment is still processing.",
          }),
        });
    if (!["AWAITING_CONFIRMATION", "AWAITING_PIN"].includes(payment.state))
      throw new AppError(
        409,
        "INVALID_PAYMENT_STATE",
        `Payment cannot be confirmed while ${payment.state}.`,
      );
    if (payment.expiresAt < new Date()) {
      transitionPayment(payment, "EXPIRED");
      await payment.save();
      emitPayment(payment.publicId, "EXPIRED");
      throw new AppError(
        410,
        "PAYMENT_EXPIRED",
        "Payment request has expired.",
      );
    }

    const provided = Buffer.from(hashToken(req.body.confirmationToken));
    const expected = Buffer.from(payment.confirmationTokenHash ?? "");
    if (
      provided.length !== expected.length ||
      !crypto.timingSafeEqual(provided, expected)
    )
      throw new AppError(
        401,
        "INVALID_CONFIRMATION",
        "Confirmation session is invalid.",
      );

    if (req.body.decision === "DECLINE") {
      const declined = await PaymentRequest.findOneAndUpdate(
        {
          _id: payment._id,
          state: { $in: ["AWAITING_CONFIRMATION", "AWAITING_PIN"] },
          confirmationTokenHash: payment.confirmationTokenHash,
        },
        {
          $set: {
            state: "CANCELLED",
            processIdempotencyKey: idempotencyKey,
            processRequestHash: processHash,
          },
          $unset: { confirmationTokenHash: 1 },
        },
        { new: true },
      );
      if (!declined)
        throw new AppError(
          409,
          "OPERATION_IN_PROGRESS",
          "This payment is already being updated.",
        );
      await audit(
        req,
        "PAYMENT_CANCELLED",
        { type: "PaymentRequest", id: payment.publicId },
        { customerDecision: true },
      );
      emitPayment(payment.publicId, "CANCELLED");
      return res.json({ success: true, data: { state: "CANCELLED" } });
    }

    let customer;
    if (payment.requiresPin) {
      if (payment.state === "AWAITING_CONFIRMATION") {
        transitionPayment(payment, "AWAITING_PIN");
        await payment.save();
        emitPayment(payment.publicId, "AWAITING_PIN");
      }
      customer = await verifyPaymentPin({
        req,
        userId: payment.customerId.toString(),
        paymentId: payment.publicId,
        pin: req.body.pin,
      });
    } else {
      customer = await User.findOne({
        _id: payment.customerId,
        status: "ACTIVE",
      });
      if (!customer)
        throw new AppError(
          403,
          "CUSTOMER_UNAVAILABLE",
          "Customer account is unavailable.",
        );
    }
    if (payment.requiresOtp) {
      await verifyPaymentOtp(payment.publicId, req.body.otp);
    }

    await paymentProvider.verifyPayment(
      payment.customerId.toString(),
      payment.amountPaisa,
    );
    const authorizationState = payment.requiresPin
      ? "AWAITING_PIN"
      : "AWAITING_CONFIRMATION";
    payment = await PaymentRequest.findOneAndUpdate(
      {
        _id: payment._id,
        state: authorizationState,
        confirmationTokenHash: payment.confirmationTokenHash,
      },
      {
        $set: {
          state: "PROCESSING",
          confirmedAt: new Date(),
          processingStartedAt: new Date(),
          processIdempotencyKey: idempotencyKey,
          processRequestHash: processHash,
          ...(payment.requiresOtp ? { otpVerifiedAt: new Date() } : {}),
        },
        $unset: { confirmationTokenHash: 1 },
      },
      { new: true },
    );
    if (!payment) {
      const current = await PaymentRequest.findOne({
        publicId: req.params.id,
        merchantId: merchant._id,
      }).select("+processIdempotencyKey +processRequestHash");
      if (current?.processIdempotencyKey === idempotencyKey) {
        const replay = await existingTransactionResult(current);
        if (replay) return res.json({ success: true, data: replay });
        return res
          .status(202)
          .json({
            success: true,
            data: paymentData(current, {
              message: "Payment is still processing.",
            }),
          });
      }
      throw new AppError(
        409,
        "OPERATION_IN_PROGRESS",
        "This payment is already being processed.",
      );
    }
    if (
      !payment.customerId ||
      payment.riskLevel === undefined ||
      payment.riskScore === undefined
    ) {
      throw new AppError(
        409,
        "PAYMENT_NOT_AUTHORIZED",
        "Payment authorization was lost during processing.",
      );
    }
    const authorizedCustomerId = payment.customerId;
    if (payment.requiresOtp) await consumePaymentOtp(payment.publicId);
    emitPayment(payment.publicId, "PROCESSING");

    let execution;
    try {
      execution = await executeWalletPayment({
        paymentRequestObjectId: payment._id.toString(),
        paymentId: payment.publicId,
        customerId: authorizedCustomerId.toString(),
        customerUserId: authorizedCustomerId.toString(),
        merchantId: merchant._id.toString(),
        merchantUserId: merchant.userId.toString(),
        merchantName: merchant.businessName,
        amountPaisa: payment.amountPaisa,
        description: payment.description ?? undefined,
        orderReference: payment.orderReference ?? undefined,
        palmVerificationId: payment.palmVerificationId?.toString(),
        riskLevel: payment.riskLevel!,
        riskScore: payment.riskScore!,
        paymentMethod: "PALM",
        requestId: req.requestId,
      });
    } catch (error) {
      await PaymentRequest.updateOne(
        { _id: payment._id, state: "PROCESSING" },
        {
          $set: {
            state: "FAILED",
            failureCode:
              error instanceof AppError ? error.code : "PROCESSING_ERROR",
          },
        },
      );
      await Promise.allSettled([
        audit(
          req,
          "PAYMENT_FAILED",
          { type: "PaymentRequest", id: payment.publicId },
          {
            failureCode:
              error instanceof AppError ? error.code : "PROCESSING_ERROR",
          },
        ),
        securityEvent(req, {
          userId: authorizedCustomerId.toString(),
          category: "PAYMENT",
          action: "PAYMENT_FAILED",
          severity: "HIGH",
          success: false,
          metadata: { paymentId: payment.publicId },
        }),
      ]);
      emitPayment(payment.publicId, "FAILED");
      throw error;
    }

    const transactionId = execution.transactionId;
    await audit(
      req,
      "PAYMENT_SUCCESS",
      { type: "Transaction", id: transactionId },
      { amountPaisa: payment.amountPaisa, providerMode: "MOCK" },
    );
    await emailService.sendPaymentReceipt({
      to: customer.email,
      displayName: customer.displayName,
      merchantName: merchant.businessName,
      amount: fromPaisa(payment.amountPaisa).toFixed(2),
      transactionId,
    });
    emitNotification(authorizedCustomerId.toString(), {
      type: "PAYMENT_SUCCESS",
      category: "PAYMENT",
      severity: "INFO",
      title: "Payment successful",
      message: `NPR ${fromPaisa(payment.amountPaisa).toLocaleString()} paid to ${merchant.businessName}.`,
      transactionId,
    });
    emitNotification(merchant.userId.toString(), {
      type: "PAYMENT_RECEIVED",
      category: "PAYMENT",
      severity: "INFO",
      title: "Payment received",
      message: `NPR ${fromPaisa(payment.amountPaisa).toLocaleString()} received by Palm Pay.`,
      transactionId,
      paymentId: payment.publicId,
    });
    emitPayment(payment.publicId, "SUCCESS", { transactionId });
    res.json({
      success: true,
      data: {
        state: "SUCCESS",
        transactionId,
        amount: fromPaisa(payment.amountPaisa),
        remainingBalance: fromPaisa(execution.remainingBalancePaisa),
        providerMode: "MOCK",
      },
    });
  }),
);

router.post(
  "/requests/:id/cancel",
  rateLimit(30, 60_000),
  validate(idParams, "params"),
  asyncHandler(async (req, res) => {
    const merchant = await getMerchant(req.auth!.userId);
    const payment = await PaymentRequest.findOne({
      publicId: req.params.id,
      merchantId: merchant._id,
    });
    if (!payment)
      throw new AppError(
        404,
        "PAYMENT_NOT_FOUND",
        "Payment request was not found.",
      );
    if (
      ![
        "CREATED",
        "AWAITING_PALM",
        "CUSTOMER_IDENTIFIED",
        "RISK_CHECK",
        "AWAITING_CONFIRMATION",
        "AWAITING_PIN",
      ].includes(payment.state)
    )
      throw new AppError(
        409,
        "INVALID_PAYMENT_STATE",
        "This payment can no longer be cancelled.",
      );
    const previousState = payment.state;
    transitionPayment(payment, "CANCELLED");
    const changed = await PaymentRequest.updateOne(
      { _id: payment._id, state: previousState },
      { $set: { state: "CANCELLED" } },
    );
    if (changed.modifiedCount !== 1)
      throw new AppError(
        409,
        "OPERATION_IN_PROGRESS",
        "This payment is already being updated.",
      );
    await audit(req, "PAYMENT_CANCELLED", {
      type: "PaymentRequest",
      id: payment.publicId,
    });
    emitPayment(payment.publicId, "CANCELLED");
    res.json({ success: true, data: { state: "CANCELLED" } });
  }),
);

export default router;
