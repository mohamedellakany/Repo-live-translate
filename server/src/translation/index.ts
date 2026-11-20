import { config } from "../config.js";
import { AzureProvider } from "./providers/azure.js";
import { ClaudeProvider } from "./providers/claude.js";
import { DeepLProvider } from "./providers/deepl.js";
import { FreeGoogleProvider } from "./providers/free.js";
import { GoogleCloudProvider } from "./providers/google.js";
import { MockProvider } from "./providers/mock.js";
import type { TranslateRequest, TranslationProvider } from "./types.js";

type ProviderName = typeof config.TRANSLATION_PROVIDER;

function createProvider(name: ProviderName): TranslationProvider {
  switch (name) {
    case "google":
      if (!config.GOOGLE_TRANSLATE_API_KEY) throw new Error("GOOGLE_TRANSLATE_API_KEY is required");
      return new GoogleCloudProvider(config.GOOGLE_TRANSLATE_API_KEY);
    case "deepl":
      if (!config.DEEPL_API_KEY) throw new Error("DEEPL_API_KEY is required");
      return new DeepLProvider(config.DEEPL_API_KEY, config.DEEPL_API_URL);
    case "azure":
      if (!config.AZURE_TRANSLATOR_KEY) throw new Error("AZURE_TRANSLATOR_KEY is required");
      return new AzureProvider(config.AZURE_TRANSLATOR_KEY, config.AZURE_TRANSLATOR_REGION);
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

/** Called after every request actually sent to a provider (not cache hits), with the characters sent. */
export type UsageListener = (provider: string, chars: number) => void;

export class Translator {
  private cache = new LruCache<string>(5_000);
  onUsage?: UsageListener;
  /**
   * Set by the server from this month's usage (see usage.ts): `preferFallback` = the main provider has reached its
   * switch point; `fallbackHasRoom` = the fallback is still under its own monthly limit.
   */
  preferFallback: () => boolean = () => false;
  fallbackHasRoom: () => boolean = () => true;
  private announcedFallback = false;
  /** `provider` translates finished sentences; `preview` translates sentences still being spoken. */
  private readonly preview: TranslationProvider;
  constructor(
    private readonly provider: TranslationProvider = createProvider(config.TRANSLATION_PROVIDER),
    preview?: TranslationProvider,
    /** Takes over when the main provider is near its monthly allowance or refuses a request. */
    readonly fallback: TranslationProvider | null = config.TRANSLATION_FALLBACK_PROVIDER &&
    config.TRANSLATION_FALLBACK_PROVIDER !== config.TRANSLATION_PROVIDER
      ? createProvider(config.TRANSLATION_FALLBACK_PROVIDER)
      : null,
  ) {
    this.preview =
      preview ??
      (config.TRANSLATION_PREVIEW_PROVIDER && config.TRANSLATION_PREVIEW_PROVIDER !== config.TRANSLATION_PROVIDER
        ? createProvider(config.TRANSLATION_PREVIEW_PROVIDER)
        : provider);
  }

  /** e.g. "deepl", or "deepl (previews: azure)" when previews use a different provider. */
  get providerName() {
    const base = this.preview === this.provider ? this.provider.name : `${this.provider.name} (previews: ${this.preview.name})`;
    return this.fallback ? `${base}, then ${this.fallback.name}` : base;
  }

  /** `meter.chars` is incremented by the characters actually sent to the provider (cache hits are free). */
  async translate(req: TranslateRequest & { kind: "partial" | "final"; meter?: { chars: number } }): Promise<string> {
    const text = req.text.trim();
    if (!text || req.from === req.to) return text;

    const main = req.kind === "partial" ? this.preview : this.provider;
    const fallback = this.fallback && this.fallbackHasRoom() ? this.fallback : null;
    const provider = fallback && this.preferFallback() ? fallback : main;
    if (provider === fallback && !this.announcedFallback) {
      this.announcedFallback = true;
      console.warn(`[translation] ${main.name} reached its monthly switch point; translating with ${fallback.name} now.`);
    }
    // Keyed by provider, so a finished sentence never reuses a cheaper preview translation of the same text.
    const key = `${provider.name}|${req.from}|${req.to}|${text}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const timeout = AbortSignal.timeout(TIMEOUT_MS[req.kind]);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    let used = provider;
    let result: string;
    try {
      result = await provider.translate({ ...req, text, signal });
    } catch (err) {
      // One provider refused (quota used up, key problem, rate limit): try the other one for this sentence.
      // Main → fallback, or, after switching, fallback → main (it usually still has a little room before 2M).
      const status = (err as { status?: number }).status;
      const other = provider === main ? fallback : main;
      if (!fallback || !other || !status || ![401, 403, 429].includes(status)) throw err;
      console.warn(`[translation] ${provider.name} refused (${describeTranslationError(err)}); using ${other.name}.`);
      used = other;
      result = await other.translate({ ...req, text, signal: AbortSignal.timeout(TIMEOUT_MS[req.kind]) });
    }
    if (req.meter) req.meter.chars += text.length;
    this.onUsage?.(used.name, text.length);
    this.cache.set(key, result);
    return result;
  }

  /** Translate one known phrase at boot so a misconfigured provider is obvious immediately. */
  async selfTest(): Promise<{ ok: true; ms: number; sample: string } | { ok: false; error: string }> {
    const started = performance.now();
    const text = "مرحبا بالجميع";
    try {
      const sample = await this.provider.translate({
        text,
        from: "ar",
        to: "en",
        signal: AbortSignal.timeout(TIMEOUT_MS.final),
      });
      this.onUsage?.(this.provider.name, text.length);
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
