import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { config } from "./config.js";
import {
  CustomerProfile,
  FraudAlert,
  JournalEntry,
  LedgerAccount,
  Merchant,
  Notification,
  SecurityEvent,
  User,
  Wallet,
} from "./models/index.js";
import { publicId } from "./lib/ids.js";
import { postDemoFundingJournal } from "./services/ledger.js";

if (config.DEMO_MODE !== "true") {
  throw new Error("Demo seed is disabled unless DEMO_MODE=true.");
}
if (!config.DEMO_SEED_PASSWORD) {
  throw new Error(
    "DEMO_SEED_PASSWORD is required for deterministic demo seeding and must not be committed.",
  );
}

const demoPassword = config.DEMO_SEED_PASSWORD;

async function upsertUser(
  email: string,
  displayName: string,
  role: "CUSTOMER" | "MERCHANT" | "ADMIN" | "AUDITOR",
) {
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const paymentPinHash =
    role === "CUSTOMER"
      ? await bcrypt.hash(config.DEMO_PAYMENT_PIN, 12)
      : undefined;
  return User.findOneAndUpdate(
    { email },
    {
      $set: {
        displayName,
        role,
        passwordHash,
        paymentPinHash,
        status: "ACTIVE",
        emailVerified: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function ensureOpeningBalance(input: {
  ownerType: "CUSTOMER" | "MERCHANT";
  ownerId: mongoose.Types.ObjectId;
  targetPaisa: number;
}) {
  const referenceId = `${input.ownerType}:${input.ownerId.toString()}`;
  if (
    await JournalEntry.exists({
      kind: "DEMO_CREDIT",
      referenceType: "SeedWallet",
      referenceId,
    })
  )
    return;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const wallet = await Wallet.findOne({
        ownerType: input.ownerType,
        ownerId: input.ownerId,
      }).session(session);
      if (!wallet)
        throw new Error(`Missing ${input.ownerType.toLowerCase()} demo wallet.`);
      const account = await LedgerAccount.findOne({
        ownerType: input.ownerType,
        ownerId: input.ownerId.toString(),
        purpose: "WALLET",
        currency: "NPR",
      }).session(session);

      if (wallet.balancePaisa === 0 && !account) {
        wallet.balancePaisa = input.targetPaisa;
        wallet.version += 1;
        await wallet.save({ session });
      }
      const openingPaisa = wallet.balancePaisa - (account?.postedBalancePaisa ?? 0);
      if (openingPaisa <= 0) return;
      await postDemoFundingJournal(
        {
          operationId: referenceId,
          ownerType: input.ownerType,
          ownerId: input.ownerId.toString(),
          amountPaisa: openingPaisa,
          referenceType: "SeedWallet",
        },
        session,
      );
    });
  } finally {
    await session.endSession();
  }
}

async function seed() {
  await mongoose.connect(config.MONGODB_URI);
  const [admin, customer, merchantUser, auditor] = await Promise.all([
    upsertUser(config.DEMO_ADMIN_EMAIL, "System Admin", "ADMIN"),
    upsertUser(config.DEMO_CUSTOMER_EMAIL, "Demo Customer", "CUSTOMER"),
    upsertUser(config.DEMO_MERCHANT_EMAIL, "Demo Merchant Operator", "MERCHANT"),
    upsertUser(config.DEMO_AUDITOR_EMAIL, "Security Auditor", "AUDITOR"),
  ]);
  await CustomerProfile.findOneAndUpdate(
    { userId: customer._id },
    {
      $set: {
        legalFullName: "Demo Customer",
        dateOfBirth: new Date("1995-01-15T00:00:00.000Z"),
        address: "Demo address, Nepalgunj",
        district: "Banke",
        phone: "+9779800000000",
        documentType: "OTHER",
        documentNumber: "DEMO-DOC-001",
        documents: [
          {
            kind: "DEMO_ID",
            fileName: "demo-identity-reference.txt",
            reference: "demo://identity/customer",
            uploadedAt: new Date(),
          },
        ],
        preferredLanguage: "en",
        kycStatus: "APPROVED",
        submittedAt: new Date(),
        reviewedAt: new Date(),
        reviewedBy: admin._id,
      },
    },
    { upsert: true },
  );
  const merchant = await Merchant.findOneAndUpdate(
    { userId: merchantUser._id },
    {
      $set: {
        businessName: "Nepalgunj Cafe",
        category: "Cafe",
        address: "Nepalgunj, Banke",
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedBy: admin._id,
      },
    },
    { upsert: true, new: true },
  );
  await Promise.all([
    Wallet.findOneAndUpdate(
      { ownerType: "CUSTOMER", ownerId: customer._id },
      {
        $setOnInsert: {
          walletId: publicId("NHPW"),
          balancePaisa: 0,
          currency: "NPR",
          status: "ACTIVE",
        },
      },
      { upsert: true },
    ),
    Wallet.findOneAndUpdate(
      { ownerType: "MERCHANT", ownerId: merchant._id },
      {
        $setOnInsert: {
          walletId: publicId("NHPMW"),
          balancePaisa: 0,
          currency: "NPR",
          status: "ACTIVE",
        },
      },
      { upsert: true },
    ),
  ]);
  await ensureOpeningBalance({
    ownerType: "CUSTOMER",
    ownerId: customer._id,
    targetPaisa: 1_000_000,
  });
  await ensureOpeningBalance({
    ownerType: "MERCHANT",
    ownerId: merchant._id,
    targetPaisa: 275_000,
  });

  if (!(await SecurityEvent.exists({ action: "SEED_EVENT" }))) {
    await SecurityEvent.create([
      {
        userId: customer._id,
        category: "AUTHENTICATION",
        action: "USER_LOGIN",
        severity: "INFO",
        success: true,
      },
      {
        userId: customer._id,
        category: "PALM",
        action: "PALM_IDENTIFICATION_FAILED",
        severity: "WARNING",
        success: false,
      },
      {
        category: "SYSTEM",
        action: "SEED_EVENT",
        severity: "INFO",
        success: true,
      },
    ]);
    await FraudAlert.create({
      userId: customer._id,
      riskScore: 42,
      riskLevel: "MEDIUM",
      indicators: ["DEMO_ALERT"],
      status: "REVIEWED",
      reviewedBy: admin._id,
      reviewedAt: new Date(),
    });
  }
  if (!(await Notification.exists({ userId: customer._id, type: "SEED_WELCOME" }))) {
    await Notification.create([
      {
        userId: customer._id,
        type: "SEED_WELCOME",
        category: "SYSTEM",
        severity: "INFO",
        title: "Welcome to the demo",
        message: "Your simulated wallet and approved demo identity are ready for portfolio testing.",
      },
      {
        userId: merchantUser._id,
        type: "MERCHANT_STATUS",
        category: "MERCHANT",
        severity: "INFO",
        title: "Demo merchant approved",
        message: "Nepalgunj Cafe can accept simulated Nepal Hand Pay payments.",
      },
    ]);
  }
  console.log(
    JSON.stringify({
      level: "info",
      message: "Demo seed complete",
      accounts: [admin.email, merchantUser.email, customer.email, auditor.email],
    }),
  );
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "Demo seed failed",
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  await mongoose.disconnect();
  process.exit(1);
});
