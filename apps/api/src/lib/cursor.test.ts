import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import { decodeDateCursor, encodeDateCursor } from "./cursor.js";

describe("opaque date cursors", () => {
  it("round trips the timestamp and stable tiebreaker", () => {
    const createdAt = new Date("2026-01-02T03:04:05.678Z");
    expect(decodeDateCursor(encodeDateCursor({ createdAt, id: "507f1f77bcf86cd799439011" }))).toEqual({ createdAt, id: "507f1f77bcf86cd799439011" });
  });

  it("rejects malformed cursors", () => {
    expect(() => decodeDateCursor("not-a-cursor")).toThrow(AppError);
  });
});
