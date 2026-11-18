import { Ionicons } from "@expo/vector-icons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, usePathname } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/auth/AuthProvider";
import { DEFAULT_SOURCE, DEFAULT_TARGET, LANGUAGES, type Language, type TranslationMode } from "@/constants/languages";
import { useCaptions, type CaptionLine } from "@/hooks/useCaptions";
import { useSpeechCapture } from "@/hooks/useSpeechCapture";
import { useI18n, type TKey } from "@/i18n";
import { formatDuration } from "@/lib/format";
import { createSocket, emitWithAck } from "@/lib/socket";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

/*
 * The speaker's live broadcast, owned by the app rather than the Speak screen: the speaker can open
 * other screens (History, Home, …) and keep talking while listeners keep getting captions. A small
 * bar on every other screen shows they're live and leads back.
 */

const PARTIAL_THROTTLE_MS = 100;
const KEEP_AWAKE_TAG = "broadcast";

export type BroadcastPhase = "setup" | "starting" | "live" | "stopping";

export interface GoLiveOptions {
  sourceLang: string;
  /** Speech-recognition locale (e.g. an Arabic dialect such as "ar-EG"). */
  locale: string;
  title: string | null;
  pin: string | null;
  mode: TranslationMode;
  allowRevisit: boolean;
}
export type GoLiveResult = "ok" | "unverified" | "notAllowed" | "failed";

interface BroadcastState {
  phase: BroadcastPhase;
  paused: boolean;
  connected: boolean;
  listeners: number;
  startedAt: number | null;
  livePin: string | null;
  /** Language being spoken in the current (or last) broadcast. */
  source: Language;
  lines: CaptionLine[];
  notice: string | null;
  setNotice: (notice: string | null) => void;
  capture: { supported: boolean; error: TKey | null; volume: number };
  goLive: (options: GoLiveOptions) => Promise<GoLiveResult>;
  stop: () => Promise<void>;
  togglePause: () => Promise<void>;
  /** Keep the connection open while a screen needs it (the Speak screen shows "connecting" status). */
  retainConnection: () => () => void;
}

const BroadcastContext = createContext<BroadcastState | null>(null);

export function useBroadcast() {
  const ctx = useContext(BroadcastContext);
  if (!ctx) throw new Error("useBroadcast must be used inside <BroadcastProvider>");
  return ctx;
}

