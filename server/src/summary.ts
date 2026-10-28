import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "./config.js";
import type { Segment } from "./db.js";
import { LANGUAGES } from "./languages.js";

export const SummarySchema = z.object({
  title: z.string().describe("A short, specific title for the session (max ~8 words)"),
  overview: z.string().describe("2-4 sentence overview of what was discussed"),
  key_points: z.array(z.string()).describe("The main points, one sentence each"),
  decisions: z.array(z.string()).describe("Decisions that were made; empty if none"),
  action_items: z
    .array(z.object({ task: z.string(), owner: z.string().nullable().describe("Person responsible, if mentioned") }))
    .describe("Follow-up tasks; empty if none"),
});
export type Summary = z.infer<typeof SummarySchema> & { language: string; createdAt: string };

const SYSTEM = `You summarize transcripts of live talks, meetings and lectures for people who followed them through live translation.
The transcript comes from speech recognition plus machine translation, so expect recognition errors, missing punctuation and repeated phrases; infer the intended meaning from the original-language text when the translation is unclear.
Be faithful: include only what was actually said, and don't invent names, numbers, owners or decisions. Leave a list empty rather than padding it.`;

let client: Anthropic | null = null;

export async function summarizeTranscript(segments: Segment[], sourceLang: string, outputLang: string): Promise<Summary> {
  if (!config.ANTHROPIC_API_KEY) throw new Error("Summaries are not configured");
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const src = LANGUAGES[sourceLang]?.name ?? sourceLang;
  const out = LANGUAGES[outputLang]?.name ?? outputLang;
  const transcript = segments
    .map((s) => {
      const t = s.translations[outputLang] ?? s.translations.en;
      return t ? `[${s.seq}] ${s.original}\n    → ${t}` : `[${s.seq}] ${s.original}`;
    })
    .join("\n");

  const response = await client.beta.messages.parse({
    model: config.CLAUDE_MODEL,
    max_tokens: 16000,
    // If a safety classifier declines, the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(SummarySchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Summarize this session. The speaker spoke ${src}; each line shows the original followed by its machine translation.\nWrite the summary in ${out}.\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to summarize this transcript");
  if (!response.parsed_output) throw new Error("The summary could not be generated. Please try again");
  return { ...response.parsed_output, language: outputLang, createdAt: new Date().toISOString() };
}
