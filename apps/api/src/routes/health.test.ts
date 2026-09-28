import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const { health } = vi.hoisted(() => ({ health: vi.fn() }));
const { redisHealth } = vi.hoisted(() => ({ redisHealth: vi.fn() }));
const { ping, mongoConnection } = vi.hoisted(() => ({
  ping: vi.fn(),
  mongoConnection: {
    readyState: 1,
    db: { admin: () => ({ ping }) },
  },
}));
vi.mock("../services/palm-client.js", () => ({ palmClient: { health } }));
vi.mock("../lib/redis.js", () => ({ redisHealth }));
vi.mock("../config.js", () => ({ config: { REDIS_REQUIRED: "false" } }));
vi.mock("mongoose", () => ({ default: { connection: mongoConnection } }));

import healthRoutes from "./health.js";

const app = express();
app.use(healthRoutes);

afterEach(() => vi.restoreAllMocks());

describe("readiness", () => {
  it("requires MongoDB, Redis, and the palm service", async () => {
    mongoConnection.readyState = 1;
    ping.mockResolvedValue({ ok: 1 });
    health.mockResolvedValue({ status: "ok" });
    redisHealth.mockResolvedValue("connected");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { database: "connected", redis: "connected", palmService: "ok" } });
  });

  it("is not ready when the palm service cannot be reached", async () => {
    mongoConnection.readyState = 1;
    ping.mockResolvedValue({ ok: 1 });
    health.mockRejectedValue(new Error("offline"));
    redisHealth.mockResolvedValue("connected");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ success: false, data: { palmService: "unavailable" } });
  });

  it("is not ready when MongoDB accepts a socket but cannot answer a ping", async () => {
    mongoConnection.readyState = 1;
    ping.mockRejectedValue(new Error("not primary"));
    health.mockResolvedValue({ status: "ok" });
    redisHealth.mockResolvedValue("connected");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.data.database).toBe("disconnected");
  });

  it("stays ready with the local fallback when Redis is optional", async () => {
    mongoConnection.readyState = 1;
    ping.mockResolvedValue({ ok: 1 });
    health.mockResolvedValue({ status: "ok" });
    redisHealth.mockResolvedValue("unavailable");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { redis: "unavailable" },
    });
  });
});
