import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/auth/AuthProvider";
import { CaptionFeed } from "@/components/CaptionFeed";
import { AppHeader, Banner, Button, Card, IconButton, LiveBadge, OptionSheet, Screen, TextField } from "@/components/ui";
import { DEFAULT_SOURCE, DEFAULT_TARGET, LANGUAGES, TARGET_LANGUAGES } from "@/constants/languages";
import { useCaptions, type CaptionLine, type HistoryItem } from "@/hooks/useCaptions";
import { useI18n } from "@/i18n";
import { normalizeUsername } from "@/lib/format";
import { recentSpeakers } from "@/lib/recentSpeakers";
import { createSocket, emitWithAck } from "@/lib/socket";
import { pendingLibrary } from "@/lib/pendingLibrary";
import { storage } from "@/lib/storage";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

interface Status {
  live: boolean;
  reconnecting: boolean;
  sessionId: string | null;
  title: string | null;
  private: boolean;
  sourceLang?: string;
  /** Signed-in listeners can reopen this session later from "My sessions". */
  revisit?: boolean;
}
type JoinState = "connecting" | "joined" | "pin" | "not_found" | "error";

const PREFS_KEY = "lt.listenerPrefs";
const FONT_SCALES = [0.85, 1, 1.2, 1.45, 1.75];
interface Prefs {
  showOriginal: boolean;
  fontIndex: number;
  readAloud: boolean;
  lang: string;
}

