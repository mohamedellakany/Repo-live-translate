import { TranslationError, type TranslateRequest, type TranslationProvider } from "../types.js";

/** Google Cloud Translation API (v2, "Basic"). Fast and reliable — recommended for production. */
export class GoogleCloudProvider implements TranslationProvider {
  readonly name = "google";
  constructor(private readonly apiKey: string) {}

  async translate({ text, from, to, signal }: TranslateRequest): Promise<string> {
    const res = await fetch(
      "https://translation.googleapis.com/language/translate/v2",
      {
        method: "POST",
        // The key goes in a header rather than the URL, so it never ends up in request logs.
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey },
        body: JSON.stringify({ q: text, source: from, target: to === "zh" ? "zh-CN" : to, format: "text" }),
        signal,
      },
    );
    if (!res.ok) throw new TranslationError(`HTTP ${res.status}: ${await res.text()}`, this.name, res.status);
    const data = (await res.json()) as { data: { translations: { translatedText: string }[] } };
    return data.data.translations[0]?.translatedText ?? "";
  }
}
