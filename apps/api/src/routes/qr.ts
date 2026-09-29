import { Router, type Request } from "express";
import { z } from "zod";
import type {
  DynamicPaymentQrPayload,
  QrPaymentRequestView,
  RiskLevel,
  StaticMerchantQrPayload,
} from "@nepal-hand-pay/shared-types";
import { asyncHandler } from "../lib/async-handler.js";
import { audit, securityEvent } from "../lib/audit.js";
import { hashToken, randomToken } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import {
  assertIdempotentReplay,
  requestHash,
  requireIdempotencyKey,
} from "../lib/idempotency.js";
import { publicId } from "../lib/ids.js";
import { fromPaisa } from "../lib/money.js";
import { emitNotification, emitPayment } from "../lib/realtime.js";
import { withDistributedLock } from "../lib/redis.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  CustomerProfile,
  FraudAlert,
  Merchant,
  type MerchantDocument,
  Notification,
  PaymentRequest,
  type PaymentRequestDocument,
  Transaction,
  User,
  Wallet,
} from "../models/index.js";
import { emailService } from "../services/email.js";
import {
  consumePaymentOtp,
  issuePaymentOtp,
  verifyPaymentOtp,
  verifyPaymentPin,
} from "../services/payment-authorization.js";
import { executeWalletPayment } from "../services/payment-execution.js";
import { paymentProvider } from "../services/payment-provider.js";
import { assessPaymentRisk } from "../services/risk.js";

const router = Router();
router.use(authenticate);

const paymentIdParams = z.object({
  id: z.string().regex(/^NHPR-[A-Z0-9-]{10,}$/),
});
const merchantParams = z.object({
  merchantId: z.string().regex(/^[a-f\d]{24}$/i),
});
const qrAmount = z.number().int().positive().max(100_000_000_00);
const createBody = z.object({
  amountMinor: qrAmount,
  currency: z.literal("NPR"),
  description: z.string().trim().min(1).max(180).optional(),
  orderReference: z.string().trim().min(1).max(80).optional(),
  expiresInSeconds: z.number().int().min(60).max(900).default(300),
});
const confirmBody = z.object({
  decision: z.enum(["CONFIRM", "DECLINE"]),
  pin: z.string().regex(/^\d{4,8}$/).optional(),
  otp: z.string().regex(/^\d{6}$/).optional(),
});

async function approvedMerchantForUser(userId: string) {
  const merchant = await Merchant.findOne({ userId });
  if (!merchant)
    throw new AppError(404, "MERCHANT_NOT_FOUND", "Merchant profile was not found.");
  if (merchant.approvalStatus !== "APPROVED")
    throw new AppError(
      403,
      "MERCHANT_NOT_APPROVED",
      "Merchant must be approved before accepting payments.",
    );
  return merchant;
}

async function approvedMerchant(merchantId: string) {
  const merchant = await Merchant.findOne({
    _id: merchantId,
    approvalStatus: "APPROVED",
  });
  if (!merchant)
    throw new AppError(
      404,
      "QR_MERCHANT_NOT_FOUND",
      "The merchant in this QR code is unavailable.",
    );
  return merchant;
}

function staticPayload(merchant: MerchantDocument): StaticMerchantQrPayload {
  return {
    version: 1,
    type: "merchant",
    merchantId: merchant._id.toString(),
    currency: "NPR",
  };
}

function dynamicPayload(
  payment: PaymentRequestDocument,
  nonce: string,
): DynamicPaymentQrPayload {
  return {
    version: 1,
    type: "payment_request",
    paymentRequestId: payment.publicId,
    merchantId: payment.merchantId.toString(),
    amountMinor: payment.amountPaisa,
    currency: "NPR",
    expiresAt: payment.expiresAt.toISOString(),
    nonce,
  };
}

async function requestView(
  payment: PaymentRequestDocument,
  merchant: MerchantDocument,
): Promise<QrPaymentRequestView> {
  const transaction = await Transaction.findOne({
    paymentRequestId: payment._id,
  })
    .select("transactionId")
    .lean();
  return {
    id: payment.publicId,
    merchantId: merchant._id.toString(),
    merchantName: merchant.businessName,
    amountMinor: payment.amountPaisa,
    currency: "NPR",
    description: payment.description ?? undefined,
    orderReference: payment.orderReference ?? undefined,
    feeMinor: 0,
    totalMinor: payment.amountPaisa,
    state: payment.state,
    expiresAt: payment.expiresAt.toISOString(),
    paymentMethod: "QR",
    transactionId: transaction?.transactionId,
  };
}

