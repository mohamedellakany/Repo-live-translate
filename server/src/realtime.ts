import { timingSafeEqual } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { userFromToken } from "./auth.js";
import { library, sessions, users, type TranslationMode, type UserRow } from "./db.js";
import { DEFAULT_SOURCE, DEFAULT_TARGET, isSourceLanguage, isTargetLanguage, listenLanguage, TARGET_LANGUAGES } from "./languages.js";
import { summarizeEndedSession } from "./summary.js";
import { settledPhraseEnd, toWords } from "./phrases.js";
import { MAX_TTS_TEXT, streamSpeech, ttsEnabled } from "./tts.js";
import { describeTranslationError, translator } from "./translation/index.js";

/* ============================================================================
 * Wire protocol
 *
 * Speaker -> server   speaker:start {sourceLang, title?, pin?, translationMode?, allowRevisit?, resumeSessionId?} (ack)
 *                     speaker:partial {seq, text}      interim recognition result
 *                     speaker:final {seq, text}        finalized utterance
 *                     speaker:stop (ack)
 * Listener -> server  listener:join {username, lang, pin?, audio?} (ack)
 *                     listener:audio {on}               turn read-aloud audio on/off
 *                     listener:leave
 * Server -> clients   caption:source {seq, text, isFinal}
 *                     caption:translation {seq, lang, text, isFinal, error?}
 *                     caption:audio {seq, part, lang}         a voiced part is coming (keeps parts in order)
 *                     caption:audio {seq, part, lang, data}   read-aloud speech, raw 16-bit PCM chunks (TTS_SAMPLE_RATE, mono)
 *                     caption:audio {seq, part, lang, end}    that part's audio is complete (or failed)
 *                     Parts: phrases voiced while the sentence is still being spoken, then the rest of it.
 *                     speaker:status {live, reconnecting, sessionId, title, sourceLang, private, revisit}
 *                     room:stats {listeners}
 *                     listener:pin_required             (a private session started; re-join with a PIN)
 *                     speaker:replaced                  (sent to an old speaker device)
 * ========================================================================== */

const SPEAKER_RECONNECT_GRACE_MS = 20_000;
const HISTORY_ON_JOIN = 100;
const BACKFILL_ON_JOIN = 30;
const CONTEXT_SENTENCES = 3;
const MAX_TEXT = 2_000;
const PIN_ATTEMPTS_PER_MINUTE = 5;

/**
 * Minimum spacing between interim translation requests per sentence, by mode.
 * `null` = interim text isn't translated at all (only finished sentences).
 */
const PARTIAL_INTERVAL_MS: Record<TranslationMode, number | null> = { live: 200, balanced: 1_000, sentences: null };
/**
 * Interim translation re-sends the whole growing sentence, and every request is billed in full, so
 * only re-translate when there's something worth showing: a couple of new words, a natural break
 * (comma, full stop, question mark…), or a short pause in speech. Finished sentences are unaffected.
 */
const PARTIAL_MIN_NEW_WORDS = 2;
const PARTIAL_SETTLE_MS = 700;
const BREAK_AT_END = /[,.!?:;،؛؟]\s*$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roomName = (speakerId: string) => `room:${speakerId}`;
const langRoom = (speakerId: string, lang: string) => `room:${speakerId}:${lang}`;
const audienceRoom = (speakerId: string) => `audience:${speakerId}`;
/** Listeners of one language who turned read-aloud on. */
const audioRoom = (speakerId: string, lang: string) => `audio:${speakerId}:${lang}`;

interface SegmentState {
  seq: number;
  text: string;
  version: number;
  finalized: boolean;
  busy: Set<string>;
  translatedVersion: Map<string, number>;
  translation: Map<string, string>;
  lastRequestAt: Map<string, number>;
  /** Interim translation: words already translated, and pending "speaker paused" checks, per language. */
  translatedWords: Map<string, number>;
  settleTimers: Map<string, NodeJS.Timeout>;
  forced: Set<string>;
  /** Read-aloud: the previous interim transcript, how many of its words were voiced, and the phrases voiced so far. */
  prevWords: string[];
  voicedWords: number;
  voicedPhrases: string[];
  parts: number;
}

