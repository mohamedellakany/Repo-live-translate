import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { io as connect, type Socket } from "socket.io-client";

process.env.NODE_ENV = "test";
process.env.TRANSLATION_PROVIDER = "mock";
process.env.ADMIN_EMAIL = "owner@x.com";
// Only some listening languages switched on (the tests also use French); Urdu is switched off.
process.env.LISTEN_LANGUAGES = "en,fr";
// Most tests exercise "Live" (word-by-word) translation, so it is switched on here; see the test that switches it off.
process.env.LIVE_MODE_ENABLED = "true";
process.env.ADMIN_USERNAMES = "boss";
// The suite signs up many accounts from one address; the live default (30 per 15 minutes) would block it.
process.env.AUTH_RATE_LIMIT = "1000";
// A throwaway PostgreSQL database, wiped before every run. Never point this at real data.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://localhost:54329/lisancast_test";
{
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await admin.end();
}

const { createServer } = await import("node:http");
const { Server } = await import("socket.io");
const { createApp } = await import("../src/app.js");
const { attachRealtime } = await import("../src/realtime.js");
const { devOutbox, devMessages } = await import("../src/mailer.js");
const { signSignupToken } = await import("../src/auth.js");

let base = "";
const httpServer = createServer(createApp());
const io = new Server(httpServer);
const sockets: Socket[] = [];

before(async () => {
  attachRealtime(io);
  await new Promise<void>((r) => httpServer.listen(0, r));
  base = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});
after(async () => {
  sockets.forEach((s) => s.disconnect());
  io.close();
  httpServer.close();
  await (await import("../src/db.js")).pool.end();
});

/* -------------------------------- helpers -------------------------------- */
const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as any) };
};
const post = (path: string, body: unknown, token?: string) => call("POST", path, body, token);
const lastCode = (email: string, purpose: string) => devOutbox.filter((m) => m.to === email && m.purpose === purpose).at(-1)?.code;

