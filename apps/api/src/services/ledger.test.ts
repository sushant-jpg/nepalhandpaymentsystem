import { describe, expect, it } from "vitest";
import { validateBalancedJournal } from "./ledger.js";

describe("double-entry ledger", () => {
  it("accepts equal integer debits and credits", () => {
    expect(
      validateBalancedJournal([
        { direction: "DEBIT", amountPaisa: 125_050 },
        { direction: "CREDIT", amountPaisa: 125_050 },
      ]),
    ).toBe(125_050);
  });

  it("rejects unbalanced journals", () => {
    expect(() =>
      validateBalancedJournal([
        { direction: "DEBIT", amountPaisa: 100 },
        { direction: "CREDIT", amountPaisa: 99 },
      ]),
    ).toThrowError(expect.objectContaining({ code: "LEDGER_UNBALANCED" }));
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid minor units: %s",
    (amountPaisa) => {
      expect(() =>
        validateBalancedJournal([
          { direction: "DEBIT", amountPaisa },
          { direction: "CREDIT", amountPaisa },
        ]),
      ).toThrowError(
        expect.objectContaining({ code: "LEDGER_INVALID_POSTING" }),
      );
    },
  );
});