interface Room {
  speakerId: string;
  username: string;
  displayName: string;
  sessionId: string | null;
  title: string | null;
  sourceLang: string;
  mode: TranslationMode;
  pin: string | null;
  /** Signed-in listeners may reopen this session later from their library. */
  allowRevisit: boolean;
  speakerSocketId: string | null;
  reconnectTimer: NodeJS.Timeout | null;
  segments: Map<number, SegmentState>;
  highestFinalSeq: number;
  recentFinals: string[];
  peakListeners: number;
  meter: { chars: number };
  /** Final sentences still being translated and saved; the session summary waits for them. */
  savingSegments: Set<Promise<void>>;
}

const rooms = new Map<string, Room>();
let io: Server;

/* ----------------------------- helpers ----------------------------------- */

function getOrCreateRoom(user: UserRow): Room {
  let room = rooms.get(user.id);
  if (!room) {
    room = {
      speakerId: user.id,
      username: user.username,
      displayName: user.display_name,
      sessionId: null,
      title: null,
      sourceLang: DEFAULT_SOURCE,
      mode: "live",
      pin: null,
      allowRevisit: true,
      speakerSocketId: null,
      reconnectTimer: null,
      segments: new Map(),
      highestFinalSeq: -1,
      recentFinals: [],
      peakListeners: 0,
      meter: { chars: 0 },
      savingSegments: new Set(),
    };
    rooms.set(user.id, room);
  }
  return room;
}

const listenerCount = (room: Room) => io.sockets.adapter.rooms.get(audienceRoom(room.speakerId))?.size ?? 0;

/**
 * Target languages that currently need translating: the default plus any language a listener picked.
 * A listener reading the speaker's own language is included too; the translator passes that text through unchanged.
 */
function activeTargetLangs(room: Room): string[] {
  const langs = new Set([DEFAULT_TARGET]);
  for (const lang of TARGET_LANGUAGES) {
    if ((io.sockets.adapter.rooms.get(langRoom(room.speakerId, lang))?.size ?? 0) > 0) langs.add(lang);
  }
  return [...langs];
}

function statusPayload(room: Room) {
  return {
    live: room.sessionId !== null,
    reconnecting: room.sessionId !== null && room.speakerSocketId === null,
    sessionId: room.sessionId,
    title: room.title,
    sourceLang: room.sourceLang,
    private: room.sessionId !== null && room.pin !== null,
    revisit: room.sessionId !== null && room.allowRevisit,
  };
}

const broadcastStatus = (room: Room) => io.to(roomName(room.speakerId)).emit("speaker:status", statusPayload(room));

function broadcastStats(room: Room) {
  const listeners = listenerCount(room);
  room.peakListeners = Math.max(room.peakListeners, listeners);
  io.to(roomName(room.speakerId)).emit("room:stats", { listeners });
}

function maybeDisposeRoom(room: Room) {
  if (!room.sessionId && !room.speakerSocketId && listenerCount(room) === 0) rooms.delete(room.speakerId);
}

function leaveListenerRooms(socket: Socket, speakerId: string) {
  socket.leave(roomName(speakerId));
  socket.leave(audienceRoom(speakerId));
  for (const lang of TARGET_LANGUAGES) {
    socket.leave(langRoom(speakerId, lang));
    socket.leave(audioRoom(speakerId, lang));
  }
}

/** Add the live session to a signed-in listener's library (the speaker controls whether they can reopen it). */
function recordAttendance(socket: Socket, room: Room) {
  const user: UserRow | undefined = socket.data.user;
  if (!user || !room.sessionId || user.id === room.speakerId) return;
  library.add(room.sessionId, user.id, socket.data.listenLang ?? DEFAULT_TARGET).catch((err) => console.error("[db] attendance", err));
}

/**
 * End the live session. The room is reset immediately (so nothing leaks into the next session);
 * the returned promise resolves once the session is marked ended in the database.
 */
function endSession(room: Room): Promise<void> {
  if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
  room.reconnectTimer = null;
  if (!room.sessionId) return Promise.resolve();
  const sessionId = room.sessionId;
  const saved = sessions.end(sessionId, room.peakListeners, room.meter.chars).then(
    () => {},
    (err) => console.error("[db] failed to end session", err),
  );
  summarizeEndedSession(sessionId, [...room.savingSegments, saved]);
  room.sessionId = null;
  room.title = null;
  room.pin = null;
  for (const seg of room.segments.values()) retireSegment(seg);
  room.segments.clear();
  room.recentFinals = [];
  room.highestFinalSeq = -1;
  room.peakListeners = 0;
  room.meter = { chars: 0 };
  broadcastStatus(room);
  return saved;
}

