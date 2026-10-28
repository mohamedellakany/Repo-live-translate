import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../auth.js";
import { features } from "../config.js";
import { sessions, type SessionRow } from "../db.js";
import { DEFAULT_TARGET, isTargetLanguage } from "../languages.js";
import { liveSessionId } from "../realtime.js";
import { summarizeTranscript } from "../summary.js";

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
  summary: s.summary ? JSON.parse(s.summary) : null,
});

/** The signed-in speaker's past and current sessions. */
sessionsRouter.get("/", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = sessions.listForSpeaker(req.user!.id, limit, offset);
  res.json({ sessions: rows.map((s) => ({ ...serialize(s), summary: undefined, hasSummary: !!s.summary, segmentCount: Number(s.segment_count) })) });
});

sessionsRouter.get("/:id", (req, res) => {
  const s = sessions.byId(req.params.id);
  if (!s || s.speaker_id !== req.user!.id) return res.status(404).json({ error: "Session not found" });
  res.json({ session: serialize(s), segments: sessions.segments(s.id) });
});

const summaryLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many attempts. Please try again later." } });

/** Generate (or regenerate) an AI summary of a finished session. */
sessionsRouter.post("/:id/summary", summaryLimiter, async (req, res) => {
  if (!features.summaries) return res.status(503).json({ error: "AI summaries aren't enabled on this server" });
  const s = sessions.byId(String(req.params.id));
  if (!s || s.speaker_id !== req.user!.id) return res.status(404).json({ error: "Session not found" });
  const segments = sessions.segments(s.id);
  if (segments.length === 0) return res.status(400).json({ error: "There's nothing to summarize in this session" });
  const lang = typeof req.body?.lang === "string" && isTargetLanguage(req.body.lang) ? req.body.lang : DEFAULT_TARGET;
  try {
    const summary = await summarizeTranscript(segments, s.source_lang, lang);
    sessions.saveSummary(s.id, summary);
    res.json({ summary });
  } catch (err) {
    console.error("[summary]", err);
    res.status(502).json({ error: (err as Error).message || "Couldn't generate the summary" });
  }
});

sessionsRouter.delete("/:id", (req, res) => {
  if (liveSessionId(req.user!.id) === req.params.id) {
    return res.status(409).json({ error: "Stop the live session before deleting it" });
  }
  if (!sessions.remove(req.params.id, req.user!.id)) return res.status(404).json({ error: "Session not found" });
  res.status(204).end();
});
