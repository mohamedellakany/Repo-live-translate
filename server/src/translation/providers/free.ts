import { TranslationError, type TranslateRequest, type TranslationProvider } from "../types.js";

/**
 * Google Translate's public web endpoint. No API key, but unofficial, rate-limited
 * and without SLA. Use ONLY for local development and demos.
 */
export class FreeGoogleProvider implements TranslationProvider {
  readonly name = "free";

  async translate({ text, from, to, signal }: TranslateRequest): Promise<string> {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t" +
      `&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to === "zh" ? "zh-CN" : to)}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new TranslationError(`HTTP ${res.status}`, this.name, res.status);
    const data = (await res.json()) as [Array<[string, ...unknown[]]>];
    return (data?.[0] ?? []).map((chunk) => chunk[0]).join("");
  }
}
