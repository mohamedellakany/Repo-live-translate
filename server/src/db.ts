import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "./config.js";

/*
 * PostgreSQL (Neon in production). Every function here is async.
 *
 * Type conventions so the rest of the app sees plain JSON-friendly values:
 *  - timestamps come back as ISO strings ("2026-11-12T18:07:57.966Z")
 *  - BIGINT / COUNT(*) come back as numbers (all our values are far below 2^53)
 */
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  // Neon may close idle connections (e.g. when the database sleeps); just open a new one.
  idleTimeoutMillis: 30_000,
});
pool.on("error", (err) => console.error("[db] idle client error", err.message));

const one = async <T>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows[0] as T | undefined;
const all = async <T>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const run = async (text: string, values: unknown[] = []) => (await pool.query(text, values)).rowCount ?? 0;

/* ------------------------------ migrations ------------------------------- */
// Each entry runs once, in order, inside a transaction; schema_migrations records progress.
const MIGRATIONS: string[] = [
  // 1: initial schema (equivalent to the last SQLite schema)
  `
  CREATE EXTENSION IF NOT EXISTS citext;
  CREATE TABLE users (
    id             TEXT PRIMARY KEY,
    username       CITEXT NOT NULL UNIQUE,
    email          CITEXT NOT NULL UNIQUE,
    display_name   TEXT NOT NULL,
    password_hash  TEXT,
    google_sub     TEXT UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE email_codes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    sent_at    BIGINT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, purpose)
  );
  CREATE TABLE sessions (
    id               TEXT PRIMARY KEY,
    speaker_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            TEXT,
    source_lang      TEXT NOT NULL,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ,
    peak_listeners   INTEGER NOT NULL DEFAULT 0,
    is_private       BOOLEAN NOT NULL DEFAULT FALSE,
    translation_mode TEXT NOT NULL DEFAULT 'live',
    chars_translated BIGINT NOT NULL DEFAULT 0,
    summary          TEXT,
    allow_revisit    BOOLEAN NOT NULL DEFAULT TRUE
  );
  CREATE INDEX idx_sessions_speaker ON sessions(speaker_id, started_at DESC);
  CREATE TABLE segments (
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    original     TEXT NOT NULL,
    translations JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, seq)
  );
  CREATE TABLE session_listeners (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lang       TEXT NOT NULL,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, user_id)
  );
  CREATE INDEX idx_session_listeners_user ON session_listeners(user_id, joined_at DESC);
  `,
];

export async function migrate() {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  for (;;) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Transaction-level lock (released at COMMIT/ROLLBACK): one server migrates at a time, and it works
      // through Neon's connection pooler, where session-level locks aren't reliable.
      await client.query("SELECT pg_advisory_xact_lock(727001)");
      const { rows } = await client.query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations");
      const version = Number(rows[0].v);
      if (version >= MIGRATIONS.length) {
        await client.query("COMMIT");
        return;
      }
      await client.query(MIGRATIONS[version]);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version + 1]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
await migrate();

/* --------------------------------- types --------------------------------- */
export interface UserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  google_sub: string | null;
  email_verified: boolean;
  created_at: string;
}
export interface PublicUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  createdAt: string;
}
export type TranslationMode = "live" | "balanced" | "sentences";
export interface SessionRow {
  id: string;
  speaker_id: string;
  title: string | null;
  source_lang: string;
  started_at: string;
  ended_at: string | null;
  peak_listeners: number;
  is_private: boolean;
  translation_mode: TranslationMode;
  chars_translated: number;
  summary: string | null;
  allow_revisit: boolean;
}
/** A session in a listener's library, with the speaker's public info. */
export interface LibraryRow {
  id: string;
  title: string | null;
  source_lang: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  lang: string;
  username: string;
  display_name: string;
  segment_count: number;
}
export interface Segment {
  seq: number;
  original: string;
  translations: Record<string, string>;
  createdAt: string;
}

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  email: u.email,
  displayName: u.display_name,
  emailVerified: !!u.email_verified,
  hasPassword: !!u.password_hash,
  googleLinked: !!u.google_sub,
  createdAt: u.created_at,
});

