import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config, summaryProvider } from "./config.js";
import { sessions, type Segment } from "./db.js";
import { DEFAULT_TARGET, LANGUAGES } from "./languages.js";

export const SummarySchema = z.object({
  title: z.string().describe("A short, specific title for the session (max ~8 words)"),
  overview: z.string().describe("2-4 sentence overview of what was discussed"),
  key_points: z.array(z.string()).describe("The main points, one sentence each"),
  decisions: z.array(z.string()).describe("Decisions that were made; empty if none"),
  action_items: z
    .array(z.object({ task: z.string(), owner: z.string().nullable().describe("Person responsible, if mentioned") }))
    .describe("Follow-up tasks; empty if none"),
});
type SummaryContent = z.infer<typeof SummarySchema>;
export type Summary = SummaryContent & { language: string; createdAt: string };

const SYSTEM = `You summarize transcripts of live talks, meetings and lectures for people who followed them through live translation.
The transcript comes from speech recognition plus machine translation, so expect recognition errors, missing punctuation and repeated phrases; infer the intended meaning from the original-language text when the translation is unclear.
Be faithful: include only what was actually said, and don't invent names, numbers, owners or decisions. Leave a list empty rather than padding it.`;

export async function summarizeTranscript(segments: Segment[], sourceLang: string, outputLang: string): Promise<Summary> {
  if (!summaryProvider) throw new Error("Summaries are not configured");

  const src = LANGUAGES[sourceLang]?.name ?? sourceLang;
  const out = LANGUAGES[outputLang]?.name ?? outputLang;
  const transcript = segments
    .map((s) => {
      const t = s.translations[outputLang] ?? s.translations.en;
      return t ? `[${s.seq}] ${s.original}\n    → ${t}` : `[${s.seq}] ${s.original}`;
    })
    .join("\n");
  const prompt = `Summarize this session. The speaker spoke ${src}; each line shows the original followed by its machine translation.\nWrite the summary in ${out}.\n\n<transcript>\n${transcript}\n</transcript>`;

  const content = summaryProvider === "gemini" ? await withGemini(prompt) : await withClaude(prompt);
  return { ...content, language: outputLang, createdAt: new Date().toISOString() };
}

// ---- Stored sessions (on request and automatically when a session ends) ----

const inFlight = new Map<string, Promise<Summary | null>>();

/** True while a summary for this session is being written. */
export const isSummaryPending = (sessionId: string) => inFlight.has(sessionId);

/**
 * Summarize a stored session and save the result. Concurrent calls for the same session share one request.
 * `waitFor` lets the last sentences finish translating first. Resolves to null if the session is gone or empty.
 */
export function summarizeSession(sessionId: string, lang: string, waitFor: Promise<unknown>[] = []): Promise<Summary | null> {
  const running = inFlight.get(sessionId);
  if (running) return running;
  const job = (async () => {
    await Promise.allSettled(waitFor);
    const session = sessions.byId(sessionId); // may have been deleted meanwhile
    const segments = session ? sessions.segments(sessionId) : [];
    if (!session || segments.length === 0) return null;
    const summary = await summarizeTranscript(segments, session.source_lang, lang);
    sessions.saveSummary(sessionId, summary);
    return summary;
  })().finally(() => inFlight.delete(sessionId));
  inFlight.set(sessionId, job);
  return job;
}

/** Called when a live session ends: write its summary in the background so it's ready in History. */
export function summarizeEndedSession(sessionId: string, pendingSegments: Promise<unknown>[]) {
  if (!summaryProvider || !config.AUTO_SUMMARY) return;
  summarizeSession(sessionId, DEFAULT_TARGET, pendingSegments).catch((err) => console.error("[summary:auto]", err));
}

// ---- Google Gemini (Interactions API with JSON-schema structured output) ----

let gemini: GoogleGenAI | null = null;
const summaryJsonSchema = z.toJSONSchema(SummarySchema, { target: "draft-2020-12" });

async function withGemini(prompt: string): Promise<SummaryContent> {
  gemini ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const interaction = await gemini.interactions.create({
    model: config.GEMINI_MODEL,
    system_instruction: SYSTEM,
    input: prompt,
    response_format: { type: "text", mime_type: "application/json", schema: summaryJsonSchema },
    // Summarizing doesn't need deep reasoning; the default (high) thinking level is the main source of latency.
    generation_config: { thinking_level: "low" },
    // Transcripts are private: don't keep them on Google's side after the summary is returned.
    store: false,
  });

  const text = interaction.output_text;
  if (!text) throw new Error("The summary could not be generated. Please try again");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The summary could not be generated. Please try again");
  }
  const parsed = SummarySchema.safeParse(json);
  if (!parsed.success) throw new Error("The summary could not be generated. Please try again");
  return parsed.data;
}

// ---- Anthropic Claude ----

let claude: Anthropic | null = null;

async function withClaude(prompt: string): Promise<SummaryContent> {
  claude ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const response = await claude.beta.messages.parse({
    model: config.CLAUDE_MODEL,
    max_tokens: 16000,
    // If a safety classifier declines, the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(SummarySchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to summarize this transcript");
  if (!response.parsed_output) throw new Error("The summary could not be generated. Please try again");
  return response.parsed_output;
}
