import { Ionicons } from "@expo/vector-icons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/auth/AuthProvider";
import { CaptionFeed } from "@/components/CaptionFeed";
import { ShareCard } from "@/components/ShareCard";
import {
  AppHeader,
  Banner,
  Button,
  Card,
  IconButton,
  LiveBadge,
  OptionSheet,
  Screen,
  SelectRow,
  SwitchRow,
  TextField,
} from "@/components/ui";
import {
  ARABIC_DIALECTS,
  DEFAULT_DIALECT,
  DEFAULT_SOURCE,
  DEFAULT_TARGET,
  LANGUAGES,
  TRANSLATION_MODES,
  type ArabicDialect,
  type TranslationMode,
} from "@/constants/languages";
import { useCaptions } from "@/hooks/useCaptions";
import { isExpoGo, useSpeechCapture } from "@/hooks/useSpeechCapture";
import { useI18n } from "@/i18n";
import { formatDuration } from "@/lib/format";
import { createSocket, emitWithAck } from "@/lib/socket";
import { storage } from "@/lib/storage";
import { colors, radius, spacing } from "@/theme";

const PARTIAL_THROTTLE_MS = 100;
const KEEP_AWAKE_TAG = "speak";
const PREFS_KEY = "lt.speakerPrefs";
const PIN_RE = /^\d{4,8}$/;

type Phase = "setup" | "starting" | "live" | "stopping";

