import { config } from "../config.js";
import { AzureProvider } from "./providers/azure.js";
import { ClaudeProvider } from "./providers/claude.js";
import { DeepLProvider } from "./providers/deepl.js";
import { FreeGoogleProvider } from "./providers/free.js";
import { GoogleCloudProvider } from "./providers/google.js";
import { MockProvider } from "./providers/mock.js";
import type { TranslateRequest, TranslationProvider } from "./types.js";
import { PAID_PROVIDER } from "./caps.js";

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

/** The fallback providers after the main one: the free fallback, then the pay-as-you-go Azure key (if configured). */
function defaultFallbacks(): TranslationProvider[] {
  const list: TranslationProvider[] = [];
  const fb = config.TRANSLATION_FALLBACK_PROVIDER;
  if (fb && fb !== config.TRANSLATION_PROVIDER) list.push(createProvider(fb));
  if (config.AZURE_TRANSLATOR_PAID_KEY) {
    list.push(new AzureProvider(config.AZURE_TRANSLATOR_PAID_KEY, config.AZURE_TRANSLATOR_PAID_REGION, PAID_PROVIDER));
  }
  return list;
}

const REFUSED = new Set([401, 403, 429]);

export class Translator {
  private cache = new LruCache<string>(5_000);
  onUsage?: UsageListener;
  /**
   * Set by the server from this month's usage (see usage.ts): whether a provider is still under its monthly limit.
   * Providers are tried in order (main, then fallbacks); the first one with room translates.
   */
  hasRoom: (provider: string) => boolean = () => true;
  private lastUsed: string | null = null;
  /** `provider` translates finished sentences; `preview` translates sentences still being spoken. */
  private readonly preview: TranslationProvider;
  /** Main provider first, then the fallbacks in order. */
  readonly chain: TranslationProvider[];
  constructor(
    private readonly provider: TranslationProvider = createProvider(config.TRANSLATION_PROVIDER),
    preview?: TranslationProvider,
    /** Used in order once the main provider has reached its monthly limit, or when a provider refuses a request. */
    fallbacks: TranslationProvider[] = defaultFallbacks(),
  ) {
    this.chain = [provider, ...fallbacks.filter((f) => f.name !== provider.name)];
    this.preview =
      preview ??
      (config.TRANSLATION_PREVIEW_PROVIDER && config.TRANSLATION_PREVIEW_PROVIDER !== config.TRANSLATION_PROVIDER
        ? createProvider(config.TRANSLATION_PREVIEW_PROVIDER)
        : provider);
  }

  /** e.g. "azure, then google, then azure-paid" (or "deepl (previews: azure)" when previews use another provider). */
  get providerName() {
    const base = this.preview === this.provider ? this.provider.name : `${this.provider.name} (previews: ${this.preview.name})`;
    return [base, ...this.chain.slice(1).map((p) => p.name)].join(", then ");
  }

  /** `meter.chars` is incremented by the characters actually sent to the provider (cache hits are free). */
  async translate(req: TranslateRequest & { kind: "partial" | "final"; meter?: { chars: number } }): Promise<string> {
    const text = req.text.trim();
    if (!text || req.from === req.to) return text;

    // The first provider in the chain that's still under its monthly limit; if none has room, the main one
    // (it may still accept a few more, or refuse and the request fails).
    const withRoom = this.chain.filter((p) => this.hasRoom(p.name));
    const first = withRoom[0] ?? this.provider;
    const provider = first === this.provider && req.kind === "partial" ? this.preview : first;
    if (first.name !== this.lastUsed) {
      if (this.lastUsed) console.warn(`[translation] now translating with ${first.name} (monthly limits: ${this.lastUsed} reached or back in the chain).`);
      this.lastUsed = first.name;
    }
    // Keyed by provider, so a finished sentence never reuses a cheaper preview translation of the same text.
    const key = `${provider.name}|${req.from}|${req.to}|${text}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const timeout = AbortSignal.timeout(TIMEOUT_MS[req.kind]);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    // If a provider refuses (quota used up, key problem, rate limit), try the next ones that have room,
    // then the main one, so one bad key never stops the translation.
    const order: TranslationProvider[] = [provider];
    for (const p of [...withRoom, this.provider]) if (p !== first && !order.includes(p)) order.push(p);
    let lastError: unknown;
    for (const [i, p] of order.entries()) {
      try {
        const result = await p.translate({ ...req, text, signal: i === 0 ? signal : AbortSignal.timeout(TIMEOUT_MS[req.kind]) });
        if (req.meter) req.meter.chars += text.length;
        this.onUsage?.(p.name, text.length);
        this.cache.set(key, result);
        return result;
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number }).status;
        if (!status || !REFUSED.has(status) || i === order.length - 1) throw err;
        console.warn(`[translation] ${p.name} refused (${describeTranslationError(err)}); trying ${order[i + 1].name}.`);
      }
    }
    throw lastError;
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
