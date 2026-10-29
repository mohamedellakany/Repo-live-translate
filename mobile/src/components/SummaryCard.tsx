import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Card } from "@/components/ui";
import { useI18n, type TKey } from "@/i18n";
import type { Summary } from "@/lib/api";
import { makeStyles, spacing, useTheme } from "@/theme";

/** AI summary of a session. `children` renders below it (e.g. a regenerate button). */
export function SummaryCard({ summary, children }: { summary: Summary; children?: ReactNode }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  return (
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
      {children}
    </Card>
  );
}

/** Plain-text version of a summary, for sharing or copying. */
export function summaryText(s: Summary, t: (key: TKey) => string) {
  return [
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
}

function SummaryList({ title, items, bullet = "•" }: { title: string; items: string[]; bullet?: string }) {
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => ({
  summary: { borderColor: colors.primary },
  summaryHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  summaryLabel: { color: colors.primary, fontSize: 13, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  listTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: spacing.xs },
  body: { color: colors.text, fontSize: 15, lineHeight: 23 },
  note: { color: colors.textDim, fontSize: 12 },
  ltr: { writingDirection: "ltr", textAlign: "left" },
}));
