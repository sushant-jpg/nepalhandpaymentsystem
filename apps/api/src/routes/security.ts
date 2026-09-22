import { Router } from "express";
import type { FilterQuery } from "mongoose";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { AuditLog, FraudAlert, SecurityEvent, type SecurityEventRecord } from "../models/index.js";

const router = Router();
router.use(authenticate);

router.get("/events", asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const filter: FilterQuery<SecurityEventRecord> = ["ADMIN", "AUDITOR"].includes(req.auth!.role) ? {} : { userId: req.auth!.userId };
  if (req.query.category) filter.category = req.query.category;
  const [items, total] = await Promise.all([SecurityEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), SecurityEvent.countDocuments(filter)]);
  res.json({ success: true, data: { items, pagination: { page, limit, total } } });
}));

router.get("/alerts", authorize("ADMIN", "AUDITOR"), asyncHandler(async (_req, res) => {
  const items = await FraudAlert.find().populate("userId", "displayName email").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, data: items });
}));

router.get("/audit", authorize("ADMIN", "AUDITOR"), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const filter = req.query.action ? { action: req.query.action } : {};
  const [items, total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditLog.countDocuments(filter)]);
  res.json({ success: true, data: { items, pagination: { page, limit, total } } });
}));

export default router;
