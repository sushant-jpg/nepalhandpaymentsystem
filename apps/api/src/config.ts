import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().default("mongodb://localhost:27017/nepal_hand_pay"),
  JWT_ACCESS_SECRET: z.string().min(32).default("development-access-secret-change-me-now"),
  JWT_REFRESH_SECRET: z.string().min(32).default("development-refresh-secret-change-me"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  PALM_SERVICE_URL: z.string().url().default("http://localhost:8001"),
  PALM_SERVICE_KEY: z.string().default("local-service-key-change-me"),
  REDIS_URL: z.string().optional(),
  REDIS_REQUIRED: z.enum(["true", "false"]).default("false"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  PALM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  PALM_LOCKOUT_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  PIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  PIN_LOCKOUT_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  PAYMENT_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  RISK_MEDIUM_THRESHOLD: z.coerce.number().min(1).max(100).default(30),
  RISK_HIGH_THRESHOLD: z.coerce.number().min(1).max(100).default(60),
  RISK_BLOCKED_THRESHOLD: z.coerce.number().min(1).max(100).default(80),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const config = parsed.data;

if (config.NODE_ENV === "production") {
  const insecure = [
    ["JWT_ACCESS_SECRET", config.JWT_ACCESS_SECRET, "development-access-secret-change-me-now"],
    ["JWT_REFRESH_SECRET", config.JWT_REFRESH_SECRET, "development-refresh-secret-change-me"],
    ["PALM_SERVICE_KEY", config.PALM_SERVICE_KEY, "local-service-key-change-me"],
  ] as const;
  const invalid = insecure.filter(([, value, fallback]) => value === fallback).map(([name]) => name);
  if (invalid.length) throw new Error(`Production secrets must be explicitly configured: ${invalid.join(", ")}`);
}

if (!(config.RISK_MEDIUM_THRESHOLD < config.RISK_HIGH_THRESHOLD && config.RISK_HIGH_THRESHOLD < config.RISK_BLOCKED_THRESHOLD)) {
  throw new Error("Risk thresholds must be ordered: MEDIUM < HIGH < BLOCKED.");
}
