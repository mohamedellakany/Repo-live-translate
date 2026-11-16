/**
 * Restore a backup made by `npm run backup` into an EMPTY PostgreSQL database (DATABASE_URL).
 * Usage: npm run restore-backup <path/to/app-….json.gz>
 * Refuses to run if the database already has users, so it can never overwrite live data.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pool } from "../db.js";
import { countRows, isEmpty, tableCounts, TABLES, writeAll, type Dump } from "./data.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run restore-backup <path/to/app-….json.gz>");
  process.exit(1);
}
const backup = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as { format?: string; tables: Dump };
// Backups made before the rename say "lisanova-backup"; both are the same format.
if (backup.format !== "lisancast-backup" && backup.format !== "lisanova-backup") {
  console.error("This file isn't a LisanCast backup.");
  process.exit(1);
}
if (!(await isEmpty())) {
  console.error("The database already has users; restore only into an empty database (e.g. a new Neon branch).");
  await pool.end();
  process.exit(1);
}

const source = countRows(backup.tables);
await writeAll(backup.tables);
const written = await tableCounts();
await pool.end();
console.log("Backup rows:   ", source);
console.log("Restored rows: ", written);
if (TABLES.some((t) => source[t] !== written[t])) {
  console.error("Row counts differ; check the output above.");
  process.exit(1);
}
console.log("Restore complete.");
