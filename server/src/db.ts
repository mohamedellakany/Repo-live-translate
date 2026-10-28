import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });

export const db = new DatabaseSync(config.DATABASE_PATH);
db.exec("PRAGMA journal_mode = WAL;");

/* ------------------------------ migrations ------------------------------- */
// Each entry runs once, in order; PRAGMA user_version records progress.
const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    speaker_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT,
    source_lang TEXT NOT NULL,
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at    TEXT,
    peak_listeners INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_speaker ON sessions(speaker_id, started_at DESC);
  CREATE TABLE IF NOT EXISTS segments (
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    original     TEXT NOT NULL,
    translations TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, seq)
  );
  `,
  // 2: Google accounts, email verification, codes, private sessions, usage, summaries
  `
  CREATE TABLE users_new (
    id             TEXT PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name   TEXT NOT NULL,
    password_hash  TEXT,
    google_sub     TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Accounts created before verification existed are treated as verified.
  INSERT INTO users_new (id, username, email, display_name, password_hash, email_verified, created_at)
    SELECT id, username, email, display_name, password_hash, 1, created_at FROM users;
  DROP TABLE users;
  ALTER TABLE users_new RENAME TO users;

  CREATE TABLE email_codes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    sent_at    INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, purpose)
  );

  ALTER TABLE sessions ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN translation_mode TEXT NOT NULL DEFAULT 'live';
  ALTER TABLE sessions ADD COLUMN chars_translated INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN summary TEXT;
  `,
];

function migrate() {
  const current = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (current >= MIGRATIONS.length) return;
  // Table rebuilds must not cascade-delete child rows.
  db.exec("PRAGMA foreign_keys = OFF;");
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  db.exec("PRAGMA foreign_keys = ON;");
}
migrate();
db.exec("PRAGMA foreign_keys = ON;");

/* --------------------------------- types --------------------------------- */
export interface UserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  google_sub: string | null;
  email_verified: number;
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
  is_private: number;
  translation_mode: TranslationMode;
  chars_translated: number;
  summary: string | null;
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
const q = {
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  userByUsername: db.prepare("SELECT * FROM users WHERE username = ?"),
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userByLogin: db.prepare("SELECT * FROM users WHERE username = ? OR email = ?"),
  userByGoogle: db.prepare("SELECT * FROM users WHERE google_sub = ?"),
  insertUser: db.prepare(
    `INSERT INTO users (id, username, email, display_name, password_hash, google_sub, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  updateDisplayName: db.prepare("UPDATE users SET display_name = ? WHERE id = ?"),
  setVerified: db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?"),
  setPassword: db.prepare("UPDATE users SET password_hash = ? WHERE id = ?"),
  linkGoogle: db.prepare("UPDATE users SET google_sub = ? WHERE id = ?"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),

  insertSession: db.prepare(
    "INSERT INTO sessions (id, speaker_id, title, source_lang, is_private, translation_mode) VALUES (?, ?, ?, ?, ?, ?)",
  ),
  endSession: db.prepare(
    `UPDATE sessions SET ended_at = datetime('now'), peak_listeners = MAX(peak_listeners, ?),
       chars_translated = chars_translated + ? WHERE id = ? AND ended_at IS NULL`,
  ),
  closeDangling: db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE ended_at IS NULL"),
  sessionsForSpeaker: db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM segments g WHERE g.session_id = s.id) AS segment_count
    FROM sessions s WHERE s.speaker_id = ? ORDER BY s.started_at DESC LIMIT ? OFFSET ?`),
  sessionById: db.prepare("SELECT * FROM sessions WHERE id = ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE id = ? AND speaker_id = ?"),
  saveSummary: db.prepare("UPDATE sessions SET summary = ? WHERE id = ?"),
  addChars: db.prepare("UPDATE sessions SET chars_translated = chars_translated + ? WHERE id = ?"),
  upsertSegment: db.prepare(`
    INSERT INTO segments (session_id, seq, original, translations) VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, seq) DO UPDATE SET original = excluded.original, translations = excluded.translations`),
  addTranslation: db.prepare(
    "UPDATE segments SET translations = json_set(translations, '$.' || ?, ?) WHERE session_id = ? AND seq = ?",
  ),
  segmentsForSession: db.prepare("SELECT * FROM segments WHERE session_id = ? ORDER BY seq ASC"),
  recentSegments: db.prepare(
    "SELECT * FROM (SELECT * FROM segments WHERE session_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC",
  ),

  upsertCode: db.prepare(`
    INSERT INTO email_codes (user_id, purpose, code_hash, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, purpose) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
      sent_at = excluded.sent_at, attempts = 0`),
  getCode: db.prepare("SELECT * FROM email_codes WHERE user_id = ? AND purpose = ?"),
  bumpCodeAttempts: db.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = ? AND purpose = ?"),
  deleteCode: db.prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose = ?"),
};

export const users = {
  byId: (id: string) => q.userById.get(id) as UserRow | undefined,
  byUsername: (username: string) => q.userByUsername.get(username) as UserRow | undefined,
  byEmail: (email: string) => q.userByEmail.get(email) as UserRow | undefined,
  byLogin: (login: string) => q.userByLogin.get(login, login) as UserRow | undefined,
  byGoogleSub: (sub: string) => q.userByGoogle.get(sub) as UserRow | undefined,
  create(input: {
    username: string;
    email: string;
    displayName: string;
    passwordHash: string | null;
    googleSub?: string | null;
    emailVerified?: boolean;
  }) {
    const id = randomUUID();
    q.insertUser.run(
      id,
      input.username,
      input.email,
      input.displayName,
      input.passwordHash,
      input.googleSub ?? null,
      input.emailVerified ? 1 : 0,
    );
    return users.byId(id)!;
  },
  updateDisplayName: (id: string, displayName: string) => q.updateDisplayName.run(displayName, id),
  setEmailVerified: (id: string) => q.setVerified.run(id),
  setPassword: (id: string, hash: string) => q.setPassword.run(hash, id),
  linkGoogle: (id: string, sub: string) => q.linkGoogle.run(sub, id),
  remove: (id: string) => q.deleteUser.run(id),
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
    q.upsertCode.run(userId, purpose, hash, expiresAt, sentAt),
  get: (userId: string, purpose: string) => q.getCode.get(userId, purpose) as CodeRow | undefined,
  bump: (userId: string, purpose: string) => q.bumpCodeAttempts.run(userId, purpose),
  remove: (userId: string, purpose: string) => q.deleteCode.run(userId, purpose),
};

/* ------------------------- sessions & transcript ------------------------- */
const rowToSegment = (r: any): Segment => ({
  seq: Number(r.seq),
  original: r.original,
  translations: JSON.parse(r.translations),
  createdAt: r.created_at,
});

export const sessions = {
  create(speakerId: string, sourceLang: string, title: string | null, opts: { isPrivate: boolean; mode: TranslationMode }) {
    const id = randomUUID();
    q.insertSession.run(id, speakerId, title, sourceLang, opts.isPrivate ? 1 : 0, opts.mode);
    return q.sessionById.get(id) as unknown as SessionRow;
  },
  end: (id: string, peakListeners: number, chars: number) => q.endSession.run(peakListeners, chars, id),
  /** Called on boot: any session still "open" belongs to a previous process. */
  closeDangling: () => q.closeDangling.run(),
  byId: (id: string) => q.sessionById.get(id) as unknown as SessionRow | undefined,
  listForSpeaker: (speakerId: string, limit = 50, offset = 0) =>
    q.sessionsForSpeaker.all(speakerId, limit, offset) as unknown as (SessionRow & { segment_count: number })[],
  remove: (id: string, speakerId: string) => q.deleteSession.run(id, speakerId).changes > 0,
  saveSummary: (id: string, summary: unknown) => q.saveSummary.run(JSON.stringify(summary), id),
  addChars: (id: string, chars: number) => q.addChars.run(chars, id),
  saveSegment: (sessionId: string, seq: number, original: string, translations: Record<string, string>) =>
    q.upsertSegment.run(sessionId, seq, original, JSON.stringify(translations)),
  addTranslation: (sessionId: string, seq: number, lang: string, text: string) =>
    q.addTranslation.run(lang, text, sessionId, seq),
  segments: (sessionId: string) => q.segmentsForSession.all(sessionId).map(rowToSegment),
  recentSegments: (sessionId: string, limit: number) => q.recentSegments.all(sessionId, limit).map(rowToSegment),
};
