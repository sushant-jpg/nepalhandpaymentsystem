import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../config.js";
import {
  IdempotencyRecord,
  JournalEntry,
  LedgerPosting,
  Wallet,
} from "../models/index.js";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  requestHash,
} from "../lib/idempotency.js";
import { publicId } from "../lib/ids.js";
import {
  postDemoFundingJournal,
  postPaymentJournal,
  postRefundJournal,
} from "../services/ledger.js";
import { DemoWalletProvider } from "../services/payment-provider.js";
import { reconcileLedger } from "../services/reconciliation.js";

const databaseName = `nhp_integration_${process.pid}_${Date.now()}`;
const provider = new DemoWalletProvider();

async function transact(operation: (session: mongoose.ClientSession) => Promise<void>) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => operation(session));
  } finally {
    await session.endSession();
  }
}

describe("database-backed financial integrity", () => {
  beforeAll(async () => {
    await mongoose.connect(config.MONGODB_URI, { dbName: databaseName });
    await Promise.all(
      Object.values(mongoose.models).map((model) => model.syncIndexes()),
    );
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it("keeps wallets and the double-entry ledger consistent under 100 payments and refunds", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const merchantId = new mongoose.Types.ObjectId();
    await Wallet.create([
      {
        walletId: publicId("NHPW"),
        ownerType: "CUSTOMER",
        ownerId: customerId,
        balancePaisa: 0,
      },
      {
        walletId: publicId("NHPMW"),
        ownerType: "MERCHANT",
        ownerId: merchantId,
        balancePaisa: 0,
      },
    ]);
    await transact(async (session) => {
      await Wallet.updateOne(
        { ownerType: "CUSTOMER", ownerId: customerId },
        { $inc: { balancePaisa: 10_000, version: 1 } },
        { session },
      );
      await postDemoFundingJournal(
        {
          operationId: "integration-opening-balance",
          ownerType: "CUSTOMER",
          ownerId: customerId.toString(),
          amountPaisa: 10_000,
          referenceType: "IntegrationTest",
        },
        session,
      );
    });

    const paymentAttempts = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) =>
        transact(async (session) => {
          await provider.capturePayment(
            customerId.toString(),
            merchantId.toString(),
            200,
            session,
          );
          await postPaymentJournal(
            {
              paymentId: `integration-payment-${index}`,
              customerId: customerId.toString(),
              merchantId: merchantId.toString(),
              amountPaisa: 200,
            },
            session,
          );
        }),
      ),
    );
    expect(paymentAttempts.filter((item) => item.status === "fulfilled")).toHaveLength(50);
    expect(paymentAttempts.filter((item) => item.status === "rejected")).toHaveLength(50);

    let [customerWallet, merchantWallet] = await Promise.all([
      Wallet.findOne({ ownerType: "CUSTOMER", ownerId: customerId }).lean(),
      Wallet.findOne({ ownerType: "MERCHANT", ownerId: merchantId }).lean(),
    ]);
    expect(customerWallet?.balancePaisa).toBe(0);
    expect(merchantWallet?.balancePaisa).toBe(10_000);

    const refundAttempts = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) =>
        transact(async (session) => {
          await provider.refundPayment(
            customerId.toString(),
            merchantId.toString(),
            200,
            session,
          );
          await postRefundJournal(
            {
              refundId: `integration-refund-${index}`,
              customerId: customerId.toString(),
              merchantId: merchantId.toString(),
              amountPaisa: 200,
            },
            session,
          );
        }),
      ),
    );
    expect(refundAttempts.filter((item) => item.status === "fulfilled")).toHaveLength(50);
    expect(refundAttempts.filter((item) => item.status === "rejected")).toHaveLength(50);

    [customerWallet, merchantWallet] = await Promise.all([
      Wallet.findOne({ ownerType: "CUSTOMER", ownerId: customerId }).lean(),
      Wallet.findOne({ ownerType: "MERCHANT", ownerId: merchantId }).lean(),
    ]);
    expect(customerWallet?.balancePaisa).toBe(10_000);
    expect(merchantWallet?.balancePaisa).toBe(0);
    expect(await JournalEntry.countDocuments({ kind: "PAYMENT" })).toBe(50);
    expect(await JournalEntry.countDocuments({ kind: "REFUND" })).toBe(50);

    const journalTotals = await LedgerPosting.aggregate<{
      debitPaisa: number;
      creditPaisa: number;
    }>([
      {
        $group: {
          _id: "$journalEntryId",
          debitPaisa: {
            $sum: { $cond: [{ $eq: ["$direction", "DEBIT"] }, "$amountPaisa", 0] },
          },
          creditPaisa: {
            $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amountPaisa", 0] },
          },
        },
      },
    ]);
    expect(journalTotals.every((row) => row.debitPaisa === row.creditPaisa)).toBe(true);
    expect((await reconcileLedger()).balanced).toBe(true);
  });

  it("allows only one simultaneous idempotency owner and safely replays the result", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const hash = requestHash({ amount: 50, purpose: "fund" });
    const attempts = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        beginIdempotentOperation({
          idempotencyKey: "integration-same-key",
          userId,
          endpoint: "POST /integration",
          requestHash: hash,
        }),
      ),
    );
    const owners = attempts.flatMap((item) =>
      item.status === "fulfilled" && item.value.kind === "execute" ? [item.value] : [],
    );
    expect(owners).toHaveLength(1);
    await completeIdempotentOperation(
      owners[0]!.recordId,
      { success: true, data: { operationId: "original" } },
      200,
    );
    const replay = await beginIdempotentOperation({
      idempotencyKey: "integration-same-key",
      userId,
      endpoint: "POST /integration",
      requestHash: hash,
    });
    expect(replay).toMatchObject({ kind: "replay", statusCode: 200 });
    await expect(
      beginIdempotentOperation({
        idempotencyKey: "integration-same-key",
        userId,
        endpoint: "POST /integration",
        requestHash: requestHash({ amount: 51, purpose: "fund" }),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("releases expired idempotency keys and keeps posted journals immutable", async () => {
    const userId = new mongoose.Types.ObjectId();
    await IdempotencyRecord.create({
      idempotencyKey: "integration-expired-key",
      userId,
      endpoint: "POST /expired",
      requestHash: requestHash({ old: true }),
      expiresAt: new Date(Date.now() - 1_000),
    });
    const restarted = await beginIdempotentOperation({
      idempotencyKey: "integration-expired-key",
      userId: userId.toString(),
      endpoint: "POST /expired",
      requestHash: requestHash({ replacement: true }),
    });
    expect(restarted.kind).toBe("execute");

    const posted = await JournalEntry.findOne();
    expect(posted).not.toBeNull();
    posted!.description = "attempted mutation";
    await expect(posted!.save()).rejects.toThrow(/immutable/);
  });
});
