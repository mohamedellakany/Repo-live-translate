import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { AppHeader, Banner, Button, Card, IconButton, Screen } from "@/components/ui";
import { DEFAULT_TARGET } from "@/constants/languages";
import { useI18n } from "@/i18n";
import { api, type Summary, type TranscriptSegment } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useServerConfig } from "@/lib/serverConfig";
import { colors, radius, spacing } from "@/theme";

export default function SessionTranscript() {
  const { t } = useI18n();
  const { features } = useServerConfig();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.session>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    api.session(String(id)).then(setData).catch((e) => setError(e.message));
  }, [id]);

  const summary = data?.session.summary ?? null;

  const asText = (segments: TranscriptSegment[]) =>
    segments.map((s) => `${s.translations[DEFAULT_TARGET] ?? ""}\n${s.original}`).join("\n\n");
  const summaryText = (s: Summary) =>
    [
      s.title,
      s.overview,
      s.key_points.length ? `${t("history.keyPoints")}:\n${s.key_points.map((p) => `• ${p}`).join("\n")}` : "",
      s.decisions.length ? `${t("history.decisions")}:\n${s.decisions.map((p) => `• ${p}`).join("\n")}` : "",
      s.action_items.length
        ? `${t("history.actionItems")}:\n${s.action_items.map((a) => `☐ ${a.task}${a.owner ? ` (${a.owner})` : ""}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

  const share = async () => {
    if (!data) return;
    const text = [
      data.session.title || t("common.appName"),
      formatDateTime(data.session.startedAt),
      summary ? summaryText(summary) : "",
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
            <Text style={styles.title}>{data.session.title || summary?.title || t("history.untitled")}</Text>
            <Text style={styles.meta}>
              {[
                formatDateTime(data.session.startedAt),
                t("history.lines", { count: data.segments.length }),
                t("history.listeners", { count: data.session.peakListeners }),
              ].join(" · ")}
            </Text>
            {data.session.charsTranslated > 0 && (
              <Text style={styles.meta}>{t("history.chars", { count: data.session.charsTranslated.toLocaleString() })}</Text>
            )}
          </View>

          {summary ? (
            <Card style={styles.summary}>
              <View style={styles.summaryHead}>
                <Ionicons name="sparkles" size={18} color={colors.primary} />
                <Text style={styles.summaryLabel}>{t("history.summary")}</Text>
              </View>
              <Text style={[styles.body, styles.ltr]}>{summary.overview}</Text>
              <SummaryList title={t("history.keyPoints")} items={summary.key_points} />
              <SummaryList title={t("history.decisions")} items={summary.decisions} />
              <SummaryList
                title={t("history.actionItems")}
                items={summary.action_items.map((a) => `${a.task}${a.owner ? ` (${a.owner})` : ""}`)}
                bullet="☐"
              />
              <Text style={styles.note}>{t("history.summaryNote")}</Text>
              {features.summaries && (
                <Button title={t("history.regenerate")} variant="ghost" icon="refresh" onPress={summarize} loading={summarizing} />
              )}
            </Card>
          ) : features.summaries && data.segments.length > 0 && data.session.endedAt ? (
            <Button
              title={summarizing ? t("history.generating") : t("history.generateSummary")}
              icon="sparkles-outline"
              variant="secondary"
              onPress={summarize}
              loading={summarizing}
            />
          ) : null}

          {data.segments.length === 0 && <Text style={styles.meta}>{t("history.nothingSaid")}</Text>}
          {data.segments.map((s) => (
            <View key={s.seq} style={styles.segment}>
              <Text style={[styles.translation, styles.ltr]} selectable>
                {s.translations[DEFAULT_TARGET] ?? "—"}
              </Text>
              <Text style={styles.original} selectable>
                {s.original}
              </Text>
            </View>
          ))}
          <Button title={t("history.deleteSession")} icon="trash-outline" variant="danger" onPress={remove} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      )}
    </Screen>
  );
}

function SummaryList({ title, items, bullet = "•" }: { title: string; items: string[]; bullet?: string }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.listTitle}>{title}</Text>
      {items.map((item, i) => (
        <Text key={i} style={[styles.body, styles.ltr]}>
          {bullet} {item}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 13 },
  summary: { borderColor: colors.primary },
  summaryHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  summaryLabel: { color: colors.primary, fontSize: 13, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  listTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: spacing.xs },
  body: { color: colors.text, fontSize: 15, lineHeight: 23 },
  note: { color: colors.textDim, fontSize: 12 },
  ltr: { writingDirection: "ltr", textAlign: "left" },
  segment: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, gap: 6 },
  translation: { color: colors.text, fontSize: 17, lineHeight: 25 },
  original: { color: colors.textMuted, fontSize: 15, lineHeight: 24, writingDirection: "rtl", textAlign: "right" },
});
