import mongoose, { HydratedDocument, InferSchemaType, Schema, model, models } from "mongoose";

const objectId = Schema.Types.ObjectId;
const timestamps = { timestamps: true } as const;

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  displayName: { type: String, required: true, trim: true, maxlength: 100 },
  phone: { type: String, trim: true, maxlength: 30, index: { sparse: true } },
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
  failedPinAttempts: { type: Number, default: 0, min: 0, select: false },
  pinLockUntil: { type: Date, select: false },
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
  status: { type: String, enum: ["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED", "PARTIALLY_REFUNDED"], required: true, index: true },
  paymentMethod: { type: String, enum: ["PALM_WALLET"], default: "PALM_WALLET" },
  palmVerificationId: { type: objectId, ref: "PalmVerification" },
  riskLevel: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "BLOCKED"], required: true, index: true },
  riskScore: { type: Number, required: true, min: 0, max: 100 },
  description: { type: String, maxlength: 180 },
  orderReference: { type: String, maxlength: 80 },
  providerReference: { type: String, maxlength: 120 },
  providerMode: { type: String, enum: ["MOCK", "SANDBOX", "LIVE"], default: "MOCK" },
  completedAt: Date,
  refundedAmountPaisa: { type: Number, default: 0, min: 0 },
}, timestamps);
transactionSchema.index({ customerId: 1, createdAt: -1 });
transactionSchema.index({ merchantId: 1, createdAt: -1 });
transactionSchema.index({ customerId: 1, status: 1, createdAt: -1 });
transactionSchema.index({ merchantId: 1, status: 1, createdAt: -1 });
transactionSchema.index({ riskLevel: 1, createdAt: -1 });

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
  state: { type: String, enum: ["CREATED", "AWAITING_PALM", "CUSTOMER_IDENTIFIED", "RISK_CHECK", "AWAITING_CONFIRMATION", "AWAITING_PIN", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED", "PARTIALLY_REFUNDED", "BLOCKED"], default: "CREATED", index: true },
  idempotencyKey: { type: String, required: true },
  idempotencyRequestHash: { type: String, required: true, select: false },
  processIdempotencyKey: { type: String, select: false },
  processRequestHash: { type: String, select: false },
  expiresAt: { type: Date, required: true, index: true },
  palmVerificationId: { type: objectId, ref: "PalmVerification" },
  riskScore: { type: Number, min: 0, max: 100 },
  riskLevel: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "BLOCKED"] },
  requiresPin: { type: Boolean, default: false },
  requiresOtp: { type: Boolean, default: false },
  otpVerifiedAt: Date,
  confirmationTokenHash: { type: String, select: false },
  confirmedAt: Date,
  processingStartedAt: Date,
  providerReference: String,
  failureCode: String,
  orderReference: { type: String, maxlength: 80 },
}, timestamps);
paymentRequestSchema.index({ merchantId: 1, idempotencyKey: 1 }, { unique: true });
paymentRequestSchema.index({ merchantId: 1, processIdempotencyKey: 1 }, { unique: true, sparse: true });
paymentRequestSchema.index({ state: 1, expiresAt: 1 });

const refundSchema = new Schema({
  refundId: { type: String, required: true, unique: true, index: true },
  transactionId: { type: objectId, ref: "Transaction", required: true, index: true },
  merchantId: { type: objectId, ref: "Merchant", required: true, index: true },
  amountPaisa: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true, maxlength: 300 },
  idempotencyKey: { type: String, required: true },
  idempotencyRequestHash: { type: String, required: true, select: false },
  providerReference: String,
  status: { type: String, enum: ["REQUESTED", "PROCESSING", "REFUNDED", "REJECTED", "FAILED"], default: "REQUESTED", index: true },
  processedAt: Date,
}, timestamps);
refundSchema.index({ merchantId: 1, idempotencyKey: 1 }, { unique: true });

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
securityEventSchema.index({ userId: 1, createdAt: -1 });
securityEventSchema.index({ category: 1, createdAt: -1 });

const fraudAlertSchema = new Schema({
  userId: { type: objectId, ref: "User", index: true },
  paymentRequestId: { type: objectId, ref: "PaymentRequest", index: true },
  riskScore: { type: Number, required: true, min: 0, max: 100 },
  riskLevel: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "BLOCKED"], required: true, index: true },
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
  requestId: { type: String, index: true },
  ip: String,
  userAgent: String,
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndDelete", "deleteOne", "deleteMany", "replaceOne"] as const) {
  auditLogSchema.pre(operation, function () {
    throw new Error("Audit logs are append-only and cannot be modified.");
  });
}

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

