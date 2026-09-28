import type { ClientSession } from "mongoose";
import { AppError } from "../lib/errors.js";
import { publicId } from "../lib/ids.js";
import { JournalEntry, LedgerAccount, LedgerPosting } from "../models/index.js";

export type PostingDirection = "DEBIT" | "CREDIT";
export type LedgerOwnerType = "CUSTOMER" | "MERCHANT" | "PLATFORM";

export interface JournalPostingInput {
  ownerType: LedgerOwnerType;
  ownerId: string;
  purpose: "WALLET" | "DEMO_CLEARING" | "PLATFORM_FEE";
  direction: PostingDirection;
  amountPaisa: number;
}

export interface JournalInput {
  kind:
    "PAYMENT" | "REFUND" | "DEMO_CREDIT" | "FEE" | "ADJUSTMENT" | "REVERSAL";
  referenceType: string;
  referenceId: string;
  description: string;
  requestId?: string;
  postings: JournalPostingInput[];
}

export function validateBalancedJournal(
  postings: Pick<JournalPostingInput, "direction" | "amountPaisa">[],
) {
  if (
    postings.length < 2 ||
    postings.some(
      (posting) =>
        !Number.isSafeInteger(posting.amountPaisa) || posting.amountPaisa <= 0,
    )
  ) {
    throw new AppError(
      500,
      "LEDGER_INVALID_POSTING",
      "Ledger postings must contain positive integer minor-unit amounts.",
    );
  }
  const debitPaisa = postings
    .filter((posting) => posting.direction === "DEBIT")
    .reduce((sum, posting) => sum + posting.amountPaisa, 0);
  const creditPaisa = postings
    .filter((posting) => posting.direction === "CREDIT")
    .reduce((sum, posting) => sum + posting.amountPaisa, 0);
  if (!Number.isSafeInteger(debitPaisa) || debitPaisa !== creditPaisa) {
    throw new AppError(
      500,
      "LEDGER_UNBALANCED",
      "Journal entry debits and credits must balance.",
    );
  }
  return debitPaisa;
}

function accountDefinition(posting: JournalPostingInput) {
  if (posting.ownerType === "PLATFORM" && posting.purpose === "DEMO_CLEARING") {
    return { accountType: "ASSET" as const, normalBalance: "DEBIT" as const };
  }
  if (posting.ownerType === "PLATFORM" && posting.purpose === "PLATFORM_FEE") {
    return {
      accountType: "REVENUE" as const,
      normalBalance: "CREDIT" as const,
    };
  }
  return {
    accountType: "LIABILITY" as const,
    normalBalance: "CREDIT" as const,
  };
}

async function accountFor(
  posting: JournalPostingInput,
  session: ClientSession,
) {
  const definition = accountDefinition(posting);
  return LedgerAccount.findOneAndUpdate(
    {
      ownerType: posting.ownerType,
      ownerId: posting.ownerId,
      purpose: posting.purpose,
      currency: "NPR",
    },
    {
      $setOnInsert: {
        accountId: publicId("LA"),
        ...definition,
        postedBalancePaisa: 0,
        status: "ACTIVE",
      },
    },
    { upsert: true, new: true, session },
  );
}