const open = (token?: string) => {
  const s = connect(base, { auth: token ? { token } : {}, transports: ["websocket"] });
  sockets.push(s);
  return s;
};
const emitAck = (s: Socket, ev: string, data: unknown) => new Promise<any>((r) => s.emit(ev, data, r));
const next = (s: Socket, ev: string, pred: (d: any) => boolean = () => true) =>
  new Promise<any>((resolve) => {
    const h = (d: any) => pred(d) && (s.off(ev, h), resolve(d));
    s.on(ev, h);
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Register + verify a speaker, returning their token. */
async function verifiedSpeaker(username: string) {
  const email = `${username}@x.com`;
  const reg = await post("/api/auth/register", { username, email, displayName: username, password: "password123" });
  assert.equal(reg.status, 201);
  const v = await post("/api/auth/verify-email", { code: lastCode(email, "verify_email") }, reg.body.token);
  assert.equal(v.body.user.emailVerified, true);
  await allowSpeaking(reg.body.user.id);
  return reg.body.token as string;
}

/** What `npm run speaker -- <email> on` does. */
async function allowSpeaking(userId: string) {
  const { users } = await import("../src/db.js");
  await users.setCanSpeak(userId, true);
}

/* --------------------------------- tests --------------------------------- */
test("registration validation, duplicates and login", async () => {
  assert.equal((await post("/api/auth/register", { username: "a", email: "x", displayName: "", password: "1" })).status, 400);
  const ok = await post("/api/auth/register", { username: "Ahmed_1", email: "a@x.com", displayName: "Ahmed", password: "password123" });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.username, "ahmed_1");
  assert.equal(ok.body.user.emailVerified, false);
  assert.equal((await post("/api/auth/register", { username: "ahmed_1", email: "b@x.com", displayName: "A", password: "password123" })).status, 409);
  assert.equal((await post("/api/auth/login", { login: "a@x.com", password: "wrong-pass" })).status, 401);
  assert.equal((await post("/api/auth/login", { login: "@AHMED_1", password: "password123" })).status, 200);
});

test("reserved usernames (admin, support…) only with an email on the app's own domain", async () => {
  const outsider = await post("/api/auth/register", { username: "admin", email: "someone@gmail.com", displayName: "X", password: "password123" });
  assert.equal(outsider.status, 400);
  assert.equal(outsider.body.error, "This username is reserved");
  const staff = await post("/api/auth/register", { username: "Admin", email: "admin@lisancast.com", displayName: "LisanCast", password: "password123" });
  assert.equal(staff.status, 201);
  assert.equal(staff.body.user.username, "admin");
  // Google sign-up follows the same rule.
  const g = signSignupToken({ sub: "g-support", email: "someone@outlook.com", emailVerified: true, name: "S" });
  assert.equal((await post("/api/auth/google/complete", { signupToken: g, username: "support", displayName: "S" })).status, 400);
});

test("email OTP verification is required before going live", async () => {
  const reg = await post("/api/auth/register", { username: "otpuser", email: "otp@x.com", displayName: "O", password: "password123" });
  const token = reg.body.token;
  const s = open(token);
  assert.equal((await emitAck(s, "speaker:start", { sourceLang: "ar" })).error, "email_unverified");

  const code = lastCode("otp@x.com", "verify_email")!;
  assert.match(code, /^\d{6}$/);
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal((await post("/api/auth/verify-email", { code: wrong }, token)).status, 400);
  assert.equal((await post("/api/auth/verify-email/send", {}, token)).status, 429); // resend cooldown
  assert.equal((await post("/api/auth/verify-email", { code }, token)).body.user.emailVerified, true);

  // Verified, but speaking is by approval: new accounts can listen, not broadcast.
  assert.equal(reg.body.user.canSpeak, false);
  assert.equal((await emitAck(s, "speaker:start", { sourceLang: "ar" })).error, "speaking_not_allowed");
  await allowSpeaking(reg.body.user.id);
  assert.equal((await call("GET", "/api/auth/me", undefined, token)).body.user.canSpeak, true);
  assert.equal((await emitAck(s, "speaker:start", { sourceLang: "ar" })).ok, true); // same socket, no reconnect needed
  await emitAck(s, "speaker:stop", {});
});

test("Google sign-up completes with a speaker ID and still needs OTP", async () => {
  assert.equal((await post("/api/auth/google", { idToken: "x".repeat(20) })).status, 401); // not configured / invalid
  const signupToken = signSignupToken({ sub: "g-123", email: "g@gmail.com", emailVerified: true, name: "Gee" });
  const done = await post("/api/auth/google/complete", { signupToken, username: "gee", displayName: "Gee" });
  assert.equal(done.status, 201);
  assert.equal(done.body.user.googleLinked, true);
  assert.equal(done.body.user.hasPassword, false);
  assert.equal(done.body.user.emailVerified, false);
  assert.ok(lastCode("g@gmail.com", "verify_email"));
  // Signup tokens are not session tokens.
  assert.equal((await call("GET", "/api/auth/me", undefined, signupToken)).status, 401);
  // Google-only accounts can't password-login.
  assert.equal((await post("/api/auth/login", { login: "gee", password: "whatever1" })).status, 400);
});

test("password reset by emailed code", async () => {
  await post("/api/auth/register", { username: "forgetful", email: "f@x.com", displayName: "F", password: "password123" });
  assert.equal((await post("/api/auth/password/forgot", { email: "nobody@x.com" })).status, 200); // no account probing
  assert.equal((await post("/api/auth/password/forgot", { email: "f@x.com" })).status, 200);
  const code = lastCode("f@x.com", "reset_password")!;
  assert.equal((await post("/api/auth/password/reset", { email: "f@x.com", code: "999999" === code ? "888888" : "999999", password: "newpassword1" })).status, 400);
  const reset = await post("/api/auth/password/reset", { email: "f@x.com", code, password: "newpassword1" });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.user.emailVerified, true);
  assert.equal((await post("/api/auth/login", { login: "forgetful", password: "newpassword1" })).status, 200);
});

test("account deletion is confirmed by typing the username, and removes everything", async () => {
  const token = await verifiedSpeaker("leaver");
  const s = open(token);
  await emitAck(s, "speaker:start", { sourceLang: "ar" });
  assert.equal((await call("DELETE", "/api/auth/me", { confirmUsername: "someone-else" }, token)).status, 400);
  assert.equal((await call("DELETE", "/api/auth/me", { password: "nope" }, token)).status, 400);
  assert.equal((await call("DELETE", "/api/auth/me", { confirmUsername: "@Leaver" }, token)).status, 204);
  assert.equal((await call("GET", "/api/speakers/leaver")).status, 404);
  assert.equal((await post("/api/auth/login", { login: "leaver", password: "password123" })).status, 401);
});

