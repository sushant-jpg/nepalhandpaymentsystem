import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../lib/async-handler.js";
import { palmClient } from "../services/palm-client.js";
import { redisHealth } from "../lib/redis.js";

const router = Router();
router.get("/", asyncHandler(async (_req, res) => {
  let palm = "unavailable";
  try { palm = (await palmClient.health()).status; } catch { /* summarized below */ }
  const database = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const redis = await redisHealth();
  const healthy = database === "connected" && palm === "ok" && redis !== "unavailable";
  res.status(healthy ? 200 : 503).json({ success: healthy, data: { api: "ok", database, redis, palmService: palm, timestamp: new Date().toISOString() } });
}));
router.get("/live", (_req, res) => res.json({ success: true, data: { api: "ok" } }));
router.get("/ready", asyncHandler(async (_req, res) => {
  const database = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const redis = await redisHealth();
  const ready = database === "connected" && redis !== "unavailable";
  res.status(ready ? 200 : 503).json({ success: ready, data: { database, redis } });
}));
export default router;
