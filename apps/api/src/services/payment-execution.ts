import mongoose from "mongoose";
import type { PaymentMethod, RiskLevel } from "@nepal-hand-pay/shared-types";
import { AppError } from "../lib/errors.js";
import { publicId } from "../lib/ids.js";
import { fromPaisa } from "../lib/money.js";
import { withDistributedLock } from "../lib/redis.js";
import {
  Notification,
  PaymentRequest,
  Transaction,
  Wallet,
} from "../models/index.js";
import { postPaymentJournal } from "./ledger.js";
import { paymentProvider } from "./payment-provider.js";

export interface ExecuteWalletPaymentInput {
  paymentRequestObjectId: string;
  paymentId: string;
  customerId: string;
  customerUserId: string;
  merchantId: string;
  merchantUserId: string;
  merchantName: string;
  amountPaisa: number;
  description?: string;
  orderReference?: string;
  palmVerificationId?: string;
  riskLevel: RiskLevel;
  riskScore: number;
  paymentMethod: PaymentMethod;
  requestId?: string;
}

export interface ExecuteWalletPaymentResult {
  transactionId: string;
  remainingBalancePaisa: number;
  replayed: boolean;
}

/**
 * The single wallet-payment commit boundary used by Palm Pay and QR Pay.
 * Wallet movement, double-entry postings, the transaction, notifications,
 * and the terminal payment state are committed in one MongoDB transaction.
 */
export async function executeWalletPayment(
  input: ExecuteWalletPaymentInput,
): Promise<ExecuteWalletPaymentResult> {
  let transactionId: string | undefined;
  let replayed = false;

  await withDistributedLock(`payment:${input.paymentId}`, 30_000, async () => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const existing = await Transaction.findOne({
          paymentRequestId: input.paymentRequestObjectId,
        }).session(session);
        if (existing) {
          transactionId = existing.transactionId;
          replayed = true;
          await PaymentRequest.updateOne(
            {
              _id: input.paymentRequestObjectId,
              state: "PROCESSING",
            },
            { $set: { state: "SUCCESS", completedAt: new Date() } },
            { session },
          );
          return;
        }

        const current = await PaymentRequest.findOne({
          _id: input.paymentRequestObjectId,
          publicId: input.paymentId,
          state: "PROCESSING",
          customerId: input.customerId,
          merchantId: input.merchantId,
        }).session(session);
        if (!current)
          throw new AppError(
            409,
            "PAYMENT_STATE_RACE",
            "Payment authorization changed before it could be committed.",
          );

        const capture = await paymentProvider.capturePayment(
          input.customerId,
          input.merchantId,
          input.amountPaisa,
          session,
        );
        await postPaymentJournal(
          {
            paymentId: input.paymentId,
            customerId: input.customerId,
            merchantId: input.merchantId,
            amountPaisa: input.amountPaisa,
            requestId: input.requestId,
          },
          session,
        );
        const [created] = await Transaction.create(
          [
            {
              transactionId: publicId("NHP"),
              customerId: input.customerId,
              merchantId: input.merchantId,
              paymentRequestId: input.paymentRequestObjectId,
              amountPaisa: input.amountPaisa,
              currency: "NPR",
              type: "PAYMENT",
              status: "SUCCESS",
              paymentMethod: input.paymentMethod,
              palmVerificationId: input.palmVerificationId,
              riskLevel: input.riskLevel,
              riskScore: input.riskScore,
              description: input.description,
              orderReference: input.orderReference,
              providerReference: capture.providerReference,
              providerMode: capture.mode,
              completedAt: new Date(),
            },
          ],
          { session },
        );
        if (!created)
          throw new AppError(
            500,
            "TRANSACTION_CREATE_FAILED",
            "Payment transaction could not be created.",
          );
        transactionId = created.transactionId;

        const completed = await PaymentRequest.updateOne(
          { _id: current._id, state: "PROCESSING" },
          {
            $set: {
              state: "SUCCESS",
              completedAt: new Date(),
              providerReference: capture.providerReference,
            },
          },
          { session },
        );
        if (completed.modifiedCount !== 1)
          throw new AppError(
            409,
            "PAYMENT_STATE_RACE",
            "Payment state changed during processing.",
          );

        const amount = fromPaisa(input.amountPaisa).toLocaleString("en-NP", {
          minimumFractionDigits: 2,
        });
        await Notification.create(
          [
            {
              userId: input.customerUserId,
              type: "PAYMENT_SUCCESS",
              category: "PAYMENT",
              severity: "INFO",
              title: "Payment successful",
              message: `NPR ${amount} paid to ${input.merchantName}.`,
              metadata: {
                transactionId: created.transactionId,
                paymentMethod: input.paymentMethod,
              },
            },
            {
              userId: input.merchantUserId,
              type: "PAYMENT_RECEIVED",
              category: "PAYMENT",
              severity: "INFO",
              title: "Payment received",
              message: `NPR ${amount} received by ${input.paymentMethod} Pay.`,
              metadata: {
                transactionId: created.transactionId,
                paymentId: input.paymentId,
                paymentMethod: input.paymentMethod,
              },
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  });

  if (!transactionId)
    throw new AppError(
      500,
      "PAYMENT_TRANSACTION_MISSING",
      "Payment transaction could not be finalized.",
    );
  const wallet = await Wallet.findOne({
    ownerType: "CUSTOMER",
    ownerId: input.customerId,
  }).lean();
  if (!wallet)
    throw new AppError(
      500,
      "CUSTOMER_WALLET_MISSING",
      "Customer wallet could not be loaded after payment.",
    );
  return {
    transactionId,
    remainingBalancePaisa: wallet.balancePaisa,
    replayed,
  };
}