/* --------------------------------- users --------------------------------- */
export const users = {
  byId: (id: string) => one<UserRow>("SELECT * FROM users WHERE id = $1", [id]),
  byUsername: (username: string) => one<UserRow>("SELECT * FROM users WHERE username = $1", [username]),
  byEmail: (email: string) => one<UserRow>("SELECT * FROM users WHERE email = $1", [email]),
  byLogin: (login: string) => one<UserRow>("SELECT * FROM users WHERE username = $1 OR email = $1", [login]),
  byGoogleSub: (sub: string) => one<UserRow>("SELECT * FROM users WHERE google_sub = $1", [sub]),
  async create(input: {
    username: string;
    email: string;
    displayName: string;
    passwordHash: string | null;
    googleSub?: string | null;
    emailVerified?: boolean;
  }) {
    return (await one<UserRow>(
      `INSERT INTO users (id, username, email, display_name, password_hash, google_sub, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [randomUUID(), input.username, input.email, input.displayName, input.passwordHash, input.googleSub ?? null, !!input.emailVerified],
    ))!;
  },
  updateDisplayName: (id: string, displayName: string) => run("UPDATE users SET display_name = $1 WHERE id = $2", [displayName, id]),
  setEmailVerified: (id: string) => run("UPDATE users SET email_verified = TRUE WHERE id = $1", [id]),
  setPassword: (id: string, hash: string) => run("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, id]),
  linkGoogle: (id: string, sub: string) => run("UPDATE users SET google_sub = $1 WHERE id = $2", [sub, id]),
  remove: (id: string) => run("DELETE FROM users WHERE id = $1", [id]),
};

/* ----------------------------- email codes ------------------------------ */
export interface CodeRow {
  user_id: string;
  purpose: string;
  code_hash: string;
  expires_at: number;
  sent_at: number;
  attempts: number;
}
export const codes = {
  put: (userId: string, purpose: string, hash: string, expiresAt: number, sentAt: number) =>
    run(
      `INSERT INTO email_codes (user_id, purpose, code_hash, expires_at, sent_at, attempts) VALUES ($1, $2, $3, $4, $5, 0)
       ON CONFLICT (user_id, purpose) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
         sent_at = excluded.sent_at, attempts = 0`,
      [userId, purpose, hash, expiresAt, sentAt],
    ),
  get: (userId: string, purpose: string) =>
    one<CodeRow>("SELECT * FROM email_codes WHERE user_id = $1 AND purpose = $2", [userId, purpose]),
  bump: (userId: string, purpose: string) =>
    run("UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = $1 AND purpose = $2", [userId, purpose]),
  remove: (userId: string, purpose: string) => run("DELETE FROM email_codes WHERE user_id = $1 AND purpose = $2", [userId, purpose]),
};

/* ------------------------- sessions & transcript ------------------------- */
interface SegmentDbRow {
  seq: number;
  original: string;
  translations: Record<string, string>;
  created_at: string;
}
const rowToSegment = (r: SegmentDbRow): Segment => ({
  seq: Number(r.seq),
  original: r.original,
  translations: r.translations ?? {},
  createdAt: r.created_at,
});
const SEGMENT_COUNT = "(SELECT COUNT(*) FROM segments g WHERE g.session_id = s.id) AS segment_count";

export const sessions = {
  async create(
    speakerId: string,
    sourceLang: string,
    title: string | null,
    opts: { isPrivate: boolean; mode: TranslationMode; allowRevisit: boolean },
  ) {
    return (await one<SessionRow>(
      `INSERT INTO sessions (id, speaker_id, title, source_lang, is_private, translation_mode, allow_revisit)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [randomUUID(), speakerId, title, sourceLang, opts.isPrivate, opts.mode, opts.allowRevisit],
    ))!;
  },
  end: (id: string, peakListeners: number, chars: number) =>
    run(
      `UPDATE sessions SET ended_at = now(), peak_listeners = GREATEST(peak_listeners, $1),
         chars_translated = chars_translated + $2 WHERE id = $3 AND ended_at IS NULL`,
      [peakListeners, chars, id],
    ),
  /** Called on boot: any session still "open" belongs to a previous process. */
  closeDangling: () => run("UPDATE sessions SET ended_at = now() WHERE ended_at IS NULL"),
  byId: (id: string) => one<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]),
  listForSpeaker: (speakerId: string, limit = 50, offset = 0) =>
    all<SessionRow & { segment_count: number }>(
      `SELECT s.*, ${SEGMENT_COUNT} FROM sessions s WHERE s.speaker_id = $1 ORDER BY s.started_at DESC LIMIT $2 OFFSET $3`,
      [speakerId, limit, offset],
    ),
  remove: async (id: string, speakerId: string) => (await run("DELETE FROM sessions WHERE id = $1 AND speaker_id = $2", [id, speakerId])) > 0,
  saveSummary: (id: string, summary: unknown) => run("UPDATE sessions SET summary = $1 WHERE id = $2", [JSON.stringify(summary), id]),
  addChars: (id: string, chars: number) => run("UPDATE sessions SET chars_translated = chars_translated + $1 WHERE id = $2", [chars, id]),
  saveSegment: (sessionId: string, seq: number, original: string, translations: Record<string, string>) =>
    run(
      `INSERT INTO segments (session_id, seq, original, translations) VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, seq) DO UPDATE SET original = excluded.original, translations = excluded.translations`,
      [sessionId, seq, original, JSON.stringify(translations)],
    ),
  addTranslation: (sessionId: string, seq: number, lang: string, text: string) =>
    run("UPDATE segments SET translations = jsonb_set(translations, ARRAY[$1::text], to_jsonb($2::text)) WHERE session_id = $3 AND seq = $4", [
      lang,
      text,
      sessionId,
      seq,
    ]),
  segments: async (sessionId: string) =>
    (await all<SegmentDbRow>("SELECT * FROM segments WHERE session_id = $1 ORDER BY seq ASC", [sessionId])).map(rowToSegment),
  recentSegments: async (sessionId: string, limit: number) =>
    (
      await all<SegmentDbRow>(
        "SELECT * FROM (SELECT * FROM segments WHERE session_id = $1 ORDER BY seq DESC LIMIT $2) recent ORDER BY seq ASC",
        [sessionId, limit],
      )
    ).map(rowToSegment),
  setAllowRevisit: async (id: string, speakerId: string, allow: boolean) =>
    (await run("UPDATE sessions SET allow_revisit = $1 WHERE id = $2 AND speaker_id = $3", [allow, id, speakerId])) > 0,
};

