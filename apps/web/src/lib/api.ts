const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api/v1";
let accessToken = sessionStorage.getItem("nhp_access");

type Options = RequestInit & { retry?: boolean };

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
  if (response.status === 401 && options.retry !== false && path !== "/auth/refresh") {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
    if (refreshed.ok) {
      const payload = await refreshed.json();
      setToken(payload.data.accessToken);
      return request<T>(path, { ...options, retry: false });
    }
  }
  const payload = await response.json().catch(() => ({ error: { message: "The server returned an invalid response." } }));
  if (!response.ok) throw new Error(payload.error?.message || payload.detail || "Request failed.");
  return payload.data as T;
}

export function setToken(token: string | null) {
  accessToken = token;
  if (token) sessionStorage.setItem("nhp_access", token); else sessionStorage.removeItem("nhp_access");
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
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