/** When a private session starts, listeners who were waiting without the PIN are removed. */
function evictUnauthorized(room: Room) {
  for (const id of io.sockets.adapter.rooms.get(audienceRoom(room.speakerId)) ?? []) {
    const s = io.sockets.sockets.get(id);
    if (!s || s.data.authorizedFor === room.sessionId) continue;
    leaveListenerRooms(s, room.speakerId);
    s.data.listeningTo = undefined;
    s.emit("listener:pin_required", { username: room.username });
  }
  broadcastStats(room);
}

const pinMatches = (expected: string, given: string) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Simple token bucket so a misbehaving client can't flood the translator. */
function rateLimiter(capacity: number, refillPerSec: number) {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/* ------------------------- translation pipeline -------------------------- */

/**
 * Translate interim text with "latest wins" coalescing: at most one request per
 * (segment, language) is in flight; when it returns, we immediately translate
 * the newest text if it changed meanwhile. Stale results are never broadcast.
 */
/** If the speaker pauses mid-sentence, translate what they've said so far even if it's only a word. */
function armSettle(room: Room, seg: SegmentState, lang: string) {
  clearTimeout(seg.settleTimers.get(lang));
  seg.settleTimers.set(
    lang,
    setTimeout(() => {
      seg.settleTimers.delete(lang);
      if (seg.finalized || (seg.translatedVersion.get(lang) ?? -1) >= seg.version) return;
      seg.forced.add(lang);
      void pumpPartial(room, seg, lang);
    }, PARTIAL_SETTLE_MS),
  );
}

/** A sentence is finished or abandoned: stop its interim work. */
function retireSegment(seg: SegmentState) {
  seg.finalized = true;
  for (const timer of seg.settleTimers.values()) clearTimeout(timer);
  seg.settleTimers.clear();
}

async function pumpPartial(room: Room, seg: SegmentState, lang: string) {
  const interval = PARTIAL_INTERVAL_MS[room.mode];
  if (interval === null || seg.busy.has(lang)) return;
  seg.busy.add(lang);
  try {
    while (!seg.finalized) {
      if ((seg.translatedVersion.get(lang) ?? -1) >= seg.version) break;
      const wait = interval - (Date.now() - (seg.lastRequestAt.get(lang) ?? 0));
      if (wait > 0) {
        await sleep(wait); // newer interim text that arrives meanwhile is picked up below
        continue;
      }
      const words = toWords(seg.text).length;
      const newWords = words - (seg.translatedWords.get(lang) ?? 0);
      if (newWords < PARTIAL_MIN_NEW_WORDS && !BREAK_AT_END.test(seg.text) && !seg.forced.has(lang)) {
        armSettle(room, seg, lang); // not worth a request yet; translate anyway if the speaker pauses here
        break;
      }
      seg.forced.delete(lang);
      seg.lastRequestAt.set(lang, Date.now());
      const version = seg.version;
      const translated = await translator.translate({
        kind: "partial",
        text: seg.text,
        from: room.sourceLang,
        to: lang,
        context: room.recentFinals,
        meter: room.meter,
      });
      if (seg.finalized) break;
      seg.translatedVersion.set(lang, version);
      seg.translatedWords.set(lang, words);
      seg.translation.set(lang, translated);
      io.to(langRoom(room.speakerId, lang)).emit("caption:translation", { seq: seg.seq, lang, text: translated, isFinal: false });
    }
  } catch (err) {
    // Partial failures are non-fatal: the final translation will follow.
    console.warn(`[translate:partial] ${describeTranslationError(err)}`);
  } finally {
    seg.busy.delete(lang);
  }
}

/** `voice`: read-aloud languages that get this whole sentence voiced (part 0, already announced). */
async function translateFinal(room: Room, sessionId: string, seq: number, text: string, context: string[], voice: Set<string>) {
  const translations: Record<string, string> = {};
  await Promise.all(
    activeTargetLangs(room).map(async (lang) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const translated = await translator.translate({ kind: "final", text, from: room.sourceLang, to: lang, context, meter: room.meter });
          translations[lang] = translated;
          io.to(langRoom(room.speakerId, lang)).emit("caption:translation", { seq, lang, text: translated, isFinal: true });
          if (voice.has(lang)) void sendSpeech(room, seq, 0, lang, translated);
          return;
        } catch (err) {
          console.warn(`[translate:final] attempt ${attempt + 1}: ${describeTranslationError(err)}`);
        }
      }
      io.to(langRoom(room.speakerId, lang)).emit("caption:translation", { seq, lang, text: "", isFinal: true, error: true });
      if (voice.has(lang)) void sendSpeech(room, seq, 0, lang, ""); // close the announced part
    }),
  );
  await sessions.saveSegment(sessionId, seq, text, translations);
}

