import { describe, expect, it } from "vitest";
import { actionUrl } from "./email.js";

describe("email action URLs", () => {
  it("encodes tokens and email addresses without exposing them in logs", () => {
    const url = new URL(actionUrl("/verify-email", { email: "person+test@example.com", token: "a/b?c=d" }));
    expect(url.pathname).toBe("/verify-email");
    expect(url.searchParams.get("email")).toBe("person+test@example.com");
    expect(url.searchParams.get("token")).toBe("a/b?c=d");
  });
});
