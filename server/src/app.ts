import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { config, features } from "./config.js";
import { localizeErrors } from "./i18n.js";
import { Sentry } from "./instrument.js";
import { DEFAULT_TARGET, LANGUAGES, SOURCE_LANGUAGES, TARGET_LANGUAGES } from "./languages.js";
import { authRouter } from "./routes/auth.js";
import { libraryRouter } from "./routes/library.js";
import { sessionsRouter } from "./routes/sessions.js";
import { speakersRouter } from "./routes/speakers.js";
import { translator } from "./translation/index.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "100kb" }));
  app.use(localizeErrors);

  app.get("/health", (_req, res) => res.json({ status: "ok", provider: translator.providerName }));
  const languages = () => ({
    source: SOURCE_LANGUAGES.map((c) => LANGUAGES[c]),
    target: TARGET_LANGUAGES.map((c) => LANGUAGES[c]),
    defaultTarget: DEFAULT_TARGET,
  });
  app.get("/api/languages", (_req, res) => res.json(languages()));
  /** Public client configuration: which optional features this server has enabled. */
  app.get("/api/config", (_req, res) => res.json({ appName: config.APP_NAME, features, languages: languages() }));
  app.use("/api/auth", authRouter);
  app.use("/api/speakers", speakersRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/library", libraryRouter);

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.expose ? err.message : "Internal server error" });
  };
  app.use(onError);
  return app;
}
