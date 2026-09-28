import type { RequestHandler } from "express";
import type { Role } from "@nepal-hand-pay/shared-types";
import { AppError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/auth.js";
import { isAccessTokenRevoked, isSessionRevoked } from "../lib/redis.js";
import { hasPermission, type Permission } from "../lib/permissions.js";

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer "))
    return next(
      new AppError(401, "AUTH_REQUIRED", "Please sign in to continue."),
    );
  void (async () => {
    try {
      const payload = verifyAccessToken(header.slice(7));
      if (
        payload.type !== "access" ||
        !payload.sub ||
        !payload.jti ||
        (await isAccessTokenRevoked(payload.jti)) ||
        (payload.sid && (await isSessionRevoked(payload.sid)))
      )
        throw new Error("Invalid token");
      req.auth = {
        userId: payload.sub,
        role: payload.role,
        email: payload.email,
        tokenJti: payload.jti,
        tokenExpiresAt: payload.exp,
        sessionId: payload.sid,
      };
      next();
    } catch (error) {
      if (error instanceof AppError && error.code === "REDIS_UNAVAILABLE") {
        return next(error);
      }
      next(
        new AppError(
          401,
          "INVALID_TOKEN",
          "Your session is invalid or has expired.",
        ),
      );
    }
  })();
};

export const authorize =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return next(
        new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission to perform this action.",
        ),
      );
    }
    next();
  };

export const requirePermission =
  (...permissions: Permission[]): RequestHandler =>
  (req, _res, next) => {
    if (
      !req.auth ||
      !permissions.every((permission) =>
        hasPermission(req.auth!.role, permission),
      )
    ) {
      return next(
        new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission to perform this action.",
        ),
      );
    }
    next();
  };
