import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { config } from "./config.js";
import { CustomerProfile, FraudAlert, Merchant, SecurityEvent, User, Wallet } from "./models/index.js";
import { publicId } from "./lib/ids.js";

const generatedPassword = process.env.DEMO_SEED_PASSWORD || `${crypto.randomBytes(9).toString("base64url")}Aa1`;
const paymentPin = process.env.DEMO_PAYMENT_PIN || "2580";

async function upsertUser(email: string, displayName: string, role: "CUSTOMER" | "MERCHANT" | "ADMIN" | "AUDITOR") {
  const passwordHash = await bcrypt.hash(generatedPassword, 12);
  const paymentPinHash = role === "CUSTOMER" ? await bcrypt.hash(paymentPin, 12) : undefined;
  return User.findOneAndUpdate({ email }, { $set: { displayName, role, passwordHash, paymentPinHash, status: "ACTIVE", emailVerified: true } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function seed() {
  await mongoose.connect(config.MONGODB_URI);
  const [admin, customer, merchantUser, auditor] = await Promise.all([
    upsertUser(process.env.DEMO_ADMIN_EMAIL || "admin@demo.local", "System Admin", "ADMIN"),
    upsertUser(process.env.DEMO_CUSTOMER_EMAIL || "customer@demo.local", "Sushant Basnet", "CUSTOMER"),
    upsertUser(process.env.DEMO_MERCHANT_EMAIL || "merchant@demo.local", "Nepalgunj Cafe Operator", "MERCHANT"),
    upsertUser(process.env.DEMO_AUDITOR_EMAIL || "auditor@demo.local", "Security Auditor", "AUDITOR"),
  ]);
  await CustomerProfile.findOneAndUpdate({ userId: customer._id }, { $setOnInsert: { district: "Banke", preferredLanguage: "en" } }, { upsert: true });
  const merchant = await Merchant.findOneAndUpdate({ userId: merchantUser._id }, { $set: { businessName: "Nepalgunj Cafe", category: "Cafe", address: "Nepalgunj, Banke", approvalStatus: "APPROVED", approvedAt: new Date(), approvedBy: admin._id } }, { upsert: true, new: true });
  await Promise.all([
    Wallet.findOneAndUpdate({ ownerType: "CUSTOMER", ownerId: customer._id }, { $setOnInsert: { walletId: publicId("NHPW") }, $set: { balancePaisa: 1_000_000, currency: "NPR", status: "ACTIVE" } }, { upsert: true }),
    Wallet.findOneAndUpdate({ ownerType: "MERCHANT", ownerId: merchant._id }, { $setOnInsert: { walletId: publicId("NHPMW") }, $set: { balancePaisa: 275_000, currency: "NPR", status: "ACTIVE" } }, { upsert: true }),
  ]);
  if (!(await SecurityEvent.exists({ action: "SEED_EVENT" }))) {
    await SecurityEvent.create([
      { userId: customer._id, category: "AUTHENTICATION", action: "USER_LOGIN", severity: "INFO", success: true },
      { userId: customer._id, category: "PALM", action: "PALM_IDENTIFICATION_FAILED", severity: "WARNING", success: false },
      { category: "SYSTEM", action: "SEED_EVENT", severity: "INFO", success: true },
    ]);
    await FraudAlert.create({ userId: customer._id, riskScore: 42, riskLevel: "MEDIUM", indicators: ["DEMO_ALERT"], status: "REVIEWED", reviewedBy: admin._id, reviewedAt: new Date() });
  }
  console.log("Demo seed complete");
  console.log(`Accounts: ${admin.email}, ${merchantUser.email}, ${customer.email}, ${auditor.email}`);
  console.log(`Development password: ${generatedPassword}`);
  console.log(`Customer payment PIN: ${paymentPin}`);
  if (!process.env.DEMO_SEED_PASSWORD) console.log("Password was generated for this run. Set DEMO_SEED_PASSWORD to make repeated seeding deterministic.");
  await mongoose.disconnect();
}

seed().catch(async (error) => { console.error(error); await mongoose.disconnect(); process.exit(1); });
