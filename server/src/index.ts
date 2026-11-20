import "./instrument.js";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { config, features, summaryProvider } from "./config.js";
import { attachRealtime } from "./realtime.js";
import { translator } from "./translation/index.js";
import { flushUsage, loadMonthTotals, monthChars, recordUsage } from "./translation/usage.js";

const httpServer = createServer(createApp());
const io = new Server(httpServer, {
  cors: { origin: config.corsOrigins },
  // Low-latency settings: quick heartbeat to detect dropped speakers, no compression of tiny packets.
  pingInterval: 10_000,
  pingTimeout: 8_000,
  perMessageDeflate: false,
});
attachRealtime(io);
translator.onUsage = recordUsage;
// Switch to the fallback provider (if any) when the main one nears its monthly allowance, while the fallback
// itself is still under its own limit (e.g. Google's free 500,000).
translator.preferFallback = () =>
  config.TRANSLATION_SWITCH_AT > 0 && monthChars(config.TRANSLATION_PROVIDER) >= config.TRANSLATION_SWITCH_AT;
translator.fallbackHasRoom = () =>
  !translator.fallback ||
  !config.TRANSLATION_FALLBACK_LIMIT ||
  monthChars(translator.fallback.name) < config.TRANSLATION_FALLBACK_LIMIT;
loadMonthTotals().catch((err) => console.error("[usage] couldn't read this month's totals:", err.message));

httpServer.listen(config.PORT, () => {
  console.log(`LisanCast server listening on http://localhost:${config.PORT}`);
  console.log(`Translation provider: ${translator.providerName}`);
  console.log(
    `Features: Google sign-in ${features.googleSignIn ? "on" : "off"} · email ${features.email ? "SMTP" : "console (dev)"} · AI summaries ${summaryProvider ? `on (${summaryProvider})` : "off"}`,
  );
  if (config.NODE_ENV === "production" && !features.email) {
    console.warn("⚠️  SMTP is not configured: verification and password-reset codes will only be printed to the log.");
  }
  translator.selfTest().then((r) => {
    if (r.ok) {
      console.log(`Translation self-test OK (${r.ms} ms): "${r.sample}"`);
    } else {
      console.warn(`\n⚠️  Translation self-test FAILED: ${r.error}`);
      console.warn(`   Listeners will see "Translation unavailable" until this is fixed.`);
      console.warn(`   Set TRANSLATION_PROVIDER and its API key in server/.env (see README > Translation providers).\n`);
    }
  });
});

const shutdown = () => {
  io.close();
  // Save the latest translation usage counts before exiting.
  void flushUsage().finally(() => httpServer.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
