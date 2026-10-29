import * as Clipboard from "expo-clipboard";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, Share, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { SummaryCard, summaryText } from "@/components/SummaryCard";
import { AppHeader, Banner, Button, IconButton, Screen } from "@/components/ui";
import { LANGUAGES } from "@/constants/languages";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { formatDateTime, formatSessionDate, formatTime } from "@/lib/format";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

/** Read-only transcript of a session the listener attended. */
export default function LibrarySession() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t, lang } = useI18n();
  const { user, ready } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.librarySession>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Wait for the saved login to be restored after a reload before fetching.
  useEffect(() => {
    if (!user) return;
    api.librarySession(String(id)).then(setData).catch((e) => setError(e.message));
  }, [id, user]);

  const session = data?.session;
  const summary = session?.summary ?? null;
  const sourceRtl = session ? (LANGUAGES[session.sourceLang]?.rtl ?? true) : true;
  const title = session ? session.title || formatSessionDate(session.startedAt, lang) : "";

  const share = async () => {
    if (!data || !session) return;
    const text = [
      title,
      `${session.speaker.displayName} (@${session.speaker.username}) · ${formatDateTime(session.startedAt)}`,
      summary ? summaryText(summary, t) : "",
      `${t("history.transcript")}:\n\n${data.segments.map((s) => `${s.translation ?? ""}\n${s.original}`).join("\n\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (Platform.OS === "web") {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      await Share.share({ message: text });
    }
  };

  const remove = () => {
    const doRemove = async () => {
      try {
        await api.removeFromLibrary(String(id));
        router.back();
      } catch (e) {
        setError((e as Error).message);
      }
    };
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(`${t("library.removeConfirmTitle")}\n${t("library.removeConfirm")}`)) doRemove();
    } else {
      Alert.alert(t("library.removeConfirmTitle"), t("library.removeConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("library.remove"), style: "destructive", onPress: doRemove },
      ]);
    }
  };

  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { next: `/library/${id}` } }} />;

  return (
    <Screen
      header={
        <AppHeader
          title={t("history.transcript")}
          right={data && <IconButton icon={copied ? "checkmark" : "share-outline"} label={t("common.share")} onPress={share} />}
        />
      }
      contentStyle={{ paddingBottom: 0 }}
    >
      {error && <Banner tone="error" text={error} />}
      {!data && !error && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />}
      {data && session && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
          <View style={{ gap: 4 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.speaker}>
              {session.speaker.displayName} · @{session.speaker.username}
            </Text>
            <Text style={styles.meta}>
              {[
                session.title ? formatDateTime(session.startedAt) : formatTime(session.startedAt, lang),
                t("history.lines", { count: data.segments.length }),
              ].join(" · ")}
            </Text>
          </View>

          {summary && <SummaryCard summary={summary} />}

          {data.segments.length === 0 && <Text style={styles.meta}>{t("history.nothingSaid")}</Text>}
          {data.segments.map((s) => {
            const translationRtl = LANGUAGES[s.translationLang]?.rtl ?? false;
            return (
              <View key={s.seq} style={styles.segment}>
                <Text style={[styles.translation, translationRtl ? styles.rtl : styles.ltr]} selectable>
                  {s.translation ?? "—"}
                </Text>
                {s.original !== s.translation && (
                  <Text style={[styles.original, sourceRtl ? styles.rtl : styles.ltr]} selectable>
                    {s.original}
                  </Text>
                )}
              </View>
            );
          })}
          <Button title={t("library.remove")} icon="bookmark-outline" variant="secondary" onPress={remove} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  speaker: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  meta: { color: colors.textMuted, fontSize: 13 },
  ltr: { writingDirection: "ltr", textAlign: "left" },
  rtl: { writingDirection: "rtl", textAlign: "right" },
  segment: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, gap: 6 },
  translation: { color: colors.text, fontSize: 17, lineHeight: 25 },
  original: { color: colors.textMuted, fontSize: 15, lineHeight: 24 },
}));
