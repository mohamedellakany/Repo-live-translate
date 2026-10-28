import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Secure storage on devices (Keychain / Keystore); localStorage on web. */
export const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return void globalThis.localStorage?.setItem(key, value);
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") return void globalThis.localStorage?.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  },
  async getJSON<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await storage.get(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  setJSON: (key: string, value: unknown) => storage.set(key, JSON.stringify(value)),
};
