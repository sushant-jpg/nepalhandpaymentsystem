import { describe, expect, it } from "vitest";
import type { PaymentState } from "@nepal-hand-pay/shared-types";
import { AppError } from "../lib/errors.js";
import { canTransition, transitionPayment } from "./payment-state.js";

describe("payment state machine", () => {
  it("allows the complete success path", () => {
    const payment: { state: PaymentState } = { state: "CREATED" };
    for (const next of ["AWAITING_PALM", "CUSTOMER_IDENTIFIED", "RISK_CHECK", "AWAITING_CONFIRMATION", "AWAITING_PIN", "PROCESSING", "SUCCESS"] as PaymentState[]) transitionPayment(payment, next);
    expect(payment.state).toBe("SUCCESS");
  });
  it("does not allow replaying a successful payment", () => {
    expect(canTransition("SUCCESS", "PROCESSING")).toBe(false);
    expect(() => transitionPayment({ state: "SUCCESS" }, "PROCESSING")).toThrow(AppError);
  });
  it("supports safe exits before processing", () => {
    expect(canTransition("AWAITING_PALM", "CANCELLED")).toBe(true);
    expect(canTransition("AWAITING_CONFIRMATION", "CANCELLED")).toBe(true);
    expect(canTransition("AWAITING_PIN", "CANCELLED")).toBe(true);
    expect(canTransition("SUCCESS", "PARTIALLY_REFUNDED")).toBe(true);
  });
});
