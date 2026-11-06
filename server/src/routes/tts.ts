import { Router } from "express";
import rateLimit from "express-rate-limit";
import { LANGUAGES } from "../languages.js";
import { MAX_TTS_TEXT, synthesize, ttsEnabled, verifyTtsToken } from "../tts.js";

/**
 * GET /api/tts?text=…&lang=…&token=… → WAV audio of a translation, in a natural voice.
 * A GET (not POST) so audio players can stream it directly from the URL. Only text the server
 * signed (caption events, library transcripts) is accepted; see tts.ts.
 */
export const ttsRouter = Router();

// One request per sentence; generous enough for a busy live session, low enough to stop abuse.
const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });

ttsRouter.get("/", limiter, async (req, res) => {
  if (!ttsEnabled) return res.status(503).json({ error: "Read-aloud audio isn't enabled on this server" });
  const { text, lang, token } = req.query;
  if (typeof text !== "string" || typeof lang !== "string" || typeof token !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Invalid request" });
  }
  if (text.length > MAX_TTS_TEXT || !LANGUAGES[lang] || !verifyTtsToken(text, lang, token)) {
    return res.status(403).json({ error: "Invalid request" });
  }
  try {
    const audio = await synthesize(text, lang);
    res.set({
      "Content-Type": "audio/wav",
      "Content-Length": String(audio.length),
      "Cache-Control": "private, max-age=86400",
      // helmet defaults to same-origin; the web app (app.*) plays this from the API (api.*) in an <audio> element.
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    res.end(audio);
  } catch (err) {
    console.error("[tts]", err);
    res.status(502).json({ error: "Couldn't generate the audio" });
  }
});
