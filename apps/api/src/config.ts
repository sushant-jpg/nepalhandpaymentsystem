import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: new URL("../../../.env", import.meta.url) });

const optionalText = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEMO_MODE: z.enum(["true", "false"]).default("true"),
  PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  MONGODB_URI: z.string().trim().min(1).default("mongodb://localhost:27017/nepal_hand_pay"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().trim().min(2).default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  PALM_SERVICE_URL: z.string().url().default("http://localhost:8001"),
  PALM_SERVICE_KEY: z.string().min(16),
  REDIS_URL: optionalText,
  REDIS_REQUIRED: z.enum(["true", "false"]).default("false"),
  FRONTEND_URL: z.string().trim().min(1).default("http://localhost:5173"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  API_BODY_LIMIT: z.string().regex(/^\d+(kb|mb)$/i).default("2mb"),
  PALM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  PALM_LOCKOUT_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  PIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  PIN_LOCKOUT_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  PAYMENT_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  RISK_MEDIUM_THRESHOLD: z.coerce.number().min(1).max(100).default(30),
  RISK_HIGH_THRESHOLD: z.coerce.number().min(1).max(100).default(60),
  RISK_BLOCKED_THRESHOLD: z.coerce.number().min(1).max(100).default(80),
  SMTP_HOST: optionalText,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: optionalText,
  SMTP_PASS: optionalText,
  SMTP_FROM: optionalText,
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(60),
  DEMO_ADMIN_EMAIL: z.string().email().default("admin@demo.local"),
  DEMO_MERCHANT_EMAIL: z.string().email().default("merchant@demo.local"),
  DEMO_CUSTOMER_EMAIL: z.string().email().default("customer@demo.local"),
  DEMO_AUDITOR_EMAIL: z.string().email().default("auditor@demo.local"),
  DEMO_SEED_PASSWORD: optionalText,
  DEMO_PAYMENT_PIN: z.string().regex(/^\d{4,8}$/).default("2580"),
});

export type EnvironmentConfig = z.infer<typeof environmentSchema>;

const insecureSecret = /(change[-_ ]?me|replace[-_ ]?with|placeholder|example|development[-_ ]?(access|refresh|secret)|local[-_ ]?service[-_ ]?key)/i;

function hasUrlCredential(value: string): boolean {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.username && parsed.password);
  } catch {
    return false;
  }
}

export function parseEnvironment(input: NodeJS.ProcessEnv): EnvironmentConfig {
  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const value = parsed.data;
  if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.");
  }
  if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASS)) {
    throw new Error("SMTP_USER and SMTP_PASS must either both be set or both be omitted.");
  }
  if (value.SMTP_HOST && !value.SMTP_FROM) {
    throw new Error("SMTP_FROM is required when SMTP_HOST is configured.");
  }
  if (
    !(
      value.RISK_MEDIUM_THRESHOLD < value.RISK_HIGH_THRESHOLD &&
      value.RISK_HIGH_THRESHOLD < value.RISK_BLOCKED_THRESHOLD
    )
  ) {
    throw new Error("Risk thresholds must be ordered: MEDIUM < HIGH < BLOCKED.");
  }

  if (value.NODE_ENV === "production") {
    const secrets = [
      ["JWT_ACCESS_SECRET", value.JWT_ACCESS_SECRET],
      ["JWT_REFRESH_SECRET", value.JWT_REFRESH_SECRET],
      ["PALM_SERVICE_KEY", value.PALM_SERVICE_KEY],
    ] as const;
    const weak = secrets
      .filter(([, secret]) => secret.length < 32 || insecureSecret.test(secret))
      .map(([name]) => name);
    if (weak.length) {
      throw new Error(
        `Production secrets must be at least 32 characters and must not be placeholders: ${weak.join(", ")}`,
      );
    }
    if (!value.REDIS_URL) {
      throw new Error("REDIS_URL is required in production.");
    }
    if (value.REDIS_REQUIRED !== "true") {
      throw new Error("REDIS_REQUIRED must be true in production.");
    }

    if (value.DEMO_MODE !== "true") {
      const frontendOrigins = value.FRONTEND_URL.split(",").map((origin) => origin.trim());
      if (value.COOKIE_SECURE !== "true") {
        throw new Error("COOKIE_SECURE must be true outside the demo environment.");
      }
      if (frontendOrigins.some((origin) => !origin.startsWith("https://"))) {
        throw new Error("Every FRONTEND_URL origin must use HTTPS in production.");
      }
      if (!value.SMTP_HOST || !value.SMTP_FROM) {
        throw new Error("SMTP_HOST and SMTP_FROM are required outside the demo environment.");
      }
      if (!hasUrlCredential(value.MONGODB_URI)) {
        throw new Error("MONGODB_URI must include database credentials outside the demo environment.");
      }
      if (!hasUrlCredential(value.REDIS_URL)) {
        throw new Error("REDIS_URL must include credentials outside the demo environment.");
      }
    }
  }

  if (value.DEMO_SEED_PASSWORD && value.DEMO_SEED_PASSWORD.length < 10) {
    throw new Error("DEMO_SEED_PASSWORD must be at least 10 characters when configured.");
  }
  if (value.DEMO_MODE !== "true") {
    throw new Error(
      "This build contains only the simulated wallet provider. Set DEMO_MODE=true or implement and review a licensed provider adapter before disabling demo mode.",
    );
  }
  return value;
}

export const config = parseEnvironment(process.env);
