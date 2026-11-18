/**
 * Give or take away speaking (broadcast) access. Listening never needs it.
 *   npm run speaker -- list                     who can speak
 *   npm run speaker -- requests                 who has asked for access (from the app's request form)
 *   npm run speaker -- <email|username> on      allow an account to speak (and email them)
 *   npm run speaker -- <email|username> off     take speaking access away
 * Production: docker compose exec -T server node dist/scripts/speaker.js <same arguments>
 */
import { pool, users } from "../db.js";
import { grantSpeaking } from "../speaking.js";

const [who, action] = process.argv.slice(2);
const usage = "Usage: speaker list | speaker requests | speaker <email or username> on | off";

try {
  if (who === "list") {
    const rows = await users.speakers();
    console.log(rows.length ? `${rows.length} account(s) can speak:` : "No account can speak yet.");
    for (const u of rows) console.log(`  @${u.username}  ${u.email}  (${u.display_name})`);
  } else if (who === "requests") {
    const rows = await users.speakRequests();
    console.log(rows.length ? `${rows.length} pending request(s):` : "No pending requests.");
    for (const u of rows) {
      console.log(`\n  @${u.username}  ${u.email}  (${u.display_name}), asked ${u.speak_requested_at?.slice(0, 10)}`);
      if (u.speak_request_note) console.log(`    "${u.speak_request_note.replace(/\s+/g, " ")}"`);
    }
  } else if (who && (action === "on" || action === "off")) {
    const user = await users.byLogin(who.replace(/^@/, "").toLowerCase());
    if (!user) {
      console.error(`No account with the email or username "${who}".`);
      process.exitCode = 1;
    } else {
      if (action === "on" && !user.can_speak) await grantSpeaking(user);
      else await users.setCanSpeak(user.id, action === "on");
      console.log(`@${user.username} (${user.email}) ${action === "on" ? "can now speak" : "can no longer speak"}.`);
      if (action === "on" && !user.email_verified) console.log("Note: they must also verify their email before going live.");
    }
  } else {
    console.error(usage);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
