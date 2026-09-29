import mongoose, { Schema } from "mongoose";
import type { HydratedDocument, InferSchemaType, Model } from "mongoose";

const objectId = Schema.Types.ObjectId;
const timestamps = { timestamps: true } as const;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 30, index: { sparse: true } },
    role: {
      type: String,
      enum: ["CUSTOMER", "MERCHANT", "ADMIN", "AUDITOR"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "FROZEN", "SUSPENDED"],
      default: "PENDING",
      index: true,
    },
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
    lastLoginIp: { type: String, select: false },
    lastLoginUserAgent: { type: String, select: false },
  },
  timestamps,
);

const customerProfileSchema = new Schema(
  {
    userId: {
      type: objectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    address: { type: String, maxlength: 300 },
    district: { type: String, maxlength: 80 },
    preferredLanguage: { type: String, enum: ["en", "ne"], default: "en" },
    dateOfBirth: Date,
    legalFullName: { type: String, trim: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 30 },
    documentType: {
      type: String,
      enum: ["CITIZENSHIP", "PASSPORT", "DRIVING_LICENSE", "OTHER"],
    },
    documentNumber: { type: String, trim: true, maxlength: 80, select: false },
    documents: [
      {
        kind: { type: String, required: true, maxlength: 60 },
        fileName: { type: String, required: true, maxlength: 180 },
        reference: { type: String, required: true, maxlength: 240 },
        uploadedAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    selfieReference: { type: String, maxlength: 240, select: false },
    kycStatus: {
      type: String,
      enum: [
        "NOT_STARTED",
        "DRAFT",
        "PENDING",
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
        "REQUIRES_UPDATE",
      ],
      default: "NOT_STARTED",
      index: true,
    },
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: { type: objectId, ref: "User" },
    rejectionReason: { type: String, maxlength: 500 },
    adminNotes: { type: String, maxlength: 1000, select: false },
    biometricConsentAt: Date,
    biometricRetentionAccepted: { type: Boolean, default: false },
  },
  timestamps,
);

const merchantSchema = new Schema(
  {
    userId: {
      type: objectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    businessName: { type: String, required: true, trim: true, maxlength: 160 },
    ownerName: { type: String, trim: true, maxlength: 160 },
    registrationNumber: { type: String, trim: true, maxlength: 80 },
    panNumber: { type: String, trim: true, maxlength: 40 },
    category: { type: String, trim: true, maxlength: 80 },
    address: { type: String, maxlength: 300 },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    contactPhone: { type: String, trim: true, maxlength: 30 },
    registrationDocuments: [
      {
        kind: { type: String, required: true, maxlength: 60 },
        fileName: { type: String, required: true, maxlength: 180 },
        reference: { type: String, required: true, maxlength: 240 },
        uploadedAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    settlementDetails: {
      bankName: { type: String, maxlength: 120 },
      accountName: { type: String, maxlength: 160 },
      maskedAccountNumber: { type: String, maxlength: 40 },
    },
    approvalStatus: {
      type: String,
      enum: [
        "DRAFT",
        "SUBMITTED",
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
        "SUSPENDED",
      ],
      default: "DRAFT",
      index: true,
    },
    submittedAt: Date,
    reviewedAt: Date,
    approvedAt: Date,
    approvedBy: { type: objectId, ref: "User" },
    reviewNotes: { type: String, maxlength: 1000, select: false },
    rejectionReason: { type: String, maxlength: 500 },
  },
  timestamps,
);

const walletSchema = new Schema(
  {
    walletId: { type: String, required: true, unique: true, index: true },
    ownerType: { type: String, enum: ["CUSTOMER", "MERCHANT"], required: true },
    ownerId: { type: objectId, required: true, index: true },
    balancePaisa: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
    currency: { type: String, enum: ["NPR"], default: "NPR" },
    status: {
      type: String,
      enum: ["ACTIVE", "FROZEN", "CLOSED"],
      default: "ACTIVE",
      index: true,
    },
    version: { type: Number, default: 0 },
  },
  { ...timestamps, optimisticConcurrency: true },
);
walletSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });

const transactionSchema = new Schema(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    customerId: { type: objectId, ref: "User", required: true, index: true },
    merchantId: {
      type: objectId,
      ref: "Merchant",
      required: true,
      index: true,
    },
    paymentRequestId: {
      type: objectId,
      ref: "PaymentRequest",
      required: true,
      unique: true,
    },
    amountPaisa: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    currency: { type: String, enum: ["NPR"], default: "NPR" },
    type: {
      type: String,
      enum: ["PAYMENT", "REFUND", "DEMO_CREDIT"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "CANCELLED",
        "EXPIRED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
      ],
      required: true,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["PALM", "QR", "WALLET", "PIN"],
      default: "PALM",
      index: true,
    },
    palmVerificationId: { type: objectId, ref: "PalmVerification" },
    riskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "BLOCKED"],
      required: true,
      index: true,
    },
    riskScore: { type: Number, required: true, min: 0, max: 100 },
    description: { type: String, maxlength: 180 },
    orderReference: { type: String, maxlength: 80 },
    providerReference: { type: String, maxlength: 120 },
    providerMode: {
      type: String,
      enum: ["MOCK", "SANDBOX", "LIVE"],
      default: "MOCK",
    },
    completedAt: Date,
    refundedAmountPaisa: { type: Number, default: 0, min: 0 },
  },
  timestamps,
);
transactionSchema.index({ customerId: 1, createdAt: -1 });
transactionSchema.index({ merchantId: 1, createdAt: -1 });
transactionSchema.index({ customerId: 1, status: 1, createdAt: -1 });
transactionSchema.index({ merchantId: 1, status: 1, createdAt: -1 });
transactionSchema.index({ riskLevel: 1, createdAt: -1 });

const palmEnrollmentSchema = new Schema(
  {
    palmEnrollmentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: objectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    handSide: { type: String, enum: ["LEFT", "RIGHT"], required: true },
    algorithmVersion: { type: String, required: true },
    serviceTemplateRef: { type: String, required: true, select: false },
    enrolledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["ACTIVE", "REVOKED", "PENDING"],
      default: "ACTIVE",
    },
    sampleCount: { type: Number, min: 3, max: 5 },
    consentAt: { type: Date, required: true },
    revokedAt: Date,
  },
  timestamps,
);

