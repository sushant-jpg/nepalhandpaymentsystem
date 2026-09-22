import express from "express";
import mongoose from "mongoose";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const { health } = vi.hoisted(() => ({ health: vi.fn() }));
const { redisHealth } = vi.hoisted(() => ({ redisHealth: vi.fn() }));
vi.mock("../services/palm-client.js", () => ({ palmClient: { health } }));
vi.mock("../lib/redis.js", () => ({ redisHealth }));

import healthRoutes from "./health.js";

const app = express();
app.use(healthRoutes);

afterEach(() => vi.restoreAllMocks());

describe("readiness", () => {
  it("requires MongoDB, Redis, and the palm service", async () => {
    vi.spyOn(mongoose.connection, "readyState", "get").mockReturnValue(1);
    health.mockResolvedValue({ status: "ok" });
    redisHealth.mockResolvedValue("connected");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { database: "connected", redis: "connected", palmService: "ok" } });
  });

  it("is not ready when the palm service cannot be reached", async () => {
    vi.spyOn(mongoose.connection, "readyState", "get").mockReturnValue(1);
    health.mockRejectedValue(new Error("offline"));
    redisHealth.mockResolvedValue("connected");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ success: false, data: { palmService: "unavailable" } });
  });
});
