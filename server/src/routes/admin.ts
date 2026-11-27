import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, verifyApproveToken } from "../auth.js";
import { providerChain } from "../translation/caps.js";
import { monthChars, usageHistory, usageMonth } from "../translation/usage.js";
import { translator } from "../translation/index.js";
import { adminUsernames, config, features } from "../config.js";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { isExpired, toPublicUser, users, type UserRow } from "../db.js";
import { grantSpeaking } from "../speaking.js";

/*
 * One-click approval from the "speaking access request" email. The signed link is the credential, so
 * only whoever receives that email (you) can use it. GET only shows a confirmation page, because email
 * providers sometimes open links automatically to scan them; access is granted by the button (POST).
 */
export const adminRouter = Router();
adminRouter.use(rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function page(res: Response, title: string, body: string, status = 200) {
  res
    .status(status)
    .type("html")
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<meta name="robots" content="noindex"><title>${esc(title)} · ${esc(config.APP_NAME)}</title></head>` +
        `<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:48px auto;padding:0 20px;color:#111;line-height:1.5">` +
        `<p style="color:#0f766e;font-weight:700;margin:0 0 8px">${esc(config.APP_NAME)}</p><h1 style="font-size:24px;margin:0 0 16px">${esc(title)}</h1>${body}</body></html>`,
    );
}

async function loadFromToken(token: unknown) {
  const id = typeof token === "string" ? verifyApproveToken(token) : null;
  return id ? { user: await users.byId(id) } : null;
}

adminRouter.get("/approve-speaker", async (req, res) => {
  const found = await loadFromToken(req.query.token);
  if (!found) return page(res, "Link not valid", "<p>This approval link is invalid or has expired (links last 30 days).</p>", 400);
  const u = found.user;
  if (!u) return page(res, "Account not found", "<p>This account has been deleted.</p>", 404);
  if (u.can_speak) return page(res, "Already approved", `<p>@${esc(u.username)} can already speak.</p>`);
  page(
    res,
    "Give speaking access?",
    `<p><b>${esc(u.display_name)}</b> (@${esc(u.username)})<br>${esc(u.email)}</p>` +
      (u.speak_request_note
        ? `<p style="margin-bottom:4px;color:#555">How they'll use it:</p><blockquote style="margin:0 0 24px;padding:12px 16px;background:#f4f4f5;border-radius:8px;white-space:pre-wrap">${esc(u.speak_request_note)}</blockquote>`
        : "") +
      `<form method="post"><button style="background:#0f766e;color:#fff;border:0;padding:12px 20px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">Give speaking access</button></form>` +
      `<p style="color:#666;font-size:14px">They'll get an email saying they can now go live. To decline, just close this page.</p>`,
  );
});

adminRouter.post("/approve-speaker", async (req, res) => {
  const found = await loadFromToken(req.query.token);
  if (!found) return page(res, "Link not valid", "<p>This approval link is invalid or has expired (links last 30 days).</p>", 400);
  const u = found.user;
  if (!u) return page(res, "Account not found", "<p>This account has been deleted.</p>", 404);
  if (!u.can_speak) await grantSpeaking(u);
  page(res, "Approved ✓", `<p>@${esc(u.username)} (${esc(u.email)}) can now speak. We've emailed them to let them know.</p>`);
});

/** Translation usage for the Usage page in the app: only for ADMIN_USERNAMES. */
adminRouter.get("/usage", requireAuth, async (req, res) => {
  if (!adminUsernames.has(req.user!.username.toLowerCase())) return res.status(403).json({ error: "Only the account owner can see usage" });
  const month = usageMonth();
  const chain = providerChain();
  const history = await usageHistory(6);
  // The provider currently translating: the first in the chain still under its limit.
  const active = chain.find((p) => translator.hasRoom(p.name))?.name ?? chain[0]?.name ?? null;
  res.json({
    month,
    active,
    liveMode: features.liveMode,
    listenLanguages: config.LISTEN_LANGUAGES ?? "all",
    providers: chain.map((p) => ({
      name: p.name,
      label: p.label,
      used: Math.max(monthChars(p.name), history.find((h) => h.month === month && h.provider === p.name)?.chars ?? 0),
      limit: p.limit,
      allowance: p.allowance,
    })),
    history,
  });
});

/* ------------------------------ speaker accounts ------------------------------ */
// Admin page "Manage speakers": create ready-to-use speaker accounts (optionally expiring), list them,
// change expiry, and turn speaking on or off. Admin only (ADMIN_USERNAMES).

const requireAdmin: import("express").RequestHandler = async (req, res, next) => {
  if (!adminUsernames.has(req.user!.username.toLowerCase())) return res.status(403).json({ error: "Only the account owner can see usage" });
  next();
};

const managedView = (u: UserRow) => ({
  ...toPublicUser(u),
  expired: isExpired(u),
  createdByAdmin: !!u.created_by_admin,
  speakRequestNote: u.can_speak ? null : u.speak_request_note,
});

/** Easy to read and type: no 0/O, 1/l/I. */
function generatePassword(length = 12) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join("");
}

const expirySchema = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .refine((v) => v === null || Date.parse(v) > Date.now(), "Choose an expiry date in the future");

adminRouter.get("/speakers", requireAuth, requireAdmin, async (_req, res) => {
  res.json({ speakers: (await users.managed()).map(managedView) });
});

adminRouter.post("/speakers", requireAuth, requireAdmin, async (req, res) => {
  const parsed = z
    .object({
      username: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9_]{3,20}$/, "Username must be 3-20 characters: letters, numbers or underscore"),
      displayName: z.string().trim().min(1, "Display name is required").max(60),
      email: z.email("Enter a valid email").trim().toLowerCase(),
      password: z.string().min(8, "Password must be at least 8 characters").max(200).optional(),
      expiresAt: expirySchema,
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
  const { username, displayName, email, expiresAt } = parsed.data;
  if (await users.byUsername(username)) return res.status(409).json({ error: "That username is taken" });
  if (await users.byEmail(email)) return res.status(409).json({ error: "An account with this email already exists" });
  const password = parsed.data.password ?? generatePassword();
  const user = await users.createByAdmin({ username, displayName, email, passwordHash: await bcrypt.hash(password, 10), expiresAt });
  // The password is shown once, so the admin can pass it on; it's stored only as a hash.
  res.status(201).json({ speaker: managedView(user), password });
});

adminRouter.patch("/speakers/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = z.object({ canSpeak: z.boolean().optional(), expiresAt: expirySchema.optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
  const target = await users.byId(String(req.params.id));
  if (!target) return res.status(404).json({ error: "Account not found" });
  // Never lock an admin account out by mistake.
  if (adminUsernames.has(target.username.toLowerCase())) return res.status(400).json({ error: "Admin accounts can't be changed here" });
  if (parsed.data.expiresAt !== undefined) await users.setExpiry(target.id, parsed.data.expiresAt);
  if (parsed.data.canSpeak !== undefined) {
    // Turning speaking on also emails them (and clears a pending request), like approving a request.
    if (parsed.data.canSpeak && !target.can_speak) await grantSpeaking(target);
    else await users.setCanSpeak(target.id, parsed.data.canSpeak);
  }
  res.json({ speaker: managedView((await users.byId(target.id))!) });
});
