import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth, signApproveToken, signSignupToken, signToken, verifySignupToken } from "../auth.js";
import { config } from "../config.js";
import { toPublicUser, users, type UserRow } from "../db.js";
import { verifyGoogleIdToken } from "../google.js";
import { sendCodeEmail, sendSpeakingRequestEmail } from "../mailer.js";
import { CODE_ERRORS, issueCode, verifyCode } from "../otp.js";
import { forceEndSpeaker } from "../realtime.js";

export const authRouter = Router();

const limiter = (limit: number) =>
  rateLimit({ windowMs: 15 * 60_000, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many attempts. Please try again later." } });
const authLimiter = limiter(30);
const codeLimiter = limiter(15);
const requestLimiter = limiter(10);

const RESERVED = new Set(["admin", "root", "support", "api", "listen", "speak", "login", "register", "me", "privacy", "terms"]);

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Username must be 3-20 characters: letters, numbers or underscore")
  .refine((u) => !RESERVED.has(u), "This username is reserved");
const displayNameSchema = z.string().trim().min(1, "Display name is required").max(60);
const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(200);
const emailSchema = z.email("Enter a valid email").trim().toLowerCase();
const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid request";
/** Two sign-ups racing for the same username/email: the database's unique index rejects the second. */
const isDuplicate = (err: unknown) => (err as { code?: string }).code === "23505";
const TAKEN = "That username or email is already registered";
const session = (res: Response, user: UserRow, status = 200) =>
  res.status(status).json({ token: signToken(user.id), user: toPublicUser(user) });

/** Issue + email a verification code. Failures to send are logged, not fatal, so sign-up still succeeds. */
async function sendVerification(user: UserRow) {
  const r = await issueCode(user.id, "verify_email");
  if ("code" in r) {
    await sendCodeEmail(user.email, user.display_name, r.code, "verify_email").catch((err) =>
      console.error("[mail] verification email failed", err),
    );
  }
  return r;
}

/* ------------------------------ email/password ---------------------------- */

authRouter.post("/register", authLimiter, async (req, res) => {
  const parsed = z
    .object({ username: usernameSchema, email: emailSchema, displayName: displayNameSchema, password: passwordSchema })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const { username, email, displayName, password } = parsed.data;

  if (await users.byUsername(username)) return res.status(409).json({ error: "That username is taken" });
  if (await users.byEmail(email)) return res.status(409).json({ error: "An account with this email already exists" });

  let user: UserRow;
  try {
    user = await users.create({ username, email, displayName, passwordHash: await bcrypt.hash(password, 10) });
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: TAKEN });
    throw err;
  }
  await sendVerification(user);
  session(res, user, 201);
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const parsed = z
    .object({ login: z.string().trim().min(1, "Enter your username or email"), password: z.string().min(1, "Enter your password") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const user = await users.byLogin(parsed.data.login.replace(/^@/, "").toLowerCase());
  if (user && !user.password_hash) {
    return res.status(400).json({ error: "This account uses Google sign-in. Continue with Google, or reset your password to add one." });
  }
  const valid = user?.password_hash && (await bcrypt.compare(parsed.data.password, user.password_hash));
  if (!user || !valid) return res.status(401).json({ error: "Incorrect username/email or password" });
  session(res, user);
});

/* --------------------------------- Google -------------------------------- */

authRouter.post("/google", authLimiter, async (req, res) => {
  const parsed = z.object({ idToken: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing Google credential" });

  let g;
  try {
    g = await verifyGoogleIdToken(parsed.data.idToken);
  } catch (err) {
    console.warn("[google] token rejected:", (err as Error).message);
    return res.status(401).json({ error: "Google sign-in failed. Please try again." });
  }

  const linked = await users.byGoogleSub(g.sub);
  if (linked) return session(res, linked);

  const byEmail = await users.byEmail(g.email);
  if (byEmail) {
    if (!g.emailVerified) return res.status(409).json({ error: "An account with this email already exists. Sign in with your password." });
    await users.linkGoogle(byEmail.id, g.sub);
    return session(res, (await users.byId(byEmail.id))!);
  }

  // New user: they still need to choose a speaker ID.
  const suggestion = g.email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  const suggestionFree = suggestion.length >= 3 && !(await users.byUsername(suggestion));
  res.json({
    needsProfile: true,
    signupToken: signSignupToken(g),
    profile: {
      email: g.email,
      displayName: g.name,
      suggestedUsername: suggestionFree ? suggestion : "",
    },
  });
});

authRouter.post("/google/complete", authLimiter, async (req, res) => {
  const parsed = z
    .object({ signupToken: z.string(), username: usernameSchema, displayName: displayNameSchema })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const g = verifySignupToken(parsed.data.signupToken);
  if (!g) return res.status(401).json({ error: "Your Google sign-in expired. Please continue with Google again." });
  if ((await users.byGoogleSub(g.sub)) || (await users.byEmail(g.email))) {
    return res.status(409).json({ error: "An account already exists for this Google account. Sign in instead." });
  }
  if (await users.byUsername(parsed.data.username)) return res.status(409).json({ error: "That username is taken" });

  let user: UserRow;
  try {
    user = await users.create({
      username: parsed.data.username,
      email: g.email,
      displayName: parsed.data.displayName,
      passwordHash: null,
      googleSub: g.sub,
      emailVerified: false, // confirmed with an emailed one-time code
    });
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: TAKEN });
    throw err;
  }
  await sendVerification(user);
  session(res, user, 201);
});

/* --------------------------- email verification -------------------------- */

authRouter.post("/verify-email/send", requireAuth, codeLimiter, async (req, res) => {
  const user = req.user!;
  if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });
  const r = await sendVerification(user);
  if ("retryAfterSec" in r) {
    return res.status(429).json({ error: `Please wait ${r.retryAfterSec}s before requesting another code`, retryAfterSec: r.retryAfterSec });
  }
  res.json({ ok: true });
});

