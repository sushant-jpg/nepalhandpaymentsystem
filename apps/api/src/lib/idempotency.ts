import crypto from "node:crypto";
import type { Request } from "express";
import { AppError } from "./errors.js";

export function requireIdempotencyKey(req: Request): string {
  const value = req.header("idempotency-key")?.trim();
  if (!value || value.length < 8 || value.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
  }
  return value;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

export function requestHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export function assertIdempotentReplay(storedHash: string | undefined, receivedHash: string): void {
  if (storedHash && storedHash !== receivedHash) {
    throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different request.");
  }
}
