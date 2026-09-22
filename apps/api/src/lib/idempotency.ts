import crypto from "node:crypto";
import type { Request } from "express";
import type { ClientSession } from "mongoose";
import { AppError } from "./errors.js";
import { IdempotencyRecord } from "../models/index.js";

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

export type IdempotencyStart =
  | { kind: "execute"; recordId: string }
  | { kind: "replay"; response: unknown; statusCode: number };

export async function beginIdempotentOperation(input: {
  idempotencyKey: string;
  userId: string;
  endpoint: string;
  requestHash: string;
  ttlSeconds?: number;
}): Promise<IdempotencyStart> {
  const filter = { userId: input.userId, endpoint: input.endpoint, idempotencyKey: input.idempotencyKey };
  const readExisting = async () => {
    const existing: any = await IdempotencyRecord.findOne(filter).select("+requestHash").lean();
    if (!existing) return null;
    assertIdempotentReplay(existing.requestHash, input.requestHash);
    if (existing.status === "COMPLETED" && existing.statusCode && existing.response) {
      return { kind: "replay", response: existing.response, statusCode: existing.statusCode } as const;
    }
    throw new AppError(409, "OPERATION_IN_PROGRESS", "This idempotent operation is already being processed.");
  };

  const replay = await readExisting();
  if (replay) return replay;
  try {
    const record: any = await IdempotencyRecord.create({
      ...filter,
      requestHash: input.requestHash,
      expiresAt: new Date(Date.now() + (input.ttlSeconds ?? 86_400) * 1000),
    });
    return { kind: "execute", recordId: record._id.toString() };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      const raced = await readExisting();
      if (raced) return raced;
    }
    throw error;
  }
}

export async function completeIdempotentOperation(recordId: string, response: unknown, statusCode: number, session?: ClientSession): Promise<void> {
  await IdempotencyRecord.updateOne(
    { _id: recordId, status: "PENDING" },
    { $set: { status: "COMPLETED", response, statusCode } },
    session ? { session } : undefined,
  );
}

export async function failIdempotentOperation(recordId: string): Promise<void> {
  await IdempotencyRecord.updateOne({ _id: recordId, status: "PENDING" }, { $set: { status: "FAILED" } });
}
