import { Platform } from "react-native";
import { ApiClient } from "./api-client";
import { getApiUrl } from "./config";
import { secureSessionStore } from "./secure-session";

export const api = new ApiClient({
  baseUrl: getApiUrl,
  sessionStore: secureSessionStore,
  native: Platform.OS !== "web",
});
