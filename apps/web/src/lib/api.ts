import { API_URL } from "./runtime-config";

let accessToken = sessionStorage.getItem("nhp_access");

type Options = RequestInit & { retryAuth?: boolean; retryNetwork?: boolean; idempotencyKey?: string; timeoutMs?: number };

export interface ValidationDetails {
  fieldErrors?: Record<string, string[]>;
  formErrors?: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
    public readonly requestId?: string,
    public readonly details?: ValidationDetails,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const errorMessages: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: "Invalid email or password.",
  INVALID_CREDENTIALS: "Invalid email or password.",
  AUTH_ACCOUNT_LOCKED: "Your account is temporarily locked. Try again later or reset your password.",
  ACCOUNT_LOCKED: "Your account is temporarily locked. Try again later or reset your password.",
  AUTH_EMAIL_NOT_VERIFIED: "Verify your email before signing in.",
  AUTH_SESSION_EXPIRED: "Your session expired. Please sign in again.",
  INVALID_TOKEN: "Your session expired. Please sign in again.",
  INVALID_REFRESH: "Your session expired. Please sign in again.",
  REFRESH_REUSED: "This session is no longer secure. Sign in again on this device.",
  ACCOUNT_UNAVAILABLE: "This account is suspended or unavailable.",
  AUTH_ACCOUNT_UNAVAILABLE: "This account is suspended or unavailable.",
  AUTH_REFRESH_REUSED: "This session is no longer secure. Sign in again on this device.",
  AUTH_REQUIRED: "Please sign in to continue.",
  FORBIDDEN: "You do not have permission to perform this action.",
  UNTRUSTED_ORIGIN: "This request was blocked for your protection. Reload the official application and try again.",
  RATE_LIMITED: "Too many attempts. Wait a moment before trying again.",
  SERVICE_UNAVAILABLE: "Nepal Hand Pay is temporarily unavailable. Please try again.",
  REDIS_UNAVAILABLE: "A required security service is temporarily unavailable. Please try again shortly.",
  PALM_SERVICE_UNAVAILABLE: "Palm verification is temporarily unavailable. Use another available payment method.",
  PALM_IMAGE_INVALID: "We could not read a clear palm image. Improve lighting and try again.",
  PALM_NOT_MATCHED: "The palm could not be matched with enough confidence.",
  QR_INVALID: "This is not a valid Nepal Hand Pay QR code.",
  QR_EXPIRED: "This QR payment request has expired.",
  QR_ALREADY_USED: "This QR payment request has already been paid.",
  QR_CANCELLED: "This QR payment request was cancelled.",
  QR_NOT_FOUND: "This QR payment request could not be found.",
  PAYMENT_DUPLICATE: "This payment has already been processed.",
  PAYMENT_INSUFFICIENT_FUNDS: "Your wallet does not have enough balance for this payment.",
  INSUFFICIENT_BALANCE: "Your wallet does not have enough balance for this payment.",
  MERCHANT_NOT_APPROVED: "This merchant is not approved to accept payments.",
  PAYMENT_EXPIRED: "This payment request has expired. Ask the merchant to create a new one.",
  PAYMENT_ALREADY_PROCESSED: "This payment has already been processed.",
  PAYMENT_NOT_AUTHORIZED: "This payment has not completed customer authorization.",
  NOT_REFUNDABLE: "This transaction is not eligible for a refund.",
  INVALID_REFUND_AMOUNT: "The refund amount exceeds the remaining refundable amount.",
  IDEMPOTENCY_KEY_REUSED: "This request key was already used for different payment details.",
  OPERATION_IN_PROGRESS: "This operation is already being processed. Check its status before retrying.",
  VALIDATION_ERROR: "Check the highlighted details and try again.",
  MALFORMED_JSON: "The request could not be read. Reload the application and try again.",
  PAYLOAD_TOO_LARGE: "The selected data is too large to upload.",
  INTERNAL_ERROR: "The server could not complete the request. Please try again.",
};

const fieldLabels: Record<string, string> = {
  displayName: "Full name",
  businessName: "Business name",
  email: "Email address",
  phone: "Phone",
  password: "Password",
};

function validationMessage(details: ValidationDetails | undefined): string | undefined {
  const field = Object.entries(details?.fieldErrors ?? {}).find(
    ([, messages]) => messages.length > 0,
  );
  if (field) {
    const [name, messages] = field;
    return `${fieldLabels[name] ?? name}: ${messages[0]}`;
  }
  return details?.formErrors?.[0];
}

function messageFor(code: string | undefined, fallback: string, status: number): string {
  if (code && errorMessages[code]) return errorMessages[code];
  if (status === 401) return "Your session is invalid or has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 408 || status === 504) return "The request timed out. Check its status before retrying.";
  if (status >= 500) return "Nepal Hand Pay could not complete the request. Please try again shortly.";
  return fallback;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const payload = await response.json() as { data?: { accessToken?: string } };
      if (!payload.data?.accessToken) return false;
      setToken(payload.data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
      refreshPromise = null;
    }
  })();
  return refreshPromise;
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
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request timed out. Its final status can be checked safely.", "REQUEST_TIMEOUT");
    }
    if (!navigator.onLine) {
      throw new ApiError("You appear to be offline. Check your connection and try again.", "NETWORK_OFFLINE");
    }
    throw new ApiError("Unable to connect to Nepal Hand Pay. Check that the API is running and try again.", "API_UNAVAILABLE");
  } finally {
    window.clearTimeout(timeout);
  }
  if (response.status === 401 && retryAuth && path !== "/auth/refresh") {
    if (await refreshAccessToken()) {
      return request<T>(path, { ...options, retryAuth: false });
    }
  }
  const payload = await response.json().catch(() => ({ error: { message: "The server returned an invalid response." } })) as {
    data?: T;
    error?: { code?: string; message?: string; details?: ValidationDetails };
    detail?: string;
    requestId?: string;
  };
  if (!response.ok) {
    const code = payload.error?.code ?? (response.status === 429 ? "RATE_LIMITED" : response.status === 503 ? "SERVICE_UNAVAILABLE" : undefined);
    const fallback = payload.error?.message || payload.detail || "The request could not be completed.";
    const message = code === "VALIDATION_ERROR"
      ? validationMessage(payload.error?.details) ?? messageFor(code, fallback, response.status)
      : messageFor(code, fallback, response.status);
    throw new ApiError(
      message,
      code,
      response.status,
      payload.requestId ?? response.headers.get("x-request-id") ?? undefined,
      payload.error?.details,
    );
  }
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
  health: (timeoutMs = 4_000) => request<{ api: string }>("/health/live", { retryAuth: false, retryNetwork: false, timeoutMs }),
  download: async (path: string, filename: string) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${API_URL}${path}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) throw new ApiError("The receipt could not be downloaded.", "DOWNLOAD_FAILED", response.status);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError")
        throw new ApiError("The receipt download timed out.", "REQUEST_TIMEOUT");
      if (!navigator.onLine) throw new ApiError("You appear to be offline.", "NETWORK_OFFLINE");
      throw new ApiError("The API is unavailable, so the receipt could not be downloaded.", "API_UNAVAILABLE");
    } finally {
      window.clearTimeout(timeout);
    }
  },
};