/** Languages with at least one listener who turned read-aloud on (nothing is voiced for the others). */
function audioLangs(room: Room): string[] {
  if (!ttsEnabled) return [];
  return TARGET_LANGUAGES.filter((lang) => (io.sockets.adapter.rooms.get(audioRoom(room.speakerId, lang))?.size ?? 0) > 0);
}

/** Tell read-aloud listeners a part is coming, so the app keeps parts in order while it's translated and voiced. */
function announcePart(room: Room, seq: number, part: number, langs: string[]) {
  for (const lang of langs) io.to(audioRoom(room.speakerId, lang)).emit("caption:audio", { seq, part, lang });
}

/**
 * Voice one part of a sentence (a phrase, or the rest of the sentence) for read-aloud listeners:
 * announce it now, then translate it and stream the speech as it's generated.
 */
function voicePart(room: Room, seq: number, part: number, langs: string[], text: string, context: string[]) {
  announcePart(room, seq, part, langs);
  for (const lang of langs) {
    void (async () => {
      let translated = "";
      try {
        translated = await translator.translate({ kind: "final", text, from: room.sourceLang, to: lang, context, meter: room.meter });
      } catch (err) {
        console.warn(`[translate:phrase] ${describeTranslationError(err)}`);
      }
      await sendSpeech(room, seq, part, lang, translated);
    })();
  }
}

/** Stream speech for an announced part, then close it (also when there's nothing to say or it failed). */
async function sendSpeech(room: Room, seq: number, part: number, lang: string, text: string) {
  const name = audioRoom(room.speakerId, lang);
  try {
    if (text && text.length <= MAX_TTS_TEXT) {
      await streamSpeech(text, lang, (data) => io.to(name).emit("caption:audio", { seq, part, lang, data }));
    }
  } catch (err) {
    console.warn(`[tts] ${(err as Error).message}`);
  } finally {
    io.to(name).emit("caption:audio", { seq, part, lang, end: true });
  }
}

/** A listener chose a language earlier lines weren't translated into: fill in the most recent ones. */
async function backfillHistory(socket: Socket, room: Room, sessionId: string, items: { seq: number; original: string }[], lang: string) {
  for (const item of items) {
    if (room.sessionId !== sessionId || !socket.connected) return;
    try {
      const translated = await translator.translate({ kind: "final", text: item.original, from: room.sourceLang, to: lang });
      await sessions.addTranslation(sessionId, item.seq, lang, translated);
      await sessions.addChars(sessionId, item.original.length);
      socket.emit("caption:translation", { seq: item.seq, lang, text: translated, isFinal: true });
    } catch (err) {
      console.warn(`[translate:backfill] ${describeTranslationError(err)}`);
      return;
    }
  }
}

/* ------------------------------ handlers --------------------------------- */

const startSchema = z.object({
  sourceLang: z.string().default(DEFAULT_SOURCE),
  title: z.string().trim().max(120).optional().nullable(),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  translationMode: z.enum(["live", "balanced", "sentences"]).default("live"),
  // Defaults to on for public sessions and off for private (PIN) ones.
  allowRevisit: z.boolean().optional(),
  resumeSessionId: z.string().optional().nullable(),
});
const textSchema = z.object({ seq: z.number().int().min(0), text: z.string().max(MAX_TEXT) });
const joinSchema = z.object({
  username: z.string().trim().min(1).max(40),
  lang: z.string().default(DEFAULT_TARGET),
  pin: z.string().trim().max(8).optional().nullable(),
  audio: z.boolean().optional(),
});

type Ack = (res: Record<string, unknown>) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === "function" ? (ack as Ack) : () => {});

/**
 * Run a socket's start/stop/join requests one at a time, in order. They read and write the database,
 * so without this a double-tapped "Go live" could create two sessions.
 */
