import { router } from "expo-router";
import { Linking, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { AppHeader, Button, Card, Screen } from "@/components/ui";
import { SUPPORT_EMAIL } from "@/content/legal";
import { useI18n } from "@/i18n";
import { makeStyles, spacing } from "@/theme";

/**
 * Public "how to delete your account" page. Google Play requires a web link that explains how users
 * delete their account and data; the actual deletion happens in Account > Delete account.
 */
export default function DeleteAccountInfo() {
  const styles = useStyles();
  const { t } = useI18n();
  const { user } = useAuth();
  const subject = encodeURIComponent(`${t("common.appName")}: ${t("deleteInfo.emailSubject")}`);

  const steps = [t("deleteInfo.step1"), t("deleteInfo.step2"), t("deleteInfo.step3")];
  const deleted = [t("deleteInfo.deleted1"), t("deleteInfo.deleted2"), t("deleteInfo.deleted3"), t("deleteInfo.deleted4")];

  return (
    <Screen scroll header={<AppHeader title={t("deleteInfo.title")} />}>
      <Text style={styles.title}>{t("deleteInfo.title")}</Text>
      <Text style={styles.body}>{t("deleteInfo.intro")}</Text>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.heading}>{t("deleteInfo.inAppTitle")}</Text>
        {steps.map((step, i) => (
          <View key={i} style={styles.step}>
            <Text style={styles.num}>{i + 1}</Text>
            <Text style={[styles.body, { flex: 1 }]}>{step}</Text>
          </View>
        ))}
        <Button
          title={user ? t("deleteInfo.openAccount") : t("home.signIn")}
          icon={user ? "person-circle-outline" : "log-in-outline"}
          variant="secondary"
          onPress={() => router.push(user ? "/account" : { pathname: "/login", params: { next: "/account" } })}
        />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.heading}>{t("deleteInfo.emailTitle")}</Text>
        <Text style={styles.body}>{t("deleteInfo.emailText", { email: SUPPORT_EMAIL })}</Text>
        <Button
          title={t("contact.sendEmail")}
          icon="mail-outline"
          variant="secondary"
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}`)}
        />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.heading}>{t("deleteInfo.whatTitle")}</Text>
        {deleted.map((item, i) => (
          <Text key={i} style={styles.body}>
            • {item}
          </Text>
        ))}
        <Text style={styles.body}>{t("deleteInfo.kept")}</Text>
      </Card>
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.md },
  heading: { color: colors.text, fontSize: 17, fontWeight: "700" },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 24 },
  step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  num: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "800",
    width: 24,
    height: 24,
    lineHeight: 24,
    textAlign: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
}));
