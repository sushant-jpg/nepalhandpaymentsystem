import mongoose, { Schema, model, models } from "mongoose";

const objectId = Schema.Types.ObjectId;
const timestamps = { timestamps: true } as const;

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  displayName: { type: String, required: true, trim: true, maxlength: 100 },
  phone: { type: String, trim: true, maxlength: 30 },
  role: { type: String, enum: ["CUSTOMER", "MERCHANT", "ADMIN", "AUDITOR"], required: true, index: true },
  status: { type: String, enum: ["PENDING", "ACTIVE", "FROZEN", "SUSPENDED"], default: "PENDING", index: true },
  emailVerified: { type: Boolean, default: false },
  emailVerificationTokenHash: { type: String, select: false },
  emailVerificationExpiresAt: Date,
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpiresAt: Date,
  failedLoginAttempts: { type: Number, default: 0, min: 0 },
  lockUntil: Date,
  paymentPinHash: { type: String, select: false },
  twoFactorEnabled: { type: Boolean, default: false },
  securityChangedAt: Date,
  lastLoginAt: Date,
}, timestamps);

const customerProfileSchema = new Schema({
  userId: { type: objectId, ref: "User", required: true, unique: true, index: true },
  address: { type: String, maxlength: 300 },
  district: { type: String, maxlength: 80 },
  preferredLanguage: { type: String, enum: ["en", "ne"], default: "en" },
  dateOfBirth: Date,
  kycStatus: { type: String, enum: ["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"], default: "NOT_STARTED" },
  biometricConsentAt: Date,
  biometricRetentionAccepted: { type: Boolean, default: false },
}, timestamps);

const merchantSchema = new Schema({
  userId: { type: objectId, ref: "User", required: true, unique: true, index: true },
  businessName: { type: String, required: true, trim: true, maxlength: 160 },
  registrationNumber: { type: String, trim: true, maxlength: 80 },
  panNumber: { type: String, trim: true, maxlength: 40 },
  category: { type: String, trim: true, maxlength: 80 },
  address: { type: String, maxlength: 300 },
  approvalStatus: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"], default: "PENDING", index: true },
  approvedAt: Date,
  approvedBy: { type: objectId, ref: "User" },
}, timestamps);

const walletSchema = new Schema({
  walletId: { type: String, required: true, unique: true, index: true },
  ownerType: { type: String, enum: ["CUSTOMER", "MERCHANT"], required: true },
  ownerId: { type: objectId, required: true, index: true },
  balancePaisa: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  currency: { type: String, enum: ["NPR"], default: "NPR" },
  status: { type: String, enum: ["ACTIVE", "FROZEN", "CLOSED"], default: "ACTIVE", index: true },
  version: { type: Number, default: 0 },
}, { ...timestamps, optimisticConcurrency: true });
walletSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });

const transactionSchema = new Schema({
  transactionId: { type: String, required: true, unique: true, index: true },
  customerId: { type: objectId, ref: "User", required: true, index: true },
  merchantId: { type: objectId, ref: "Merchant", required: true, index: true },
  paymentRequestId: { type: objectId, ref: "PaymentRequest", required: true, unique: true },
  amountPaisa: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, enum: ["NPR"], default: "NPR" },
  type: { type: String, enum: ["PAYMENT", "REFUND", "DEMO_CREDIT"], required: true },
  status: { type: String, enum: ["PENDING", "PALM_VERIFIED", "AWAITING_CONFIRMATION", "SUCCESS", "FAILED", "DECLINED", "CANCELLED", "REFUNDED"], required: true, index: true },
  paymentMethod: { type: String, enum: ["PALM_WALLET"], default: "PALM_WALLET" },
  palmVerificationId: { type: objectId, ref: "PalmVerification" },
  riskLevel: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], required: true, index: true },
  riskScore: { type: Number, required: true, min: 0, max: 100 },
  description: { type: String, maxlength: 180 },
  completedAt: Date,
  refundedAmountPaisa: { type: Number, default: 0, min: 0 },
}, timestamps);
transactionSchema.index({ customerId: 1, createdAt: -1 });
transactionSchema.index({ merchantId: 1, createdAt: -1 });

const palmEnrollmentSchema = new Schema({
  palmEnrollmentId: { type: String, required: true, unique: true, index: true },
  userId: { type: objectId, ref: "User", required: true, unique: true, index: true },
  handSide: { type: String, enum: ["LEFT", "RIGHT"], required: true },
  algorithmVersion: { type: String, required: true },
  serviceTemplateRef: { type: String, required: true, select: false },
  enrolledAt: { type: Date, required: true },
  status: { type: String, enum: ["ACTIVE", "REVOKED", "PENDING"], default: "ACTIVE" },
  sampleCount: { type: Number, min: 3, max: 5 },
  consentAt: { type: Date, required: true },
  revokedAt: Date,
}, timestamps);

const palmVerificationSchema = new Schema({
  verificationId: { type: String, required: true, unique: true, index: true },
  userId: { type: objectId, ref: "User", index: true },
  paymentRequestId: { type: objectId, ref: "PaymentRequest", index: true },
  matched: { type: Boolean, required: true },
  similarity: { type: Number, min: 0, max: 1 },
  threshold: { type: Number, min: 0, max: 1 },
  algorithmVersion: String,
  failureReason: String,
  ip: String,
}, timestamps);

