import { useEffect, useState } from "react";
import { api, type ServerConfig } from "./api";

const FALLBACK: ServerConfig = { appName: "Live Translate", features: { googleSignIn: false, email: false, summaries: false } };
let cached: ServerConfig | null = null;
let pending: Promise<ServerConfig> | null = null;

/** Which optional features (Google sign-in, email, AI summaries) the backend has enabled. */
export function useServerConfig(): ServerConfig {
  const [config, setConfig] = useState<ServerConfig>(cached ?? FALLBACK);
  useEffect(() => {
    if (cached) return;
    pending ??= api
      .config()
      .then((c) => (cached = c))
      .catch(() => {
        pending = null; // retry on next mount
        return FALLBACK;
      });
    pending.then(setConfig);
  }, []);
  return config;
}
