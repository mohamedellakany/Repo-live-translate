/**
 * Create a shared guest speaker account. It starts switched off: an admin presses Reset on the admin page, which
 * gives it a new password and GUEST_SESSION_HOURS of access, then it's signed out automatically.
 *   npm run guest -- create <username> "<Display name>" [email]
 * Production: docker compose exec -T server node dist/scripts/guest.js create <username> "<Display name>" [email]
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { pool, users } from "../db.js";

const [cmd, rawUsername, displayName, rawEmail] = process.argv.slice(2);
try {
  if (cmd !== "create" || !rawUsername || !displayName) {
    console.error('Usage: guest create <username> "<Display name>" [email]');
    process.exitCode = 1;
  } else {
    const username = rawUsername.replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error("Username must be 3-20 characters: letters, numbers or underscore");
    const email = (rawEmail ?? `${username}@${config.STAFF_EMAIL_DOMAIN}`).toLowerCase();
    if (await users.byUsername(username)) throw new Error(`@${username} already exists`);
    if (await users.byEmail(email)) throw new Error(`${email} is already used by another account`);
    // A random password nobody knows: the account only becomes usable when an admin presses Reset.
    const g = await users.createGuest({ username, email, displayName, passwordHash: await bcrypt.hash(randomBytes(24).toString("hex"), 10) });
    console.log(`Created guest @${g.username} (${g.display_name}). It's off until an admin presses Reset on the admin page.`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
