import type { RequestHandler } from "express";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";

function normalizedOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

const allowedOrigins = new Set(
  config.FRONTEND_URL.split(",").map(normalizedOrigin),
);
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function isTrustedBrowserOrigin(origin: string): boolean {
  const normalized = normalizedOrigin(origin);
  if (allowedOrigins.has(normalized)) return true;
  if (config.NODE_ENV === "production") return false;

  try {
    const parsed = new URL(normalized);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Browser CSRF defense for cookie-bearing state changes. Non-browser clients
 * such as CLI and Postman do not send Origin/Sec-Fetch-Site and continue to use
 * the normal authentication and idempotency controls.
 */
export const requireTrustedBrowserOrigin: RequestHandler = (req, _res, next) => {
  if (safeMethods.has(req.method)) return next();
  const fetchSite = req.header("sec-fetch-site");
  const origin = req.header("origin")?.replace(/\/$/, "");
  if (fetchSite === "cross-site" || (origin && !isTrustedBrowserOrigin(origin))) {
    return next(
      new AppError(
        403,
        "UNTRUSTED_ORIGIN",
        "This request did not originate from an approved Nepal Hand Pay application.",
      ),
    );
  }
  next();
};