const idempotencyRecordSchema = new Schema({
  idempotencyKey: { type: String, required: true },
  userId: { type: objectId, ref: "User", required: true, index: true },
  endpoint: { type: String, required: true },
  requestHash: { type: String, required: true, select: false },
  response: { type: Schema.Types.Mixed },
  statusCode: Number,
  status: { type: String, enum: ["PENDING", "COMPLETED", "FAILED"], default: "PENDING", index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, timestamps);
idempotencyRecordSchema.index({ userId: 1, endpoint: 1, idempotencyKey: 1 }, { unique: true });

export type UserRecord = InferSchemaType<typeof userSchema>;
export type CustomerProfileRecord = InferSchemaType<typeof customerProfileSchema>;
export type MerchantRecord = InferSchemaType<typeof merchantSchema>;
export type WalletRecord = InferSchemaType<typeof walletSchema>;
export type TransactionRecord = InferSchemaType<typeof transactionSchema>;
export type PalmEnrollmentRecord = InferSchemaType<typeof palmEnrollmentSchema>;
export type PalmVerificationRecord = InferSchemaType<typeof palmVerificationSchema>;
export type PaymentRequestRecord = InferSchemaType<typeof paymentRequestSchema>;
export type RefundRecord = InferSchemaType<typeof refundSchema>;
export type SecurityEventRecord = InferSchemaType<typeof securityEventSchema>;
export type FraudAlertRecord = InferSchemaType<typeof fraudAlertSchema>;
export type AuditLogRecord = InferSchemaType<typeof auditLogSchema>;
export type RefreshTokenRecord = InferSchemaType<typeof refreshTokenSchema>;
export type NotificationRecord = InferSchemaType<typeof notificationSchema>;
export type SystemConfigRecord = InferSchemaType<typeof systemConfigSchema>;
export type IdempotencyRecord = InferSchemaType<typeof idempotencyRecordSchema>;

export type UserDocument = HydratedDocument<UserRecord>;
export type MerchantDocument = HydratedDocument<MerchantRecord>;
export type WalletDocument = HydratedDocument<WalletRecord>;
export type PaymentRequestDocument = HydratedDocument<PaymentRequestRecord>;
export type TransactionDocument = HydratedDocument<TransactionRecord>;
export type RefundDocument = HydratedDocument<RefundRecord>;
export type AuditLogDocument = HydratedDocument<AuditLogRecord>;
export type SecurityEventDocument = HydratedDocument<SecurityEventRecord>;
export type RefreshTokenDocument = HydratedDocument<RefreshTokenRecord>;
export type PalmEnrollmentDocument = HydratedDocument<PalmEnrollmentRecord>;

export const User = (models.User || model<UserRecord>("User", userSchema)) as mongoose.Model<UserRecord>;
export const CustomerProfile = (models.CustomerProfile || model<CustomerProfileRecord>("CustomerProfile", customerProfileSchema)) as mongoose.Model<CustomerProfileRecord>;
export const Merchant = (models.Merchant || model<MerchantRecord>("Merchant", merchantSchema)) as mongoose.Model<MerchantRecord>;
export const Wallet = (models.Wallet || model<WalletRecord>("Wallet", walletSchema)) as mongoose.Model<WalletRecord>;
export const Transaction = (models.Transaction || model<TransactionRecord>("Transaction", transactionSchema)) as mongoose.Model<TransactionRecord>;
export const PalmEnrollment = (models.PalmEnrollment || model<PalmEnrollmentRecord>("PalmEnrollment", palmEnrollmentSchema)) as mongoose.Model<PalmEnrollmentRecord>;
export const PalmVerification = (models.PalmVerification || model<PalmVerificationRecord>("PalmVerification", palmVerificationSchema)) as mongoose.Model<PalmVerificationRecord>;
export const PaymentRequest = (models.PaymentRequest || model<PaymentRequestRecord>("PaymentRequest", paymentRequestSchema)) as mongoose.Model<PaymentRequestRecord>;
export const Refund = (models.Refund || model<RefundRecord>("Refund", refundSchema)) as mongoose.Model<RefundRecord>;
export const SecurityEvent = (models.SecurityEvent || model<SecurityEventRecord>("SecurityEvent", securityEventSchema)) as mongoose.Model<SecurityEventRecord>;
export const FraudAlert = (models.FraudAlert || model<FraudAlertRecord>("FraudAlert", fraudAlertSchema)) as mongoose.Model<FraudAlertRecord>;
export const AuditLog = (models.AuditLog || model<AuditLogRecord>("AuditLog", auditLogSchema)) as mongoose.Model<AuditLogRecord>;
export const RefreshToken = (models.RefreshToken || model<RefreshTokenRecord>("RefreshToken", refreshTokenSchema)) as mongoose.Model<RefreshTokenRecord>;
export const Notification = (models.Notification || model<NotificationRecord>("Notification", notificationSchema)) as mongoose.Model<NotificationRecord>;
export const SystemConfig = (models.SystemConfig || model<SystemConfigRecord>("SystemConfig", systemConfigSchema)) as mongoose.Model<SystemConfigRecord>;
export const IdempotencyRecord = (models.IdempotencyRecord || model<IdempotencyRecord>("IdempotencyRecord", idempotencyRecordSchema)) as mongoose.Model<IdempotencyRecord>;

export const isValidId = (value: string) => mongoose.isValidObjectId(value);
