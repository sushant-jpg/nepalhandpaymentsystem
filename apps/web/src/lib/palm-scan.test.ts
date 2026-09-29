import { describe, expect, it } from "vitest";
import { PalmScanGuard } from "@nepal-hand-pay/shared-types";

describe("PalmScanGuard", () => {
  it("prevents duplicate submissions until cooldown and palm removal", () => {
    const guard = new PalmScanGuard(1_000, 2);

    expect(guard.begin(0)).toBe(true);
    expect(guard.begin(0)).toBe(false);
    guard.finish(false, 100);
    expect(guard.begin(500)).toBe(false);
    expect(guard.observeRemoval(true, 1_100)).toBe(false);
    expect(guard.observeRemoval(false, 1_101)).toBe(false);
    expect(guard.observeRemoval(true, 1_102)).toBe(false);
    expect(guard.observeRemoval(true, 1_103)).toBe(true);
    expect(guard.begin(1_104)).toBe(true);
  });
});