const palmVerificationSchema = new Schema(
  {
    verificationId: { type: String, required: true, unique: true, index: true },
    userId: { type: objectId, ref: "User", index: true },
    paymentRequestId: { type: objectId, ref: "PaymentRequest", index: true },
    matched: { type: Boolean, required: true },
    similarity: { type: Number, min: 0, max: 1 },
    threshold: { type: Number, min: 0, max: 1 },
    algorithmVersion: String,
    failureReason: String,
    ip: String,
  },
  timestamps,
);

const paymentRequestSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    merchantId: {
      type: objectId,
      ref: "Merchant",
      required: true,
      index: true,
    },
    customerId: { type: objectId, ref: "User", index: true },
    createdByUserId: { type: objectId, ref: "User", index: true },
    amountPaisa: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    currency: { type: String, enum: ["NPR"], default: "NPR" },
    paymentMethod: {
      type: String,
      enum: ["PALM", "QR"],
      default: "PALM",
      required: true,
      index: true,
    },
    qrType: { type: String, enum: ["STATIC", "DYNAMIC"] },
    qrNonce: { type: String, select: false },
    qrNonceHash: { type: String, select: false },
    description: { type: String, maxlength: 180 },
    state: {
      type: String,
      enum: [
        "CREATED",
        "AWAITING_PALM",
        "CUSTOMER_IDENTIFIED",
        "RISK_CHECK",
        "AWAITING_CONFIRMATION",
        "AWAITING_PIN",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "CANCELLED",
        "EXPIRED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
        "BLOCKED",
      ],
      default: "CREATED",
      index: true,
    },
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
    completedAt: Date,
    cancelledAt: Date,
  },
  timestamps,
);
paymentRequestSchema.index(
  { merchantId: 1, idempotencyKey: 1 },
  { unique: true },
);
paymentRequestSchema.index(
  { merchantId: 1, processIdempotencyKey: 1 },
  { unique: true, sparse: true },
);
paymentRequestSchema.index({ state: 1, expiresAt: 1 });
paymentRequestSchema.index({ merchantId: 1, paymentMethod: 1, createdAt: -1 });