function inOrder(socket: Socket, ack: Ack, task: () => Promise<unknown>) {
  const previous: Promise<unknown> = socket.data.queue ?? Promise.resolve();
  socket.data.queue = previous.then(task).catch((err) => {
    console.error("[socket]", err);
    ack({ ok: false, error: "server_error" });
  });
}

function registerSpeakerHandlers(socket: Socket) {
  const allow = rateLimiter(40, 25);

  const ownRoom = () => {
    const user: UserRow | undefined = socket.data.user;
    if (!user) return null;
    const room = rooms.get(user.id);
    return room && room.speakerSocketId === socket.id && room.sessionId ? room : null;
  };

  socket.on("speaker:start", (raw, ackFn) => {
    const ack = safeAck(ackFn);
    inOrder(socket, ack, () => startBroadcast(raw, ack));
  });

  async function startBroadcast(raw: unknown, ack: Ack) {
    // Re-read the user: verification status may have changed since this socket connected.
    const user = socket.data.user ? await users.byId((socket.data.user as UserRow).id) : undefined;
    if (!user) return ack({ ok: false, error: "unauthorized" });
    if (!user.email_verified) return ack({ ok: false, error: "email_unverified" });
    if (!user.can_speak) return ack({ ok: false, error: "speaking_not_allowed" });
    socket.data.user = user;

    const parsed = startSchema.safeParse(raw ?? {});
    if (!parsed.success || !isSourceLanguage(parsed.data.sourceLang)) return ack({ ok: false, error: "invalid_request" });
    const { sourceLang, title, pin, translationMode, allowRevisit, resumeSessionId } = parsed.data;
    const room = getOrCreateRoom(user);
    room.displayName = user.display_name;

    // Only one broadcasting device per speaker.
    if (room.speakerSocketId && room.speakerSocketId !== socket.id) {
      const old = io.sockets.sockets.get(room.speakerSocketId);
      old?.emit("speaker:replaced");
      old?.leave(roomName(room.speakerId));
    }
    if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
    room.reconnectTimer = null;

    const resuming = !!resumeSessionId && room.sessionId === resumeSessionId;
    if (!resuming) {
      void endSession(room);
      const revisit = allowRevisit ?? !pin;
      const session = await sessions.create(user.id, sourceLang, title || null, { isPrivate: !!pin, mode: translationMode, allowRevisit: revisit });
      room.sessionId = session.id;
      room.title = session.title;
      room.sourceLang = sourceLang;
      room.mode = translationMode;
      room.pin = pin ?? null;
      room.allowRevisit = revisit;
    }

    room.speakerSocketId = socket.id;
    socket.data.speakingFor = user.id;
    socket.join([roomName(user.id), langRoom(user.id, DEFAULT_TARGET)]);
    if (!resuming && room.pin) evictUnauthorized(room);
    if (!resuming) {
      // Listeners who were already waiting for this speaker attended too.
      for (const id of io.sockets.adapter.rooms.get(audienceRoom(room.speakerId)) ?? []) {
        const s = io.sockets.sockets.get(id);
        if (s) recordAttendance(s, room);
      }
    }
    broadcastStatus(room);
    ack({ ok: true, resumed: resuming, sessionId: room.sessionId, listeners: listenerCount(room) });
  }

  socket.on("speaker:partial", (raw) => {
    const room = ownRoom();
    const parsed = textSchema.safeParse(raw);
    if (!room || !parsed.success || !allow()) return;
    const { seq, text } = parsed.data;
    if (seq <= room.highestFinalSeq || !text.trim()) return;

    let seg = room.segments.get(seq);
    if (!seg) {
      seg = {
        seq,
        text,
        version: 0,
        finalized: false,
        busy: new Set(),
        translatedVersion: new Map(),
        translation: new Map(),
        lastRequestAt: new Map(),
        translatedWords: new Map(),
        settleTimers: new Map(),
        forced: new Set(),
        prevWords: [],
        voicedWords: 0,
        voicedPhrases: [],
        parts: 0,
      };
      room.segments.set(seq, seg);
    } else {
      if (seg.text === text) return;
      seg.text = text;
      seg.version++;
    }
    io.to(roomName(room.speakerId)).emit("caption:source", { seq, text, isFinal: false });
    for (const lang of activeTargetLangs(room)) void pumpPartial(room, seg, lang);

    // Read-aloud keeps pace with the speaker: voice phrases that stopped changing without waiting for the sentence to end.
    const words = toWords(text);
    const langs = audioLangs(room);
    const end = langs.length ? settledPhraseEnd(seg.prevWords, words, seg.voicedWords) : null;
    if (end !== null) {
      const phrase = words.slice(seg.voicedWords, end).join(" ");
      const context = [...room.recentFinals, ...seg.voicedPhrases];
      seg.voicedWords = end;
      seg.voicedPhrases.push(phrase);
      voicePart(room, seq, seg.parts++, langs, phrase, context);
    }
    seg.prevWords = words;
  });

  socket.on("speaker:final", (raw) => {
    const room = ownRoom();
    const parsed = textSchema.safeParse(raw);
    if (!room || !parsed.success) return;
    const { seq, text } = parsed.data;
    if (seq <= room.highestFinalSeq) return;

    const seg = room.segments.get(seq);
    if (seg) retireSegment(seg);
    room.segments.delete(seq);
    room.highestFinalSeq = seq;
    // Drop any interim segments the client abandoned before this one.
    for (const [s, abandoned] of room.segments) {
      if (s < seq) {
        retireSegment(abandoned);
        room.segments.delete(s);
      }
    }

    const clean = text.trim();
    io.to(roomName(room.speakerId)).emit("caption:source", { seq, text: clean, isFinal: true });
    if (!clean) return;

    const context = room.recentFinals.slice();
    room.recentFinals = [...room.recentFinals, clean].slice(-CONTEXT_SENTENCES);

    // Read-aloud: if phrases were already voiced, voice just the rest; otherwise the whole sentence
    // reuses the caption translation below (no extra translation request).
    const langs = audioLangs(room);
    const voiceWhole = new Set<string>();
    if (langs.length && seg && seg.voicedWords > 0) {
      const rest = toWords(clean).slice(seg.voicedWords).join(" ");
      if (rest) voicePart(room, seq, seg.parts, langs, rest, [...context, ...seg.voicedPhrases]);
    } else if (langs.length) {
      announcePart(room, seq, 0, langs);
      for (const lang of langs) voiceWhole.add(lang);
    }
    const saving = translateFinal(room, room.sessionId!, seq, clean, context, voiceWhole)
      .catch((err) => console.error("[final] failed to persist segment", err))
      .finally(() => room.savingSegments.delete(saving));
    room.savingSegments.add(saving);
  });

  socket.on("speaker:stop", (_raw, ackFn) => {
    const ack = safeAck(ackFn);
    inOrder(socket, ack, async () => {
      const room = ownRoom();
      if (room) await endSession(room); // so History shows it as ended right away
      ack({ ok: true });
    });
  });
}

