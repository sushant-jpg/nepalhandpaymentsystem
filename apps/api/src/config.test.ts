import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./config.js";

const base = {
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: "test-access-secret-that-is-at-least-32-characters",
  JWT_REFRESH_SECRET: "test-refresh-secret-that-is-different-and-long",
  PALM_SERVICE_KEY: "test-palm-service-key",
};

describe("environment validation", () => {
  it("parses a valid test configuration", () => {
    expect(parseEnvironment(base)).toMatchObject(base);
  });

  it("requires signing and service secrets in every environment", () => {
    expect(() => parseEnvironment({ NODE_ENV: "test" })).toThrow(
      /JWT_ACCESS_SECRET.*JWT_REFRESH_SECRET.*PALM_SERVICE_KEY/,
    );
  });

  it("rejects malformed secrets", () => {
    expect(() =>
      parseEnvironment({
        ...base,
        JWT_ACCESS_SECRET: "too-short",
        PALM_SERVICE_KEY: "also-too-short",
      }),
    ).toThrow(/JWT_ACCESS_SECRET.*PALM_SERVICE_KEY/);
  });

  it("rejects the same secret for access and refresh tokens", () => {
    expect(() =>
      parseEnvironment({
        ...base,
        JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/must be different/);
  });

  it("rejects placeholder secrets in production", () => {
    expect(() =>
      parseEnvironment({
        ...base,
        NODE_ENV: "production",
        DEMO_MODE: "true",
        REDIS_URL: "redis://redis:6379",
        REDIS_REQUIRED: "true",
        JWT_ACCESS_SECRET: "replace-with-at-least-32-random-characters",
        PALM_SERVICE_KEY: "a-secure-looking-palm-key-over-32-characters",
      }),
    ).toThrow(/must not be placeholders/);
  });

  it("requires secure infrastructure configuration outside demo mode", () => {
    expect(() =>
      parseEnvironment({
        ...base,
        NODE_ENV: "production",
        DEMO_MODE: "false",
        JWT_ACCESS_SECRET: "production-access-secret-0123456789abcdef",
        JWT_REFRESH_SECRET: "production-refresh-secret-fedcba9876543210",
        PALM_SERVICE_KEY: "production-palm-service-key-0123456789",
        REDIS_URL: "redis://redis:6379",
        REDIS_REQUIRED: "true",
        FRONTEND_URL: "http://payments.example",
      }),
    ).toThrow(/COOKIE_SECURE/);
  });
});
