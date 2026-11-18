import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default("*"),
  JWT_SECRET: z.string().min(1).default("dev-insecure-secret"),
  JWT_EXPIRES_IN: z.string().default("30d"),
  // PostgreSQL connection string (Neon: copy it from the project's "Connect" dialog).
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (PostgreSQL connection string)"),
  // Old SQLite database: only read by the one-time import script (npm run import-sqlite).
  DATABASE_PATH: z.string().default("./data/app.db"),
  APP_NAME: z.string().default("LisanCast"),

  TRANSLATION_PROVIDER: z.enum(["free", "google", "deepl", "azure", "claude", "mock"]).default("free"),
  // Optional: a different (usually cheaper) provider for in-progress sentences only; finished sentences
  // always use TRANSLATION_PROVIDER. Blank = same as TRANSLATION_PROVIDER.
  TRANSLATION_PREVIEW_PROVIDER: z.preprocess(
    (v) => (typeof v === "string" && !v.trim() ? undefined : v),
    z.enum(["free", "google", "deepl", "azure", "claude", "mock"]).optional(),
  ),
  GOOGLE_TRANSLATE_API_KEY: optional,
  DEEPL_API_KEY: optional,
  DEEPL_API_URL: z.string().default("https://api-free.deepl.com"),
  // Azure AI Translator: Keys and Endpoint page of the Translator resource.
  AZURE_TRANSLATOR_KEY: optional,
  AZURE_TRANSLATOR_REGION: z.string().default("global"),
  // Monthly character allowance of the main translation provider (Azure F0 = 2,000,000). The server
  // warns in its log at 80% and 100%. 0 turns the warnings off; usage is still counted.
  TRANSLATION_MONTHLY_LIMIT: z.coerce.number().int().nonnegative().default(2_000_000),
  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),

  // AI meeting summaries: "gemini" or "claude". If unset, uses whichever key is configured (Gemini first).
  // A blank value (as in .env.example) counts as unset.
  SUMMARY_PROVIDER: z.preprocess(
    (v) => (typeof v === "string" && !v.trim() ? undefined : v),
    z.enum(["gemini", "claude"]).optional(),
  ),
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  // Natural read-aloud voice for listeners (Gemini TTS, uses GEMINI_API_KEY). Set TTS_ENABLED=false to use the phones' own voices.
  TTS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v?.trim() !== "false"),
  // The lite model starts speaking in ~0.5 s, so the voice keeps up with live captions.
  TTS_MODEL: z.string().default("gemini-3.8-flash-lite-tts"),
  TTS_VOICE: z.string().default("Charon"),
  // Summarize every session automatically when it ends (set to "false" to only summarize on request).
  AUTO_SUMMARY: z
    .string()
    .optional()
    .transform((v) => v?.trim() !== "false"),

  // Google sign-in: comma-separated OAuth client IDs (web, iOS, Android) accepted as token audiences.
  GOOGLE_CLIENT_IDS: optional,

  // Email (verification codes, password reset). Without SMTP_HOST, codes are printed to the console.
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  MAIL_FROM: optional,
  // Where speaking-access requests are emailed (defaults to SMTP_USER, the address that sends the codes).
  ADMIN_EMAIL: optional,

  SENTRY_DSN: optional,
  BACKUP_DIR: z.string().default("./data/backups"),
  BACKUP_KEEP: z.coerce.number().int().positive().default(14),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const config = {
  ...parsed.data,
  corsOrigins:
    parsed.data.CORS_ORIGINS.trim() === "*"
      ? true
      : parsed.data.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
  googleClientIds: (parsed.data.GOOGLE_CLIENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
};

/** Which AI provider writes session summaries, or null when no key is configured. */
export const summaryProvider: "gemini" | "claude" | null = (() => {
  const hasKey = { gemini: !!config.GEMINI_API_KEY, claude: !!config.ANTHROPIC_API_KEY };
  if (config.SUMMARY_PROVIDER) return hasKey[config.SUMMARY_PROVIDER] ? config.SUMMARY_PROVIDER : null;
  if (hasKey.gemini) return "gemini";
  if (hasKey.claude) return "claude";
  return null;
})();

export const features = {
  googleSignIn: config.googleClientIds.length > 0,
  email: !!config.SMTP_HOST,
  summaries: summaryProvider !== null,
  /** Natural read-aloud voice (see tts.ts). */
  tts: !!config.GEMINI_API_KEY && config.TTS_ENABLED,
};

if (
  config.NODE_ENV === "production" &&
  ["dev-insecure-secret", "change-me-in-production"].includes(config.JWT_SECRET)
) {
  console.error("JWT_SECRET must be set to a strong random value in production.");
  process.exit(1);
}
