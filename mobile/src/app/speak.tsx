import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { useBroadcast, useNow } from "@/broadcast/BroadcastProvider";
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
  LANGUAGES,
  SOURCE_LANGUAGES,
  TRANSLATION_MODES,
  type ArabicDialect,
  type TranslationMode,
} from "@/constants/languages";
import { isExpoGo } from "@/hooks/useSpeechCapture";
import { useI18n } from "@/i18n";
import { formatDuration } from "@/lib/format";
import { storage } from "@/lib/storage";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

const PREFS_KEY = "lt.speakerPrefs";
const PIN_RE = /^\d{4,8}$/;

/** `modeChosen`: the speaker picked the mode themselves (older versions saved "live" with every setting). */
type SpeakerPrefs = { sourceLang?: string; dialect?: ArabicDialect; mode?: TranslationMode; modeChosen?: boolean };
/** "Balanced" by default: still feels live (updates about once a second) with roughly 3-4x fewer characters. */
const DEFAULT_MODE: TranslationMode = "balanced";

export default function Speak() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  const { user, ready, refresh } = useAuth();
  const broadcast = useBroadcast();
  const { phase, paused, connected, listeners, startedAt, livePin, lines, notice, capture } = broadcast;

  const [sourceLang, setSourceLang] = useState(DEFAULT_SOURCE);
  const source = LANGUAGES[sourceLang] ?? LANGUAGES[DEFAULT_SOURCE];
  const [title, setTitle] = useState("");
  const [dialect, setDialect] = useState<ArabicDialect>(DEFAULT_DIALECT);
  const [mode, setMode] = useState<TranslationMode>(DEFAULT_MODE);
  const [modeChosen, setModeChosen] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [allowRevisit, setAllowRevisit] = useState(true);
  const [pin, setPin] = useState("");
  const [picker, setPicker] = useState<"language" | "dialect" | "mode" | null>(null);
  const [showShare, setShowShare] = useState(false);

  // The broadcast itself lives in BroadcastProvider; this screen keeps the connection open to show its status.
  const { retainConnection } = broadcast;
  useEffect(() => retainConnection(), [retainConnection]);

  // Remember the speaker's language, dialect and translation mode between sessions (Arabic until they pick another).
  useEffect(() => {
    storage.getJSON<SpeakerPrefs>(PREFS_KEY, {}).then((p) => {
      if (p.sourceLang && SOURCE_LANGUAGES.includes(p.sourceLang)) setSourceLang(p.sourceLang);
      if (p.dialect && ARABIC_DIALECTS.includes(p.dialect)) setDialect(p.dialect);
      if (p.modeChosen && p.mode && TRANSLATION_MODES.includes(p.mode)) {
        setMode(p.mode);
        setModeChosen(true);
      }
    });
  }, []);
  const savePrefs = (patch: SpeakerPrefs) => storage.setJSON(PREFS_KEY, { sourceLang, dialect, mode, modeChosen, ...patch });

  // While live, the spoken language is the broadcast's; before that, the one being picked.
  const isLive = phase === "live" || phase === "stopping";
  const spoken = isLive ? broadcast.source : source;
  // The generic "not supported" message talks about Arabic dialects, so use a different one for other languages.
  const captureError =
    capture.error === "speech.languageNotSupported" && spoken.code !== "ar" ? "speech.languageNotSupportedOther" : capture.error;

  const pinError = isPrivate && pin && !PIN_RE.test(pin) ? t("speak.pinInvalid") : null;
  const canStart = connected && capture.supported && (!isPrivate || PIN_RE.test(pin));

  const goLive = async () => {
    const result = await broadcast.goLive({
      sourceLang: source.code,
      // Arabic uses the chosen dialect's recognizer; other languages use their standard locale.
      locale: source.code === "ar" ? dialect : source.ttsLocale,
      title: title.trim() || null,
      pin: isPrivate ? pin : null,
      mode,
      allowRevisit,
    });
    if (result === "unverified") router.replace({ pathname: "/verify-email", params: { next: "/speak" } });
    // Access was taken away since the app last checked: reload the account so the page explains why.
    if (result === "notAllowed") refresh().catch(() => {});
  };

  // Speaking is by approval. If this account doesn't have it yet, re-check once in case it was just granted.
  const [checkingAccess, setCheckingAccess] = useState(false);
  const checkAccess = async () => {
    setCheckingAccess(true);
    await refresh().catch(() => {});
    setCheckingAccess(false);
  };
  const lacksAccess = !!user && !user.canSpeak;
  useEffect(() => {
    if (lacksAccess) refresh().catch(() => {});
    // Only when the access state changes; `refresh` changes identity every time the user object does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lacksAccess]);

  const now = useNow(phase === "live");

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
  if (!user.canSpeak && phase === "setup") {
    return (
      <Screen scroll header={<AppHeader title={t("speak.header")} />}>
        <Card style={{ gap: spacing.md, alignItems: "center" }}>
          <Ionicons name="mic-off-outline" size={44} color={colors.textDim} />
          <Text style={styles.lockedTitle}>{t("speak.lockedTitle")}</Text>
          <Text style={styles.lockedText}>{t(user.speakRequestedAt ? "home.requestPending" : "speak.lockedText")}</Text>
          {!user.speakRequestedAt && (
            <Button title={t("home.requestAccess")} icon="mic-outline" onPress={() => router.push("/request-speaking")} />
          )}
          <Button title={t("speak.checkAgain")} icon="refresh" variant="secondary" loading={checkingAccess} onPress={checkAccess} />
        </Card>
      </Screen>
    );
  }

  const header = (
    <AppHeader
      title={isLive ? undefined : t("speak.header")}
      right={<IconButton icon="qr-code-outline" label={t("speak.share")} onPress={() => setShowShare((v) => !v)} active={showShare} />}
    />
  );

  if (!isLive) {
    return (
      <Screen scroll header={header}>
        {notice && <Banner tone="warning" text={notice} />}
        {captureError && <Banner tone="error" text={t(captureError)} />}
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
            icon="language-outline"
            label={t("speak.language")}
            hint={t("speak.languageHint")}
            value={source.nativeName}
            onPress={() => setPicker("language")}
          />
          {source.code === "ar" && (
            <SelectRow
              icon="mic-outline"
              label={t("speak.dialect")}
              hint={t("speak.dialectHint")}
              value={t(`dialect.${dialect}`)}
              onPress={() => setPicker("dialect")}
            />
          )}
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
              setAllowRevisit(!v); // private sessions default to not revisitable
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
          <SwitchRow
            label={t("speak.allowRevisit")}
            hint={t("speak.allowRevisitHint")}
            value={allowRevisit}
            onValueChange={setAllowRevisit}
          />
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
          visible={picker === "language"}
          onClose={() => setPicker(null)}
          title={t("speak.language")}
          selected={sourceLang}
          options={SOURCE_LANGUAGES.map((c) => ({ value: c, label: LANGUAGES[c].nativeName, description: LANGUAGES[c].name }))}
          onSelect={(c) => {
            setSourceLang(c);
            savePrefs({ sourceLang: c });
          }}
        />
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
            setModeChosen(true);
            savePrefs({ mode: m, modeChosen: true });
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
      {captureError && <Banner tone="error" text={t(captureError)} />}
      {!connected && <Banner tone="warning" icon="cloud-offline-outline" text={t("speak.connectionLost")} />}
      <Text style={styles.hint}>{t("speak.keepGoingHint")}</Text>

      <View style={styles.feed}>
        <CaptionFeed
          lines={lines}
          mode="speaker"
          originalRtl={spoken.rtl}
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
          onPress={broadcast.togglePause}
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
          onPress={broadcast.stop}
          loading={phase === "stopping"}
          style={{ flex: 1 }}
        />
        <IconButton icon="time-outline" label={t("home.pastSessions")} onPress={() => router.push("/history")} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  lockedTitle: { color: colors.text, fontSize: 20, fontWeight: "700", textAlign: "center" },
  lockedText: { color: colors.textMuted, fontSize: 15, lineHeight: 23, textAlign: "center" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
  infoLabel: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
  infoValue: { color: colors.textMuted, fontSize: 15 },
  pinRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  tip: { color: colors.textDim, fontSize: 13, textAlign: "center", lineHeight: 19 },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
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
}));
