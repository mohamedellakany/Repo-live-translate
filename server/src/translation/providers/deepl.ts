import { TranslationError, type TranslateRequest, type TranslationProvider } from "../types.js";

// DeepL needs regional variants for some target languages.
const TARGET_MAP: Record<string, string> = { en: "EN-US", pt: "PT-BR", zh: "ZH-HANS" };

/** DeepL API. High quality; supports passing previous sentences as `context`. */
export class DeepLProvider implements TranslationProvider {
  readonly name = "deepl";
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

  async translate({ text, from, to, context, signal }: TranslateRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v2/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `DeepL-Auth-Key ${this.apiKey}` },
      body: JSON.stringify({
        text: [text],
        source_lang: from.toUpperCase(),
        target_lang: TARGET_MAP[to] ?? to.toUpperCase(),
        ...(context?.length ? { context: context.join(" ") } : {}),
      }),
      signal,
    });
    if (!res.ok) throw new TranslationError(`HTTP ${res.status}: ${await res.text()}`, this.name, res.status);
    const data = (await res.json()) as { translations: { text: string }[] };
    return data.translations[0]?.text ?? "";
  }
}
