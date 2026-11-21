import { z } from "zod";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../auth.js";
import { features } from "../config.js";
import { sessions, type SessionRow } from "../db.js";
import { DEFAULT_TARGET, isTargetLanguage } from "../languages.js";
import { liveSessionId } from "../realtime.js";
import { isSummaryPending, summarizeSession } from "../summary.js";

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

const serialize = (s: SessionRow) => ({
  id: s.id,
  title: s.title,
  sourceLang: s.source_lang,
  startedAt: s.started_at,
  endedAt: s.ended_at,
  peakListeners: s.peak_listeners,
  isPrivate: !!s.is_private,
  translationMode: s.translation_mode,
  charsTranslated: s.chars_translated,
  allowRevisit: !!s.allow_revisit,
  summary: s.summary ? JSON.parse(s.summary) : null,
  summaryPending: isSummaryPending(s.id),
});

/** The signed-in speaker's past and current sessions. */
sessionsRouter.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = await sessions.listForSpeaker(req.user!.id, limit, offset);
  res.json({
    sessions: rows.map((s) => {
      const { summary, ...rest } = serialize(s);
      // Untitled sessions fall back to the AI summary's title once one exists.
      return { ...rest, title: rest.title ?? summary?.title ?? null, hasSummary: !!summary, segmentCount: Number(s.segment_count) };
    }),
  });
});

sessionsRouter.get("/:id", async (req, res) => {
  const s = await sessions.byId(req.params.id);
  if (!s || s.speaker_id !== req.user!.id) return res.status(404).json({ error: "Session not found" });
  res.json({ session: serialize(s), segments: await sessions.segments(s.id) });
});

const summaryLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many attempts. Please try again later." } });

/** Generate (or regenerate) an AI summary of a finished session. */
sessionsRouter.post("/:id/summary", summaryLimiter, async (req, res) => {
  if (!features.summaries) return res.status(503).json({ error: "AI summaries aren't enabled on this server" });
  const s = await sessions.byId(String(req.params.id));
  if (!s || s.speaker_id !== req.user!.id) return res.status(404).json({ error: "Session not found" });
  if ((await sessions.segments(s.id)).length === 0) return res.status(400).json({ error: "There's nothing to summarize in this session" });
  const lang = typeof req.body?.lang === "string" && isTargetLanguage(req.body.lang) ? req.body.lang : DEFAULT_TARGET;
  try {
    // If the automatic summary is still being written, this waits for it instead of starting another request.
    const summary = await summarizeSession(s.id, lang);
    if (!summary) return res.status(404).json({ error: "Session not found" });
    res.json({ summary });
  } catch (err) {
    console.error("[summary]", err);
    res.status(502).json({ error: (err as Error).message || "Couldn't generate the summary" });
  }
});

/** Let listeners who attended reopen this session from their library (or stop them). */
sessionsRouter.patch("/:id", async (req, res) => {
  if (typeof req.body?.allowRevisit !== "boolean") return res.status(400).json({ error: "Invalid request" });
  if (!(await sessions.setAllowRevisit(req.params.id, req.user!.id, req.body.allowRevisit))) {
    return res.status(404).json({ error: "Session not found" });
  }
  res.json({ session: serialize((await sessions.byId(req.params.id))!) });
});

/** Correct one line of a finished session's transcript (the original wording and/or its translation). */
sessionsRouter.patch("/:id/segments/:seq", async (req, res) => {
  const parsed = z
    .object({
      original: z.string().trim().min(1, "The text can't be empty").max(4000).optional(),
      translation: z.string().trim().min(1, "The text can't be empty").max(8000).optional(),
      lang: z.string().optional(),
    })
    .refine((b) => b.original !== undefined || b.translation !== undefined, "Nothing to change")
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
  const seq = Number(req.params.seq);
  const s = await sessions.byId(String(req.params.id));
  if (!s || s.speaker_id !== req.user!.id || !Number.isInteger(seq)) return res.status(404).json({ error: "Session not found" });
  if (liveSessionId(req.user!.id) === s.id) return res.status(409).json({ error: "Stop the live session before editing it" });
  const lang = parsed.data.lang && isTargetLanguage(parsed.data.lang) ? parsed.data.lang : DEFAULT_TARGET;
  const segment = await sessions.editSegment(s.id, seq, lang, parsed.data);
  if (!segment) return res.status(404).json({ error: "Line not found" });
  res.json({ segment });
});

sessionsRouter.delete("/:id", async (req, res) => {
  if (liveSessionId(req.user!.id) === req.params.id) {
    return res.status(409).json({ error: "Stop the live session before deleting it" });
  }
  if (!(await sessions.remove(req.params.id, req.user!.id))) return res.status(404).json({ error: "Session not found" });
  res.status(204).end();
});
