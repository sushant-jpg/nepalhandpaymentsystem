import { describe, expect, it } from "vitest";
import { MobileConfigurationError, resolveApiUrl } from "./config";

describe("mobile API URL", () => {
  it("accepts LAN, emulator, and production API URLs", () => {
    expect(resolveApiUrl("http://192.168.1.20:4000/api/v1/ ")).toBe(
      "http://192.168.1.20:4000/api/v1",
    );
    expect(resolveApiUrl("http://10.0.2.2:4000/api/v1")).toBe(
      "http://10.0.2.2:4000/api/v1",
    );
    expect(resolveApiUrl("https://pay.example/api/v1")).toBe(
      "https://pay.example/api/v1",
    );
  });

  it("rejects missing, malformed, or secret-bearing URLs", () => {
    expect(() => resolveApiUrl(undefined)).toThrow(MobileConfigurationError);
    expect(() => resolveApiUrl("localhost:4000/api/v1")).toThrow(
      /complete http/,
    );
    expect(() => resolveApiUrl("https://user:pass@example/api/v1")).toThrow(
      /must not contain credentials/,
    );
    expect(() => resolveApiUrl("https://example.test")).toThrow(/api\/v1/);
    expect(() =>
      resolveApiUrl("http://api.example.test/api/v1", true),
    ).toThrow(/HTTPS/);
  });
});
