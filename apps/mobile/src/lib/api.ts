import { Platform } from "react-native";
import { ApiClient, MobileApiError } from "./api-client";
import { getApiUrl } from "./config";
import { secureSessionStore } from "./secure-session";

// Resolve once during application bootstrap so a missing or malformed URL fails
// immediately instead of being mistaken for an authentication problem.
const apiUrl = getApiUrl();

export const api = new ApiClient({
  baseUrl: () => apiUrl,
  sessionStore: secureSessionStore,
  native: Platform.OS !== "web",
});

if (typeof __DEV__ !== "undefined" && __DEV__) {
  console.info(`[Nepal Hand Pay] API base URL: ${apiUrl}`);
  void api
    .health()
    .then(() => console.info("[Nepal Hand Pay] API health check: PASS"))
    .catch((error: unknown) => {
      const category =
        error instanceof MobileApiError ? error.code ?? "HTTP_ERROR" : "UNKNOWN";
      console.warn(`[Nepal Hand Pay] API health check: FAIL (${category})`);
    });
}
