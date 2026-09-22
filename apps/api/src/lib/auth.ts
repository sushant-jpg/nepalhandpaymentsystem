import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { Role } from "@nepal-hand-pay/shared-types";
import { config } from "../config.js";

export interface TokenPayload { sub: string; role: Role; email: string; type: "access" | "refresh"; jti: string; exp?: number }

export function signAccessToken(user: { id: string; role: Role; email: string }) {
  return jwt.sign(
    { role: user.role, email: user.email, type: "access", jti: crypto.randomUUID() },
    config.JWT_ACCESS_SECRET,
    { subject: user.id, expiresIn: config.JWT_ACCESS_TTL } as SignOptions,
  );
}

export function signRefreshToken(user: { id: string; role: Role; email: string }, jti: string) {
  return jwt.sign(
    { role: user.role, email: user.email, type: "refresh", jti },
    config.JWT_REFRESH_SECRET,
    { subject: user.id, expiresIn: `${config.JWT_REFRESH_TTL_DAYS}d` } as SignOptions,
  );
}

export const verifyAccessToken = (token: string) => jwt.verify(token, config.JWT_ACCESS_SECRET) as TokenPayload;
export const verifyRefreshToken = (token: string) => jwt.verify(token, config.JWT_REFRESH_SECRET) as TokenPayload;
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("hex");