test("live captions, late-join history, language backfill and usage metering", async () => {
  const token = await verifiedSpeaker("speaker");
  const speaker = open(token);
  assert.equal((await emitAck(open(), "speaker:start", { sourceLang: "ar" })).ok, false); // guests can't broadcast
  assert.equal((await emitAck(speaker, "speaker:start", { sourceLang: "ar", title: "Weekly sync" })).ok, true);

  const listener = open();
  assert.equal((await emitAck(listener, "listener:join", { username: "nobody", lang: "en" })).error, "not_found");
  const joined = await emitAck(listener, "listener:join", { username: "@Speaker", lang: "en" });
  assert.equal(joined.ok, true);
  assert.equal(joined.status.live, true);
  assert.equal(joined.status.private, false);

  const partialSrc = next(listener, "caption:source", (d) => !d.isFinal);
  const partialTr = next(listener, "caption:translation", (d) => !d.isFinal);
  speaker.emit("speaker:partial", { seq: 0, text: "مرحبا" });
  assert.deepEqual(await partialSrc, { seq: 0, text: "مرحبا", isFinal: false });
  assert.equal((await partialTr).text, "[en] مرحبا");

  const finalTr = next(listener, "caption:translation", (d) => d.isFinal);
  speaker.emit("speaker:final", { seq: 0, text: "مرحبا بالجميع" });
  assert.deepEqual(await finalTr, { seq: 0, lang: "en", text: "[en] مرحبا بالجميع", isFinal: true });
  await sleep(50);

  // A French reader joining late gets the history translated into French on demand.
  const fr = open();
  const backfill = next(fr, "caption:translation", (d) => d.lang === "fr");
  const frJoin = await emitAck(fr, "listener:join", { username: "speaker", lang: "fr" });
  assert.equal(frJoin.history.length, 1);
  assert.equal(frJoin.history[0].translation, null);
  assert.equal((await backfill).text, "[fr] مرحبا بالجميع");

  const ended = next(listener, "speaker:status", (d) => !d.live);
  await emitAck(speaker, "speaker:stop", {});
  await ended;

  const list = await call("GET", "/api/sessions", undefined, token);
  const sess = list.body.sessions[0];
  assert.equal(sess.title, "Weekly sync");
  assert.equal(sess.segmentCount, 1);
  assert.equal(sess.peakListeners, 2);
  assert.ok(sess.charsTranslated > 0, "characters sent to the provider are counted");
  const detail = await call("GET", `/api/sessions/${sess.id}`, undefined, token);
  assert.deepEqual(Object.keys(detail.body.segments[0].translations).sort(), ["en", "fr"]);
  assert.equal((await post(`/api/sessions/${sess.id}/summary`, {}, token)).status, 503); // no Claude key in tests
});

test("private sessions require the PIN and evict waiting listeners", async () => {
  const token = await verifiedSpeaker("boardroom");
  const waiting = open();
  assert.equal((await emitAck(waiting, "listener:join", { username: "boardroom", lang: "en" })).ok, true); // offline: allowed to wait
  const evicted = next(waiting, "listener:pin_required");

  const speaker = open(token);
  assert.equal((await emitAck(speaker, "speaker:start", { sourceLang: "ar", pin: "4821" })).ok, true);
  await evicted;
  assert.equal((await call("GET", "/api/speakers/boardroom")).body.private, true);

  const guest = open();
  assert.equal((await emitAck(guest, "listener:join", { username: "boardroom", lang: "en" })).error, "pin_required");
  assert.equal((await emitAck(guest, "listener:join", { username: "boardroom", lang: "en", pin: "0000" })).error, "invalid_pin");
  const ok = await emitAck(guest, "listener:join", { username: "boardroom", lang: "en", pin: "4821" });
  assert.equal(ok.ok, true);
  assert.equal(ok.status.private, true);

  // Evicted listener doesn't receive captions; the authorized one does.
  let leaked = false;
  waiting.on("caption:source", () => (leaked = true));
  const got = next(guest, "caption:source");
  speaker.emit("speaker:final", { seq: 0, text: "سري" });
  await got;
  await sleep(50);
  assert.equal(leaked, false);
  await emitAck(speaker, "speaker:stop", {});
});