/* --------------------------- listener libraries --------------------------- */
// Only finished sessions whose speaker allows revisiting are visible to listeners.
const LIBRARY_SELECT = `
  SELECT s.id, s.title, s.source_lang, s.started_at, s.ended_at, s.summary, l.lang, u.username, u.display_name, ${SEGMENT_COUNT}
  FROM session_listeners l JOIN sessions s ON s.id = l.session_id JOIN users u ON u.id = s.speaker_id`;

export const library = {
  /** Remember that a signed-in listener attended a session (in the language they read). */
  add: (sessionId: string, userId: string, lang: string) =>
    run(
      `INSERT INTO session_listeners (session_id, user_id, lang) VALUES ($1, $2, $3)
       ON CONFLICT (session_id, user_id) DO UPDATE SET lang = excluded.lang`,
      [sessionId, userId, lang],
    ),
  remove: async (sessionId: string, userId: string) =>
    (await run("DELETE FROM session_listeners WHERE session_id = $1 AND user_id = $2", [sessionId, userId])) > 0,
  list: (userId: string, limit = 50, offset = 0) =>
    all<LibraryRow>(
      `${LIBRARY_SELECT} WHERE l.user_id = $1 AND s.allow_revisit AND s.ended_at IS NOT NULL ORDER BY s.started_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
  entry: (userId: string, sessionId: string) =>
    one<LibraryRow>(`${LIBRARY_SELECT} WHERE l.user_id = $1 AND s.id = $2 AND s.allow_revisit AND s.ended_at IS NOT NULL`, [userId, sessionId]),
};
