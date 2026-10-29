import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { library, sessions, type LibraryRow } from "../db.js";
import { DEFAULT_TARGET, isTargetLanguage } from "../languages.js";

/** A listener's library: finished sessions they attended, if the speaker allows revisiting. */
export const libraryRouter = Router();
libraryRouter.use(requireAuth);

/** Sessions can be claimed after the fact (listened as a guest, then signed up) for this long. */
const CLAIM_WINDOW_MS = 30 * 24 * 60 * 60_000;

const summaryOf = (r: LibraryRow) => (r.summary ? JSON.parse(r.summary) : null);
const serialize = (r: LibraryRow) => ({
  id: r.id,
  title: r.title ?? summaryOf(r)?.title ?? null,
  sourceLang: r.source_lang,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  lang: r.lang,
  speaker: { username: r.username, displayName: r.display_name },
  segmentCount: Number(r.segment_count),
  hasSummary: !!r.summary,
});

libraryRouter.get("/", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json({ sessions: library.list(req.user!.id, limit, offset).map(serialize) });
});

const claimSchema = z.object({ sessionId: z.string().min(1).max(64), lang: z.string().default(DEFAULT_TARGET) });

/**
 * Add a session the user followed before signing in. The session ID is only ever sent to people
 * who were in the room (after the PIN check for private sessions), so knowing it proves attendance.
 */
libraryRouter.post("/", (req, res) => {
  const parsed = claimSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const s = sessions.byId(parsed.data.sessionId);
  const started = s ? new Date(`${s.started_at.replace(" ", "T")}Z`).getTime() : 0;
  if (!s || Date.now() - started > CLAIM_WINDOW_MS) return res.status(404).json({ error: "Session not found" });
  if (s.speaker_id !== req.user!.id) {
    library.add(s.id, req.user!.id, isTargetLanguage(parsed.data.lang) ? parsed.data.lang : DEFAULT_TARGET);
  }
  res.status(204).end();
});

libraryRouter.get("/:id", (req, res) => {
  const entry = library.entry(req.user!.id, req.params.id);
  if (!entry) return res.status(404).json({ error: "Session not found" });
  // Listeners get the transcript in the language they read (falling back to the default one).
  const segments = sessions.segments(entry.id).map((s) => {
    const lang = s.translations[entry.lang] !== undefined ? entry.lang : DEFAULT_TARGET;
    return { seq: s.seq, original: s.original, translation: s.translations[lang] ?? null, translationLang: lang };
  });
  res.json({ session: { ...serialize(entry), summary: summaryOf(entry) }, segments });
});

/** Remove a session from the listener's own library (the speaker's copy is unaffected). */
libraryRouter.delete("/:id", (req, res) => {
  if (!library.remove(req.params.id, req.user!.id)) return res.status(404).json({ error: "Session not found" });
  res.status(204).end();
});