/** Re-render every second while `active` (for the live timer). */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function BroadcastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { token } = useAuth();

  const socket = useMemo<Socket | null>(() => (token ? createSocket(token) : null), [token]);
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<BroadcastPhase>("setup");
  const [paused, setPaused] = useState(false);
  const [listeners, setListeners] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [livePin, setLivePin] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState<Language>(LANGUAGES[DEFAULT_SOURCE]);
  /** Recognition locale, e.g. the chosen Arabic dialect; kept so automatic restarts use the same one. */
  const [locale, setLocale] = useState<string>(LANGUAGES[DEFAULT_SOURCE].ttsLocale);
  const [retained, setRetained] = useState(0);

  // Broadcast state kept in refs so socket callbacks always see current values.
  const sessionId = useRef<string | null>(null);
  const streamReady = useRef(false); // true once the server accepted speaker:start on this connection
  const seq = useRef(0);
  const seqHasContent = useRef(false);
  const pendingFinals = useRef<{ seq: number; text: string }[]>([]);
  const partialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPartialAt = useRef(0);
  const latestPartial = useRef("");
  const keepAwakeOn = useRef(false);

  /** Keep the screen on only while live. Releasing a lock that was never taken throws on web, so track it. */
  const setKeepAwake = useCallback((on: boolean) => {
    if (keepAwakeOn.current === on) return;
    keepAwakeOn.current = on;
    (on ? activateKeepAwakeAsync(KEEP_AWAKE_TAG) : deactivateKeepAwake(KEEP_AWAKE_TAG)).catch(() => {});
  }, []);

  const { lines, reset } = useCaptions(socket, DEFAULT_TARGET);

  /* ------------------------------- streaming ------------------------------- */
  const flushPartial = useCallback(() => {
    partialTimer.current = null;
    if (!socket || !streamReady.current || !latestPartial.current) return;
    lastPartialAt.current = Date.now();
    socket.emit("speaker:partial", { seq: seq.current, text: latestPartial.current });
  }, [socket]);

  const onPartial = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      seqHasContent.current = true;
      latestPartial.current = text;
      const wait = PARTIAL_THROTTLE_MS - (Date.now() - lastPartialAt.current);
      if (wait <= 0) flushPartial();
      else if (!partialTimer.current) partialTimer.current = setTimeout(flushPartial, wait);
    },
    [flushPartial],
  );

  const onFinal = useCallback(
    (text: string) => {
      if (partialTimer.current) clearTimeout(partialTimer.current);
      partialTimer.current = null;
      latestPartial.current = "";
      if (!text.trim() && !seqHasContent.current) return;
      const payload = { seq: seq.current, text };
      seq.current += 1;
      seqHasContent.current = false;
      if (socket && streamReady.current) socket.emit("speaker:final", payload);
      else pendingFinals.current.push(payload); // delivered after reconnect
    },
    [socket],
  );

  const capture = useSpeechCapture({ locale, onPartial, onFinal });

  /* ------------------------------- controls -------------------------------- */
  const endLocal = useCallback(() => {
    capture.stop();
    sessionId.current = null;
    streamReady.current = false;
    pendingFinals.current = [];
    setPhase("setup");
    setPaused(false);
    setStartedAt(null);
    setLivePin(null);
    setKeepAwake(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.stop, setKeepAwake]);

  /* ---------------------------- socket lifecycle --------------------------- */
  const onConnect = useEffectEvent(async (s: Socket) => {
    setConnected(true);
    if (!sessionId.current) return;
    // Reconnected mid-broadcast: resume the same session.
    try {
      const res = await emitWithAck(s, "speaker:start", { sourceLang: source.code, resumeSessionId: sessionId.current });
      if (!res.ok) throw new Error(res.error);
      sessionId.current = res.sessionId;
      streamReady.current = true;
      if (!res.resumed) setNotice(t("speak.newSessionStarted"));
      for (const f of pendingFinals.current.splice(0)) s.emit("speaker:final", f);
    } catch {
      setNotice(t("speak.resumeFailed"));
    }
  });
  const onReplaced = useEffectEvent(() => {
    setNotice(t("speak.replaced"));
    endLocal();
  });

  useEffect(() => {
    if (!socket) return;
    const handleConnect = () => void onConnect(socket);
    const handleDisconnect = () => {
      setConnected(false);
      streamReady.current = false;
    };
    const handleStats = (d: { listeners: number }) => setListeners(d.listeners);
    const handleReplaced = () => onReplaced();
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:stats", handleStats);
    socket.on("speaker:replaced", handleReplaced);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:stats", handleStats);
      socket.off("speaker:replaced", handleReplaced);
      socket.disconnect();
    };
  }, [socket]);

  // Connected while live, and while a screen that needs it (Speak) is open.
  const needConnection = phase !== "setup" || retained > 0;
  useEffect(() => {
    if (!socket) return;
    if (needConnection) socket.connect();
    else socket.disconnect();
  }, [socket, needConnection]);

  // Signing out (or switching account) while live ends the broadcast on this device.
  useEffect(() => {
    if (!token && sessionId.current) endLocal();
  }, [token, endLocal]);

  const retainConnection = useCallback(() => {
    setRetained((n) => n + 1);
    return () => setRetained((n) => n - 1);
  }, []);

  const goLive = useCallback(
    async (o: GoLiveOptions): Promise<GoLiveResult> => {
      if (!socket) return "failed";
      setNotice(null);
      setPhase("starting");
      const language = LANGUAGES[o.sourceLang] ?? LANGUAGES[DEFAULT_SOURCE];
      setSource(language);
      setLocale(o.locale);
      try {
        const res = await emitWithAck(socket, "speaker:start", {
          sourceLang: language.code,
          title: o.title,
          pin: o.pin,
          translationMode: o.mode,
          allowRevisit: o.allowRevisit,
        });
        if (!res.ok) {
          setPhase("setup");
          if (res.error === "email_unverified") return "unverified";
          if (res.error === "speaking_not_allowed") return "notAllowed";
          setNotice(res.error === "unauthorized" ? t("speak.sessionExpired") : t("speak.startFailed"));
          return "failed";
        }
        sessionId.current = res.sessionId;
        streamReady.current = true;
        seq.current = 0;
        seqHasContent.current = false;
        setListeners(res.listeners ?? 0);
        setLivePin(o.pin);
        reset();
      } catch {
        setPhase("setup");
        setNotice(connected ? t("speak.startFailed") : t("common.offline"));
        return "failed";
      }
      const started = await capture.start(o.locale);
      if (!started) {
        await emitWithAck(socket, "speaker:stop", {}).catch(() => {});
        endLocal();
        return "failed";
      }
      setStartedAt(Date.now());
      setPhase("live");
      setKeepAwake(true);
      return "ok";
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [socket, connected, capture.start, endLocal, reset, setKeepAwake, t],
  );

  const stop = useCallback(async () => {
    setPhase("stopping");
    capture.stop();
    // Give the recognizer a moment to deliver the last final result.
    await new Promise((r) => setTimeout(r, 600));
    if (socket) await emitWithAck(socket, "speaker:stop", {}).catch(() => {});
    endLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, capture.stop, endLocal]);

  const togglePause = useCallback(async () => {
    if (paused) {
      if (await capture.start()) setPaused(false);
    } else {
      capture.stop();
      setPaused(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, capture.start, capture.stop]);

  // Web: closing or reloading the tab while live would end the broadcast, so ask first.
  const live = phase === "live" || phase === "stopping";
  useEffect(() => {
    if (Platform.OS !== "web" || !live || typeof window === "undefined") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [live]);

  useEffect(() => () => setKeepAwake(false), [setKeepAwake]);

  const value = useMemo<BroadcastState>(
    () => ({
      phase,
      paused,
      connected,
      listeners,
      startedAt,
      livePin,
      source,
      lines,
      notice,
      setNotice,
      capture: { supported: capture.supported, error: capture.error, volume: capture.volume },
      goLive,
      stop,
      togglePause,
      retainConnection,
    }),
    [phase, paused, connected, listeners, startedAt, livePin, source, lines, notice, capture.supported, capture.error, capture.volume, goLive, stop, togglePause, retainConnection],
  );

  return (
    <BroadcastContext.Provider value={value}>
      {children}
      <LiveBar />
    </BroadcastContext.Provider>
  );
}

/** Shown on every screen except Speak while the speaker is live: status, and a way back. */
function LiveBar() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useI18n();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const b = useBroadcast();
  const live = b.phase === "live" || b.phase === "stopping";
  const now = useNow(live);
  if (!live || pathname === "/speak") return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + spacing.md }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("liveBar.back")}
        onPress={() => router.push("/speak")}
        style={({ pressed }) => [styles.bar, pressed && { opacity: 0.9 }]}
      >
        <View style={[styles.dot, (b.paused || !b.connected) && { backgroundColor: colors.warning }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {b.paused ? t("badge.paused") : !b.connected ? t("badge.reconnecting") : t("liveBar.live")}
            {b.startedAt ? ` · ${formatDuration(now - b.startedAt)}` : ""}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {t("liveBar.listeners", { count: b.listeners })}
          </Text>
        </View>
        <Text style={styles.back}>{t("liveBar.back")}</Text>
        <Ionicons name="chevron-forward" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingHorizontal: spacing.lg },
  bar: {
    width: "100%",
    maxWidth: 520,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.live,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#fff" },
  title: { color: "#fff", fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  sub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 1 },
  back: { color: "#fff", fontSize: 14, fontWeight: "700" },
}));
