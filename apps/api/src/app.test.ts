import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("API envelope and route protection", () => {
  it("returns a consistent not-found response", async () => {
    const response = await request(app).get("/api/v1/not-a-route");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: { code: "NOT_FOUND", message: "The requested resource was not found." } });
  });
  it("protects account routes", async () => {
    const response = await request(app).get("/api/v1/users/profile");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });
});
