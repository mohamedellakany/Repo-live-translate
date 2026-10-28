import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button, Screen } from "@/components/ui";
import { useI18n } from "@/i18n";
import { colors, spacing } from "@/theme";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Screen>
      <View style={styles.center}>
        <Text style={styles.title}>{t("common.notFound")}</Text>
        <Button title={t("common.goHome")} onPress={() => router.replace("/")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
});
