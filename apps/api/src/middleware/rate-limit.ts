import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(max: number, windowMs: number): RequestHandler {
  return (req, _res, next) => {
    const key = `${req.ip ?? "unknown"}:${req.path}`;
    const now = Date.now();
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) return next(new AppError(429, "RATE_LIMITED", "Too many attempts. Please try again later."));
    next();
  };
}