const expirableStates = [
  "CREATED",
  "RISK_CHECK",
  "AWAITING_CONFIRMATION",
  "AWAITING_PIN",
] as const;

async function expireIfNecessary(payment: PaymentRequestDocument) {
  if (
    payment.expiresAt <= new Date() &&
    expirableStates.includes(payment.state as (typeof expirableStates)[number])
  ) {
    const changed = await PaymentRequest.updateOne(
      { _id: payment._id, state: payment.state },
      { $set: { state: "EXPIRED" } },
    );
    if (changed.modifiedCount === 1) {
      payment.state = "EXPIRED";
      emitPayment(payment.publicId, "EXPIRED");
    }
  }
}

async function createRequest(input: {
  req: Request;
  merchant: MerchantDocument;
  body: z.infer<typeof createBody>;
  qrType: "STATIC" | "DYNAMIC";
  customerId?: string;
}) {
  const idempotencyKey = requireIdempotencyKey(input.req);
  const bodyHash = requestHash({
    route: input.qrType,
    customerId: input.customerId,
    ...input.body,
  });
  const existing = await PaymentRequest.findOne({
    merchantId: input.merchant._id,
    idempotencyKey,
  })
    .select("+idempotencyRequestHash +qrNonce")
    .lean();
  if (existing) {
    assertIdempotentReplay(existing.idempotencyRequestHash, bodyHash);
    if (existing.paymentMethod !== "QR")
      throw new AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key belongs to a different payment method.",
      );
    const hydrated = await PaymentRequest.findById(existing._id).select(
      "+qrNonce",
    );
    if (!hydrated)
      throw new AppError(404, "QR_NOT_FOUND", "QR payment request was not found.");
    return { payment: hydrated, nonce: hydrated.qrNonce ?? "", duplicate: true };
  }

  const paymentId = publicId("NHPR");
  const nonce = randomToken();
  const provider = await paymentProvider.createPayment({
    paymentId,
    amountPaisa: input.body.amountMinor,
    currency: "NPR",
  });
  const payment = await PaymentRequest.create({
    publicId: paymentId,
    merchantId: input.merchant._id,
    customerId: input.customerId,
    createdByUserId: input.req.auth!.userId,
    amountPaisa: input.body.amountMinor,
    currency: "NPR",
    description: input.body.description,
    orderReference: input.body.orderReference,
    paymentMethod: "QR",
    qrType: input.qrType,
    qrNonce: nonce,
    qrNonceHash: hashToken(nonce),
    state: "CREATED",
    idempotencyKey,
    idempotencyRequestHash: bodyHash,
    providerReference: provider.providerReference,
    expiresAt: new Date(Date.now() + input.body.expiresInSeconds * 1_000),
  });
  await audit(
    input.req,
    "QR_PAYMENT_REQUEST_CREATED",
    { type: "PaymentRequest", id: payment.publicId },
    {
      amountPaisa: payment.amountPaisa,
      qrType: input.qrType,
      merchantId: input.merchant._id.toString(),
    },
  );
  emitPayment(payment.publicId, payment.state);
  return { payment, nonce, duplicate: false };
}

router.get(
  "/merchant",
  authorize("MERCHANT"),
  asyncHandler(async (req, res) => {
    const merchant = await approvedMerchantForUser(req.auth!.userId);
    const payload = staticPayload(merchant);
    res.json({
      success: true,
      data: {
        merchantId: merchant._id,
        merchantName: merchant.businessName,
        currency: "NPR",
        qrPayload: JSON.stringify(payload),
      },
    });
  }),
);

router.get(
  "/merchants/:merchantId",
  authorize("CUSTOMER"),
  validate(merchantParams, "params"),
  asyncHandler(async (req, res) => {
    const merchant = await approvedMerchant(String(req.params.merchantId));
    res.json({
      success: true,
      data: {
        merchantId: merchant._id,
        merchantName: merchant.businessName,
        currency: "NPR",
      },
    });
  }),
);