const paymentRequestSchema = new Schema({
  publicId: { type: String, required: true, unique: true, index: true },
  merchantId: { type: objectId, ref: "Merchant", required: true, index: true },
  customerId: { type: objectId, ref: "User", index: true },
  amountPaisa: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, enum: ["NPR"], default: "NPR" },
  description: { type: String, maxlength: 180 },
  state: { type: String, enum: ["CREATED", "PALM_PENDING", "PALM_VERIFIED", "CUSTOMER_CONFIRMATION", "PROCESSING", "SUCCESS", "DECLINED", "EXPIRED", "FAILED", "CANCELLED"], default: "CREATED", index: true },
  idempotencyKey: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: true },
  palmVerificationId: { type: objectId, ref: "PalmVerification" },
  riskScore: { type: Number, min: 0, max: 100 },
  riskLevel: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
  requiresPin: { type: Boolean, default: false },
  confirmationTokenHash: { type: String, select: false },
  confirmedAt: Date,
}, timestamps);
paymentRequestSchema.index({ merchantId: 1, idempotencyKey: 1 }, { unique: true });

const refundSchema = new Schema({
  refundId: { type: String, required: true, unique: true, index: true },
  transactionId: { type: objectId, ref: "Transaction", required: true, index: true },
  merchantId: { type: objectId, ref: "Merchant", required: true, index: true },
  amountPaisa: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true, maxlength: 300 },
  status: { type: String, enum: ["REQUESTED", "PROCESSING", "REFUNDED", "REJECTED", "FAILED"], default: "REQUESTED", index: true },
  processedAt: Date,
}, timestamps);

const securityEventSchema = new Schema({
  userId: { type: objectId, ref: "User", index: true },
  category: { type: String, enum: ["AUTHENTICATION", "PALM", "PAYMENT", "ACCOUNT", "SYSTEM"], required: true, index: true },
  action: { type: String, required: true, index: true },
  severity: { type: String, enum: ["INFO", "WARNING", "HIGH", "CRITICAL"], default: "INFO", index: true },
  success: { type: Boolean, required: true },
  ip: String,
  userAgent: String,
  metadata: { type: Schema.Types.Mixed, default: {} },
}, timestamps);
securityEventSchema.index({ createdAt: -1 });

const fraudAlertSchema = new Schema({
  userId: { type: objectId, ref: "User", index: true },
  paymentRequestId: { type: objectId, ref: "PaymentRequest", index: true },
  riskScore: { type: Number, required: true, min: 0, max: 100 },
  riskLevel: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], required: true, index: true },
  indicators: [{ type: String }],
  status: { type: String, enum: ["OPEN", "REVIEWED", "RESOLVED", "BLOCKED"], default: "OPEN", index: true },
  reviewedBy: { type: objectId, ref: "User" },
  reviewedAt: Date,
}, timestamps);

const auditLogSchema = new Schema({
  actorId: { type: objectId, ref: "User", index: true },
  actorRole: { type: String, enum: ["CUSTOMER", "MERCHANT", "ADMIN", "AUDITOR", "SYSTEM"] },
  action: { type: String, required: true, index: true },
  targetType: String,
  targetId: String,
  ip: String,
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });
auditLogSchema.index({ createdAt: -1 });

const refreshTokenSchema = new Schema({
  userId: { type: objectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: Date,
  userAgent: String,
  ip: String,
}, timestamps);

const notificationSchema = new Schema({
  userId: { type: objectId, ref: "User", required: true, index: true },
  type: { type: String, required: true },
  title: { type: String, required: true, maxlength: 100 },
  message: { type: String, required: true, maxlength: 300 },
  readAt: Date,
  metadata: { type: Schema.Types.Mixed, default: {} },
}, timestamps);
notificationSchema.index({ userId: 1, createdAt: -1 });

const systemConfigSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  description: String,
  updatedBy: { type: objectId, ref: "User" },
}, timestamps);

type AnyModel = mongoose.Model<any>;
export const User = (models.User || model("User", userSchema)) as AnyModel;
export const CustomerProfile = (models.CustomerProfile || model("CustomerProfile", customerProfileSchema)) as AnyModel;
export const Merchant = (models.Merchant || model("Merchant", merchantSchema)) as AnyModel;
export const Wallet = (models.Wallet || model("Wallet", walletSchema)) as AnyModel;
export const Transaction = (models.Transaction || model("Transaction", transactionSchema)) as AnyModel;
export const PalmEnrollment = (models.PalmEnrollment || model("PalmEnrollment", palmEnrollmentSchema)) as AnyModel;
export const PalmVerification = (models.PalmVerification || model("PalmVerification", palmVerificationSchema)) as AnyModel;
export const PaymentRequest = (models.PaymentRequest || model("PaymentRequest", paymentRequestSchema)) as AnyModel;
export const Refund = (models.Refund || model("Refund", refundSchema)) as AnyModel;
export const SecurityEvent = (models.SecurityEvent || model("SecurityEvent", securityEventSchema)) as AnyModel;
export const FraudAlert = (models.FraudAlert || model("FraudAlert", fraudAlertSchema)) as AnyModel;
export const AuditLog = (models.AuditLog || model("AuditLog", auditLogSchema)) as AnyModel;
export const RefreshToken = (models.RefreshToken || model("RefreshToken", refreshTokenSchema)) as AnyModel;
export const Notification = (models.Notification || model("Notification", notificationSchema)) as AnyModel;
export const SystemConfig = (models.SystemConfig || model("SystemConfig", systemConfigSchema)) as AnyModel;

export const isValidId = (value: string) => mongoose.isValidObjectId(value);
