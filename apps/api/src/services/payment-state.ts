import type { PaymentState } from "@nepal-hand-pay/shared-types";
import { AppError } from "../lib/errors.js";

const transitions: Record<PaymentState, readonly PaymentState[]> = {
  CREATED: ["AWAITING_PALM", "CANCELLED", "EXPIRED"],
  AWAITING_PALM: ["CUSTOMER_IDENTIFIED", "CANCELLED", "EXPIRED", "FAILED"],
  CUSTOMER_IDENTIFIED: ["RISK_CHECK", "CANCELLED", "EXPIRED", "FAILED"],
  RISK_CHECK: ["AWAITING_CONFIRMATION", "CANCELLED", "EXPIRED", "FAILED", "BLOCKED"],
  AWAITING_CONFIRMATION: ["AWAITING_PIN", "PROCESSING", "CANCELLED", "EXPIRED", "FAILED"],
  AWAITING_PIN: ["PROCESSING", "CANCELLED", "EXPIRED", "FAILED"],
  PROCESSING: ["SUCCESS", "FAILED"],
  SUCCESS: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  REFUNDED: [], FAILED: [], CANCELLED: [], EXPIRED: [], BLOCKED: [],
};

export function canTransition(from: PaymentState, to: PaymentState) {
  return transitions[from].includes(to);
}

export function transitionPayment(payment: { state: PaymentState }, next: PaymentState) {
  if (!canTransition(payment.state, next)) {
    throw new AppError(409, "INVALID_PAYMENT_STATE", `Payment cannot transition from ${payment.state} to ${next}.`);
  }
  payment.state = next;
}
