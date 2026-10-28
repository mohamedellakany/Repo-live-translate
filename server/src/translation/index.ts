import { config } from "../config.js";
import { ClaudeProvider } from "./providers/claude.js";
import { DeepLProvider } from "./providers/deepl.js";
import { FreeGoogleProvider } from "./providers/free.js";
import { GoogleCloudProvider } from "./providers/google.js";
import { MockProvider } from "./providers/mock.js";
import type { TranslateRequest, TranslationProvider } from "./types.js";

function createProvider(): TranslationProvider {
  switch (config.TRANSLATION_PROVIDER) {
    case "google":
      if (!config.GOOGLE_TRANSLATE_API_KEY) throw new Error("GOOGLE_TRANSLATE_API_KEY is required");
      return new GoogleCloudProvider(config.GOOGLE_TRANSLATE_API_KEY);
    case "deepl":
      if (!config.DEEPL_API_KEY) throw new Error("DEEPL_API_KEY is required");
      return new DeepLProvider(config.DEEPL_API_KEY, config.DEEPL_API_URL);
    case "claude":
      return new ClaudeProvider(config.ANTHROPIC_API_KEY, config.CLAUDE_MODEL);
    case "mock":
      return new MockProvider();
    case "free":
    default:
      return new FreeGoogleProvider();
  }
}

/** Small LRU cache: interim results repeat a lot while someone is speaking. */
class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string) {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

const TIMEOUT_MS = { partial: 4_000, final: 10_000 };

export class Translator {
  private cache = new LruCache<string>(5_000);
  constructor(private readonly provider: TranslationProvider = createProvider()) {}

  get providerName() {
    return this.provider.name;
  }

  /** `meter.chars` is incremented by the characters actually sent to the provider (cache hits are free). */
  async translate(req: TranslateRequest & { kind: "partial" | "final"; meter?: { chars: number } }): Promise<string> {
    const text = req.text.trim();
    if (!text || req.from === req.to) return text;

    const key = `${req.from}|${req.to}|${text}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const timeout = AbortSignal.timeout(TIMEOUT_MS[req.kind]);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    const result = await this.provider.translate({ ...req, text, signal });
    if (req.meter) req.meter.chars += text.length;
    this.cache.set(key, result);
    return result;
  }

  /** Translate one known phrase at boot so a misconfigured provider is obvious immediately. */
  async selfTest(): Promise<{ ok: true; ms: number; sample: string } | { ok: false; error: string }> {
    const started = performance.now();
    try {
      const sample = await this.provider.translate({
        text: "مرحبا بالجميع",
        from: "ar",
        to: "en",
        signal: AbortSignal.timeout(TIMEOUT_MS.final),
      });
      return { ok: true, ms: Math.round(performance.now() - started), sample };
    } catch (err) {
      return { ok: false, error: describeTranslationError(err) };
    }
  }
}

export function describeTranslationError(err: unknown): string {
  const e = err as { status?: number; name?: string; message?: string };
  if (e.name === "TimeoutError") return "request timed out";
  if (e.status === 429) return "HTTP 429 - the provider is rate-limiting requests";
  if (e.status === 401 || e.status === 403) return `HTTP ${e.status} - the API key is missing, invalid or not enabled`;
  return e.message ?? String(err);
}

export const translator = new Translator();