authRouter.post("/verify-email", requireAuth, codeLimiter, async (req, res) => {
  const parsed = z.object({ code: codeSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const user = req.user!;
  if (!user.email_verified) {
    const result = await verifyCode(user.id, "verify_email", parsed.data.code);
    if (result !== "ok") return res.status(400).json({ error: CODE_ERRORS[result] });
    await users.setEmailVerified(user.id);
  }
  res.json({ user: toPublicUser((await users.byId(user.id))!) });
});

/* ----------------------------- password reset ---------------------------- */

authRouter.post("/password/forgot", codeLimiter, async (req, res) => {
  const parsed = z.object({ email: emailSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const user = await users.byEmail(parsed.data.email);
  if (user) {
    const r = await issueCode(user.id, "reset_password");
    if ("code" in r) {
      await sendCodeEmail(user.email, user.display_name, r.code, "reset_password").catch((err) =>
        console.error("[mail] reset email failed", err),
      );
    }
  }
  // Same response whether or not the account exists, so emails can't be probed.
  res.json({ ok: true });
});

authRouter.post("/password/reset", codeLimiter, async (req, res) => {
  const parsed = z.object({ email: emailSchema, code: codeSchema, password: passwordSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const user = await users.byEmail(parsed.data.email);
  if (!user) return res.status(400).json({ error: CODE_ERRORS.invalid });
  const result = await verifyCode(user.id, "reset_password", parsed.data.code);
  if (result !== "ok") return res.status(400).json({ error: CODE_ERRORS[result] });
  await users.setPassword(user.id, await bcrypt.hash(parsed.data.password, 10));
  await users.setEmailVerified(user.id); // receiving the code proves email ownership
  session(res, (await users.byId(user.id))!);
});

/* -------------------------------- account -------------------------------- */

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user!) });
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const parsed = z.object({ displayName: displayNameSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  await users.updateDisplayName(req.user!.id, parsed.data.displayName);
  res.json({ user: toPublicUser((await users.byId(req.user!.id))!) });
});

/* ---------------------------- speaking access ---------------------------- */

const REQUEST_EMAIL_EVERY_MS = 12 * 60 * 60_000;

/** Ask for speaking access. Emails the app owner a one-click approval link. */
authRouter.post("/speaking-request", requireAuth, requestLimiter, async (req, res) => {
  const parsed = z
    .object({ note: z.string().trim().min(10, "Tell us a little more (at least 10 characters)").max(1000, "Please keep it under 1000 characters") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const user = req.user!;
  if (!user.email_verified) return res.status(403).json({ error: "Verify your email first" });
  if (!user.can_speak) {
    const recentlyAsked = !!user.speak_requested_at && Date.now() - Date.parse(user.speak_requested_at) < REQUEST_EMAIL_EVERY_MS;
    await users.requestSpeaking(user.id, parsed.data.note);
    const admin = config.ADMIN_EMAIL ?? config.SMTP_USER;
    if (!recentlyAsked && admin) {
      const approveUrl = `${req.protocol}://${req.get("host")}/api/admin/approve-speaker?token=${signApproveToken(user.id)}`;
      await sendSpeakingRequestEmail(admin, toPublicUser(user), parsed.data.note, approveUrl).catch((err) =>
        console.error("[mail] speaking request email failed", err),
      );
    } else if (!admin) {
      console.warn(`[speaking] @${user.username} requested speaking access, but ADMIN_EMAIL/SMTP_USER isn't set to notify anyone.`);
    }
  }
  res.json({ user: toPublicUser((await users.byId(user.id))!) });
});

/** Permanently delete the account, its sessions and transcripts (App Store requirement). */
authRouter.delete("/me", requireAuth, authLimiter, async (req, res) => {
  const user = req.user!;
  const parsed = z.object({ password: z.string().optional(), confirmUsername: z.string().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  if (user.password_hash) {
    if (!parsed.data.password || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      return res.status(401).json({ error: "Incorrect password" });
    }
  } else if (parsed.data.confirmUsername?.trim().replace(/^@/, "").toLowerCase() !== user.username) {
    return res.status(400).json({ error: "Type your username to confirm" });
  }
  await forceEndSpeaker(user.id);
  await users.remove(user.id);
  res.status(204).end();
});
