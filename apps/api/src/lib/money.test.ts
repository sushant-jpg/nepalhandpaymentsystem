import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import { fromPaisa, toPaisa } from "./money.js";

describe("money conversion", () => {
  it("uses integer paisa without floating point drift", () => {
    expect(toPaisa(650.25)).toBe(65025);
    expect(fromPaisa(65025)).toBe(650.25);
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid amount %s", (amount) => {
    expect(() => toPaisa(amount)).toThrow(AppError);
  });
});
