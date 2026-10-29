import { Text, View } from "react-native";
import type { LegalSection } from "@/content/legal";
import { LEGAL_UPDATED } from "@/content/legal";
import { useI18n } from "@/i18n";
import { makeStyles, spacing } from "@/theme";
import { AppHeader, Screen } from "./ui";

export function LegalPage({ title, sections }: { title: string; sections: LegalSection[] }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <Screen scroll header={<AppHeader title={title} />}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.updated}>{t("legal.updated", { date: LEGAL_UPDATED })}</Text>
      {sections.map((s) => (
        <View key={s.heading} style={{ gap: spacing.xs }}>
          <Text style={styles.heading}>{s.heading}</Text>
          <Text style={styles.body} selectable>
            {s.body}
          </Text>
        </View>
      ))}
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.md },
  updated: { color: colors.textDim, fontSize: 13, marginTop: -spacing.sm },
  heading: { color: colors.text, fontSize: 17, fontWeight: "700" },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 24 },
}));
