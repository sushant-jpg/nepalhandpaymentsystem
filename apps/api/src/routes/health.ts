import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { getServiceHealth } from "../services/health.js";

const router = Router();

router.get("/", asyncHandler(async (_req, res) => {
  const health = await getServiceHealth();
  res.status(health.ready ? 200 : 503).json({ success: health.ready, data: health });
}));
router.get("/live", (_req, res) => res.json({ success: true, data: { api: "ok" } }));
router.get("/ready", asyncHandler(async (_req, res) => {
  const health = await getServiceHealth();
  res.status(health.ready ? 200 : 503).json({
    success: health.ready,
    data: {
      database: health.services.database.detail,
      redis: health.services.redis.detail,
      palmService: health.services.palmService.detail,
    },
  });
}));
export default router;
