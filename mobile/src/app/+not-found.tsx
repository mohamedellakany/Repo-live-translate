import { router } from "expo-router";
import { Text, View } from "react-native";
import { Button, Screen } from "@/components/ui";
import { useI18n } from "@/i18n";
import { makeStyles, spacing } from "@/theme";

export default function NotFound() {
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => ({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
}));
