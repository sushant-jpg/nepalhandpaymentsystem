function normalizeApiUrl(value: string): string {
  const normalized = value.trim().replace(/\/$/, "");
  if (!normalized) return "/api/v1";

  if (import.meta.env.PROD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(normalized)) {
    throw new Error("VITE_API_URL cannot target localhost in a production build. Use /api/v1 or a public HTTPS URL.");
  }
  return normalized;
}

export const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL ?? "/api/v1");

export const SOCKET_URL = (() => {
  const configured = import.meta.env.VITE_SOCKET_URL?.trim().replace(/\/$/, "");
  if (import.meta.env.PROD && configured && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)) {
    throw new Error("VITE_SOCKET_URL cannot target localhost in a production build. Leave it empty for same-origin Socket.IO.");
  }
  return configured || window.location.origin;
})();
