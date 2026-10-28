import Constants from "expo-constants";
import { Platform } from "react-native";

const SERVER_PORT = 4000;

/**
 * Resolve the backend URL:
 *  1. EXPO_PUBLIC_API_URL if set (production builds),
 *  2. web: same host the page was served from,
 *  3. native dev: the IP of the machine running the Expo dev server.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:${SERVER_PORT}`;
  }
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host ?? "localhost"}:${SERVER_PORT}`;
}

function resolveWebUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_WEB_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host ?? "localhost"}:8081`;
}

export const API_URL = resolveApiUrl();
export const WEB_URL = resolveWebUrl();
export const listenUrl = (username: string) => `${WEB_URL}/listen/${encodeURIComponent(username)}`;