test("listener libraries: attended sessions can be reopened if the speaker allows it", async () => {
  const speakerToken = await verifiedSpeaker("lecturer");
  const readerToken = await verifiedSpeaker("reader1");
  const guestToken = await verifiedSpeaker("reader2");
  const get = (path: string, token: string) => call("GET", path, undefined, token);

  // A signed-in reader waits before the talk starts and is recorded when it begins.
  const reader = open(readerToken);
  assert.equal((await emitAck(reader, "listener:join", { username: "lecturer", lang: "fr" })).ok, true);
  const speaker = open(speakerToken);
  const live = next(reader, "speaker:status", (d) => d.live);
  const started = await emitAck(speaker, "speaker:start", { sourceLang: "ar", title: "Lecture 1" });
  assert.equal((await live).revisit, true);
  const fin = next(reader, "caption:translation", (d) => d.isFinal);
  speaker.emit("speaker:final", { seq: 0, text: "درس اليوم" });
  await fin;
  await sleep(50);
  assert.equal((await get("/api/library", readerToken)).body.sessions.length, 0, "live sessions aren't listed yet");
  await emitAck(speaker, "speaker:stop", {});

  const list = (await get("/api/library", readerToken)).body.sessions;
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Lecture 1");
  assert.equal(list[0].lang, "fr");
  assert.deepEqual(list[0].speaker, { username: "lecturer", displayName: "lecturer" });
  assert.equal(list[0].reviewStatus, "reviewing");
  // Readers see the transcript once the speaker has reviewed and published it.
  assert.equal((await post(`/api/sessions/${started.sessionId}/publish`, {}, speakerToken)).status, 200);
  const detail = await get(`/api/library/${started.sessionId}`, readerToken);
  assert.equal(detail.body.segments[0].translation, "[fr] درس اليوم");
  assert.equal((await get("/api/library", speakerToken)).body.sessions.length, 0, "speakers don't collect their own sessions");

  // A guest listener who signs up afterwards can claim the session; other users can't see it otherwise.
  assert.equal((await get(`/api/library/${started.sessionId}`, guestToken)).status, 404);
  assert.equal((await post("/api/library", { sessionId: "nope" }, guestToken)).status, 404);
  assert.equal((await post("/api/library", { sessionId: started.sessionId, lang: "en" }, guestToken)).status, 204);
  assert.equal((await get(`/api/library/${started.sessionId}`, guestToken)).body.segments[0].translation, "[en] درس اليوم");
  assert.equal((await call("DELETE", `/api/library/${started.sessionId}`, undefined, guestToken)).status, 204);
  assert.equal((await get("/api/library", guestToken)).body.sessions.length, 0);

  // The speaker can turn revisiting off and on again.
  const off = await call("PATCH", `/api/sessions/${started.sessionId}`, { allowRevisit: false }, speakerToken);
  assert.equal(off.body.session.allowRevisit, false);
  assert.equal((await get(`/api/library/${started.sessionId}`, readerToken)).status, 404);
  assert.equal((await call("PATCH", `/api/sessions/${started.sessionId}`, { allowRevisit: false }, readerToken)).status, 404);
  await call("PATCH", `/api/sessions/${started.sessionId}`, { allowRevisit: true }, speakerToken);
  assert.equal((await get("/api/library", readerToken)).body.sessions.length, 1);

  // Private sessions aren't revisitable unless the speaker opts in.
  const priv = await emitAck(speaker, "speaker:start", { sourceLang: "ar", pin: "1234" });
  assert.equal((await emitAck(reader, "listener:join", { username: "lecturer", lang: "fr", pin: "1234" })).ok, true);
  await emitAck(speaker, "speaker:stop", {});
  assert.equal((await get(`/api/library/${priv.sessionId}`, readerToken)).status, 404);
  await call("PATCH", `/api/sessions/${priv.sessionId}`, { allowRevisit: true }, speakerToken);
  assert.equal((await get(`/api/library/${priv.sessionId}`, readerToken)).status, 200);

  // When the speaker deletes a session, it disappears from listeners' libraries too.
  assert.equal((await call("DELETE", `/api/sessions/${started.sessionId}`, undefined, speakerToken)).status, 204);
  assert.equal((await get(`/api/library/${started.sessionId}`, readerToken)).status, 404);
});

test("'sentences' mode skips interim translations", async () => {
  const token = await verifiedSpeaker("thrifty");
  const speaker = open(token);
  await emitAck(speaker, "speaker:start", { sourceLang: "ar", translationMode: "sentences" });
  const listener = open();
  await emitAck(listener, "listener:join", { username: "thrifty", lang: "en" });
  const translations: any[] = [];
  listener.on("caption:translation", (d) => translations.push(d));
  const src = next(listener, "caption:source");
  speaker.emit("speaker:partial", { seq: 0, text: "واحد اثنان" });
  await src; // listeners still see the original text live
  await sleep(150);
  assert.equal(translations.length, 0);
  const fin = next(listener, "caption:translation", (d) => d.isFinal);
  speaker.emit("speaker:final", { seq: 0, text: "واحد اثنان ثلاثة" });
  assert.equal((await fin).text, "[en] واحد اثنان ثلاثة");
  await emitAck(speaker, "speaker:stop", {});
});

test("read-aloud audio is refused when TTS isn't configured, and no audio is streamed", async () => {
  assert.equal((await call("GET", "/api/tts?text=hi&lang=en&token=x")).status, 503); // no Gemini key in tests
  const token = await verifiedSpeaker("quiet");
  const speaker = open(token);
  await emitAck(speaker, "speaker:start", { sourceLang: "ar" });
  const listener = open();
  assert.equal((await emitAck(listener, "listener:join", { username: "quiet", lang: "en", audio: true })).ok, true);
  let audio = false;
  listener.on("caption:audio", () => (audio = true));
  const fin = next(listener, "caption:translation", (d) => d.isFinal);
  speaker.emit("speaker:final", { seq: 0, text: "اختبار" });
  await fin;
  await sleep(50);
  assert.equal(audio, false);
  await emitAck(speaker, "speaker:stop", {});
});

