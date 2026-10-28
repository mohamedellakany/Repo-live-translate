import Anthropic from "@anthropic-ai/sdk";
import { LANGUAGES } from "../../languages.js";
import { TranslationError, type TranslateRequest, type TranslationProvider } from "../types.js";

const SYSTEM = `You are a professional simultaneous interpreter producing live captions.
Translate the speaker's latest utterance from the source language into the target language.
The utterance comes from speech recognition: it may be unpunctuated, colloquial or dialectal, or cut off mid-sentence. Translate it naturally and faithfully, keeping an incomplete sentence incomplete instead of guessing how it ends.
Previous utterances, when given, are for context only; do not translate them again.
Reply with the translation only: no quotes, notes or explanations.`;

/** Anthropic Claude. Context-aware, handles dialects and idioms well; slower than MT engines. */
export class ClaudeProvider implements TranslationProvider {
  readonly name = "claude";
  private readonly client: Anthropic;

  constructor(apiKey: string | undefined, private readonly model: string) {
    // With no explicit key the SDK resolves credentials from the environment.
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async translate({ text, from, to, context, signal }: TranslateRequest): Promise<string> {
    const src = LANGUAGES[from]?.name ?? from;
    const dst = LANGUAGES[to]?.name ?? to;
    const contextBlock = context?.length
      ? `<previous_utterances>\n${context.join("\n")}\n</previous_utterances>\n\n`
      : "";

    const response = await this.client.beta.messages.create(
      {
        model: this.model,
        // If a safety classifier declines a segment, the API retries it on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        max_tokens: 1024,
        system: SYSTEM,
        // Live captions are latency-sensitive and translation is a simple task.
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: `${contextBlock}Source language: ${src}\nTarget language: ${dst}\n\n<utterance>\n${text}\n</utterance>`,
          },
        ],
      },
      { signal, maxRetries: 0 },
    );

    if (response.stop_reason === "refusal") {
      throw new TranslationError("Model declined to translate this segment", this.name);
    }
    return response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
  }
}
