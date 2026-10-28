import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";

process.env.NODE_ENV = "test";
process.env.TRANSLATION_PROVIDER = "mock";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "lt-")), "test.db");

const { createServer } = await import("node:http");
const { Server } = await import("socket.io");
const { createApp } = await import("../src/app.js");
const { attachRealtime } = await import("../src/realtime.js");
const { devOutbox } = await import("../src/mailer.js");
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
after(() => {
  sockets.forEach((s) => s.disconnect());
  io.close();
  httpServer.close();
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
  return reg.body.token as string;
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

test("account deletion requires the password and removes everything", async () => {
  const token = await verifiedSpeaker("leaver");
  const s = open(token);
  await emitAck(s, "speaker:start", { sourceLang: "ar" });
  assert.equal((await call("DELETE", "/api/auth/me", { password: "nope" }, token)).status, 401);
  assert.equal((await call("DELETE", "/api/auth/me", { password: "password123" }, token)).status, 204);
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