test("translation usage is added up per month and provider", async () => {
  const { recordUsage, flushUsage, usageHistory, usageMonth } = await import("../src/translation/usage.js");
  recordUsage("azure", 120);
  recordUsage("azure", 30);
  await flushUsage();
  recordUsage("azure", 50);
  recordUsage("deepl", 7);
  await flushUsage();
  const rows = await usageHistory();
  const month = usageMonth();
  const azure = rows.find((r) => r.month === month && r.provider === "azure");
  const deepl = rows.find((r) => r.month === month && r.provider === "deepl");
  assert.deepEqual(azure, { month, provider: "azure", chars: 200, calls: 3 });
  assert.deepEqual(deepl, { month, provider: "deepl", chars: 7, calls: 1 });

  // The running monthly total that decides when to switch providers.
  const { monthChars } = await import("../src/translation/usage.js");
  assert.equal(monthChars("azure"), 200);
  assert.equal(monthChars("google"), 0);
});

test("speaking access: request form, owner email, one-click approval", async () => {
  const email = "asker@x.com";
  const reg = await post("/api/auth/register", { username: "asker", email, displayName: "Asker", password: "password123" });
  const token = reg.body.token;
  assert.equal((await post("/api/auth/speaking-request", { note: "I teach a weekly class" }, token)).status, 403); // unverified
  // Verified directly: the email-code endpoints' rate limit is shared with the other tests.
  await (await import("../src/db.js")).users.setEmailVerified(reg.body.user.id);

  assert.equal((await post("/api/auth/speaking-request", { note: "hi" }, token)).status, 400);
  const sent = await post("/api/auth/speaking-request", { note: "Friday talks at our mosque, Arabic to English" }, token);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.user.canSpeak, false);
  assert.ok(sent.body.user.speakRequestedAt);
  // Asking again soon after doesn't email the owner twice.
  await post("/api/auth/speaking-request", { note: "Friday talks at our mosque, Arabic to English" }, token);
  const toOwner = devMessages.filter((m) => m.to === "owner@x.com" && m.subject.includes("@asker"));
  assert.equal(toOwner.length, 1);
  assert.match(toOwner[0].text, /Friday talks at our mosque/);

  const link = toOwner[0].text.match(/https?:\/\/\S+approve-speaker\?token=\S+/)![0];
  const path = link.replace(/^https?:\/\/[^/]+/, "");
  assert.equal((await fetch(base + path.replace(/token=.*/, "token=forged"))).status, 400);
  // Opening the link (as email scanners do) only shows a confirmation page.
  const preview = await fetch(base + path);
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /Give speaking access\?/);
  assert.equal((await call("GET", "/api/auth/me", undefined, token)).body.user.canSpeak, false);

  const approved = await fetch(base + path, { method: "POST" });
  assert.match(await approved.text(), /can now speak/);
  const me = (await call("GET", "/api/auth/me", undefined, token)).body.user;
  assert.equal(me.canSpeak, true);
  assert.equal(me.speakRequestedAt, null);
  assert.ok(devMessages.some((m) => m.to === email && m.subject.includes("you can now speak")));
  const s = open(token);
  assert.equal((await emitAck(s, "speaker:start", { sourceLang: "ar" })).ok, true);
  await emitAck(s, "speaker:stop", {});
});

test("switched-off listening languages fall back to English", async () => {
  const langs = (await call("GET", "/api/languages")).body;
  assert.deepEqual(langs.target.map((l: { code: string }) => l.code), ["en", "fr"]);

  // Set up directly: the email-code endpoints' rate limit is shared with the other tests.
  const reg = await post("/api/auth/register", { username: "langspeaker", email: "lang@x.com", displayName: "L", password: "password123" });
  const { users } = await import("../src/db.js");
  await users.setEmailVerified(reg.body.user.id);
  await allowSpeaking(reg.body.user.id);
  const token = reg.body.token as string;
  const speaker = open(token);
  assert.equal((await emitAck(speaker, "speaker:start", { sourceLang: "ar" })).ok, true);
  // An older app still offering Urdu: the listener is served English instead of an error.
  const listener = open();
  const joined = await emitAck(listener, "listener:join", { username: "langspeaker", lang: "ur" });
  assert.equal(joined.ok, true);
  assert.equal(joined.lang, "en");
  const french = await emitAck(open(), "listener:join", { username: "langspeaker", lang: "fr" });
  assert.equal(french.lang, "fr");
  await emitAck(speaker, "speaker:stop", {});
});

