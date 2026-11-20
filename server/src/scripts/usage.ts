/**
 * Show how many characters were sent to the translation provider(s), per month.
 * Usage: npm run usage            (production: docker compose exec server node dist/scripts/usage.js)
 */
import { config } from "../config.js";
import { pool } from "../db.js";
import { usageHistory, usageMonth } from "../translation/usage.js";

const rows = await usageHistory(6);
await pool.end();

const n = (v: number) => v.toLocaleString("en-US");
const limit = config.TRANSLATION_MONTHLY_LIMIT;
const main = config.TRANSLATION_PROVIDER;
const current = rows.find((r) => r.month === usageMonth() && r.provider === main)?.chars ?? 0;

console.log(`\nTranslation usage (calendar months, UTC). Current provider: ${main}\n`);
if (!rows.length) {
  console.log("No translations recorded yet.");
} else {
  console.log(`${"Month".padEnd(9)}${"Provider".padEnd(10)}${"Characters".padStart(13)}${"Requests".padStart(11)}`);
  for (const r of rows) {
    const cap = r.provider === main ? limit : r.provider === config.TRANSLATION_FALLBACK_PROVIDER ? config.TRANSLATION_FALLBACK_LIMIT : 0;
    const pct = cap ? `  ${((r.chars / cap) * 100).toFixed(1)}% of ${n(cap)}` : "";
    console.log(`${r.month.padEnd(9)}${r.provider.padEnd(10)}${n(r.chars).padStart(13)}${n(r.calls).padStart(11)}${pct}`);
  }
}
if (limit) {
  console.log(`\nThis month on ${main}: ${n(current)} of ${n(limit)} characters used, ${n(Math.max(0, limit - current))} left.`);
}
const fb = config.TRANSLATION_FALLBACK_PROVIDER;
if (fb && fb !== main) {
  const used = rows.find((r) => r.month === usageMonth() && r.provider === fb)?.chars ?? 0;
  const cap = config.TRANSLATION_FALLBACK_LIMIT;
  console.log(`Fallback ${fb}: takes over at ${n(config.TRANSLATION_SWITCH_AT)} on ${main}; ${n(used)} used this month${cap ? ` of ${n(cap)}` : ""}.`);
}
console.log("");
