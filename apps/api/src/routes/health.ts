import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../lib/async-handler.js";
import { palmClient } from "../services/palm-client.js";

const router = Router();
router.get("/", asyncHandler(async (_req, res) => {
  let palm = "unavailable";
  try { palm = (await palmClient.health()).status; } catch { /* summarized below */ }
  const database = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const healthy = database === "connected" && palm === "ok";
  res.status(healthy ? 200 : 503).json({ success: healthy, data: { api: "ok", database, palmService: palm, timestamp: new Date().toISOString() } });
}));
export default router;
