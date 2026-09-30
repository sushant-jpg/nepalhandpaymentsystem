import { describe, expect, it } from "vitest";
import { parseQrPayload, QrPayloadError } from "@nepal-hand-pay/shared-types";

describe("QR public payload", () => {
  it("accepts a minimal static merchant QR", () => {
    expect(
      parseQrPayload(
        JSON.stringify({
          version: 1,
          type: "merchant",
          merchantId: "0123456789abcdef01234567",
          currency: "NPR",
        }),
      ),
    ).toMatchObject({ type: "merchant", currency: "NPR" });
  });

  it("accepts a dynamic capability envelope without financial values", () => {
    const parsed = parseQrPayload(
      JSON.stringify({
        version: 1,
        type: "payment_request",
        paymentRequestId: "NHPR-20260930-ABCDEFGHJK",
        merchantId: "0123456789abcdef01234567",
        currency: "NPR",
        expiresAt: "2026-09-30T10:00:00.000Z",
        nonce: "abcdef0123456789abcdef0123456789",
        amountMinor: 1,
      }),
    );
    expect(parsed).not.toHaveProperty("amountMinor");
  });

  it("rejects malformed, secret-bearing, and unsupported payloads", () => {
    expect(() => parseQrPayload("not-json-data")).toThrow(QrPayloadError);
    expect(() =>
      parseQrPayload(
        JSON.stringify({
          version: 1,
          type: "payment_request",
          paymentRequestId: "NHPR-too-short",
          merchantId: "not-a-merchant",
          currency: "NPR",
          expiresAt: "never",
          nonce: "jwt-or-password",
        }),
      ),
    ).toThrow(QrPayloadError);
  });
});
