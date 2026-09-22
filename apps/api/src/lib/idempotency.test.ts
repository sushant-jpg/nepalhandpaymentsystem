import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { assertIdempotentReplay, requestHash, requireIdempotencyKey } from "./idempotency.js";

describe("idempotency", () => {
  it("hashes equivalent objects deterministically", () => {
    expect(requestHash({ amount: 10, reference: "A" })).toBe(requestHash({ reference: "A", amount: 10 }));
  });

  it("rejects key reuse with different request data", () => {
    expect(() => assertIdempotentReplay(requestHash({ amount: 10 }), requestHash({ amount: 11 }))).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
  });

  it("requires a constrained header value", () => {
    const valid = { header: () => "payment:abc-123" } as unknown as Request;
    const missing = { header: () => undefined } as unknown as Request;
    expect(requireIdempotencyKey(valid)).toBe("payment:abc-123");
    expect(() => requireIdempotencyKey(missing)).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED" }));
  });
});
