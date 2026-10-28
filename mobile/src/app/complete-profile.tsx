import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { LegalNotice } from "@/components/AuthExtras";
import { AppHeader, Banner, Button, Screen, TextField } from "@/components/ui";
import { useI18n } from "@/i18n";
import { USERNAME_RE } from "@/lib/format";
import { routeAfterAuth } from "@/lib/postAuth";
import { colors, spacing } from "@/theme";

/** After a first Google sign-in: pick a speaker ID, then verify the email with a code. */
export default function CompleteProfile() {
  const { t } = useI18n();
  const { completeGoogleSignUp } = useAuth();
  const params = useLocalSearchParams<{ signupToken: string; email: string; displayName: string; suggestedUsername: string; next?: string }>();
  const [displayName, setDisplayName] = useState(params.displayName ?? "");
  const [username, setUsername] = useState(params.suggestedUsername ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const clean = username.trim().toLowerCase();
  const usernameError = clean && !USERNAME_RE.test(clean) ? t("auth.usernameInvalid") : null;
  const valid = !!params.signupToken && displayName.trim() && USERNAME_RE.test(clean);

  const submit = async () => {
    if (!valid) return;
    setError(null);
    setLoading(true);
    try {
      const user = await completeGoogleSignUp({ signupToken: params.signupToken, username: clean, displayName: displayName.trim() });
      routeAfterAuth(user, params.next || "/speak");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!params.signupToken) return <Redirect href="/register" />;

  return (
    <Screen scroll header={<AppHeader title={t("profile.header")} />}>
      <Text style={styles.title}>{t("profile.title")}</Text>
      <Text style={styles.subtitle}>{t("profile.subtitle", { email: params.email })}</Text>
      {error && <Banner tone="error" text={error} />}
      <TextField label={t("auth.displayName")} value={displayName} onChangeText={setDisplayName} autoComplete="name" />
      <TextField
        label={t("auth.usernameLabel")}
        prefix="@"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        error={usernameError}
        hint={t("auth.usernameHint")}
        onSubmitEditing={submit}
      />
      <Button title={t("common.continue")} onPress={submit} loading={loading} disabled={!valid} />
      <LegalNotice />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.md },
  subtitle: { color: colors.textMuted, fontSize: 15, marginTop: -spacing.sm, lineHeight: 22 },
});