router.post(
  "/merchant-payment-requests",
  authorize("CUSTOMER"),
  rateLimit(20, 60_000),
  validate(createBody.extend({ merchantId: merchantParams.shape.merchantId })),
  asyncHandler(async (req, res) => {
    const merchant = await approvedMerchant(req.body.merchantId);
    const created = await createRequest({
      req,
      merchant,
      body: req.body,
      qrType: "STATIC",
      customerId: req.auth!.userId,
    });
    res.status(created.duplicate ? 200 : 201).json({
      success: true,
      data: {
        ...(await requestView(created.payment, merchant)),
        duplicate: created.duplicate,
      },
    });
  }),
);

router.post(
  "/payment-requests",
  authorize("MERCHANT"),
  rateLimit(30, 60_000),
  validate(createBody),
  asyncHandler(async (req, res) => {
    const merchant = await approvedMerchantForUser(req.auth!.userId);
    const created = await createRequest({
      req,
      merchant,
      body: req.body,
      qrType: "DYNAMIC",
    });
    if (!created.nonce)
      throw new AppError(
        500,
        "QR_PAYLOAD_UNAVAILABLE",
        "The QR payload could not be reconstructed.",
      );
    res.status(created.duplicate ? 200 : 201).json({
      success: true,
      data: {
        ...(await requestView(created.payment, merchant)),
        qrPayload: JSON.stringify(
          dynamicPayload(created.payment, created.nonce),
        ),
        duplicate: created.duplicate,
      },
    });
  }),
);

router.get(
  "/payment-requests/:id",
  authorize("CUSTOMER", "MERCHANT"),
  validate(paymentIdParams, "params"),
  asyncHandler(async (req, res) => {
    const payment = await PaymentRequest.findOne({
      publicId: req.params.id,
      paymentMethod: "QR",
    });
    if (!payment)
      throw new AppError(404, "QR_NOT_FOUND", "QR payment request was not found.");
    const merchant = await Merchant.findById(payment.merchantId);
    if (!merchant || merchant.approvalStatus !== "APPROVED")
      throw new AppError(
        404,
        "QR_MERCHANT_NOT_FOUND",
        "The merchant for this payment is unavailable.",
      );
    if (
      req.auth!.role === "MERCHANT" &&
      merchant.userId.toString() !== req.auth!.userId
    )
      throw new AppError(403, "FORBIDDEN", "You cannot view this payment request.");
    await expireIfNecessary(payment);
    if (req.auth!.role === "CUSTOMER")
      await audit(req, "QR_PAYMENT_REQUEST_VIEWED", {
        type: "PaymentRequest",
        id: payment.publicId,
      });
    res.json({ success: true, data: await requestView(payment, merchant) });
  }),
);

router.post(
  "/payment-requests/:id/cancel",
  authorize("MERCHANT"),
  rateLimit(30, 60_000),
  validate(paymentIdParams, "params"),
  asyncHandler(async (req, res) => {
    const merchant = await approvedMerchantForUser(req.auth!.userId);
    const payment = await PaymentRequest.findOne({
      publicId: req.params.id,
      merchantId: merchant._id,
      paymentMethod: "QR",
    });
    if (!payment)
      throw new AppError(404, "QR_NOT_FOUND", "QR payment request was not found.");
    await expireIfNecessary(payment);
    if (payment.state === "EXPIRED")
      throw new AppError(410, "QR_EXPIRED", "QR payment request has expired.");
    const changed = await PaymentRequest.updateOne(
      { _id: payment._id, state: { $in: expirableStates } },
      { $set: { state: "CANCELLED", cancelledAt: new Date() } },
    );
    if (changed.modifiedCount !== 1)
      throw new AppError(
        409,
        "QR_ALREADY_USED",
        "This QR payment request can no longer be cancelled.",
      );
    await audit(req, "QR_PAYMENT_CANCELLED", {
      type: "PaymentRequest",
      id: payment.publicId,
    });
    emitPayment(payment.publicId, "CANCELLED");
    if (payment.customerId) {
      const notification = await Notification.create({
        userId: payment.customerId,
        type: "QR_PAYMENT_CANCELLED",
        category: "PAYMENT",
        severity: "INFO",
        title: "QR payment cancelled",
        message: `${merchant.businessName} cancelled the payment request.`,
      });
      emitNotification(payment.customerId.toString(), notification.toObject());
    }
    res.json({ success: true, data: { state: "CANCELLED" } });
  }),
);

