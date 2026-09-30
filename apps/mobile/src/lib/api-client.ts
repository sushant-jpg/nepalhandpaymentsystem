import type { ApiResponse, SessionUser } from "@nepal-hand-pay/shared-types";
import type { SessionCredentials, SessionStore } from "./session-store";

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
  retryAuth?: boolean;
  authenticated?: boolean;
}

export interface AuthSessionPayload {
  accessToken: string;
  refreshToken?: string;
  user: SessionUser;
  developmentVerificationToken?: string;
}

interface ErrorPayload {
  code?: string;
  message?: string;
  details?: unknown;
}

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

interface ApiClientOptions {
  baseUrl(): string;
  sessionStore: SessionStore;
  native: boolean;
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  requestId?: () => string;
}

function defaultRequestId(): string {
  const random = Math.random().toString(36).slice(2, 12);
  return `nhpm-${Date.now().toString(36)}-${random}`;
}

export class ApiClient {
  private credentials: SessionCredentials | null = null;
  private hydrated = false;
  private refreshPromise: Promise<boolean> | null = null;
  private unauthorizedHandler: (() => void) | undefined;
  private readonly fetcher: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly requestId: () => string;

  constructor(private readonly options: ApiClientOptions) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.requestId = options.requestId ?? defaultRequestId;
  }

  setUnauthorizedHandler(handler: (() => void) | undefined): void {
    this.unauthorizedHandler = handler;
  }

  async getCredentials(): Promise<SessionCredentials | null> {
    if (!this.hydrated) {
      this.credentials = await this.options.sessionStore.read();
      this.hydrated = true;
    }
    return this.credentials;
  }

  private async saveSession(payload: AuthSessionPayload): Promise<void> {
    const previous = await this.getCredentials();
    const credentials: SessionCredentials = {
      accessToken: payload.accessToken,
      ...(payload.refreshToken || previous?.refreshToken
        ? { refreshToken: payload.refreshToken ?? previous?.refreshToken }
        : {}),
    };
    this.credentials = credentials;
    this.hydrated = true;
    await this.options.sessionStore.write(credentials);
  }

  async clearSession(): Promise<void> {
    this.credentials = null;
    this.hydrated = true;
    await this.options.sessionStore.clear();
  }

  private mobileHeaders(): Record<string, string> {
    return this.options.native ? { "X-NHP-Client": "mobile" } : {};
  }

  private async rotateSession(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const current = await this.getCredentials();
      if (this.options.native && !current?.refreshToken) return false;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await this.fetcher(
          `${this.options.baseUrl()}/auth/refresh`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-Request-Id": this.requestId(),
              ...this.mobileHeaders(),
            },
            body: JSON.stringify(
              current?.refreshToken
                ? { refreshToken: current.refreshToken }
                : {},
            ),
            signal: controller.signal,
          },
        );
        if (!response.ok) return false;
        const payload = (await response.json()) as ApiResponse<AuthSessionPayload>;
        if (!payload.success || !payload.data.accessToken) return false;
        await this.saveSession(payload.data);
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timeout);
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const {
      method = "GET",
      body,
      idempotencyKey,
      timeoutMs = 20_000,
      retryAuth = true,
      authenticated = true,
    } = options;
    const credentials = authenticated ? await this.getCredentials() : null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl()}${path}`, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": this.requestId(),
          ...this.mobileHeaders(),
          ...(credentials?.accessToken
            ? { Authorization: `Bearer ${credentials.accessToken}` }
            : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new MobileApiError(
          "The request timed out. Check the transaction status before retrying.",
          "REQUEST_TIMEOUT",
        );
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      throw new MobileApiError(
        offline
          ? "Network unavailable. Connect this device to the internet or your development Wi-Fi."
          : "API unavailable. Check that Nepal Hand Pay is running and that your phone can reach its configured LAN or HTTPS address.",
        offline ? "NETWORK_UNAVAILABLE" : "API_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (
      response.status === 401 &&
      retryAuth &&
      authenticated &&
      !["/auth/login", "/auth/register", "/auth/refresh"].includes(path)
    ) {
      if (await this.rotateSession())
        return this.request<T>(path, { ...options, retryAuth: false });
      await this.clearSession();
      this.unauthorizedHandler?.();
      throw new MobileApiError(
        "Your session has expired. Please log in again.",
        "AUTH_SESSION_EXPIRED",
        401,
      );
    }

    const payload = (await response.json().catch(() => ({
      success: false,
      error: { message: "The server returned an invalid response." },
    }))) as
      | { success: true; data: T }
      | { success: false; error: ErrorPayload };
    if (!response.ok || !payload.success) {
      const error = payload.success ? undefined : payload.error;
      throw new MobileApiError(
        error?.message ?? "The request could not be completed.",
        error?.code,
        response.status,
        error?.details,
      );
    }
    return payload.data;
  }

  async login(email: string, password: string): Promise<AuthSessionPayload> {
    const payload = await this.request<AuthSessionPayload>("/auth/login", {
      method: "POST",
      body: { email, password },
      authenticated: false,
      retryAuth: false,
    });
    await this.saveSession(payload);
    return payload;
  }

  async register(input: Record<string, unknown>): Promise<AuthSessionPayload> {
    const payload = await this.request<AuthSessionPayload>("/auth/register", {
      method: "POST",
      body: input,
      authenticated: false,
      retryAuth: false,
    });
    await this.saveSession(payload);
    return payload;
  }

  async logout(): Promise<void> {
    const current = await this.getCredentials();
    try {
      await this.request("/auth/logout", {
        method: "POST",
        body: current?.refreshToken
          ? { refreshToken: current.refreshToken }
          : {},
        retryAuth: false,
      });
    } finally {
      await this.clearSession();
    }
  }
}