function registerListenerHandlers(socket: Socket) {
  const allowPinAttempt = rateLimiter(PIN_ATTEMPTS_PER_MINUTE, PIN_ATTEMPTS_PER_MINUTE / 60);

  const leaveCurrent = () => {
    const speakerId: string | undefined = socket.data.listeningTo;
    if (!speakerId) return;
    leaveListenerRooms(socket, speakerId);
    socket.data.listeningTo = undefined;
    const room = rooms.get(speakerId);
    if (room) {
      broadcastStats(room);
      maybeDisposeRoom(room);
    }
  };

  socket.on("listener:join", (raw, ackFn) => {
    const ack = safeAck(ackFn);
    inOrder(socket, ack, () => join(raw, ack));
  });

  async function join(raw: unknown, ack: Ack) {
    const parsed = joinSchema.safeParse(raw ?? {});
    if (!parsed.success || !isTargetLanguage(parsed.data.lang)) return ack({ ok: false, error: "invalid_request" });
    const speaker = await users.byUsername(parsed.data.username.replace(/^@/, ""));
    if (!speaker) return ack({ ok: false, error: "not_found" });
    const speakerInfo = { username: speaker.username, displayName: speaker.display_name };

    leaveCurrent();
    const { pin, audio } = parsed.data;
    // A switched-off language (e.g. from an older app version) falls back to the default one.
    const lang = listenLanguage(parsed.data.lang);
    const room = getOrCreateRoom(speaker);

    // Private session: require the PIN (unless this socket already entered it for this session).
    if (room.sessionId && room.pin && socket.data.authorizedFor !== room.sessionId) {
      if (!pin) return ack({ ok: false, error: "pin_required", speaker: speakerInfo });
      if (!allowPinAttempt()) return ack({ ok: false, error: "too_many_attempts", speaker: speakerInfo });
      if (!pinMatches(room.pin, pin)) return ack({ ok: false, error: "invalid_pin", speaker: speakerInfo });
      socket.data.authorizedFor = room.sessionId;
    }

    socket.data.listeningTo = speaker.id;
    socket.data.listenLang = lang;
    socket.join([roomName(speaker.id), audienceRoom(speaker.id), langRoom(speaker.id, lang)]);
    if (audio) socket.join(audioRoom(speaker.id, lang));
    recordAttendance(socket, room);

    // Catch the listener up: recent finalized lines plus anything being spoken right now.
    const saved = room.sessionId ? await sessions.recentSegments(room.sessionId, HISTORY_ON_JOIN) : [];
    const history = [
      ...saved.map((s) => ({ seq: s.seq, original: s.original, translation: s.translations[lang] ?? null, isFinal: true })),
      ...[...room.segments.values()].map((s) => ({
        seq: s.seq,
        original: s.text,
        translation: s.translation.get(lang) ?? null,
        isFinal: false,
      })),
    ];
    const missing = saved.filter((s) => s.translations[lang] === undefined).slice(-BACKFILL_ON_JOIN).reverse();
    if (room.sessionId && missing.length) void backfillHistory(socket, room, room.sessionId, missing, lang);

    broadcastStats(room);
    ack({ ok: true, speaker: speakerInfo, status: statusPayload(room), listeners: listenerCount(room), history, lang });
  }

  socket.on("listener:audio", (raw) => {
    const speakerId: string | undefined = socket.data.listeningTo;
    const lang: string | undefined = socket.data.listenLang;
    if (!speakerId || !lang) return;
    if ((raw as { on?: unknown })?.on === true) socket.join(audioRoom(speakerId, lang));
    else socket.leave(audioRoom(speakerId, lang));
  });

  socket.on("listener:leave", leaveCurrent);
  return leaveCurrent;
}