export async function postJournal(input: JournalInput, session: ClientSession) {
  const totalPaisa = validateBalancedJournal(input.postings);
  const [entry] = await JournalEntry.create(
    [
      {
        journalId: publicId("JE"),
        kind: input.kind,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        description: input.description,
        totalPaisa,
        requestId: input.requestId,
        postedAt: new Date(),
      },
    ],
    { session },
  );
  if (!entry) {
    throw new AppError(
      500,
      "LEDGER_ENTRY_FAILED",
      "Ledger journal entry could not be created.",
    );
  }

  for (const posting of input.postings) {
    const account = await accountFor(posting, session);
    if (!account) {
      throw new AppError(
        500,
        "LEDGER_ACCOUNT_FAILED",
        "Ledger account could not be created.",
      );
    }
    const delta =
      account.normalBalance === posting.direction
        ? posting.amountPaisa
        : -posting.amountPaisa;
    const changed = await LedgerAccount.updateOne(
      { _id: account._id, status: "ACTIVE" },
      { $inc: { postedBalancePaisa: delta } },
      { session },
    );
    if (changed.modifiedCount !== 1) {
      throw new AppError(
        409,
        "LEDGER_ACCOUNT_RACE",
        "Ledger account changed during posting.",
      );
    }
    await LedgerPosting.create(
      [
        {
          journalEntryId: entry._id,
          ledgerAccountId: account._id,
          direction: posting.direction,
          amountPaisa: posting.amountPaisa,
        },
      ],
      { session },
    );
  }
  return entry;
}

export function postPaymentJournal(
  input: {
    paymentId: string;
    customerId: string;
    merchantId: string;
    amountPaisa: number;
    requestId?: string;
  },
  session: ClientSession,
) {
  return postJournal(
    {
      kind: "PAYMENT",
      referenceType: "PaymentRequest",
      referenceId: input.paymentId,
      description: `Wallet payment ${input.paymentId}`,
      requestId: input.requestId,
      postings: [
        {
          ownerType: "CUSTOMER",
          ownerId: input.customerId,
          purpose: "WALLET",
          direction: "DEBIT",
          amountPaisa: input.amountPaisa,
        },
        {
          ownerType: "MERCHANT",
          ownerId: input.merchantId,
          purpose: "WALLET",
          direction: "CREDIT",
          amountPaisa: input.amountPaisa,
        },
      ],
    },
    session,
  );
}

export function postRefundJournal(
  input: {
    refundId: string;
    customerId: string;
    merchantId: string;
    amountPaisa: number;
    requestId?: string;
  },
  session: ClientSession,
) {
  return postJournal(
    {
      kind: "REFUND",
      referenceType: "Refund",
      referenceId: input.refundId,
      description: `Wallet refund ${input.refundId}`,
      requestId: input.requestId,
      postings: [
        {
          ownerType: "MERCHANT",
          ownerId: input.merchantId,
          purpose: "WALLET",
          direction: "DEBIT",
          amountPaisa: input.amountPaisa,
        },
        {
          ownerType: "CUSTOMER",
          ownerId: input.customerId,
          purpose: "WALLET",
          direction: "CREDIT",
          amountPaisa: input.amountPaisa,
        },
      ],
    },
    session,
  );
}

export function postDemoFundingJournal(
  input: {
    operationId: string;
    ownerType: "CUSTOMER" | "MERCHANT";
    ownerId: string;
    amountPaisa: number;
    requestId?: string;
    referenceType?: string;
  },
  session: ClientSession,
) {
  return postJournal(
    {
      kind: "DEMO_CREDIT",
      referenceType: input.referenceType ?? "IdempotencyRecord",
      referenceId: input.operationId,
      description: `Demo wallet funding ${input.operationId}`,
      requestId: input.requestId,
      postings: [
        {
          ownerType: "PLATFORM",
          ownerId: "DEMO",
          purpose: "DEMO_CLEARING",
          direction: "DEBIT",
          amountPaisa: input.amountPaisa,
        },
        {
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          purpose: "WALLET",
          direction: "CREDIT",
          amountPaisa: input.amountPaisa,
        },
      ],
    },
    session,
  );
}

export function postDemoCreditJournal(
  input: {
    operationId: string;
    customerId: string;
    amountPaisa: number;
    requestId?: string;
  },
  session: ClientSession,
) {
  return postDemoFundingJournal(
    {
      operationId: input.operationId,
      ownerType: "CUSTOMER",
      ownerId: input.customerId,
      amountPaisa: input.amountPaisa,
      requestId: input.requestId,
    },
    session,
  );
}
