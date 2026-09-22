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

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  emailVerified: boolean;
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
  severity: "INFO" | "WARNING" | "HIGH" | "CRITICAL";
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
