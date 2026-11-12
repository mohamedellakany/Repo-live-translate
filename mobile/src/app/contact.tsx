import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { AppHeader, Button, Card, Screen, SelectRow } from "@/components/ui";
import { SUPPORT_EMAIL } from "@/content/legal";
import { useI18n } from "@/i18n";
import { makeStyles, spacing, useTheme } from "@/theme";

/** Contact us: the support page linked from the app stores ("Support URL") and the app. */
export default function Contact() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const version = Constants.expoConfig?.version ?? "";

  const copy = async () => {
    await Clipboard.setStringAsync(SUPPORT_EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const subject = encodeURIComponent(`${t("common.appName")} support`);
  const body = encodeURIComponent(`\n\n—\n${t("common.appName")} ${version} · ${Platform.OS}`);

  return (
    <Screen scroll header={<AppHeader title={t("contact.title")} />}>
      <Text style={styles.title}>{t("contact.title")}</Text>
      <Text style={styles.body}>{t("contact.intro")}</Text>

      <Card>
        <View style={styles.row}>
          <Ionicons name="mail-outline" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{t("contact.emailUs")}</Text>
            <Text style={styles.email} selectable>
              {SUPPORT_EMAIL}
            </Text>
          </View>
        </View>
        <View style={styles.buttons}>
          <Button
            title={t("contact.sendEmail")}
            icon="send-outline"
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`)}
            style={{ flex: 1 }}
          />
          <Button
            title={copied ? t("common.copied") : t("common.copy")}
            icon={copied ? "checkmark" : "copy-outline"}
            variant="secondary"
            onPress={copy}
            style={{ flex: 1 }}
          />
        </View>
        <Text style={styles.note}>{t("contact.replyTime")}</Text>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.heading}>{t("contact.reportTitle")}</Text>
        <Text style={styles.body}>{t("contact.reportText")}</Text>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SelectRow icon="shield-checkmark-outline" label={t("legal.privacyTitle")} value="" onPress={() => router.push("/privacy")} />
        <SelectRow icon="document-text-outline" label={t("legal.termsTitle")} value="" onPress={() => router.push("/terms")} />
        <SelectRow icon="trash-outline" label={t("deleteInfo.title")} value="" onPress={() => router.push("/delete-account")} />
      </Card>

      {!!version && <Text style={styles.version}>{t("contact.version", { version })}</Text>}
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.md },
  heading: { color: colors.text, fontSize: 17, fontWeight: "700" },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  email: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: 2 },
  buttons: { flexDirection: "row", gap: spacing.sm },
  note: { color: colors.textDim, fontSize: 13 },
  version: { color: colors.textDim, fontSize: 12, textAlign: "center" },
}));
