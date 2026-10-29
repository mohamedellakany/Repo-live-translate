import { Redirect, router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/auth/AuthProvider";
import { CodeInput } from "@/components/CodeInput";
import { AppHeader, Banner, Button, Screen } from "@/components/ui";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { useServerConfig } from "@/lib/serverConfig";
import { makeStyles, spacing, useTheme } from "@/theme";

const RESEND_SECONDS = 60;

export default function VerifyEmail() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  const { user, ready, verifyEmail, signOut } = useAuth();
  const { features } = useServerConfig();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS); // a code was just sent at sign-up

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  if (ready && !user) return <Redirect href="/login" />;
  if (!user) return <ActivityIndicator color={colors.primary} style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (user.emailVerified) return <Redirect href={(next || "/") as Href} />;

  const submit = async (value = code) => {
    if (value.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      await verifyEmail(value);
      router.replace((next || "/") as Href);
    } catch (e) {
      setError((e as Error).message);
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError(null);
    setInfo(null);
    try {
      await api.sendVerification();
      setInfo(t("verify.resent"));
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setCooldown(RESEND_SECONDS);
      setError((e as Error).message);
    }
  };

  return (
    <Screen scroll header={<AppHeader title={t("verify.header")} back={false} />}>
      <View style={styles.icon}>
        <Ionicons name="mail-unread-outline" size={44} color={colors.primary} />
      </View>
      <Text style={styles.title}>{t("verify.title")}</Text>
      <Text style={styles.subtitle}>{t("verify.subtitle", { email: user.email })}</Text>
      {!features.email && <Banner tone="info" icon="terminal-outline" text={t("verify.devHint")} />}
      {info && <Banner tone="info" icon="checkmark-circle-outline" text={info} />}
      <CodeInput value={code} onChange={setCode} onComplete={submit} error={error} label={t("verify.code")} />
      <Button title={t("verify.submit")} onPress={() => submit()} loading={loading} disabled={code.length !== 6} />
      <Button
        title={cooldown > 0 ? t("verify.resendIn", { seconds: cooldown }) : t("verify.resend")}
        variant="ghost"
        onPress={resend}
        disabled={cooldown > 0}
      />
      <Text
        style={styles.link}
        onPress={async () => {
          await signOut();
          router.replace("/login");
        }}
      >
        {t("verify.wrongAccount")}
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  icon: { alignItems: "center", marginTop: spacing.lg },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", textAlign: "center" },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  link: { color: colors.textMuted, textAlign: "center", fontSize: 14, paddingVertical: spacing.sm },
}));