export default function Speak() {
  const { t } = useI18n();
  const { user, token, ready } = useAuth();
  const source = LANGUAGES[DEFAULT_SOURCE];
  const preview = LANGUAGES[DEFAULT_TARGET];

  const socket = useMemo<Socket | null>(() => (token ? createSocket(token) : null), [token]);
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup");
  const [paused, setPaused] = useState(false);
  const [title, setTitle] = useState("");
  const [dialect, setDialect] = useState<ArabicDialect>(DEFAULT_DIALECT);
  const [mode, setMode] = useState<TranslationMode>("live");
  const [isPrivate, setIsPrivate] = useState(false);
  const [pin, setPin] = useState("");
  const [livePin, setLivePin] = useState<string | null>(null);
  const [picker, setPicker] = useState<"dialect" | "mode" | null>(null);
  const [listeners, setListeners] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);

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

  const { lines, reset } = useCaptions(socket, preview.code);

  // Remember the speaker's dialect and translation mode between sessions.
  useEffect(() => {
    storage.getJSON<{ dialect?: ArabicDialect; mode?: TranslationMode }>(PREFS_KEY, {}).then((p) => {
      if (p.dialect && ARABIC_DIALECTS.includes(p.dialect)) setDialect(p.dialect);
      if (p.mode && TRANSLATION_MODES.includes(p.mode)) setMode(p.mode);
    });
  }, []);
  const savePrefs = (patch: { dialect?: ArabicDialect; mode?: TranslationMode }) =>
    storage.setJSON(PREFS_KEY, { dialect, mode, ...patch });

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

  const capture = useSpeechCapture({ locale: dialect, onPartial, onFinal });

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
    socket.connect();
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:stats", handleStats);
      socket.off("speaker:replaced", handleReplaced);
      socket.disconnect();
    };
  }, [socket]);

  const pinError = isPrivate && pin && !PIN_RE.test(pin) ? t("speak.pinInvalid") : null;
  const canStart = connected && capture.supported && (!isPrivate || PIN_RE.test(pin));

  const goLive = async () => {
    if (!socket) return;
    setNotice(null);
    setPhase("starting");
    const sessionPin = isPrivate ? pin : null;
    try {
      const res = await emitWithAck(socket, "speaker:start", {
        sourceLang: source.code,
        title: title.trim() || null,
        pin: sessionPin,
        translationMode: mode,
      });
      if (!res.ok) {
        if (res.error === "email_unverified") return router.replace({ pathname: "/verify-email", params: { next: "/speak" } });
        throw new Error(res.error === "unauthorized" ? t("speak.sessionExpired") : t("speak.startFailed"));
      }
      sessionId.current = res.sessionId;
      streamReady.current = true;
      seq.current = 0;
      seqHasContent.current = false;
      setListeners(res.listeners ?? 0);
      setLivePin(sessionPin);
      reset();
    } catch (e) {
      setPhase("setup");
      setNotice(connected ? (e as Error).message : t("common.offline"));
      return;
    }
    const started = await capture.start();
    if (!started) {
      await emitWithAck(socket, "speaker:stop", {}).catch(() => {});
      endLocal();
      return;
    }
    setStartedAt(Date.now());
    setPhase("live");
    setKeepAwake(true);
  };

  const stopLive = async () => {
    setPhase("stopping");
    capture.stop();
    // Give the recognizer a moment to deliver the last final result.
    await new Promise((r) => setTimeout(r, 600));
    if (socket) await emitWithAck(socket, "speaker:stop", {}).catch(() => {});
    endLocal();
  };

  const togglePause = async () => {
    if (paused) {
      if (await capture.start()) setPaused(false);
    } else {
      capture.stop();
      setPaused(true);
    }
  };

  // Leaving the screen disconnects the socket; the server ends the session after its reconnect grace period.
  useEffect(() => () => setKeepAwake(false), [setKeepAwake]);

  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  /* --------------------------------- render -------------------------------- */
  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { next: "/speak" } }} />;
  if (!user) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
      </Screen>
    );
  }
  if (!user.emailVerified) return <Redirect href={{ pathname: "/verify-email", params: { next: "/speak" } }} />;

  const isLive = phase === "live" || phase === "stopping";
  const header = (
    <AppHeader
      title={isLive ? undefined : t("speak.header")}
      back={!isLive}
      right={<IconButton icon="qr-code-outline" label={t("speak.share")} onPress={() => setShowShare((v) => !v)} active={showShare} />}
    />
  );

  if (!isLive) {
    return (
      <Screen scroll header={header}>
        {notice && <Banner tone="warning" text={notice} />}
        {capture.error && <Banner tone="error" text={t(capture.error)} />}
        {!capture.supported && <Banner tone="warning" text={t(isExpoGo ? "speech.expoGo" : "speak.unsupported")} />}
        {!connected && <Banner tone="info" icon="cloud-offline-outline" text={t("speak.connecting")} />}

        <ShareCard username={user.username} displayName={user.displayName} pin={isPrivate && PIN_RE.test(pin) ? pin : null} />

        <Card style={{ gap: spacing.sm }}>
          <TextField
            label={t("speak.title")}
            placeholder={t("speak.titlePlaceholder")}
            value={title}
            onChangeText={setTitle}
            maxLength={120}
          />
          <SelectRow
            icon="mic-outline"
            label={t("speak.dialect")}
            hint={t("speak.dialectHint")}
            value={t(`dialect.${dialect}`)}
            onPress={() => setPicker("dialect")}
          />
          <View style={styles.infoRow}>
            <Ionicons name="eye-outline" size={20} color={colors.textMuted} />
            <Text style={styles.infoLabel}>{t("speak.theyRead")}</Text>
            <Text style={styles.infoValue}>{t("speak.theyReadValue")}</Text>
          </View>
          <SelectRow
            icon="speedometer-outline"
            label={t("speak.mode")}
            hint={t(`mode.${mode}Desc`)}
            value={t(`mode.${mode}`)}
            onPress={() => setPicker("mode")}
          />
          <SwitchRow
            label={t("speak.private")}
            hint={t("speak.privateHint")}
            value={isPrivate}
            onValueChange={(v) => {
              setIsPrivate(v);
              if (v && !pin) setPin(String(Math.floor(1000 + Math.random() * 9000)));
            }}
          />
          {isPrivate && (
            <View style={styles.pinRow}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={t("speak.pin")}
                  value={pin}
                  onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 8))}
                  keyboardType="number-pad"
                  error={pinError}
                />
              </View>
              <Button
                title={t("speak.pinGenerate")}
                variant="secondary"
                icon="refresh"
                onPress={() => setPin(String(Math.floor(1000 + Math.random() * 9000)))}
                style={{ marginTop: 22 }}
              />
            </View>
          )}
        </Card>

        <Button
          title={phase === "starting" ? t("speak.starting") : t("speak.goLive")}
          icon="radio-outline"
          variant="live"
          size="lg"
          onPress={goLive}
          loading={phase === "starting"}
          disabled={!canStart}
        />
        <Text style={styles.tip}>{t("speak.tip")}</Text>

        <OptionSheet
          visible={picker === "dialect"}
          onClose={() => setPicker(null)}
          title={t("speak.dialect")}
          selected={dialect}
          options={ARABIC_DIALECTS.map((d) => ({ value: d, label: t(`dialect.${d}`) }))}
          onSelect={(d) => {
            setDialect(d);
            savePrefs({ dialect: d });
          }}
        />
        <OptionSheet
          visible={picker === "mode"}
          onClose={() => setPicker(null)}
          title={t("speak.mode")}
          selected={mode}
          options={TRANSLATION_MODES.map((m) => ({ value: m, label: t(`mode.${m}`), description: t(`mode.${m}Desc`) }))}
          onSelect={(m) => {
            setMode(m);
            savePrefs({ mode: m });
          }}
        />
      </Screen>
    );
  }

  const elapsed = startedAt ? now - startedAt : 0;
  return (
    <Screen header={header} contentStyle={{ paddingBottom: 0 }}>
      <View style={styles.liveBar}>
        <LiveBadge state={!connected ? "reconnecting" : paused ? "paused" : "live"} />
        <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
        {livePin && (
          <View style={styles.pinBadge}>
            <Ionicons name="lock-closed" size={12} color={colors.warning} />
            <Text style={styles.pinBadgeText}>{t("speak.pinBadge", { pin: livePin })}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Ionicons name="people" size={18} color={colors.textMuted} />
        <Text style={styles.listeners} accessibilityLabel={t("speak.listeners", { count: listeners })}>
          {listeners}
        </Text>
      </View>

      {showShare && (
        <ScrollView style={{ maxHeight: 440, flexGrow: 0 }}>
          <ShareCard username={user.username} displayName={user.displayName} pin={livePin} />
        </ScrollView>
      )}
      {notice && <Banner tone="warning" text={notice} />}
      {capture.error && <Banner tone="error" text={t(capture.error)} />}
      {!connected && <Banner tone="warning" icon="cloud-offline-outline" text={t("speak.connectionLost")} />}

      <View style={styles.feed}>
        <CaptionFeed
          lines={lines}
          mode="speaker"
          empty={
            <View style={{ alignItems: "center", gap: spacing.sm }}>
              <Ionicons name="mic" size={36} color={colors.textDim} />
              <Text style={styles.emptyText}>{paused ? t("speak.paused") : t("speak.startSpeaking")}</Text>
              <Text style={styles.emptySub}>{t("speak.feedHint")}</Text>
            </View>
          }
        />
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={togglePause}
          accessibilityRole="button"
          accessibilityLabel={paused ? t("speak.resume") : t("speak.pause")}
          style={[styles.micButton, paused && { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        >
          <View
            style={[
              styles.micPulse,
              { transform: [{ scale: 1 + capture.volume * 0.35 }], opacity: paused ? 0 : 0.25 + capture.volume * 0.5 },
            ]}
          />
          <Ionicons name={paused ? "mic-off" : "mic"} size={30} color="#fff" />
        </Pressable>
        <Button
          title={phase === "stopping" ? t("speak.ending") : t("speak.end")}
          icon="stop-circle-outline"
          variant="danger"
          onPress={stopLive}
          loading={phase === "stopping"}
          style={{ flex: 1 }}
        />
        <IconButton icon="time-outline" label={t("home.pastSessions")} onPress={() => router.push("/history")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
  infoLabel: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
  infoValue: { color: colors.textMuted, fontSize: 15 },
  pinRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  tip: { color: colors.textDim, fontSize: 13, textAlign: "center", lineHeight: 19 },
  liveBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  timer: { color: colors.text, fontSize: 16, fontVariant: ["tabular-nums"], fontWeight: "600" },
  pinBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pinBadgeText: { color: colors.warning, fontSize: 12, fontWeight: "700" },
  listeners: { color: colors.text, fontSize: 16, fontWeight: "700", minWidth: 20 },
  feed: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  emptyText: { color: colors.textMuted, fontSize: 17, fontWeight: "600" },
  emptySub: { color: colors.textDim, fontSize: 14, textAlign: "center" },
  controls: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  micButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.live,
    borderWidth: 1,
    borderColor: colors.live,
    alignItems: "center",
    justifyContent: "center",
  },
  micPulse: { position: "absolute", width: 68, height: 68, borderRadius: 34, backgroundColor: colors.live },
});
