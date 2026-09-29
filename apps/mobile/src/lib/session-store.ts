export interface SessionCredentials {
  accessToken: string;
  refreshToken?: string;
}

export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SessionStore {
  read(): Promise<SessionCredentials | null>;
  write(credentials: SessionCredentials): Promise<void>;
  clear(): Promise<void>;
}

const STORAGE_KEY = "nhp.mobile.session.v1";

function validCredentials(value: unknown): value is SessionCredentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    (candidate.refreshToken === undefined ||
      typeof candidate.refreshToken === "string")
  );
}

export function createSessionStore(storage: StringStorage): SessionStore {
  return {
    async read() {
      const serialized = await storage.getItem(STORAGE_KEY);
      if (!serialized) return null;
      try {
        const parsed: unknown = JSON.parse(serialized);
        if (validCredentials(parsed)) return parsed;
      } catch {
        // Corrupted credentials are cleared below.
      }
      await storage.removeItem(STORAGE_KEY);
      return null;
    },
    async write(credentials) {
      if (!validCredentials(credentials))
        throw new Error("Cannot persist an invalid mobile session.");
      await storage.setItem(STORAGE_KEY, JSON.stringify(credentials));
    },
    async clear() {
      await storage.removeItem(STORAGE_KEY);
    },
  };
}
