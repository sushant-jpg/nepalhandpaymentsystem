import crypto from "node:crypto";
import { createClient } from "redis";
import { config } from "../config.js";
import { AppError } from "./errors.js";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | undefined;
const localValues = new Map<string, { value: string; expiresAt: number }>();
const localLocks = new Map<string, { token: string; expiresAt: number }>();

function localGet(key: string): string | null {
  const item = localValues.get(key);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    localValues.delete(key);
    return null;
  }
  return item.value;
}

export async function connectRedis(): Promise<void> {
  if (!config.REDIS_URL || client?.isOpen) return;
  const candidate = createClient({ url: config.REDIS_URL });
  candidate.on("error", (error) => {
    console.error(JSON.stringify({ level: "error", message: "Redis client error", error: error.message }));
  });
  try {
    await candidate.connect();
    client = candidate;
  } catch (error) {
    await candidate.disconnect().catch(() => undefined);
    if (config.REDIS_REQUIRED === "true" || config.NODE_ENV === "production") throw error;
    console.warn(JSON.stringify({ level: "warn", message: "Redis unavailable; using process-local development fallback" }));
  }
}

export async function disconnectRedis(): Promise<void> {
  if (client?.isOpen) await client.quit();
  client = undefined;
}

export async function redisHealth(): Promise<"connected" | "disabled" | "unavailable"> {
  if (!config.REDIS_URL) return "disabled";
  if (!client?.isOpen) return "unavailable";
  try {
    return await client.ping() === "PONG" ? "connected" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function setTemporary(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (client?.isOpen) {
    await client.set(key, value, { EX: ttlSeconds });
    return;
  }
  localValues.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function getTemporary(key: string): Promise<string | null> {
  return client?.isOpen ? client.get(key) : localGet(key);
}

export async function deleteTemporary(key: string): Promise<void> {
  if (client?.isOpen) await client.del(key);
  localValues.delete(key);
}

export async function incrementCounter(key: string, ttlSeconds: number): Promise<number> {
  if (client?.isOpen) {
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, ttlSeconds);
    return count;
  }
  const count = Number(localGet(key) ?? "0") + 1;
  localValues.set(key, { value: String(count), expiresAt: Date.now() + ttlSeconds * 1000 });
  return count;
}

export async function revokeAccessToken(jti: string, ttlSeconds: number): Promise<void> {
  await setTemporary(`auth:revoked:${jti}`, "1", Math.max(1, ttlSeconds));
}

export async function isAccessTokenRevoked(jti: string): Promise<boolean> {
  return (await getTemporary(`auth:revoked:${jti}`)) === "1";
}

export async function withDistributedLock<T>(key: string, ttlMs: number, operation: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID();
  let acquired = false;
  if (client?.isOpen) {
    acquired = (await client.set(`lock:${key}`, token, { NX: true, PX: ttlMs })) === "OK";
  } else {
    const current = localLocks.get(key);
    if (!current || current.expiresAt <= Date.now()) {
      localLocks.set(key, { token, expiresAt: Date.now() + ttlMs });
      acquired = true;
    }
  }
  if (!acquired) throw new AppError(409, "OPERATION_IN_PROGRESS", "This operation is already being processed.");
  try {
    return await operation();
  } finally {
    if (client?.isOpen) {
      await client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: [`lock:${key}`], arguments: [token] },
      ).catch(() => undefined);
    } else if (localLocks.get(key)?.token === token) {
      localLocks.delete(key);
    }
  }
}