test("with Live mode switched off, speakers asking for it get Balanced", async () => {
  const { features } = await import("../src/config.js");
  const { sessions } = await import("../src/db.js");
  features.liveMode = false;
  try {
    const reg = await post("/api/auth/register", { username: "nolive", email: "nolive@x.com", displayName: "N", password: "password123" });
    const { users } = await import("../src/db.js");
    await users.setEmailVerified(reg.body.user.id);
    await allowSpeaking(reg.body.user.id);
    const s = open(reg.body.token);
    const started = await emitAck(s, "speaker:start", { sourceLang: "ar", translationMode: "live" });
    assert.equal(started.ok, true);
    assert.equal((await sessions.byId(started.sessionId))!.translation_mode, "balanced");
    await emitAck(s, "speaker:stop", {});
    assert.equal((await call("GET", "/api/config")).body.features.liveMode, false);
  } finally {
    features.liveMode = true;
  }
});

test("the speaker can correct a line of a finished transcript; nobody else can", async () => {
  const reg = await post("/api/auth/register", { username: "editor", email: "editor@x.com", displayName: "E", password: "password123" });
  const { users } = await import("../src/db.js");
  await users.setEmailVerified(reg.body.user.id);
  await allowSpeaking(reg.body.user.id);
  const token = reg.body.token as string;
  const s = open(token);
  const started = await emitAck(s, "speaker:start", { sourceLang: "ar", translationMode: "sentences" });
  const listener = open();
  await emitAck(listener, "listener:join", { username: "editor", lang: "en" });
  const caption = next(listener, "caption:translation", (d) => d.isFinal);
  s.emit("speaker:final", { seq: 1, text: "مرحبا بكم" });
  await caption;
  const path = `/api/sessions/${started.sessionId}/segments/1`;
  // Not while live.
  assert.equal((await call("PATCH", path, { translation: "Welcome, everyone" }, token)).status, 409);
  await emitAck(s, "speaker:stop", {});
  await sleep(200);

  const edited = await call("PATCH", path, { translation: "Welcome, everyone", original: "مرحباً بكم جميعاً" }, token);
  assert.equal(edited.status, 200);
  assert.equal(edited.body.segment.translations.en, "Welcome, everyone");
  assert.equal(edited.body.segment.original, "مرحباً بكم جميعاً");
  const reread = await call("GET", `/api/sessions/${started.sessionId}`, undefined, token);
  assert.equal(reread.body.segments[0].translations.en, "Welcome, everyone");

  assert.equal((await call("PATCH", path, {}, token)).status, 400); // nothing to change
  assert.equal((await call("PATCH", path, { translation: "   " }, token)).status, 400); // empty
  assert.equal((await call("PATCH", `/api/sessions/${started.sessionId}/segments/99`, { translation: "x" }, token)).status, 404);
  const other = await post("/api/auth/register", { username: "intruder", email: "intruder@x.com", displayName: "I", password: "password123" });
  assert.equal((await call("PATCH", path, { translation: "hacked" }, other.body.token)).status, 404);

  // "Translate again": a fresh translation of the corrected wording, for review (nothing is saved).
  const again = await post(`/api/sessions/${started.sessionId}/retranslate`, { text: "مرحباً بكم جميعاً" }, token);
  assert.equal(again.status, 200);
  assert.equal(typeof again.body.translation, "string");
  assert.ok(again.body.translation.length > 0);
  assert.equal((await post(`/api/sessions/${started.sessionId}/retranslate`, { text: " " }, token)).status, 400);
  assert.equal((await post(`/api/sessions/${started.sessionId}/retranslate`, { text: "x" }, other.body.token)).status, 404);
  const unchanged = await call("GET", `/api/sessions/${started.sessionId}`, undefined, token);
  assert.equal(unchanged.body.segments[0].translations.en, "Welcome, everyone");
});

