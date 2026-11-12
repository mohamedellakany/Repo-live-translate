import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { codes } from "./db.js";

export type CodePurpose = "verify_email" | "reset_password";

const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

const hash = (userId: string, purpose: string, code: string) =>
  createHmac("sha256", config.JWT_SECRET).update(`${userId}:${purpose}:${code}`).digest("hex");

/** Create a fresh 6-digit code. Returns `retryAfterSec` instead if one was sent very recently. */
export async function issueCode(userId: string, purpose: CodePurpose): Promise<{ code: string } | { retryAfterSec: number }> {
  const existing = await codes.get(userId, purpose);
  const now = Date.now();
  if (existing && now - existing.sent_at < RESEND_COOLDOWN_MS) {
    return { retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - (now - existing.sent_at)) / 1000) };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await codes.put(userId, purpose, hash(userId, purpose, code), now + CODE_TTL_MS, now);
  return { code };
}

export type VerifyResult = "ok" | "invalid" | "expired" | "too_many_attempts";

export async function verifyCode(userId: string, purpose: CodePurpose, code: string): Promise<VerifyResult> {
  const row = await codes.get(userId, purpose);
  if (!row) return "expired";
  if (row.expires_at < Date.now()) {
    await codes.remove(userId, purpose);
    return "expired";
  }
  if (row.attempts >= MAX_ATTEMPTS) return "too_many_attempts";
  const expected = Buffer.from(row.code_hash, "hex");
  const actual = Buffer.from(hash(userId, purpose, code.trim()), "hex");
  if (!timingSafeEqual(expected, actual)) {
    await codes.bump(userId, purpose);
    return "invalid";
  }
  await codes.remove(userId, purpose);
  return "ok";
}

export const CODE_ERRORS: Record<Exclude<VerifyResult, "ok">, string> = {
  invalid: "That code isn't correct",
  expired: "This code has expired. Request a new one",
  too_many_attempts: "Too many wrong attempts. Request a new code",
};
