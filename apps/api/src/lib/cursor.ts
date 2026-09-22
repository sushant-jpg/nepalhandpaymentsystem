import mongoose from "mongoose";
import { AppError } from "./errors.js";

export interface DateCursor { createdAt: Date; id: string }

export function encodeDateCursor(value: DateCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id }), "utf8").toString("base64url");
}

export function decodeDateCursor(value: string): DateCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    const createdAt = new Date(String(parsed.createdAt));
    if (!Number.isFinite(createdAt.getTime()) || typeof parsed.id !== "string" || !mongoose.isValidObjectId(parsed.id)) throw new Error("invalid");
    return { createdAt, id: parsed.id };
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }
}