const refundSchema = new Schema(
  {
    refundId: { type: String, required: true, unique: true, index: true },
    transactionId: {
      type: objectId,
      ref: "Transaction",
      required: true,
      index: true,
    },
    merchantId: {
      type: objectId,
      ref: "Merchant",
      required: true,
      index: true,
    },
    amountPaisa: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, maxlength: 300 },
    idempotencyKey: { type: String, required: true },
    idempotencyRequestHash: { type: String, required: true, select: false },
    providerReference: String,
    status: {
      type: String,
      enum: ["REQUESTED", "PROCESSING", "REFUNDED", "REJECTED", "FAILED"],
      default: "REQUESTED",
      index: true,
    },
    processedAt: Date,
  },
  timestamps,
);
refundSchema.index({ merchantId: 1, idempotencyKey: 1 }, { unique: true });

const securityEventSchema = new Schema(
  {
    userId: { type: objectId, ref: "User", index: true },
    category: {
      type: String,
      enum: ["AUTHENTICATION", "PALM", "PAYMENT", "ACCOUNT", "SYSTEM"],
      required: true,
      index: true,
    },
    action: { type: String, required: true, index: true },
    severity: {
      type: String,
      enum: ["INFO", "LOW", "MEDIUM", "WARNING", "HIGH", "CRITICAL"],
      default: "INFO",
      index: true,
    },
    success: { type: Boolean, required: true },
    requestId: { type: String, index: true },
    ip: String,
    userAgent: String,
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  timestamps,
);
securityEventSchema.index({ createdAt: -1 });
securityEventSchema.index({ userId: 1, createdAt: -1 });
securityEventSchema.index({ category: 1, createdAt: -1 });

const fraudAlertSchema = new Schema(
  {
    userId: { type: objectId, ref: "User", index: true },
    paymentRequestId: { type: objectId, ref: "PaymentRequest", index: true },
    riskScore: { type: Number, required: true, min: 0, max: 100 },
    riskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "BLOCKED"],
      required: true,
      index: true,
    },
    indicators: [{ type: String }],
    status: {
      type: String,
      enum: ["OPEN", "REVIEWED", "RESOLVED", "BLOCKED"],
      default: "OPEN",
      index: true,
    },
    reviewedBy: { type: objectId, ref: "User" },
    reviewedAt: Date,
  },
  timestamps,
);

