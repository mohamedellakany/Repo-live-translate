/**
 * Backup of the PostgreSQL database: every table exported to a compressed JSON file in BACKUP_DIR.
 * It doesn't depend on a particular PostgreSQL version. Restore with: npm run restore-backup <file>
 * Usage: npm run backup   (Neon also keeps its own restore history; this is an extra, independent copy)
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { config } from "../config.js";
import { pool } from "../db.js";
import { countRows, readAll } from "./data.js";

mkdirSync(config.BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = join(config.BACKUP_DIR, `app-${stamp}.json.gz`);

const dump = await readAll();
await pool.end();
writeFileSync(dest, gzipSync(JSON.stringify({ format: "lisanova-backup", version: 1, createdAt: new Date().toISOString(), tables: dump })));
console.log(`Backup written: ${dest}`, countRows(dump));

// Retention: keep the newest BACKUP_KEEP files.
const files = readdirSync(config.BACKUP_DIR).filter((f) => /^app-.*\.json\.gz$/.test(f)).sort();
for (const old of files.slice(0, Math.max(0, files.length - config.BACKUP_KEEP))) {
  rmSync(join(config.BACKUP_DIR, old));
  console.log(`Removed old backup: ${old}`);
}
