import { describe, expect, it } from "vitest";
import { parseMinorUnits } from "./money";

describe("mobile money input", () => {
  it("uses exact integer minor units", () => {
    expect(parseMinorUnits("10")).toBe(1_000);
    expect(parseMinorUnits("10.05")).toBe(1_005);
    expect(parseMinorUnits("0.01")).toBe(1);
  });

  it("rejects floating precision and malformed amounts", () => {
    expect(parseMinorUnits("1.001")).toBeUndefined();
    expect(parseMinorUnits("1e3")).toBeUndefined();
    expect(parseMinorUnits("0")).toBeUndefined();
  });
});
