/**
 * Show how many characters were sent to each translation provider, per month, against each one's limit.
 * Usage: npm run usage            (production: docker compose exec server node dist/scripts/usage.js)
 */
import { pool } from "../db.js";
import { providerChain } from "../translation/caps.js";
import { usageHistory, usageMonth } from "../translation/usage.js";

const rows = await usageHistory(6);
await pool.end();

const n = (v: number) => v.toLocaleString("en-US");
const chain = providerChain();
const month = usageMonth();

console.log(`\nTranslation usage (calendar months, UTC). Order: ${chain.map((p) => p.label).join(" → ")}\n`);
if (!rows.length) {
  console.log("No translations recorded yet.");
} else {
  console.log(`${"Month".padEnd(9)}${"Provider".padEnd(12)}${"Characters".padStart(13)}${"Requests".padStart(11)}`);
  for (const r of rows) {
    const cap = chain.find((p) => p.name === r.provider)?.allowance ?? 0;
    const pct = cap ? `  ${((r.chars / cap) * 100).toFixed(1)}% of ${n(cap)}` : "";
    console.log(`${r.month.padEnd(9)}${r.provider.padEnd(12)}${n(r.chars).padStart(13)}${n(r.calls).padStart(11)}${pct}`);
  }
}
console.log(`\nThis month:`);
for (const p of chain) {
  const used = rows.find((r) => r.month === month && r.provider === p.name)?.chars ?? 0;
  const limit = p.limit ? ` of ${n(p.limit)} (switches on after that)` : "";
  console.log(`  ${p.label.padEnd(24)} ${n(used)} used${limit}`);
}
console.log("");
