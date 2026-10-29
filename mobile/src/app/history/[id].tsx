import * as Clipboard from "expo-clipboard";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, Share, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { SummaryCard, summaryText } from "@/components/SummaryCard";
import { AppHeader, Banner, Button, Card, IconButton, Screen, SwitchRow } from "@/components/ui";
import { DEFAULT_TARGET, LANGUAGES } from "@/constants/languages";
import { useI18n } from "@/i18n";
import { api, type TranscriptSegment } from "@/lib/api";
import { formatDateTime, formatSessionDate, formatTime } from "@/lib/format";
import { useServerConfig } from "@/lib/serverConfig";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

export default function SessionTranscript() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t, lang } = useI18n();
  const { features } = useServerConfig();
  const { user, ready } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.session>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  // After a reload the saved login is restored asynchronously; fetching before then fails with "Authentication required".
  useEffect(() => {
    if (!user) return;
    api.session(String(id)).then(setData).catch((e) => setError(e.message));
  }, [id, user]);

  const summary = data?.session.summary ?? null;
  // Sessions are summarized automatically when they end; refresh until that summary arrives.
  const summaryPending = !summary && !!data?.session.summaryPending;
  useEffect(() => {
    if (!summaryPending) return;
    const timer = setInterval(() => {
      api.session(String(id)).then(setData).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [summaryPending, id]);

  const namedTitle = data ? data.session.title || summary?.title || null : null;
  const sourceRtl = data ? (LANGUAGES[data.session.sourceLang]?.rtl ?? true) : true;

  const asText = (segments: TranscriptSegment[]) =>
    segments.map((s) => `${s.translations[DEFAULT_TARGET] ?? ""}\n${s.original}`).join("\n\n");

  const share = async () => {
    if (!data) return;
    const text = [
      namedTitle || formatSessionDate(data.session.startedAt, lang),
      formatDateTime(data.session.startedAt),
      summary ? summaryText(summary, t) : "",
      `${t("history.transcript")}:\n\n${asText(data.segments)}`,
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

  const summarize = async () => {
    setSummarizing(true);
    setError(null);
    try {
      // Summaries are written in the default reading language (English).
      const res = await api.summarize(String(id), DEFAULT_TARGET);
      setData((d) => (d ? { ...d, session: { ...d.session, summary: res.summary } } : d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSummarizing(false);
    }
  };

  const setAllowRevisit = async (allowRevisit: boolean) => {
    setError(null);
    setData((d) => (d ? { ...d, session: { ...d.session, allowRevisit } } : d));
    try {
      await api.updateSession(String(id), { allowRevisit });
    } catch (e) {
      setData((d) => (d ? { ...d, session: { ...d.session, allowRevisit: !allowRevisit } } : d));
      setError((e as Error).message);
    }
  };

  const remove = () => {
    const doDelete = async () => {
      try {
        await api.deleteSession(String(id));
        router.back();
      } catch (e) {
        setError((e as Error).message);
      }
    };
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(`${t("history.deleteConfirmTitle")}\n${t("history.deleteConfirm")}`)) doDelete();
    } else {
      Alert.alert(t("history.deleteConfirmTitle"), t("history.deleteConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: doDelete },
      ]);
    }
  };

  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { next: `/history/${id}` } }} />;

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
      {data && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
          <View style={{ gap: 4 }}>
            <Text style={styles.title}>{namedTitle || formatSessionDate(data.session.startedAt, lang)}</Text>
            <Text style={styles.meta}>
              {[
                namedTitle ? formatDateTime(data.session.startedAt) : formatTime(data.session.startedAt, lang),
                t("history.lines", { count: data.segments.length }),
                t("history.listeners", { count: data.session.peakListeners }),
              ].join(" · ")}
            </Text>
            {data.session.charsTranslated > 0 && (
              <Text style={styles.meta}>{t("history.chars", { count: data.session.charsTranslated.toLocaleString() })}</Text>
            )}
          </View>

          {summary ? (
            <SummaryCard summary={summary}>
              {features.summaries && (
                <Button title={t("history.regenerate")} variant="ghost" icon="refresh" onPress={summarize} loading={summarizing} />
              )}
            </SummaryCard>
          ) : features.summaries && data.segments.length > 0 && data.session.endedAt ? (
            <Button
              title={summarizing || summaryPending ? t("history.generating") : t("history.generateSummary")}
              icon="sparkles-outline"
              variant="secondary"
              onPress={summarize}
              loading={summarizing || summaryPending}
            />
          ) : null}

          <Card>
            <SwitchRow
              label={t("history.allowRevisit")}
              hint={t("history.allowRevisitHint")}
              value={data.session.allowRevisit}
              onValueChange={setAllowRevisit}
            />
          </Card>

          {data.segments.length === 0 && <Text style={styles.meta}>{t("history.nothingSaid")}</Text>}
          {data.segments.map((s) => (
            <View key={s.seq} style={styles.segment}>
              <Text style={[styles.translation, styles.ltr]} selectable>
                {s.translations[DEFAULT_TARGET] ?? "—"}
              </Text>
              {s.original !== s.translations[DEFAULT_TARGET] && (
                <Text style={[styles.original, sourceRtl ? styles.rtl : styles.ltr]} selectable>
                  {s.original}
                </Text>
              )}
            </View>
          ))}
          <Button title={t("history.deleteSession")} icon="trash-outline" variant="danger" onPress={remove} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 13 },
  ltr: { writingDirection: "ltr", textAlign: "left" },
  rtl: { writingDirection: "rtl", textAlign: "right" },
  segment: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, gap: 6 },
  translation: { color: colors.text, fontSize: 17, lineHeight: 25 },
  original: { color: colors.textMuted, fontSize: 15, lineHeight: 24 },
}));
