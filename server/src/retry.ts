/** Errors worth retrying: the AI provider is busy, rate-limiting, briefly down, or too slow. */
export function isTransientAiError(err: unknown): boolean {
  const e = err as { status?: number; name?: string; message?: string };
  if (e?.status && [408, 429, 500, 502, 503, 504].includes(e.status)) return true;
  if (e?.name === "TimeoutError" || e?.name === "InternalServerError" || e?.name === "RateLimitError") return true;
  return /\b(429|500|502|503|504)\b|high demand|overloaded|unavailable|rate limit|try again later/i.test(e?.message ?? "");
}

/** The model returned something that isn't a valid summary; another try (or model) usually fixes it. */
export class BadOutputError extends Error {}

export type Attempt = { model: string; delayMs?: number };

/**
 * Run `run(model)` for each attempt in turn until one succeeds. Moves on only for transient errors or bad
 * output; anything else (bad key, invalid request) fails immediately. Throws the last error if all fail.
 */
export async function withFallbacks<T>(
  attempts: Attempt[],
  run: (model: string) => Promise<T>,
  opts: { sleep?: (ms: number) => Promise<void>; log?: (msg: string) => void } = {},
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (const [i, a] of attempts.entries()) {
    if (a.delayMs) await sleep(a.delayMs);
    try {
      return await run(a.model);
    } catch (err) {
      last = err;
      if (!(err instanceof BadOutputError) && !isTransientAiError(err)) throw err;
      const nextAttempt = attempts[i + 1];
      if (nextAttempt) opts.log?.(`${a.model} failed (${(err as Error).message?.slice(0, 120)}); trying ${nextAttempt.model}`);
    }
  }
  throw last;
}
