import mongoose from "mongoose";
import { config } from "../config.js";
import { redisHealth } from "../lib/redis.js";
import { palmClient } from "./palm-client.js";

export type DependencyStatus = "healthy" | "degraded" | "unavailable";

export interface DependencyHealth {
  status: DependencyStatus;
  detail: string;
  latencyMs: number;
}

async function timed<T>(operation: () => Promise<T>): Promise<{
  value?: T;
  latencyMs: number;
}> {
  const startedAt = performance.now();
  try {
    return {
      value: await operation(),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } catch {
    return {
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }
}

async function mongoHealth(): Promise<DependencyHealth> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return { status: "unavailable", detail: "disconnected", latencyMs: 0 };
  }
  const result = await timed(async () => {
    await Promise.race([
      mongoose.connection.db!.admin().ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("MongoDB health check timed out")), 2_000),
      ),
    ]);
    return true;
  });
  return {
    status: result.value ? "healthy" : "unavailable",
    detail: result.value ? "connected" : "disconnected",
    latencyMs: result.latencyMs,
  };
}

async function currentRedisHealth(): Promise<DependencyHealth> {
  const result = await timed(redisHealth);
  const detail = result.value ?? "unavailable";
  return {
    status:
      detail === "connected"
        ? "healthy"
        : detail === "disabled" || config.REDIS_REQUIRED !== "true"
          ? "degraded"
          : "unavailable",
    detail,
    latencyMs: result.latencyMs,
  };
}

async function currentPalmHealth(): Promise<DependencyHealth> {
  const result = await timed(() => palmClient.health());
  const detail = result.value?.status ?? "unavailable";
  return {
    status: detail === "ok" ? "healthy" : "unavailable",
    detail,
    latencyMs: result.latencyMs,
  };
}

export async function getServiceHealth() {
  const [database, redis, palmService] = await Promise.all([
    mongoHealth(),
    currentRedisHealth(),
    currentPalmHealth(),
  ]);
  const ready =
    database.status === "healthy" &&
    redis.status !== "unavailable" &&
    palmService.status === "healthy";
  return {
    ready,
    checkedAt: new Date().toISOString(),
    services: {
      api: { status: "healthy" as const, detail: "ok", latencyMs: 0 },
      database,
      redis,
      palmService,
    },
  };
}
