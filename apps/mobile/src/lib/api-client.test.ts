import type { SessionUser } from "@nepal-hand-pay/shared-types";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./api-client";
import { createSessionStore, type StringStorage } from "./session-store";

const user: SessionUser = {
  id: "customer-0001",
  email: "customer@example.com",
  displayName: "Demo Customer",
  role: "CUSTOMER",
  emailVerified: true,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function storage(): StringStorage {
  const values = new Map<string, string>();
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

describe("mobile API client", () => {
  it("logs in through the existing API and persists rotated credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          user,
        },
      }),
    );
    const sessionStore = createSessionStore(storage());
    const client = new ApiClient({
      baseUrl: () => "http://10.0.2.2:4000/api/v1",
      sessionStore,
      native: true,
      fetcher,
      requestId: () => "request-12345678",
    });

    await expect(client.login(user.email, "Password123")).resolves.toMatchObject({
      user,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("http://10.0.2.2:4000/api/v1/auth/login");
    expect(new Headers(init?.headers).get("X-NHP-Client")).toBe("mobile");
    await expect(sessionStore.read()).resolves.toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
  });

  it("rotates once after an unauthorized response and retries with the new access token", async () => {
    const sessionStore = createSessionStore(storage());
    await sessionStore.write({
      accessToken: "access-old",
      refreshToken: "refresh-old",
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: { code: "INVALID_TOKEN" } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            accessToken: "access-new",
            refreshToken: "refresh-new",
            user,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { balance: 500 } }),
      );
    const client = new ApiClient({
      baseUrl: () => "https://api.example/api/v1",
      sessionStore,
      native: true,
      fetcher,
    });

    await expect(client.request<{ balance: number }>("/users/wallet")).resolves.toEqual({
      balance: 500,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const refreshBody = fetcher.mock.calls[1]?.[1]?.body;
    expect(refreshBody).toBe(JSON.stringify({ refreshToken: "refresh-old" }));
    const retriedHeaders = new Headers(fetcher.mock.calls[2]?.[1]?.headers);
    expect(retriedHeaders.get("Authorization")).toBe("Bearer access-new");
  });

  it("clears credentials even when logout cannot reach the server", async () => {
    const sessionStore = createSessionStore(storage());
    await sessionStore.write({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    const client = new ApiClient({
      baseUrl: () => "https://api.example/api/v1",
      sessionStore,
      native: true,
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
    });

    await expect(client.logout()).rejects.toThrow(/API unavailable/);
    await expect(sessionStore.read()).resolves.toBeNull();
  });
});
