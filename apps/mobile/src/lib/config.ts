export class MobileConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileConfigurationError";
  }
}

export function resolveApiUrl(
  value: string | undefined,
  production = process.env.NODE_ENV === "production",
): string {
  const candidate = value?.trim().replace(/\/$/, "");
  if (!candidate)
    throw new MobileConfigurationError(
      "EXPO_PUBLIC_API_URL is not configured. Copy apps/mobile/.env.example to apps/mobile/.env and use your API's reachable URL.",
    );
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate))
    throw new MobileConfigurationError(
      "EXPO_PUBLIC_API_URL must be a complete http:// or https:// URL.",
    );
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new MobileConfigurationError(
      "EXPO_PUBLIC_API_URL must be a complete http:// or https:// URL.",
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new MobileConfigurationError(
      "EXPO_PUBLIC_API_URL must use http:// for local development or https:// in production.",
    );
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new MobileConfigurationError(
      "EXPO_PUBLIC_API_URL must not contain credentials, query parameters, or fragments.",
    );
  if (!parsed.pathname.endsWith("/api/v1"))
    throw new MobileConfigurationError(
      "EXPO_PUBLIC_API_URL must include the /api/v1 path.",
    );
  if (production && parsed.protocol !== "https:")
    throw new MobileConfigurationError(
      "EXPO_PUBLIC_API_URL must use HTTPS in production.",
    );
  return candidate;
}

export function getApiUrl(): string {
  return resolveApiUrl(process.env.EXPO_PUBLIC_API_URL);
}
