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
  await transport.sendMail({ from: config.MAIL_FROM ?? config.SMTP_USER, to, subject: c.subject(app), text, html });
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