test("sessions are reviewed before readers see them; publishing emails signed-in readers", async () => {
  const { users } = await import("../src/db.js");
  const make = async (username: string) => {
    const reg = await post("/api/auth/register", { username, email: `${username}@x.com`, displayName: username, password: "password123" });
    await users.setEmailVerified(reg.body.user.id);
    return reg.body as { token: string; user: { id: string } };
  };
  const speaker = await make("revspeaker");
  await allowSpeaking(speaker.user.id);
  const reader = await make("revreader");

  const s = open(speaker.token);
  const started = await emitAck(s, "speaker:start", { sourceLang: "ar", translationMode: "sentences" });
  const listener = open(reader.token);
  await emitAck(listener, "listener:join", { username: "revspeaker", lang: "en" });
  const caption = next(listener, "caption:translation", (d) => d.isFinal);
  s.emit("speaker:final", { seq: 1, text: "مرحبا بكم" });
  await caption;
  await emitAck(s, "speaker:stop", {});
  await sleep(200);

  // Ended, but still in review: the reader sees it listed as "reviewing", without the transcript.
  const list = await call("GET", "/api/library", undefined, reader.token);
  const item = list.body.sessions.find((x: { id: string }) => x.id === started.sessionId);
  assert.equal(item.reviewStatus, "reviewing");
  const hidden = await call("GET", `/api/library/${started.sessionId}`, undefined, reader.token);
  assert.deepEqual(hidden.body.segments, []);
  assert.equal(hidden.body.session.summary, null);
  const speakerView = await call("GET", `/api/sessions/${started.sessionId}`, undefined, speaker.token);
  assert.equal(speakerView.body.session.reviewStatus, "reviewing");
  assert.equal(speakerView.body.segments.length, 1); // the speaker can see and edit everything

  // Only the speaker can publish.
  assert.equal((await post(`/api/sessions/${started.sessionId}/publish`, {}, reader.token)).status, 404);
  const pub = await post(`/api/sessions/${started.sessionId}/publish`, {}, speaker.token);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.session.reviewStatus, "published");
  assert.equal(pub.body.notified, 1);
  await sleep(100);
  assert.ok(devMessages.some((m) => m.to === "revreader@x.com" && m.subject.includes("final translation") && m.text.includes(`/library/${started.sessionId}`)));
  const shown = await call("GET", `/api/library/${started.sessionId}`, undefined, reader.token);
  assert.equal(shown.body.segments.length, 1);
  // Publishing again doesn't email anyone twice.
  assert.equal((await post(`/api/sessions/${started.sessionId}/publish`, {}, speaker.token)).body.notified, 0);
});

test("the Usage page is only for the account owner", async () => {
  // Created directly: the sign-up rate limit is shared with the other tests.
  const { users } = await import("../src/db.js");
  const { signToken } = await import("../src/auth.js");
  const make = async (username: string) => {
    const u = await users.create({ username, email: `${username}@x.com`, displayName: username, passwordHash: null, emailVerified: true });
    return { token: signToken(u.id) };
  };
  const boss = { body: await make("boss") };
  const other = { body: await make("someone") };
  assert.equal((await call("GET", "/api/auth/me", undefined, boss.body.token)).body.user.isAdmin, true);
  assert.equal((await call("GET", "/api/auth/me", undefined, other.body.token)).body.user.isAdmin, false);
  const usage = await call("GET", "/api/admin/usage", undefined, boss.body.token);
  assert.equal(usage.status, 200);
  assert.ok(Array.isArray(usage.body.providers) && usage.body.providers.length >= 1);
  assert.equal(typeof usage.body.providers[0].used, "number");
  assert.equal((await call("GET", "/api/admin/usage", undefined, other.body.token)).status, 403);
  assert.equal((await call("GET", "/api/admin/usage")).status, 401);
});

