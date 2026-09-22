const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api/v1";
let accessToken = sessionStorage.getItem("nhp_access");

type Options = RequestInit & { retryAuth?: boolean; retryNetwork?: boolean; idempotencyKey?: string; timeoutMs?: number };

export class ApiError extends Error {
  constructor(message: string, public readonly code?: string, public readonly status?: number) { super(message); }
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const { retryAuth = true, retryNetwork = true, idempotencyKey, timeoutMs = 20_000, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  if (fetchOptions.body && !(fetchOptions.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...fetchOptions, headers, credentials: "include", signal: fetchOptions.signal ?? controller.signal });
  } catch (error) {
    if (retryNetwork && idempotencyKey && (error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError"))) {
      return request<T>(path, { ...options, retryNetwork: false });
    }
    throw new ApiError(error instanceof DOMException && error.name === "AbortError" ? "The request timed out. Its final status can be checked safely." : "The network request failed.", "NETWORK_ERROR");
  } finally {
    window.clearTimeout(timeout);
  }
  if (response.status === 401 && retryAuth && path !== "/auth/refresh") {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
    if (refreshed.ok) {
      const payload = await refreshed.json();
      setToken(payload.data.accessToken);
      return request<T>(path, { ...options, retryAuth: false });
    }
  }
  const payload = await response.json().catch(() => ({ error: { message: "The server returned an invalid response." } }));
  if (!response.ok) throw new ApiError(payload.error?.message || payload.detail || "Request failed.", payload.error?.code, response.status);
  return payload.data as T;
}

export function setToken(token: string | null) {
  accessToken = token;
  if (token) sessionStorage.setItem("nhp_access", token); else sessionStorage.removeItem("nhp_access");
}

export const getToken = () => accessToken;

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, options: { idempotencyKey?: string; timeoutMs?: number } = {}) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), ...options }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  download: async (path: string, filename: string) => {
    const response = await fetch(`${API_URL}${path}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, credentials: "include" });
    if (!response.ok) throw new Error("Receipt could not be downloaded.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  },
};
