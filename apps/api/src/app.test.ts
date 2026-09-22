import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("API envelope and route protection", () => {
  it("returns a consistent not-found response", async () => {
    const response = await request(app).get("/api/v1/not-a-route");
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, error: { code: "NOT_FOUND", message: "The requested resource was not found." } });
    expect(response.body.requestId).toEqual(expect.any(String));
  });
  it("protects account routes", async () => {
    const response = await request(app).get("/api/v1/users/profile");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });
  it("protects administrator routes", async () => {
    const response = await request(app).get("/api/v1/admin/dashboard");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });
  it("rejects an invalid bearer token", async () => {
    const response = await request(app).get("/api/v1/users/profile").set("Authorization", "Bearer invalid-token");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });
  it("rejects malformed registration input before persistence", async () => {
    const response = await request(app).post("/api/v1/auth/register").send({ email: "not-an-email", password: "weak" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