test("admins: approvals and search, expiry, guest reset (6 hours, then signed out), and admin rights", async () => {
  const { users } = await import("../src/db.js");
  const { signToken } = await import("../src/auth.js");
  const bcrypt = (await import("bcryptjs")).default;
  const make = (username: string, extra: Partial<{ password: string }> = {}) =>
    users.create({ username, email: `${username}@x.com`, displayName: username, passwordHash: extra.password ? bcrypt.hashSync(extra.password, 4) : null, emailVerified: true });
  const boss = (await users.byUsername("boss")) ?? (await make("boss"));
  const bossToken = signToken(boss.id);

  // Search finds anyone by username or email, with pending requests first.
  const asker = await make("askme");
  await users.requestSpeaking(asker.id, "Weekly lessons");
  const found = (await call("GET", "/api/admin/speakers?q=askme@x", undefined, bossToken)).body.speakers;
  assert.equal(found[0].username, "askme");
  assert.equal(found[0].speakRequestNote, "Weekly lessons");
  // Creating accounts from the admin page is gone.
  assert.equal((await post("/api/admin/speakers", { username: "nope", displayName: "N", email: "nope@x.com", expiresAt: null }, bossToken)).status, 404);

  // Admin rights: only the main admin can grant them; a promoted admin can use the admin pages but not grant.
  const helper = await make("helper");
  assert.equal((await call("PATCH", `/api/admin/speakers/${helper.id}`, { isAdmin: true }, bossToken)).body.speaker.isAdmin, true);
  const helperToken = signToken(helper.id);
  assert.equal((await call("GET", "/api/admin/usage", undefined, helperToken)).status, 200);
  assert.equal((await call("PATCH", `/api/admin/speakers/${asker.id}`, { canSpeak: true }, helperToken)).body.speaker.canSpeak, true);
  assert.equal((await call("PATCH", `/api/admin/speakers/${asker.id}`, { isAdmin: true }, helperToken)).status, 403);
  assert.equal((await call("PATCH", `/api/admin/speakers/${boss.id}`, { canSpeak: false }, helperToken)).status, 400);
  const other = await make("otheradmin");
  await users.setAdmin(other.id, true);
  assert.equal((await call("PATCH", `/api/admin/speakers/${other.id}`, { canSpeak: false }, helperToken)).status, 400); // admins can't change other admins
  assert.equal((await call("PATCH", `/api/admin/speakers/${helper.id}`, { isAdmin: false }, bossToken)).body.speaker.isAdmin, false);
  assert.equal((await call("GET", "/api/admin/usage", undefined, helperToken)).status, 403);

  // Expiry on a normal account: signed out everywhere when it passes; extending restores access.
  const timed = await make("timed", { password: "password123" });
  const timedLogin = await post("/api/auth/login", { login: "timed", password: "password123" });
  await users.setExpiry(timed.id, new Date(Date.now() - 1000).toISOString());
  assert.equal((await call("GET", "/api/auth/me", undefined, timedLogin.body.token)).status, 401);
  assert.equal((await post("/api/auth/login", { login: "timed", password: "password123" })).body.expired, true);
  await users.setExpiry(timed.id, null);
  assert.equal((await post("/api/auth/login", { login: "timed", password: "password123" })).status, 200);
  // Expiry can no longer be changed from the admin pages (it's ignored).
  await call("PATCH", `/api/admin/speakers/${timed.id}`, { expiresAt: new Date(Date.now() + 86400_000).toISOString() }, bossToken);
  assert.equal((await users.byId(timed.id))!.expires_at, null);

  // Guest: off until Reset; Reset = new password + 6 hours + speaking on, earlier sign-ins stop working.
  const guest = await users.createGuest({ username: "guest_t", email: "guest_t@x.com", displayName: "Guest", passwordHash: bcrypt.hashSync("unknown", 4) });
  assert.equal((await post(`/api/admin/speakers/${timed.id}/reset`, {}, bossToken)).status, 400); // only guests
  const r1 = await post(`/api/admin/speakers/${guest.id}/reset`, {}, bossToken);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.password.length, 12);
  const hours = (Date.parse(r1.body.expiresAt) - Date.now()) / 3600_000;
  assert.ok(hours > 5.9 && hours <= 6, `expires in ~6 hours (${hours})`);
  const g1 = await post("/api/auth/login", { login: "guest_t", password: r1.body.password });
  assert.equal(g1.status, 200);
  const s1 = open(g1.body.token);
  assert.equal((await emitAck(s1, "speaker:start", { sourceLang: "ar" })).ok, true);
  // The next Reset signs the previous user out at once (their app is told), and the old password stops working.
  const signedOut = next(s1, "account:signed_out");
  const r2 = await post(`/api/admin/speakers/${guest.id}/reset`, {}, bossToken);
  await signedOut;
  assert.equal((await call("GET", "/api/auth/me", undefined, g1.body.token)).status, 401);
  assert.equal((await post("/api/auth/login", { login: "guest_t", password: r1.body.password })).status, 401);
  assert.equal((await post("/api/auth/login", { login: "guest_t", password: r2.body.password })).status, 200);
  // When the time is up, a connected guest is signed out automatically.
  const g2 = await post("/api/auth/login", { login: "guest_t", password: r2.body.password });
  await users.setExpiry(guest.id, new Date(Date.now() + 1500).toISOString());
  const s2 = open(g2.body.token);
  const expiredOut = next(s2, "account:signed_out");
  await expiredOut;

  // Delete an account: signed out at once and gone; admins and yourself are protected.
  const goner = await make("goner", { password: "password123" });
  const gonerLogin = await post("/api/auth/login", { login: "goner", password: "password123" });
  const gs = open(gonerLogin.body.token);
  await new Promise((r) => gs.once("connect", r));
  const gonerOut = next(gs, "account:signed_out");
  await users.setAdmin(helper.id, true);
  assert.equal((await call("DELETE", `/api/admin/speakers/${goner.id}`, undefined, signToken(asker.id))).status, 403); // not an admin
  assert.equal((await call("DELETE", `/api/admin/speakers/${other.id}`, undefined, helperToken)).status, 400); // other admin
  assert.equal((await call("DELETE", `/api/admin/speakers/${boss.id}`, undefined, helperToken)).status, 400); // main admin
  assert.equal((await call("DELETE", `/api/admin/speakers/${helper.id}`, undefined, helperToken)).status, 400); // yourself
  assert.equal((await call("DELETE", `/api/admin/speakers/${goner.id}`, undefined, helperToken)).status, 204);
  await gonerOut;
  assert.equal(await users.byId(goner.id), undefined);
  assert.equal((await post("/api/auth/login", { login: "goner", password: "password123" })).status, 401);
  assert.equal((await call("DELETE", `/api/admin/speakers/${other.id}`, undefined, bossToken)).status, 204); // the main admin can
});
