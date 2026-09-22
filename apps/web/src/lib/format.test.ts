import { describe, expect, it } from "vitest";
import { dateTime, npr } from "./format";

describe("Nepal-facing formatting", () => {
  it("formats NPR values without changing the amount", () => {
    expect(npr(650.25)).toContain("650.25");
  });

  it("formats timestamps in the Kathmandu time zone", () => {
    expect(dateTime("2026-01-01T00:00:00.000Z")).toMatch(/5:45|05:45/);
  });
});
