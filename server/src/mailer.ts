import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config.js";

let transport: Transporter | null = null;
if (config.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
}

const COPY = {
  verify_email: {
    subject: (app: string) => `${app} verification code`,
    en: "Use this code to verify your email address:",
    ar: "استخدم هذا الرمز لتأكيد بريدك الإلكتروني:",
  },
  reset_password: {
    subject: (app: string) => `${app} password reset code`,
    en: "Use this code to reset your password:",
    ar: "استخدم هذا الرمز لإعادة تعيين كلمة المرور:",
  },
} as const;

/** Codes "sent" while SMTP isn't configured (inspected by tests). */
export const devOutbox: { to: string; code: string; purpose: string }[] = [];

/** Sends a bilingual (English/Arabic) one-time code. Without SMTP configured, logs it instead. */
export async function sendCodeEmail(to: string, name: string, code: string, purpose: keyof typeof COPY) {
  const c = COPY[purpose];
  const app = config.APP_NAME;
  if (!transport) {
    devOutbox.push({ to, code, purpose });
    if (config.NODE_ENV !== "test") console.log(`\n📧 [dev email] ${purpose} code for ${to}: ${code}  (configure SMTP_HOST to send real emails)\n`);
    return;
  }
  const text = `Hi ${name},\n\n${c.en}\n\n${code}\n\nThe code expires in 10 minutes. If you didn't request it, you can ignore this email.\n\n—\n\n${c.ar}\n\n${code}\n\nتنتهي صلاحية الرمز خلال 10 دقائق.`;
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
    <h2 style="margin:0 0 16px">${app}</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>${c.en}</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${code}</p>
    <p style="color:#555">The code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p dir="rtl" style="text-align:right">${c.ar}</p>
    <p dir="rtl" style="text-align:right;color:#555">تنتهي صلاحية الرمز خلال 10 دقائق.</p>
  </div>`;
  await transport.sendMail({ from: config.MAIL_FROM ?? config.SMTP_USER, replyTo: config.MAIL_REPLY_TO, to, subject: c.subject(app), text, html });
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/* ------------------------- speaking access requests ------------------------ */

/** Other emails "sent" while SMTP isn't configured (inspected by tests). */
export const devMessages: { to: string; subject: string; text: string }[] = [];

async function send(to: string, subject: string, text: string, html: string, replyTo = config.MAIL_REPLY_TO) {
  if (!transport) {
    devMessages.push({ to, subject, text });
    if (config.NODE_ENV !== "test") console.log(`\n📧 [dev email] to ${to}: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: config.MAIL_FROM ?? config.SMTP_USER, replyTo, to, subject, text, html });
}

const wrap = (inner: string) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">${inner}</div>`;

/** To the app owner: someone asked for speaking access. `approveUrl` grants it in one click. */
export async function sendSpeakingRequestEmail(
  to: string,
  u: { displayName: string; username: string; email: string; createdAt: string },
  note: string,
  approveUrl: string,
) {
  const app = config.APP_NAME;
  const subject = `${app}: speaking access request from @${u.username}`;
  const text =
    `${u.displayName} (@${u.username}, ${u.email}) asked for speaking access.\n\n` +
    `How they'll use it:\n${note}\n\n` +
    `Approve with one click (link valid for 30 days):\n${approveUrl}\n\n` +
    `Or on the server: docker compose exec -T server node dist/scripts/speaker.js ${u.email} on\n` +
    `To decline, just ignore this email.`;
  const html = wrap(`
    <h2 style="margin:0 0 16px">Speaking access request</h2>
    <p><b>${escapeHtml(u.displayName)}</b> (@${escapeHtml(u.username)})<br><a href="mailto:${escapeHtml(u.email)}">${escapeHtml(u.email)}</a><br>
    <span style="color:#666">Account created ${escapeHtml(u.createdAt.slice(0, 10))}</span></p>
    <p style="margin-bottom:4px;color:#555">How they'll use it:</p>
    <blockquote style="margin:0 0 24px;padding:12px 16px;background:#f4f4f5;border-radius:8px;white-space:pre-wrap">${escapeHtml(note)}</blockquote>
    <p><a href="${escapeHtml(approveUrl)}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Review and approve</a></p>
    <p style="color:#666;font-size:13px">The link opens a confirmation page and is valid for 30 days. To decline, just ignore this email.</p>`);
  // Replying to this email answers the person who asked.
  await send(to, subject, text, html, u.email);
}

/** To the user: their speaking access was turned on. */
export async function sendSpeakingApprovedEmail(to: string, name: string) {
  const app = config.APP_NAME;
  const subject = `${app}: you can now speak`;
  const text =
    `Hi ${name},\n\nYour speaking access has been turned on. Open ${app} and tap "Start speaking" to go live.\n\n—\n\n` +
    `تم تفعيل صلاحية التحدث لحسابك. افتح ${app} واضغط "ابدأ التحدث" لبدء البث.`;
  const html = wrap(`
    <h2 style="margin:0 0 16px">${escapeHtml(app)}</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your speaking access has been turned on. Open ${escapeHtml(app)} and tap <b>Start speaking</b> to go live.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p dir="rtl" style="text-align:right">تم تفعيل صلاحية التحدث لحسابك. افتح ${escapeHtml(app)} واضغط <b>ابدأ التحدث</b> لبدء البث.</p>`);
  await send(to, subject, text, html);
}
