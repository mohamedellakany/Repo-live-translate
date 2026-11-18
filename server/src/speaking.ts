import { users, type UserRow } from "./db.js";
import { sendSpeakingApprovedEmail } from "./mailer.js";

/** Turn on speaking access and tell the user by email. Email failures are logged, not fatal. */
export async function grantSpeaking(user: UserRow) {
  await users.setCanSpeak(user.id, true);
  await sendSpeakingApprovedEmail(user.email, user.display_name).catch((err) => console.error("[mail] approval email failed", err));
}
