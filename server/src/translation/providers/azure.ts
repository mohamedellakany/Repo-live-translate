import { TranslationError, type TranslateRequest, type TranslationProvider } from "../types.js";

// Azure uses its own codes for a few languages: LisanCast's "Dari (Persian)" is Azure's Dari, "prs".
const CODE_MAP: Record<string, string> = { fa: "prs", zh: "zh-Hans" };

/**
 * Microsoft Azure AI Translator (Text Translation v3). Fast and inexpensive, with a free tier
 * (F0: 2M characters/month). It doesn't take previous sentences as context.
 */
export class AzureProvider implements TranslationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly region: string,
    /** "azure" for the main key; a second key (e.g. pay-as-you-go) gets its own name so its usage is counted apart. */
    readonly name = "azure",
    private readonly endpoint = "https://api.cognitive.microsofttranslator.com",
  ) {}

  async translate({ text, from, to, signal }: TranslateRequest): Promise<string> {
    const url = new URL("/translate", this.endpoint);
    url.searchParams.set("api-version", "3.0");
    url.searchParams.set("from", CODE_MAP[from] ?? from);
    url.searchParams.set("to", CODE_MAP[to] ?? to);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": this.apiKey,
        // Regional resources need their region; "global" resources don't.
        ...(this.region && this.region !== "global" ? { "Ocp-Apim-Subscription-Region": this.region } : {}),
      },
      body: JSON.stringify([{ Text: text }]),
      signal,
    });
    if (!res.ok) throw new TranslationError(`HTTP ${res.status}: ${await res.text()}`, this.name, res.status);
    const data = (await res.json()) as { translations: { text: string }[] }[];
    return data[0]?.translations[0]?.text ?? "";
  }
}
