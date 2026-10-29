import { timingSafeEqual } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { userFromToken } from "./auth.js";
import { library, sessions, users, type TranslationMode, type UserRow } from "./db.js";
import { DEFAULT_SOURCE, DEFAULT_TARGET, isSourceLanguage, isTargetLanguage, TARGET_LANGUAGES } from "./languages.js";
import { summarizeEndedSession } from "./summary.js";
import { describeTranslationError, translator } from "./translation/index.js";

/* ============================================================================
 * Wire protocol
 *
 * Speaker -> server   speaker:start {sourceLang, title?, pin?, translationMode?, allowRevisit?, resumeSessionId?} (ack)
 *                     speaker:partial {seq, text}      interim recognition result
 *                     speaker:final {seq, text}        finalized utterance
 *                     speaker:stop (ack)
 * Listener -> server  listener:join {username, lang, pin?} (ack)
 *                     listener:leave
 * Server -> clients   caption:source {seq, text, isFinal}
 *                     caption:translation {seq, lang, text, isFinal, error?}
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roomName = (speakerId: string) => `room:${speakerId}`;
const langRoom = (speakerId: string, lang: string) => `room:${speakerId}:${lang}`;
const audienceRoom = (speakerId: string) => `audience:${speakerId}`;

interface SegmentState {
  seq: number;
  text: string;
  version: number;
  finalized: boolean;
  busy: Set<string>;
  translatedVersion: Map<string, number>;
  translation: Map<string, string>;
  lastRequestAt: Map<string, number>;
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
  for (const lang of TARGET_LANGUAGES) socket.leave(langRoom(speakerId, lang));
}

/** Add the live session to a signed-in listener's library (the speaker controls whether they can reopen it). */
function recordAttendance(socket: Socket, room: Room) {
  const user: UserRow | undefined = socket.data.user;
  if (!user || !room.sessionId || user.id === room.speakerId) return;
  library.add(room.sessionId, user.id, socket.data.listenLang ?? DEFAULT_TARGET);
}

function endSession(room: Room) {
  if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
  room.reconnectTimer = null;
  if (!room.sessionId) return;
  sessions.end(room.sessionId, room.peakListeners, room.meter.chars);
  summarizeEndedSession(room.sessionId, [...room.savingSegments]);
  room.sessionId = null;
  room.title = null;
  room.pin = null;
  room.segments.clear();
  room.recentFinals = [];
  room.highestFinalSeq = -1;
  room.peakListeners = 0;
  room.meter = { chars: 0 };
  broadcastStatus(room);
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

async function translateFinal(room: Room, sessionId: string, seq: number, text: string, context: string[]) {
  const translations: Record<string, string> = {};
  await Promise.all(
    activeTargetLangs(room).map(async (lang) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const translated = await translator.translate({ kind: "final", text, from: room.sourceLang, to: lang, context, meter: room.meter });
          translations[lang] = translated;
          io.to(langRoom(room.speakerId, lang)).emit("caption:translation", { seq, lang, text: translated, isFinal: true });
          return;
        } catch (err) {
          console.warn(`[translate:final] attempt ${attempt + 1}: ${describeTranslationError(err)}`);
        }
      }
      io.to(langRoom(room.speakerId, lang)).emit("caption:translation", { seq, lang, text: "", isFinal: true, error: true });
    }),
  );
  sessions.saveSegment(sessionId, seq, text, translations);
}

/** A listener chose a language earlier lines weren't translated into: fill in the most recent ones. */
async function backfillHistory(socket: Socket, room: Room, sessionId: string, items: { seq: number; original: string }[], lang: string) {
  for (const item of items) {
    if (room.sessionId !== sessionId || !socket.connected) return;
    try {
      const translated = await translator.translate({ kind: "final", text: item.original, from: room.sourceLang, to: lang });
      sessions.addTranslation(sessionId, item.seq, lang, translated);
      sessions.addChars(sessionId, item.original.length);
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
});

type Ack = (res: Record<string, unknown>) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === "function" ? (ack as Ack) : () => {});

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
    // Re-read the user: verification status may have changed since this socket connected.
    const user = socket.data.user ? users.byId((socket.data.user as UserRow).id) : undefined;
    if (!user) return ack({ ok: false, error: "unauthorized" });
    if (!user.email_verified) return ack({ ok: false, error: "email_unverified" });
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
      endSession(room);
      const revisit = allowRevisit ?? !pin;
      const session = sessions.create(user.id, sourceLang, title || null, { isPrivate: !!pin, mode: translationMode, allowRevisit: revisit });
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
  });

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
      };
      room.segments.set(seq, seg);
    } else {
      if (seg.text === text) return;
      seg.text = text;
      seg.version++;
    }
    io.to(roomName(room.speakerId)).emit("caption:source", { seq, text, isFinal: false });
    for (const lang of activeTargetLangs(room)) void pumpPartial(room, seg, lang);
  });

  socket.on("speaker:final", (raw) => {
    const room = ownRoom();
    const parsed = textSchema.safeParse(raw);
    if (!room || !parsed.success) return;
    const { seq, text } = parsed.data;
    if (seq <= room.highestFinalSeq) return;

    const seg = room.segments.get(seq);
    if (seg) seg.finalized = true;
    room.segments.delete(seq);
    room.highestFinalSeq = seq;
    // Drop any interim segments the client abandoned before this one.
    for (const s of room.segments.keys()) if (s < seq) room.segments.delete(s);

    const clean = text.trim();
    io.to(roomName(room.speakerId)).emit("caption:source", { seq, text: clean, isFinal: true });
    if (!clean) return;

    const context = room.recentFinals.slice();
    room.recentFinals = [...room.recentFinals, clean].slice(-CONTEXT_SENTENCES);
    const saving = translateFinal(room, room.sessionId!, seq, clean, context)
      .catch((err) => console.error("[final] failed to persist segment", err))
      .finally(() => room.savingSegments.delete(saving));
    room.savingSegments.add(saving);
  });

  socket.on("speaker:stop", (_raw, ackFn) => {
    const ack = safeAck(ackFn);
    const room = ownRoom();
    if (room) endSession(room);
    ack({ ok: true });
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
    const parsed = joinSchema.safeParse(raw ?? {});
    if (!parsed.success || !isTargetLanguage(parsed.data.lang)) return ack({ ok: false, error: "invalid_request" });
    const speaker = users.byUsername(parsed.data.username.replace(/^@/, ""));
    if (!speaker) return ack({ ok: false, error: "not_found" });
    const speakerInfo = { username: speaker.username, displayName: speaker.display_name };

    leaveCurrent();
    const { lang, pin } = parsed.data;
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
    recordAttendance(socket, room);

    // Catch the listener up: recent finalized lines plus anything being spoken right now.
    const saved = room.sessionId ? sessions.recentSegments(room.sessionId, HISTORY_ON_JOIN) : [];
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
    ack({ ok: true, speaker: speakerInfo, status: statusPayload(room), listeners: listenerCount(room), history });
  });

  socket.on("listener:leave", leaveCurrent);
  return leaveCurrent;
}

export function attachRealtime(server: Server) {
  io = server;
  sessions.closeDangling();

  io.on("connection", (socket) => {
    socket.data.user = userFromToken(socket.handshake.auth?.token) ?? undefined;

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
          endSession(room);
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
export function forceEndSpeaker(speakerId: string) {
  const room = rooms.get(speakerId);
  if (!room || !io) return;
  endSession(room);
  if (room.speakerSocketId) io.sockets.sockets.get(room.speakerSocketId)?.disconnect(true);
  room.speakerSocketId = null;
  maybeDisposeRoom(room);
}