export default function Listen() {
  const { colors } = useTheme();
  const styles = useStyles();
  // Leaving before the browser grants the wake lock is normal; don't surface it as an error.
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const { t } = useI18n();
  const params = useLocalSearchParams<{ username: string }>();
  const username = normalizeUsername(String(params.username ?? ""));
  const { token, ready, user } = useAuth();

  // Created once auth state is known (token is optional for listeners); connected in an effect below.
  const socket = useMemo<Socket | null>(() => (ready ? createSocket(token) : null), [ready, token]);
  const [connected, setConnected] = useState(false);
  const [joinState, setJoinState] = useState<JoinState>("connecting");
  const [speaker, setSpeaker] = useState<{ username: string; displayName: string } | null>(null);
  const [status, setStatus] = useState<Status>({ live: false, reconnecting: false, sessionId: null, title: null, private: false });
  const [listeners, setListeners] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>({ showOriginal: true, fontIndex: 1, readAloud: false, lang: DEFAULT_TARGET });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [langPicker, setLangPicker] = useState(false);
  const [copied, setCopied] = useState(false);

  const target = LANGUAGES[prefs.lang] ?? LANGUAGES[DEFAULT_TARGET];
  const sessionRef = useRef<string | null>(null);
  const revisitRef = useRef(false);
  /** The session that just ended, to offer reading it again later. */
  const [ended, setEnded] = useState<{ sessionId: string; revisit: boolean } | null>(null);

  /** Track the current session; guests' sessions are remembered so they can be saved after signing up. */
  const noteSession = (st: Status, lang: string) => {
    if (!st.sessionId) return;
    revisitRef.current = !!st.revisit;
    setEnded(null);
    if (!token && st.revisit) void pendingLibrary.add({ sessionId: st.sessionId, lang });
  };
  const pinRef = useRef<string | null>(null);

  useEffect(() => {
    storage.getJSON<Partial<Prefs>>(PREFS_KEY, {}).then((p) => {
      setPrefs((cur) => ({
        ...cur,
        ...p,
        readAloud: false,
        lang: p.lang && TARGET_LANGUAGES.includes(p.lang) ? p.lang : DEFAULT_TARGET,
      }));
      setPrefsLoaded(true);
    });
  }, []);
  const updatePrefs = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      storage.setJSON(PREFS_KEY, next);
      return next;
    });

  const speak = useCallback(
    (line: CaptionLine) => {
      if (prefs.readAloud && line.translation) Speech.speak(line.translation, { language: target.ttsLocale });
    },
    [prefs.readAloud, target.ttsLocale],
  );
  const { lines, reset } = useCaptions(socket, target.code, speak);

  const join = useCallback(
    async (s: Socket, lang: string, pin: string | null) => {
      try {
        const res = await emitWithAck(s, "listener:join", { username, lang, pin });
        if (res.speaker) setSpeaker(res.speaker);
        if (!res.ok) {
          if (res.error === "pin_required" || res.error === "invalid_pin" || res.error === "too_many_attempts") {
            setJoinState("pin");
            setPinError(
              res.error === "invalid_pin" ? t("listen.invalidPin") : res.error === "too_many_attempts" ? t("listen.tooManyAttempts") : null,
            );
            return false;
          }
          setJoinState(res.error === "not_found" ? "not_found" : "error");
          return false;
        }
        pinRef.current = pin;
        setStatus(res.status);
        setListeners(res.listeners);
        sessionRef.current = res.status.sessionId;
        noteSession(res.status, lang);
        reset(res.history as HistoryItem[]);
        setJoinState("joined");
        setPinError(null);
        recentSpeakers.add(res.speaker);
        return true;
      } catch {
        setJoinState("error");
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [username, reset, t, token],
  );

  // (Re)join on every connect, with the current language and any PIN already accepted.
  const onConnect = useEffectEvent((s: Socket) => {
    setConnected(true);
    join(s, prefs.lang, pinRef.current);
  });
  const onStatus = useEffectEvent((st: Status) => {
    if (st.sessionId && st.sessionId !== sessionRef.current) reset(); // a new session began
    if (!st.sessionId && sessionRef.current) setEnded({ sessionId: sessionRef.current, revisit: revisitRef.current });
    noteSession(st, prefs.lang);
    sessionRef.current = st.sessionId;
    setStatus(st);
  });
  const onPinRequired = useEffectEvent(() => {
    pinRef.current = null;
    reset();
    setJoinState("pin");
  });

  // Connect once preferences are loaded; socket.io reconnects automatically.
  useEffect(() => {
    if (!socket || !prefsLoaded || !username) return;
    const handleConnect = () => onConnect(socket);
    const handleDisconnect = () => setConnected(false);
    const handleStatus = (st: Status) => onStatus(st);
    const handleStats = (d: { listeners: number }) => setListeners(d.listeners);
    const handlePinRequired = () => onPinRequired();
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleDisconnect);
    socket.on("speaker:status", handleStatus);
    socket.on("room:stats", handleStats);
    socket.on("listener:pin_required", handlePinRequired);
    socket.connect();
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleDisconnect);
      socket.off("speaker:status", handleStatus);
      socket.off("room:stats", handleStats);
      socket.off("listener:pin_required", handlePinRequired);
      socket.disconnect();
      Speech.stop();
    };
  }, [socket, prefsLoaded, username]);

  const changeLanguage = (lang: string) => {
    if (lang === prefs.lang) return;
    Speech.stop();
    updatePrefs({ lang });
    reset();
    if (socket?.connected) join(socket, lang, pinRef.current);
  };

  const submitPin = async () => {
    if (!socket) return;
    setJoining(true);
    await join(socket, prefs.lang, pinInput.trim());
    setJoining(false);
  };

  const copyTranscript = async () => {
    const text = lines
      .filter((l) => l.sourceFinal)
      .map((l) => (prefs.showOriginal ? `${l.translation ?? ""}\n${l.original}` : l.translation ?? ""))
      .join("\n\n");
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fontScale = FONT_SCALES[prefs.fontIndex] ?? 1;
  const liveState = status.live ? (status.reconnecting ? "reconnecting" : "live") : "offline";
  const speakerName = speaker?.displayName ?? `@${username}`;
  /** Signed in as the speaker (e.g. testing in a second tab of the same browser). */
  const isOwnSession = !!user && user.username === username;

  /* ------------------------------ error states ----------------------------- */
  if (joinState === "not_found" || joinState === "error") {
    return (
      <Screen header={<AppHeader title={t("listen.header")} />}>
        <View style={styles.center}>
          <Ionicons name={joinState === "not_found" ? "search" : "cloud-offline-outline"} size={48} color={colors.textDim} />
          <Text style={styles.centerTitle}>
            {joinState === "not_found" ? t("listen.notFoundTitle", { username }) : t("listen.errorTitle")}
          </Text>
          <Text style={styles.centerText}>{joinState === "not_found" ? t("listen.notFoundText") : t("listen.errorText")}</Text>
          <Button title={t("common.goBack")} variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        </View>
      </Screen>
    );
  }

  if (joinState === "pin") {
    return (
      <Screen scroll header={<AppHeader title={speakerName} />}>
        <Card style={{ marginTop: spacing.xl, alignItems: "stretch" }}>
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <Ionicons name="lock-closed" size={40} color={colors.warning} />
            <Text style={styles.centerTitle}>{t("listen.privateTitle")}</Text>
            <Text style={styles.centerText}>{t("listen.privateText", { name: speakerName })}</Text>
          </View>
          <TextField
            label={t("listen.pin")}
            value={pinInput}
            onChangeText={(v) => setPinInput(v.replace(/\D/g, "").slice(0, 8))}
            keyboardType="number-pad"
            autoFocus
            error={pinError}
            onSubmitEditing={submitPin}
            style={{ letterSpacing: 6, fontSize: 22, textAlign: "center" }}
          />
          <Button title={t("listen.join")} icon="enter-outline" onPress={submitPin} loading={joining} disabled={pinInput.length < 4} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      contentStyle={{ paddingBottom: 0 }}
      header={
        <AppHeader
          title={speakerName}
          right={
            <IconButton
              icon={prefs.readAloud ? "volume-high" : "volume-mute-outline"}
              label={prefs.readAloud ? t("listen.stopReading") : t("listen.readAloud")}
              active={prefs.readAloud}
              onPress={() => {
                if (prefs.readAloud) Speech.stop();
                updatePrefs({ readAloud: !prefs.readAloud });
              }}
            />
          }
        />
      }
    >
      <View style={styles.statusBar}>
        <LiveBadge state={liveState} />
        {status.private && <Ionicons name="lock-closed" size={14} color={colors.warning} accessibilityLabel={t("listen.private")} />}
        <Text style={styles.statusTitle} numberOfLines={1}>
          {status.title ?? `@${username}`}
        </Text>
        <Pressable
          style={styles.langButton}
          onPress={() => setLangPicker(true)}
          accessibilityRole="button"
          accessibilityLabel={t("listen.language")}
        >
          <Ionicons name="language" size={16} color={colors.primary} />
          <Text style={styles.langText}>{target.nativeName}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.primary} />
        </Pressable>
        <Ionicons name="people" size={16} color={colors.textMuted} />
        <Text style={styles.count}>{listeners}</Text>
      </View>

      {!connected && joinState === "joined" && <Banner tone="warning" icon="cloud-offline-outline" text={t("listen.reconnecting")} />}
      {status.live && status.reconnecting && <Banner tone="warning" text={t("listen.speakerDropped")} />}
      {ended && isOwnSession && (
        // Speakers aren't added to their own listeners' library; their sessions live in Past sessions.
        <Card style={styles.saveCard}>
          <View style={styles.saveHead}>
            <Ionicons name="time-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.saveTitle}>{t("listen.ownTitle")}</Text>
              <Text style={styles.saveText}>{t("listen.ownText")}</Text>
            </View>
            <Button
              title={t("listen.openSaved")}
              variant="secondary"
              onPress={() => router.push({ pathname: "/history/[id]", params: { id: ended.sessionId } })}
            />
          </View>
        </Card>
      )}
      {ended?.revisit &&
        !isOwnSession &&
        (user ? (
          <Card style={styles.saveCard}>
            <View style={styles.saveHead}>
              <Ionicons name="bookmark" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.saveTitle}>{t("listen.savedTitle")}</Text>
                <Text style={styles.saveText}>{t("listen.savedText")}</Text>
              </View>
              <Button
                title={t("listen.openSaved")}
                variant="secondary"
                onPress={() => router.push({ pathname: "/library/[id]", params: { id: ended.sessionId } })}
              />
            </View>
          </Card>
        ) : (
          <Card style={styles.saveCard}>
            <View style={styles.saveHead}>
              <Ionicons name="bookmark-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.saveTitle}>{t("listen.saveTitle")}</Text>
                <Text style={styles.saveText}>{t("listen.saveText")}</Text>
              </View>
            </View>
            <Button
              title={t("listen.saveCreate")}
              icon="person-add-outline"
              onPress={() => router.push({ pathname: "/register", params: { next: "/library" } })}
            />
            <Button
              title={t("listen.saveSignIn")}
              variant="ghost"
              onPress={() => router.push({ pathname: "/login", params: { next: "/library" } })}
            />
          </Card>
        ))}

      <View style={styles.feed}>
        {joinState === "connecting" ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.centerText}>{t("common.connecting")}</Text>
          </View>
        ) : (
          <CaptionFeed
            lines={lines}
            mode="listener"
            showOriginal={prefs.showOriginal}
            fontScale={fontScale}
            translationRtl={target.rtl}
            originalRtl={LANGUAGES[status.sourceLang ?? DEFAULT_SOURCE]?.rtl ?? true}
            empty={
              <View style={{ alignItems: "center", gap: spacing.sm }}>
                <Ionicons name={status.live ? "ear-outline" : "moon-outline"} size={40} color={colors.textDim} />
                <Text style={styles.centerTitle}>{status.live ? t("listen.listening") : t("listen.offlineTitle", { name: speakerName })}</Text>
                <Text style={styles.centerText}>{status.live ? t("listen.listeningText") : t("listen.offlineText")}</Text>
              </View>
            }
          />
        )}
      </View>

      <View style={styles.toolbar}>
        <IconButton icon="remove" label={t("listen.smaller")} onPress={() => updatePrefs({ fontIndex: Math.max(0, prefs.fontIndex - 1) })} />
        <Text style={styles.aa}>Aa</Text>
        <IconButton
          icon="add"
          label={t("listen.larger")}
          onPress={() => updatePrefs({ fontIndex: Math.min(FONT_SCALES.length - 1, prefs.fontIndex + 1) })}
        />
        <View style={{ flex: 1 }} />
        <Button
          title={prefs.showOriginal ? t("listen.hideOriginal") : t("listen.showOriginal")}
          variant="ghost"
          icon={prefs.showOriginal ? "eye-off-outline" : "eye-outline"}
          onPress={() => updatePrefs({ showOriginal: !prefs.showOriginal })}
        />
        <IconButton icon={copied ? "checkmark" : "copy-outline"} label={t("listen.copyTranscript")} onPress={copyTranscript} />
      </View>

      <OptionSheet
        visible={langPicker}
        onClose={() => setLangPicker(false)}
        title={t("listen.language")}
        selected={prefs.lang}
        options={TARGET_LANGUAGES.map((c) => ({ value: c, label: LANGUAGES[c].nativeName, description: LANGUAGES[c].name }))}
        onSelect={changeLanguage}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  statusBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusTitle: { flex: 1, color: colors.textMuted, fontSize: 14 },
  langButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  langText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  count: { color: colors.text, fontWeight: "700" },
  feed: { flex: 1, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  centerTitle: { color: colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" },
  centerText: { color: colors.textMuted, fontSize: 15, textAlign: "center", lineHeight: 22 },
  toolbar: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.sm },
  aa: { color: colors.textMuted, fontWeight: "700" },
  saveCard: { gap: spacing.sm, borderColor: colors.primary },
  saveHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  saveTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  saveText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
}));
