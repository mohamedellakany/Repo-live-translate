/**
 * Consistent online backup of the SQLite database (safe while the server is running).
 * Usage: npm run backup   (schedule it daily with cron; see README > Deploy)
 */
import { backup, DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

mkdirSync(config.BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = join(config.BACKUP_DIR, `app-${stamp}.db`);

const source = new DatabaseSync(config.DATABASE_PATH, { readOnly: true });
await backup(source, dest);
source.close();
console.log(`Backup written: ${dest}`);

// Retention: keep the newest BACKUP_KEEP files.
const files = readdirSync(config.BACKUP_DIR).filter((f) => /^app-.*\.db$/.test(f)).sort();
for (const old of files.slice(0, Math.max(0, files.length - config.BACKUP_KEEP))) {
  rmSync(join(config.BACKUP_DIR, old));
  console.log(`Removed old backup: ${old}`);
}
