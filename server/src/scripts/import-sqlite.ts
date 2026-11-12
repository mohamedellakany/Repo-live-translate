/**
 * One-time move from the old SQLite database (DATABASE_PATH) into PostgreSQL (DATABASE_URL).
 * Usage: npm run import-sqlite            (refuses to run if PostgreSQL already has users)
 *
 * Everything is copied in one transaction, then row counts are compared to prove nothing was lost.
 * The SQLite file is only read, never changed, so it remains a complete fallback.
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { pool } from "../db.js";
import { countRows, isEmpty, tableCounts, TABLES, writeAll, type Dump, type Row } from "./data.js";

if (!existsSync(config.DATABASE_PATH)) {
  console.error(`SQLite database not found: ${config.DATABASE_PATH}`);
  process.exit(1);
}
if (!(await isEmpty())) {
  console.error("PostgreSQL already has users; refusing to import over existing data.");
  await pool.end();
  process.exit(1);
}

const sqlite = new DatabaseSync(config.DATABASE_PATH, { readOnly: true });
const hasTable = (t: string) => !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const rows = (t: string) => (hasTable(t) ? (sqlite.prepare(`SELECT * FROM ${t}`).all() as Row[]) : []);

/** SQLite stored UTC times as "YYYY-MM-DD HH:MM:SS"; PostgreSQL wants an unambiguous timestamp. */
const ts = (v: unknown) => (typeof v === "string" && v ? `${v.replace(" ", "T")}Z` : null);
const bool = (v: unknown) => Number(v) !== 0;

const dump: Dump = {
  users: rows("users").map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    display_name: u.display_name,
    password_hash: u.password_hash ?? null,
    google_sub: u.google_sub ?? null,
    email_verified: bool(u.email_verified),
    created_at: ts(u.created_at),
  })),
  email_codes: rows("email_codes").map((c) => ({
    user_id: c.user_id,
    purpose: c.purpose,
    code_hash: c.code_hash,
    expires_at: Number(c.expires_at),
    sent_at: Number(c.sent_at),
    attempts: Number(c.attempts),
  })),
  sessions: rows("sessions").map((s) => ({
    id: s.id,
    speaker_id: s.speaker_id,
    title: s.title ?? null,
    source_lang: s.source_lang,
    started_at: ts(s.started_at),
    ended_at: ts(s.ended_at),
    peak_listeners: Number(s.peak_listeners ?? 0),
    is_private: bool(s.is_private ?? 0),
    translation_mode: s.translation_mode ?? "live",
    chars_translated: Number(s.chars_translated ?? 0),
    summary: s.summary ?? null,
    allow_revisit: s.allow_revisit === undefined ? !bool(s.is_private ?? 0) : bool(s.allow_revisit),
  })),
  segments: rows("segments").map((g) => ({
    session_id: g.session_id,
    seq: Number(g.seq),
    original: g.original,
    translations: JSON.parse(String(g.translations ?? "{}")),
    created_at: ts(g.created_at),
  })),
  session_listeners: rows("session_listeners").map((l) => ({
    session_id: l.session_id,
    user_id: l.user_id,
    lang: l.lang,
    joined_at: ts(l.joined_at),
  })),
};
sqlite.close();

const source = countRows(dump);
console.log("SQLite rows:     ", source);
await writeAll(dump);
const written = await tableCounts();
console.log("PostgreSQL rows: ", written);
await pool.end();

const mismatched = TABLES.filter((t) => source[t] !== written[t]);
if (mismatched.length) {
  console.error(`Row counts differ for: ${mismatched.join(", ")}`);
  process.exit(1);
}
console.log("Import complete: every row was copied.");