const auditLogSchema = new Schema(
  {
    actorId: { type: objectId, ref: "User", index: true },
    actorRole: {
      type: String,
      enum: ["CUSTOMER", "MERCHANT", "ADMIN", "AUDITOR", "SYSTEM"],
    },
    action: { type: String, required: true, index: true },
    targetType: String,
    targetId: String,
    requestId: { type: String, index: true },
    ip: String,
    userAgent: String,
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
for (const operation of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndDelete",
  "deleteOne",
  "deleteMany",
  "replaceOne",
] as const) {
  auditLogSchema.pre(operation, function () {
    throw new Error("Audit logs are append-only and cannot be modified.");
  });
}

const refreshTokenSchema = new Schema(
  {
    userId: { type: objectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    jti: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: Date,
    revokedReason: { type: String, maxlength: 80 },
    rotatedFromJti: { type: String, index: { sparse: true } },
    userAgent: String,
    ip: String,
    lastActiveAt: { type: Date, required: true, default: Date.now },
  },
  timestamps,
);
refreshTokenSchema.index({ userId: 1, revokedAt: 1, expiresAt: -1 });

const notificationSchema = new Schema(
  {
    userId: { type: objectId, ref: "User", required: true, index: true },
    type: { type: String, required: true },
    category: {
      type: String,
      enum: ["PAYMENT", "REFUND", "KYC", "MERCHANT", "SECURITY", "DISPUTE", "SYSTEM"],
      default: "SYSTEM",
      index: true,
    },
    severity: {
      type: String,
      enum: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "INFO",
    },
    title: { type: String, required: true, maxlength: 100 },
    message: { type: String, required: true, maxlength: 300 },
    readAt: Date,
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  timestamps,
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

const systemConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    description: String,
    updatedBy: { type: objectId, ref: "User" },
  },
  timestamps,
);

const idempotencyRecordSchema = new Schema(
  {
    idempotencyKey: { type: String, required: true },
    userId: { type: objectId, ref: "User", required: true, index: true },
    endpoint: { type: String, required: true },
    requestHash: { type: String, required: true, select: false },
    response: { type: Schema.Types.Mixed },
    statusCode: Number,
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  timestamps,
);
idempotencyRecordSchema.index(
  { userId: 1, endpoint: 1, idempotencyKey: 1 },
  { unique: true },
);

const ledgerAccountSchema = new Schema(
  {
    accountId: { type: String, required: true, unique: true, index: true },
    ownerType: {
      type: String,
      enum: ["CUSTOMER", "MERCHANT", "PLATFORM"],
      required: true,
    },
    ownerId: { type: String, required: true },
    purpose: {
      type: String,
      enum: ["WALLET", "DEMO_CLEARING", "PLATFORM_FEE"],
      required: true,
    },
    accountType: {
      type: String,
      enum: ["ASSET", "LIABILITY", "REVENUE"],
      required: true,
    },
    normalBalance: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: true,
    },
    currency: { type: String, enum: ["NPR"], default: "NPR" },
    postedBalancePaisa: {
      type: Number,
      required: true,
      default: 0,
      validate: Number.isSafeInteger,
    },
    status: { type: String, enum: ["ACTIVE", "CLOSED"], default: "ACTIVE" },
  },
  timestamps,
);
ledgerAccountSchema.index(
  { ownerType: 1, ownerId: 1, purpose: 1, currency: 1 },
  { unique: true },
);

const journalEntrySchema = new Schema(
  {
    journalId: { type: String, required: true, unique: true, index: true },
    kind: {
      type: String,
      enum: ["PAYMENT", "REFUND", "DEMO_CREDIT", "FEE", "ADJUSTMENT", "REVERSAL"],
      required: true,
      index: true,
    },
    referenceType: { type: String, required: true },
    referenceId: { type: String, required: true },
    description: { type: String, required: true, maxlength: 240 },
    currency: { type: String, enum: ["NPR"], default: "NPR" },
    totalPaisa: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    status: { type: String, enum: ["POSTED"], default: "POSTED" },
    requestId: { type: String, index: true },
    reversalOf: { type: objectId, ref: "JournalEntry" },
    postedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
journalEntrySchema.index(
  { kind: 1, referenceType: 1, referenceId: 1 },
  { unique: true },
);

const ledgerPostingSchema = new Schema(
  {
    journalEntryId: {
      type: objectId,
      ref: "JournalEntry",
      required: true,
      index: true,
    },
    ledgerAccountId: {
      type: objectId,
      ref: "LedgerAccount",
      required: true,
      index: true,
    },
    direction: { type: String, enum: ["DEBIT", "CREDIT"], required: true },
    amountPaisa: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    currency: { type: String, enum: ["NPR"], default: "NPR" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
ledgerPostingSchema.index({ ledgerAccountId: 1, createdAt: -1 });

function makeAppendOnly(schema: Schema) {
  schema.pre("save", function () {
    if (!this.isNew) {
      throw new Error(
        "Posted ledger records are immutable and cannot be modified or deleted.",
      );
    }
  });
  for (const operation of [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findOneAndDelete",
    "deleteOne",
    "deleteMany",
    "replaceOne",
  ] as const) {
    schema.pre(operation, function () {
      throw new Error(
        "Posted ledger records are immutable and cannot be modified or deleted.",
      );
    });
  }
}
makeAppendOnly(journalEntrySchema);
makeAppendOnly(ledgerPostingSchema);

export type UserRecord = InferSchemaType<typeof userSchema>;
export type CustomerProfileRecord = InferSchemaType<
  typeof customerProfileSchema
>;
export type MerchantRecord = InferSchemaType<typeof merchantSchema>;
export type WalletRecord = InferSchemaType<typeof walletSchema>;
export type TransactionRecord = InferSchemaType<typeof transactionSchema>;
export type PalmEnrollmentRecord = InferSchemaType<typeof palmEnrollmentSchema>;
export type PalmVerificationRecord = InferSchemaType<
  typeof palmVerificationSchema
>;
export type PaymentRequestRecord = InferSchemaType<typeof paymentRequestSchema>;
export type RefundRecord = InferSchemaType<typeof refundSchema>;
export type SecurityEventRecord = InferSchemaType<typeof securityEventSchema>;
export type FraudAlertRecord = InferSchemaType<typeof fraudAlertSchema>;
export type AuditLogRecord = InferSchemaType<typeof auditLogSchema>;
export type RefreshTokenRecord = InferSchemaType<typeof refreshTokenSchema>;
export type NotificationRecord = InferSchemaType<typeof notificationSchema>;
export type SystemConfigRecord = InferSchemaType<typeof systemConfigSchema>;
export type IdempotencyRecord = InferSchemaType<typeof idempotencyRecordSchema>;
export type LedgerAccountRecord = InferSchemaType<typeof ledgerAccountSchema>;
export type JournalEntryRecord = InferSchemaType<typeof journalEntrySchema>;
export type LedgerPostingRecord = InferSchemaType<typeof ledgerPostingSchema>;

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

export const User = (mongoose.models.User ??
  mongoose.model<UserRecord>("User", userSchema)) as Model<UserRecord>;
export const CustomerProfile = (mongoose.models.CustomerProfile ??
  mongoose.model<CustomerProfileRecord>(
    "CustomerProfile",
    customerProfileSchema,
  )) as Model<CustomerProfileRecord>;
export const Merchant = (mongoose.models.Merchant ??
  mongoose.model<MerchantRecord>(
    "Merchant",
    merchantSchema,
  )) as Model<MerchantRecord>;
export const Wallet = (mongoose.models.Wallet ??
  mongoose.model<WalletRecord>("Wallet", walletSchema)) as Model<WalletRecord>;
export const Transaction = (mongoose.models.Transaction ??
  mongoose.model<TransactionRecord>(
    "Transaction",
    transactionSchema,
  )) as Model<TransactionRecord>;
export const PalmEnrollment = (mongoose.models.PalmEnrollment ??
  mongoose.model<PalmEnrollmentRecord>(
    "PalmEnrollment",
    palmEnrollmentSchema,
  )) as Model<PalmEnrollmentRecord>;
export const PalmVerification = (mongoose.models.PalmVerification ??
  mongoose.model<PalmVerificationRecord>(
    "PalmVerification",
    palmVerificationSchema,
  )) as Model<PalmVerificationRecord>;
export const PaymentRequest = (mongoose.models.PaymentRequest ??
  mongoose.model<PaymentRequestRecord>(
    "PaymentRequest",
    paymentRequestSchema,
  )) as Model<PaymentRequestRecord>;
export const Refund = (mongoose.models.Refund ??
  mongoose.model<RefundRecord>("Refund", refundSchema)) as Model<RefundRecord>;
export const SecurityEvent = (mongoose.models.SecurityEvent ??
  mongoose.model<SecurityEventRecord>(
    "SecurityEvent",
    securityEventSchema,
  )) as Model<SecurityEventRecord>;
export const FraudAlert = (mongoose.models.FraudAlert ??
  mongoose.model<FraudAlertRecord>(
    "FraudAlert",
    fraudAlertSchema,
  )) as Model<FraudAlertRecord>;
export const AuditLog = (mongoose.models.AuditLog ??
  mongoose.model<AuditLogRecord>(
    "AuditLog",
    auditLogSchema,
  )) as Model<AuditLogRecord>;
export const RefreshToken = (mongoose.models.RefreshToken ??
  mongoose.model<RefreshTokenRecord>(
    "RefreshToken",
    refreshTokenSchema,
  )) as Model<RefreshTokenRecord>;
export const Notification = (mongoose.models.Notification ??
  mongoose.model<NotificationRecord>(
    "Notification",
    notificationSchema,
  )) as Model<NotificationRecord>;
export const SystemConfig = (mongoose.models.SystemConfig ??
  mongoose.model<SystemConfigRecord>(
    "SystemConfig",
    systemConfigSchema,
  )) as Model<SystemConfigRecord>;
export const IdempotencyRecord = (mongoose.models.IdempotencyRecord ??
  mongoose.model<IdempotencyRecord>(
    "IdempotencyRecord",
    idempotencyRecordSchema,
  )) as Model<IdempotencyRecord>;
export const LedgerAccount = (mongoose.models.LedgerAccount ??
  mongoose.model<LedgerAccountRecord>(
    "LedgerAccount",
    ledgerAccountSchema,
  )) as Model<LedgerAccountRecord>;
export const JournalEntry = (mongoose.models.JournalEntry ??
  mongoose.model<JournalEntryRecord>(
    "JournalEntry",
    journalEntrySchema,
  )) as Model<JournalEntryRecord>;
export const LedgerPosting = (mongoose.models.LedgerPosting ??
  mongoose.model<LedgerPostingRecord>(
    "LedgerPosting",
    ledgerPostingSchema,
  )) as Model<LedgerPostingRecord>;

export const isValidId = (value: string) => mongoose.isValidObjectId(value);
