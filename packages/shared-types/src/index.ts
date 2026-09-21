export const roles = ["CUSTOMER", "MERCHANT", "ADMIN", "AUDITOR"] as const;
export type Role = (typeof roles)[number];

export const transactionStatuses = [
  "PENDING",
  "PALM_VERIFIED",
  "AWAITING_CONFIRMATION",
  "SUCCESS",
  "FAILED",
  "DECLINED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type TransactionStatus = (typeof transactionStatuses)[number];

export const paymentStates = [
  "CREATED",
  "PALM_PENDING",
  "PALM_VERIFIED",
  "CUSTOMER_CONFIRMATION",
  "PROCESSING",
  "SUCCESS",
  "DECLINED",
  "EXPIRED",
  "FAILED",
  "CANCELLED",
] as const;
export type PaymentState = (typeof paymentStates)[number];

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

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
