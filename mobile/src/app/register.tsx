import { Link, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { GoogleAuthSection, LegalNotice } from "@/components/AuthExtras";
import { AppHeader, Banner, Button, Screen, TextField } from "@/components/ui";
import { useI18n } from "@/i18n";
import { USERNAME_RE } from "@/lib/format";
import { routeAfterAuth } from "@/lib/postAuth";
import { makeStyles, spacing } from "@/theme";



export default function Register() {
  const styles = useStyles();
  const { t } = useI18n();
  const { signUp } = useAuth();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [form, setForm] = useState({ displayName: "", username: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const username = form.username.trim().toLowerCase();
  const usernameError = username && !USERNAME_RE.test(username) ? t("auth.usernameInvalid") : null;
  const passwordError = form.password && form.password.length < 8 ? t("auth.passwordShort") : null;
  const valid = form.displayName.trim() && USERNAME_RE.test(username) && form.email.includes("@") && form.password.length >= 8;

  const submit = async () => {
    if (!valid) return;
    setError(null);
    setLoading(true);
    try {
      routeAfterAuth(await signUp({ ...form, username }), next || "/speak");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll header={<AppHeader title={t("auth.registerHeader")} />}>
      <Text style={styles.title}>{t("auth.registerTitle")}</Text>
      <Text style={styles.subtitle}>{t("auth.registerSubtitle")}</Text>
      {error && <Banner tone="error" text={error} />}
      <GoogleAuthSection next={next || "/speak"} />
      <TextField
        label={t("auth.displayName")}
        placeholder={t("auth.displayNamePlaceholder")}
        value={form.displayName}
        onChangeText={set("displayName")}
        autoComplete="name"
      />
      <TextField
        label={t("auth.usernameLabel")}
        prefix="@"
        placeholder="mohamed"
        value={form.username}
        onChangeText={set("username")}
        autoCapitalize="none"
        autoCorrect={false}
        error={usernameError}
        hint={t("auth.usernameHint")}
      />
      <TextField
        label={t("auth.email")}
        value={form.email}
        onChangeText={set("email")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <TextField
        label={t("auth.password")}
        value={form.password}
        onChangeText={set("password")}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={passwordError}
        onSubmitEditing={submit}
      />
      <Button title={t("auth.createAccount")} onPress={submit} loading={loading} disabled={!valid} />
      <LegalNotice />
      <Link href={{ pathname: "/login", params: next ? { next } : {} }} replace style={styles.link}>
        {t("auth.haveAccount")}
      </Link>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.md },
  subtitle: { color: colors.textMuted, fontSize: 15, marginTop: -spacing.sm, lineHeight: 22 },
  link: { color: colors.primary, textAlign: "center", fontSize: 15, fontWeight: "600", paddingBottom: spacing.lg },
}));
