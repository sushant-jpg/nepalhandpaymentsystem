export const roles = ["CUSTOMER", "MERCHANT", "ADMIN", "AUDITOR"] as const;
export type Role = (typeof roles)[number];

export const transactionStatuses = [
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type TransactionStatus = (typeof transactionStatuses)[number];

export const paymentStates = [
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
] as const;
export type PaymentState = (typeof paymentStates)[number];

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export const paymentMethods = ["PALM", "QR", "WALLET", "PIN"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  emailVerified: boolean;
  permissions?: string[];
}

export interface ApiErrorShape {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorShape;

export interface TransactionView {
  id: string;
  transactionId: string;
  customerName?: string;
  merchantName?: string;
  amount: number;
  currency: "NPR";
  status: TransactionStatus;
  paymentMethod?: PaymentMethod;
  riskLevel: RiskLevel;
  createdAt: string;
}

/**
 * Shared domain contracts. Persistence layers may add database identifiers and
 * timestamps, but neither API consumers nor the web application should need
 * to reach into Mongoose implementation types for these core shapes.
 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: "PENDING" | "ACTIVE" | "FROZEN" | "SUSPENDED";
  emailVerified: boolean;
}

export interface Merchant {
  id: string;
  userId: string;
  businessName: string;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
}

export interface Wallet {
  id: string;
  ownerType: "CUSTOMER" | "MERCHANT";
  ownerId: string;
  /** Integer NPR paisa; never a floating-point account balance. */
  balancePaisa: number;
  currency: "NPR";
  status: "ACTIVE" | "FROZEN" | "CLOSED";
  version: number;
}

export interface PaymentRequest {
  id: string;
  merchantId: string;
  customerId?: string;
  amountPaisa: number;
  currency: "NPR";
  state: PaymentState;
  paymentMethod: PaymentMethod;
  expiresAt: string;
  riskScore?: number;
  riskLevel?: RiskLevel;
}

export interface Transaction {
  id: string;
  transactionId: string;
  customerId: string;
  merchantId: string;
  paymentRequestId: string;
  amountPaisa: number;
  currency: "NPR";
  status: TransactionStatus;
  paymentMethod: PaymentMethod;
  riskLevel: RiskLevel;
  refundedAmountPaisa: number;
}

export interface Refund {
  id: string;
  refundId: string;
  transactionId: string;
  merchantId: string;
  amountPaisa: number;
  status: "REQUESTED" | "PROCESSING" | "REFUNDED" | "REJECTED" | "FAILED";
}

export interface AuditLog {
  id: string;
  action: string;
  actorId?: string;
  requestId?: string;
  createdAt: string;
}

export interface SecurityEvent {
  id: string;
  userId?: string;
  category: "AUTHENTICATION" | "PALM" | "PAYMENT" | "ACCOUNT" | "SYSTEM";
  action: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "WARNING" | "HIGH" | "CRITICAL";
  success: boolean;
}

export interface RiskDecision {
  score: number;
  level: RiskLevel;
  reasons: string[];
  requiresPin: boolean;
  requiresOtp: boolean;
}

export interface RefreshToken {
  id: string;
  userId: string;
  jti: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface PalmEnrollment {
  id: string;
  userId: string;
  handSide: "LEFT" | "RIGHT";
  algorithmVersion: string;
  status: "ACTIVE" | "REVOKED" | "PENDING";
  enrolledAt: string;
}

export interface StaticMerchantQrPayload {
  version: 1;
  type: "merchant";
  merchantId: string;
  currency: "NPR";
}

export interface DynamicPaymentQrPayload {
  version: 1;
  type: "payment_request";
  paymentRequestId: string;
  merchantId: string;
  amountMinor: number;
  currency: "NPR";
  expiresAt: string;
  nonce: string;
}

export type QrPayload = StaticMerchantQrPayload | DynamicPaymentQrPayload;

export interface QrPaymentRequestView {
  id: string;
  merchantId: string;
  merchantName: string;
  amountMinor: number;
  currency: "NPR";
  description?: string;
  orderReference?: string;
  feeMinor: number;
  totalMinor: number;
  state: PaymentState;
  expiresAt: string;
  paymentMethod: "QR";
  transactionId?: string;
}

export class QrPayloadError extends Error {
  constructor(message = "The QR code is not a supported Nepal Hand Pay code.") {
    super(message);
    this.name = "QrPayloadError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses only the small public QR envelope. Financial values in the envelope
 * are display hints; clients must always fetch the authoritative request.
 */
export function parseQrPayload(value: string): QrPayload {
  if (value.length < 10 || value.length > 2_048)
    throw new QrPayloadError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new QrPayloadError("The QR code contains malformed data.");
  }
  if (!isPlainObject(parsed) || parsed.version !== 1 || parsed.currency !== "NPR")
    throw new QrPayloadError();
  if (
    parsed.type === "merchant" &&
    typeof parsed.merchantId === "string" &&
    /^[a-f\d]{24}$/i.test(parsed.merchantId)
  ) {
    return {
      version: 1,
      type: "merchant",
      merchantId: parsed.merchantId,
      currency: "NPR",
    };
  }
  if (
    parsed.type === "payment_request" &&
    typeof parsed.paymentRequestId === "string" &&
    /^NHPR-[A-Z0-9-]{10,}$/.test(parsed.paymentRequestId) &&
    typeof parsed.merchantId === "string" &&
    /^[a-f\d]{24}$/i.test(parsed.merchantId) &&
    typeof parsed.amountMinor === "number" &&
    Number.isSafeInteger(parsed.amountMinor) &&
    parsed.amountMinor > 0 &&
    typeof parsed.expiresAt === "string" &&
    Number.isFinite(Date.parse(parsed.expiresAt)) &&
    typeof parsed.nonce === "string" &&
    /^[A-Za-z0-9_-]{16,128}$/.test(parsed.nonce)
  ) {
    return {
      version: 1,
      type: "payment_request",
      paymentRequestId: parsed.paymentRequestId,
      merchantId: parsed.merchantId,
      amountMinor: parsed.amountMinor,
      currency: "NPR",
      expiresAt: parsed.expiresAt,
      nonce: parsed.nonce,
    };
  }
  throw new QrPayloadError();
}

export const palmScanStates = [
  "IDLE",
  "CAMERA_READY",
  "SEARCHING_FOR_PALM",
  "PALM_DETECTED",
  "HOLD_STILL",
  "CAPTURING",
  "IDENTIFYING",
  "SUCCESS",
  "FAILED",
] as const;
export type PalmScanState = (typeof palmScanStates)[number];

export interface PalmQualityResult {
  detected: boolean;
  stable: boolean;
  stableFrames: number;
  stabilityScore: number;
  qualityScore: number;
  algorithmVersion: string;
  livenessAssessment: "PASSIVE_RGB_CHECK_ONLY" | string;
}

/**
 * Cross-platform duplicate-submission guard for automatic palm capture.
 * A completed attempt cannot rearm until both the cooldown elapsed and the
 * caller observed palm/scene removal in consecutive local frames.
 */
export class PalmScanGuard {
  private processing = false;
  private armed = true;
  private cooldownUntil = 0;
  private removalFrames = 0;
  private currentState: PalmScanState = "IDLE";

  constructor(
    private readonly cooldownMs = 1_500,
    private readonly removalFramesRequired = 2,
  ) {}

  get state(): PalmScanState {
    return this.currentState;
  }

  get isProcessing(): boolean {
    return this.processing;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  setState(state: PalmScanState): void {
    this.currentState = state;
  }

  begin(now = Date.now()): boolean {
    if (this.processing || !this.armed || now < this.cooldownUntil) return false;
    this.processing = true;
    this.currentState = "CAPTURING";
    return true;
  }

  finish(success: boolean, now = Date.now()): void {
    this.processing = false;
    this.armed = false;
    this.cooldownUntil = now + this.cooldownMs;
    this.removalFrames = 0;
    this.currentState = success ? "SUCCESS" : "FAILED";
  }

  observeRemoval(sceneChanged: boolean, now = Date.now()): boolean {
    if (this.armed || this.processing || now < this.cooldownUntil) return false;
    this.removalFrames = sceneChanged ? this.removalFrames + 1 : 0;
    if (this.removalFrames < this.removalFramesRequired) return false;
    this.armed = true;
    this.removalFrames = 0;
    this.currentState = "SEARCHING_FOR_PALM";
    return true;
  }

  reset(state: PalmScanState = "IDLE"): void {
    this.processing = false;
    this.armed = true;
    this.cooldownUntil = 0;
    this.removalFrames = 0;
    this.currentState = state;
  }
}
