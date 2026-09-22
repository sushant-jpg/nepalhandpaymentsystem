import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../lib/errors.js";
import { rateLimit } from "./rate-limit.js";

describe("rate limiting", () => {
  it("rejects requests beyond the fixed window", async () => {
    const app = express();
    app.get("/limited-test", rateLimit(2, 60_000), (_req, res) => res.json({ success: true }));
    app.use(errorHandler);
    expect((await request(app).get("/limited-test")).status).toBe(200);
    expect((await request(app).get("/limited-test")).status).toBe(200);
    const blocked = await request(app).get("/limited-test");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });
});
