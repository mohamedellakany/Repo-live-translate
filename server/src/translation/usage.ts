import { config } from "../config.js";
import { pool } from "../db.js";

/*
 * Counts the characters sent to each translation provider per calendar month (UTC), so you can see how
 * much of a monthly allowance (e.g. Azure F0's 2,000,000) is used: `npm run usage`.
 * Counts are kept in memory and written to the database in small batches, and only while translations
 * are happening, so an idle server never wakes the database.
 */
const FLUSH_MS = 30_000;
const WARN_AT = [0.8, 1];

export const usageMonth = (d = new Date()) => d.toISOString().slice(0, 7);

const pending = new Map<string, { chars: number; calls: number }>();
const warned = new Set<string>();
let timer: NodeJS.Timeout | undefined;

function add(key: string, chars: number, calls: number) {
  const u = pending.get(key) ?? { chars: 0, calls: 0 };
  u.chars += chars;
  u.calls += calls;
  pending.set(key, u);
}

export function recordUsage(provider: string, chars: number) {
  add(`${usageMonth()}|${provider}`, chars, 1);
  timer ??= setTimeout(() => {
    timer = undefined;
    void flushUsage();
  }, FLUSH_MS).unref();
}

/** Write the counts gathered so far. Never throws; a failed write is kept and retried next time. */
export async function flushUsage() {
  const batch = [...pending];
  pending.clear();
  for (const [key, u] of batch) {
    const [month, provider] = key.split("|");
    try {
      const { rows } = await pool.query<{ chars: number }>(
        `INSERT INTO translation_usage (month, provider, chars, calls) VALUES ($1, $2, $3, $4)
         ON CONFLICT (month, provider) DO UPDATE
           SET chars = translation_usage.chars + EXCLUDED.chars, calls = translation_usage.calls + EXCLUDED.calls
         RETURNING chars`,
        [month, provider, u.chars, u.calls],
      );
      if (provider === config.TRANSLATION_PROVIDER) warnIfNearLimit(month, provider, rows[0].chars);
    } catch (err) {
      console.error("[usage] couldn't save translation usage, will retry:", (err as Error).message);
      add(key, u.chars, u.calls);
      timer ??= setTimeout(() => {
        timer = undefined;
        void flushUsage();
      }, FLUSH_MS).unref();
    }
  }
}

function warnIfNearLimit(month: string, provider: string, chars: number) {
  const limit = config.TRANSLATION_MONTHLY_LIMIT;
  if (!limit) return;
  for (const level of WARN_AT) {
    const key = `${month}|${level}`;
    if (chars >= limit * level && !warned.has(key)) {
      warned.add(key);
      console.warn(
        `⚠️  Translation usage: ${chars.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} characters ` +
          `(${Math.round((chars / limit) * 100)}%) used on ${provider} in ${month}.`,
      );
    }
  }
}

export type UsageRow = { month: string; provider: string; chars: number; calls: number };

/** Usage for the most recent `months` months, newest first. */
export async function usageHistory(months = 6): Promise<UsageRow[]> {
  const { rows } = await pool.query<UsageRow>(
    `SELECT month, provider, chars, calls FROM translation_usage
     WHERE month >= $1 ORDER BY month DESC, chars DESC`,
    [usageMonth(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - (months - 1), 1)))],
  );
  return rows;
}