export function attachRealtime(server: Server) {
  io = server;
  sessions.closeDangling().catch((err) => console.error("[db] closeDangling", err));

  // Look the user up before the connection is accepted, so every event handler already knows who it is.
  io.use((socket, next) => {
    userFromToken(socket.handshake.auth?.token).then(
      (user) => {
        socket.data.user = user ?? undefined;
        next();
      },
      (err) => next(err instanceof Error ? err : new Error("auth failed")),
    );
  });

  io.on("connection", (socket) => {

    registerSpeakerHandlers(socket);
    const leaveListening = registerListenerHandlers(socket);

    socket.on("disconnect", () => {
      leaveListening();
      const speakerId: string | undefined = socket.data.speakingFor;
      const room = speakerId ? rooms.get(speakerId) : undefined;
      if (!room || room.speakerSocketId !== socket.id) return;
      room.speakerSocketId = null;
      if (room.sessionId) {
        // Keep the session alive briefly so a network blip doesn't end the broadcast.
        broadcastStatus(room);
        room.reconnectTimer = setTimeout(() => {
          void endSession(room);
          maybeDisposeRoom(room);
        }, SPEAKER_RECONNECT_GRACE_MS);
      } else {
        maybeDisposeRoom(room);
      }
    });
  });
}

/** Public live info for a speaker (used by the REST API). */
export function liveInfo(speakerId: string) {
  const room = rooms.get(speakerId);
  if (!room) return { live: false, reconnecting: false, listeners: 0, title: null, private: false };
  const s = statusPayload(room);
  return { live: s.live, reconnecting: s.reconnecting, listeners: listenerCount(room), title: room.title, private: s.private };
}

export const liveSessionId = (speakerId: string) => rooms.get(speakerId)?.sessionId ?? null;

/** Used when an account is deleted: end any live session and disconnect the broadcasting device. */
export async function forceEndSpeaker(speakerId: string) {
  const room = rooms.get(speakerId);
  if (!room || !io) return;
  await endSession(room);
  if (room.speakerSocketId) io.sockets.sockets.get(room.speakerSocketId)?.disconnect(true);
  room.speakerSocketId = null;
  maybeDisposeRoom(room);
}
