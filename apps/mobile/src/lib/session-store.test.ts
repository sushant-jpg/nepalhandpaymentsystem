import { describe, expect, it } from "vitest";
import { createSessionStore, type StringStorage } from "./session-store";

function memoryStorage(): StringStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
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

describe("session store", () => {
  it("persists and clears access and refresh credentials", async () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage);
    const session = { accessToken: "access-token", refreshToken: "refresh-token" };

    await store.write(session);
    await expect(store.read()).resolves.toEqual(session);
    await store.clear();
    await expect(store.read()).resolves.toBeNull();
  });

  it("clears corrupted persisted data", async () => {
    const storage = memoryStorage();
    storage.values.set("nhp.mobile.session.v1", "not-json");
    const store = createSessionStore(storage);

    await expect(store.read()).resolves.toBeNull();
    expect(storage.values.size).toBe(0);
  });
});
