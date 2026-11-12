/**
 * Shared helpers for moving data in and out of PostgreSQL: the SQLite import, backups and restores.
 * A "Dump" is every table's rows, in an order that respects foreign keys.
 */
import type { PoolClient } from "pg";
import { pool } from "../db.js";

/** Tables in insertion order (parents before children). */
export const TABLES = ["users", "email_codes", "sessions", "segments", "session_listeners"] as const;
export type Table = (typeof TABLES)[number];
export type Row = Record<string, unknown>;
export type Dump = Record<Table, Row[]>;

/** Row counts per table, for comparing a source with what was written. */
export const countRows = (dump: Dump) => Object.fromEntries(TABLES.map((t) => [t, dump[t].length])) as Record<Table, number>;

export async function readAll(): Promise<Dump> {
  const dump = {} as Dump;
  for (const t of TABLES) dump[t] = (await pool.query(`SELECT * FROM ${t}`)).rows;
  return dump;
}

export async function tableCounts(): Promise<Record<Table, number>> {
  const counts = {} as Record<Table, number>;
  for (const t of TABLES) counts[t] = Number((await pool.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n);
  return counts;
}

/** True when the database has no users (nothing to overwrite). */
export async function isEmpty() {
  return (await tableCounts()).users === 0;
}

/** Insert a dump in one transaction: either everything is written or nothing is. */
export async function writeAll(dump: Dump) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of TABLES) {
      for (const row of dump[t]) await insertRow(client, t, row);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function insertRow(client: PoolClient, table: Table, row: Row) {
  const cols = Object.keys(row);
  const values = cols.map((c) => {
    const v = row[c];
    // JSON columns (segments.translations) are sent as JSON text.
    return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  await client.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`, values);
}
