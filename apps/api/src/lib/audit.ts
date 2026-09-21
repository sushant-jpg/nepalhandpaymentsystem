import type { Request } from "express";
import { AuditLog, SecurityEvent } from "../models/index.js";

export async function audit(
  req: Request,
  action: string,
  target?: { type: string; id: string },
  metadata: Record<string, unknown> = {},
) {
  await AuditLog.create({
    actorId: req.auth?.userId,
    actorRole: req.auth?.role ?? "SYSTEM",
    action,
    targetType: target?.type,
    targetId: target?.id,
    ip: req.ip,
    metadata,
  });
}

export async function securityEvent(
  req: Request,
  event: { userId?: string; category: string; action: string; severity?: string; success: boolean; metadata?: Record<string, unknown> },
) {
  await SecurityEvent.create({
    ...event,
    ip: req.ip,
    userAgent: req.header("user-agent"),
  });
}
