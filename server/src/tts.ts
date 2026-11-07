import { createHmac, timingSafeEqual } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { config, features } from "./config.js";

/**
 * Natural-sounding read-aloud audio (Gemini TTS). The language is detected from the text.
 *
 * Listeners don't need an account, so to keep the endpoint from voicing arbitrary text on our API key,
 * the server signs every translation it sends out (`ttsToken`) and only synthesizes signed text.
 */
export const ttsEnabled = features.tts;
export const MAX_TTS_TEXT = 1_000;

const signingKey = createHmac("sha256", config.JWT_SECRET).update("tts").digest();
const sign = (text: string, lang: string) => createHmac("sha256", signingKey).update(`${lang}\n${text}`).digest("hex").slice(0, 32);

/** Token that lets a client request audio for exactly this text. `undefined` when read-aloud audio is off. */
export const ttsToken = (text: string, lang: string) => (ttsEnabled && text ? sign(text, lang) : undefined);

export function verifyTtsToken(text: string, lang: string, token: string) {
  const expected = Buffer.from(sign(text, lang));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Streaming audio format: raw 16-bit signed little-endian PCM, mono. */
export const TTS_SAMPLE_RATE = 24_000;

/* --------------------------------- cache ---------------------------------- */
// Sentences are replayed often (every listener of a live session, replays in "My sessions"),
// so keep recent audio (raw PCM) in memory, bounded by total size.
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;

function remember(key: string, pcm: Buffer) {
  cache.set(key, pcm);
  cacheBytes += pcm.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= MAX_CACHE_BYTES) break;
    cache.delete(k);
    cacheBytes -= v.length;
  }
}

/* -------------------------------- synthesis ------------------------------- */
let client: GoogleGenAI | null = null;

/** One sentence being generated. Everyone asking for the same sentence shares it, including late joiners. */
class SpeechJob {
  readonly chunks: Buffer[] = [];
  private readonly listeners = new Set<(chunk: Buffer) => void>();
  readonly done: Promise<Buffer>;

  constructor(text: string) {
    this.done = this.run(text);
  }

  /** Receive every chunk: the ones generated so far, then new ones as they arrive. */
  subscribe(onChunk: (chunk: Buffer) => void) {
    for (const c of this.chunks) onChunk(c);
    this.listeners.add(onChunk);
    return () => this.listeners.delete(onChunk);
  }

  private async run(text: string): Promise<Buffer> {
    client ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    const stream = await client.interactions.create({
      model: config.TTS_MODEL,
      input: [
        {
          type: "user_input",
          content: [
            {
              type: "text",
              text,
              annotations: [{ type: "speech_metadata", style: "natural and clear, at a brisk pace like a live interpreter" }],
            },
          ],
        },
      ],
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: TTS_SAMPLE_RATE },
      generation_config: { speech_config: [{ voice: config.TTS_VOICE }] },
      // Transcripts are private: don't keep them on Google's side after the audio is returned.
      store: false,
      stream: true,
    });
    for await (const event of stream) {
      if (event.event_type === "step.delta" && event.delta.type === "audio" && event.delta.data) {
        const chunk = Buffer.from(event.delta.data, "base64");
        this.chunks.push(chunk);
        for (const l of this.listeners) l(chunk);
      }
    }
    if (!this.chunks.length) throw new Error("No audio returned");
    return Buffer.concat(this.chunks);
  }
}

const inFlight = new Map<string, SpeechJob>();
const cacheKey = (text: string, lang: string) => `${config.TTS_MODEL}|${config.TTS_VOICE}|${lang}|${text}`;

/**
 * Stream speech for `text` as it's generated: `onChunk` gets raw PCM pieces (TTS_SAMPLE_RATE, 16-bit mono).
 * Resolves when the sentence is complete. Cached and shared, so repeated sentences cost one request.
 */
export async function streamSpeech(text: string, lang: string, onChunk: (pcm: Buffer) => void): Promise<void> {
  const key = cacheKey(text, lang);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key); // refresh LRU position
    cache.set(key, cached);
    onChunk(cached);
    return;
  }
  let job = inFlight.get(key);
  if (!job) {
    const created = new SpeechJob(text);
    job = created;
    inFlight.set(key, created);
    created.done.then((pcm) => remember(key, pcm)).catch(() => {}).finally(() => inFlight.delete(key));
  }
  const unsubscribe = job.subscribe(onChunk);
  try {
    await job.done;
  } finally {
    unsubscribe();
  }
}

/** WAV file (header + PCM) of `text`, for players that need a complete file (e.g. "My sessions" playback). */
export async function synthesize(text: string, lang: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  await streamSpeech(text, lang, (c) => parts.push(c));
  return wav(Buffer.concat(parts));
}

function wav(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(TTS_SAMPLE_RATE, 24);
  header.writeUInt32LE(TTS_SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
