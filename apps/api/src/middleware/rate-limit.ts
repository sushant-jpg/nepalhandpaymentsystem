import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { incrementCounter } from "../lib/redis.js";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(max: number, windowMs: number): RequestHandler {
  return (req, res, next) => {
    const identity = req.auth?.userId ?? req.ip ?? "unknown";
    const key = `${identity}:${req.method}:${req.baseUrl}${req.path}`;
    const retryAfterSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Policy", `${max};w=${retryAfterSeconds}`);
    void incrementCounter(`rate:${key}`, Math.ceil(windowMs / 1000)).then((count) => {
      res.setHeader("RateLimit-Remaining", String(Math.max(0, max - count)));
      if (count > max) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return next(new AppError(429, "RATE_LIMITED", "Too many attempts. Please try again later."));
      }
      next();
    }).catch(() => {
      const now = Date.now();
      const current = attempts.get(key);
      if (!current || current.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }
      current.count += 1;
      res.setHeader("RateLimit-Remaining", String(Math.max(0, max - current.count)));
      if (current.count > max) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
        return next(new AppError(429, "RATE_LIMITED", "Too many attempts. Please try again later."));
      }
      next();
    });
  };
}