router.post(
  "/payment-requests/:id/confirm",
  authorize("CUSTOMER"),
  rateLimit(20, 60_000),
  validate(paymentIdParams, "params"),
  validate(confirmBody),
  asyncHandler(async (req, res) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const processHash = requestHash({
      paymentId: req.params.id,
      decision: req.body.decision,
      customerId: req.auth!.userId,
    });

    const outcome = await withDistributedLock(
      `qr-confirm:${req.params.id}`,
      35_000,
      async (): Promise<{ status: number; data: Record<string, unknown> }> => {
        let payment = await PaymentRequest.findOne({
          publicId: req.params.id,
          paymentMethod: "QR",
        }).select("+processIdempotencyKey +processRequestHash");
        if (!payment)
          throw new AppError(404, "QR_NOT_FOUND", "QR payment request was not found.");
        const merchant = await approvedMerchant(payment.merchantId.toString());
        await expireIfNecessary(payment);

        if (payment.state === "EXPIRED")
          throw new AppError(410, "QR_EXPIRED", "QR payment request has expired.");
        if (payment.state === "CANCELLED")
          throw new AppError(409, "QR_CANCELLED", "QR payment request was cancelled.");
        if (["SUCCESS", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.state)) {
          if (payment.processIdempotencyKey !== idempotencyKey) {
            await securityEvent(req, {
              userId: req.auth!.userId,
              category: "PAYMENT",
              action: "QR_REPLAY_ATTEMPT",
              severity: "HIGH",
              success: false,
              metadata: { paymentId: payment.publicId },
            });
            throw new AppError(
              409,
              "QR_ALREADY_USED",
              "This QR payment request has already been paid.",
            );
          }
          assertIdempotentReplay(payment.processRequestHash ?? undefined, processHash);
          const transaction = await Transaction.findOne({
            paymentRequestId: payment._id,
          }).lean();
          const wallet = await Wallet.findOne({
            ownerType: "CUSTOMER",
            ownerId: req.auth!.userId,
          }).lean();
          if (!transaction)
            throw new AppError(
              409,
              "OPERATION_IN_PROGRESS",
              "The payment result is still being finalized.",
            );
          return {
            status: 200,
            data: {
              state: payment.state,
              transactionId: transaction.transactionId,
              amountMinor: payment.amountPaisa,
              feeMinor: 0,
              totalMinor: payment.amountPaisa,
              currency: payment.currency,
              merchantName: merchant.businessName,
              orderReference: payment.orderReference,
              requestId: payment.publicId,
              paymentMethod: "QR",
              remainingBalanceMinor: wallet?.balancePaisa,
              replayed: true,
            },
          };
        }
        if (["FAILED", "BLOCKED"].includes(payment.state))
          throw new AppError(
            409,
            payment.state === "BLOCKED" ? "PAYMENT_RISK_REJECTED" : "PAYMENT_FAILED",
            "This QR payment request cannot be retried.",
          );
        if (
          payment.customerId &&
          payment.customerId.toString() !== req.auth!.userId
        ) {
          await securityEvent(req, {
            userId: req.auth!.userId,
            category: "PAYMENT",
            action: "QR_REPLAY_ATTEMPT",
            severity: "HIGH",
            success: false,
            metadata: { paymentId: payment.publicId },
          });
          throw new AppError(
            409,
            "QR_ALREADY_USED",
            "This QR payment request is already assigned to another customer.",
          );
        }

        if (req.body.decision === "DECLINE") {
          const declined = await PaymentRequest.updateOne(
            { _id: payment._id, state: { $in: expirableStates } },
            {
              $set: {
                state: "CANCELLED",
                customerId: req.auth!.userId,
                cancelledAt: new Date(),
                processIdempotencyKey: idempotencyKey,
                processRequestHash: processHash,
              },
            },
          );
          if (declined.modifiedCount !== 1)
            throw new AppError(
              409,
              "OPERATION_IN_PROGRESS",
              "This QR request is already being updated.",
            );
          await audit(req, "QR_PAYMENT_CANCELLED", {
            type: "PaymentRequest",
            id: payment.publicId,
          });
          emitPayment(payment.publicId, "CANCELLED");
          return { status: 200, data: { state: "CANCELLED" } };
        }

        const [customer, profile] = await Promise.all([
          User.findOne({
            _id: req.auth!.userId,
            role: "CUSTOMER",
            status: "ACTIVE",
            emailVerified: true,
          }),
          CustomerProfile.findOne({ userId: req.auth!.userId }).select("kycStatus"),
        ]);
        if (!customer)
          throw new AppError(
            403,
            "CUSTOMER_UNAVAILABLE",
            "Customer account is unavailable.",
          );
        if (profile?.kycStatus !== "APPROVED")
          throw new AppError(
            403,
            "KYC_REQUIRED",
            "Approved demo identity verification is required for QR Pay.",
          );

        const risk =
          payment.riskLevel !== undefined &&
          payment.riskScore !== undefined &&
          payment.customerId?.toString() === req.auth!.userId
            ? {
                level: payment.riskLevel as RiskLevel,
                score: payment.riskScore as number,
                requiresPin: payment.requiresPin,
                requiresOtp: payment.requiresOtp,
                indicators: [] as string[],
              }
            : await assessPaymentRisk(
                req.auth!.userId,
                payment.amountPaisa,
                merchant.createdAt,
              );
        if (risk.level === "BLOCKED") {
          await PaymentRequest.updateOne(
            { _id: payment._id, state: { $in: expirableStates } },
            {
              $set: {
                state: "BLOCKED",
                customerId: req.auth!.userId,
                riskLevel: risk.level,
                riskScore: risk.score,
                requiresPin: risk.requiresPin,
                requiresOtp: risk.requiresOtp,
                failureCode: "RISK_BLOCKED",
              },
            },
          );
          await FraudAlert.create({
            userId: req.auth!.userId,
            paymentRequestId: payment._id,
            riskScore: risk.score,
            riskLevel: risk.level,
            indicators: risk.indicators,
            status: "BLOCKED",
          });
          await securityEvent(req, {
            userId: req.auth!.userId,
            category: "PAYMENT",
            action: "QR_PAYMENT_RISK_BLOCKED",
            severity: "CRITICAL",
            success: false,
            metadata: { paymentId: payment.publicId, riskScore: risk.score },
          });
          emitPayment(payment.publicId, "BLOCKED");
          throw new AppError(
            403,
            "PAYMENT_RISK_REJECTED",
            "Payment was blocked by the risk policy.",
          );
        }
        if (
          (risk.requiresOtp && !req.body.otp) ||
          (risk.requiresPin && !req.body.pin)
        ) {
          const otp =
            risk.requiresOtp && !req.body.otp
              ? await issuePaymentOtp({
                  paymentId: payment.publicId,
                  customer,
                  merchantName: merchant.businessName,
                })
              : {};
          await PaymentRequest.updateOne(
            { _id: payment._id, state: { $in: expirableStates } },
            {
              $set: {
                state: "AWAITING_CONFIRMATION",
                customerId: req.auth!.userId,
                riskLevel: risk.level,
                riskScore: risk.score,
                requiresPin: risk.requiresPin,
                requiresOtp: true,
              },
            },
          );
          emitPayment(payment.publicId, "AWAITING_CONFIRMATION");
          return {
            status: 202,
            data: {
              state: "AWAITING_CONFIRMATION",
              requiresPin: risk.requiresPin,
              requiresOtp: risk.requiresOtp,
              ...otp,
            },
          };
        }
        if (risk.requiresPin)
          await verifyPaymentPin({
            req,
            userId: req.auth!.userId,
            paymentId: payment.publicId,
            pin: req.body.pin,
          });
        if (risk.requiresOtp) await verifyPaymentOtp(payment.publicId, req.body.otp);

        await paymentProvider.verifyPayment(
          req.auth!.userId,
          payment.amountPaisa,
        );
        payment = await PaymentRequest.findOneAndUpdate(
          {
            _id: payment._id,
            state: { $in: expirableStates },
            $or: [
              { customerId: { $exists: false } },
              { customerId: req.auth!.userId },
            ],
          },
          {
            $set: {
              state: "PROCESSING",
              customerId: req.auth!.userId,
              riskLevel: risk.level,
              riskScore: risk.score,
              requiresPin: risk.requiresPin,
              requiresOtp: risk.requiresOtp,
              confirmedAt: new Date(),
              processingStartedAt: new Date(),
              processIdempotencyKey: idempotencyKey,
              processRequestHash: processHash,
              ...(risk.requiresOtp ? { otpVerifiedAt: new Date() } : {}),
            },
          },
          { new: true },
        ).select("+processIdempotencyKey +processRequestHash");
        if (!payment)
          throw new AppError(
            409,
            "OPERATION_IN_PROGRESS",
            "This QR payment is already being processed.",
          );
        if (risk.requiresOtp) await consumePaymentOtp(payment.publicId);
        emitPayment(payment.publicId, "PROCESSING");

        let execution;
        try {
          execution = await executeWalletPayment({
            paymentRequestObjectId: payment._id.toString(),
            paymentId: payment.publicId,
            customerId: req.auth!.userId,
            customerUserId: req.auth!.userId,
            merchantId: merchant._id.toString(),
            merchantUserId: merchant.userId.toString(),
            merchantName: merchant.businessName,
            amountPaisa: payment.amountPaisa,
            description: payment.description ?? undefined,
            orderReference: payment.orderReference ?? undefined,
            riskLevel: risk.level as RiskLevel,
            riskScore: risk.score as number,
            paymentMethod: "QR",
            requestId: req.requestId,
          });
        } catch (error) {
          const failureCode =
            error instanceof AppError ? error.code : "PROCESSING_ERROR";
          await PaymentRequest.updateOne(
            { _id: payment._id, state: "PROCESSING" },
            { $set: { state: "FAILED", failureCode } },
          );
          const amount = fromPaisa(payment.amountPaisa).toLocaleString("en-NP");
          await Notification.create([
            {
              userId: req.auth!.userId,
              type: "PAYMENT_FAILED",
              category: "PAYMENT",
              severity: "HIGH",
              title: "Payment failed",
              message: `The NPR ${amount} QR payment to ${merchant.businessName} failed.`,
              metadata: { paymentId: payment.publicId, failureCode },
            },
            {
              userId: merchant.userId,
              type: "PAYMENT_FAILED",
              category: "PAYMENT",
              severity: "INFO",
              title: "QR payment failed",
              message: `The NPR ${amount} payment request was not completed.`,
              metadata: { paymentId: payment.publicId, failureCode },
            },
          ]);
          await Promise.allSettled([
            audit(
              req,
              "QR_PAYMENT_FAILED",
              { type: "PaymentRequest", id: payment.publicId },
              { failureCode },
            ),
            securityEvent(req, {
              userId: req.auth!.userId,
              category: "PAYMENT",
              action: "QR_PAYMENT_FAILED",
              severity: "HIGH",
              success: false,
              metadata: { paymentId: payment.publicId, failureCode },
            }),
          ]);
          emitPayment(payment.publicId, "FAILED");
          throw error;
        }

        await audit(
          req,
          "QR_PAYMENT_SUCCEEDED",
          { type: "Transaction", id: execution.transactionId },
          { paymentId: payment.publicId, amountPaisa: payment.amountPaisa },
        );
        await securityEvent(req, {
          userId: req.auth!.userId,
          category: "PAYMENT",
          action: "QR_PAYMENT_CONFIRMED",
          severity: risk.level === "HIGH" ? "HIGH" : "INFO",
          success: true,
          metadata: { paymentId: payment.publicId, riskLevel: risk.level },
        });
        await emailService.sendPaymentReceipt({
          to: customer.email,
          displayName: customer.displayName,
          merchantName: merchant.businessName,
          amount: fromPaisa(payment.amountPaisa).toFixed(2),
          transactionId: execution.transactionId,
        });
        const customerMessage = `NPR ${fromPaisa(payment.amountPaisa).toLocaleString()} paid to ${merchant.businessName}.`;
        emitNotification(req.auth!.userId, {
          type: "PAYMENT_SUCCESS",
          category: "PAYMENT",
          title: "Payment successful",
          message: customerMessage,
          transactionId: execution.transactionId,
        });
        emitNotification(merchant.userId.toString(), {
          type: "PAYMENT_RECEIVED",
          category: "PAYMENT",
          title: "Payment received",
          message: customerMessage,
          transactionId: execution.transactionId,
          paymentId: payment.publicId,
        });
        emitPayment(payment.publicId, "SUCCESS", {
          transactionId: execution.transactionId,
        });
        return {
          status: 200,
          data: {
            state: "SUCCESS",
            transactionId: execution.transactionId,
            merchantName: merchant.businessName,
            amountMinor: payment.amountPaisa,
            feeMinor: 0,
            totalMinor: payment.amountPaisa,
            currency: payment.currency,
            orderReference: payment.orderReference,
            requestId: payment.publicId,
            paymentMethod: "QR",
            completedAt: new Date().toISOString(),
            remainingBalanceMinor: execution.remainingBalancePaisa,
          },
        };
      },
    );
    res.status(outcome.status).json({ success: true, data: outcome.data });
  }),
);

export default router;
