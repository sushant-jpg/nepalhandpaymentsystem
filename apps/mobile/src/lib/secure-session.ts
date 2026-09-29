import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createSessionStore, type StringStorage } from "./session-store";

const volatile = new Map<string, string>();

const webMemoryStorage: StringStorage = {
  async getItem(key) {
    return volatile.get(key) ?? null;
  },
  async setItem(key, value) {
    volatile.set(key, value);
  },
  async removeItem(key) {
    volatile.delete(key);
  },
};

const nativeSecureStorage: StringStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const secureSessionStore = createSessionStore(
  Platform.OS === "web" ? webMemoryStorage : nativeSecureStorage,
);
