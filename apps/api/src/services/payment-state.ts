import type { PaymentState } from "@nepal-hand-pay/shared-types";
import { AppError } from "../lib/errors.js";

const transitions: Record<PaymentState, readonly PaymentState[]> = {
  CREATED: ["PALM_PENDING", "CANCELLED", "EXPIRED"],
  PALM_PENDING: ["PALM_VERIFIED", "DECLINED", "CANCELLED", "EXPIRED", "FAILED"],
  PALM_VERIFIED: ["CUSTOMER_CONFIRMATION", "DECLINED", "CANCELLED", "EXPIRED"],
  CUSTOMER_CONFIRMATION: ["PROCESSING", "DECLINED", "CANCELLED", "EXPIRED"],
  PROCESSING: ["SUCCESS", "FAILED"],
  SUCCESS: [], DECLINED: [], EXPIRED: [], FAILED: [], CANCELLED: [],
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
