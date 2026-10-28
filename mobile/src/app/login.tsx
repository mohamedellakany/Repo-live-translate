import { Link, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { GoogleAuthSection } from "@/components/AuthExtras";
import { AppHeader, Banner, Button, Screen, TextField } from "@/components/ui";
import { useI18n } from "@/i18n";
import { routeAfterAuth } from "@/lib/postAuth";
import { colors, spacing } from "@/theme";

export default function Login() {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      routeAfterAuth(await signIn(login, password), next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll header={<AppHeader title={t("auth.signIn")} />}>
      <Text style={styles.title}>{t("auth.signInTitle")}</Text>
      <Text style={styles.subtitle}>{t("auth.signInSubtitle")}</Text>
      {error && <Banner tone="error" text={error} />}
      <GoogleAuthSection next={next} />
      <TextField
        label={t("auth.usernameOrEmail")}
        value={login}
        onChangeText={setLogin}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
      />
      <TextField
        label={t("auth.password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      <Link href="/forgot-password" style={styles.forgot}>
        {t("auth.forgotPassword")}
      </Link>
      <Button title={t("auth.signIn")} onPress={submit} loading={loading} disabled={!login || !password} />
      <Link href={{ pathname: "/register", params: next ? { next } : {} }} replace style={styles.link}>
        {t("auth.newHere")}
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.md },
  subtitle: { color: colors.textMuted, fontSize: 15, marginTop: -spacing.sm },
  forgot: { color: colors.primary, fontSize: 14, fontWeight: "600", alignSelf: "flex-end", marginTop: -spacing.sm },
  link: { color: colors.primary, textAlign: "center", fontSize: 15, fontWeight: "600" },
});
