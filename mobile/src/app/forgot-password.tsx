import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { CodeInput } from "@/components/CodeInput";
import { AppHeader, Banner, Button, Screen, TextField } from "@/components/ui";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { routeAfterAuth } from "@/lib/postAuth";
import { useServerConfig } from "@/lib/serverConfig";
import { colors, spacing } from "@/theme";

/** Two steps: request a code by email, then enter it with a new password. */
export default function ForgotPassword() {
  const { t } = useI18n();
  const { resetPassword } = useAuth();
  const { features } = useServerConfig();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    setError(null);
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setStep("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      routeAfterAuth(await resetPassword({ email: email.trim(), code, password }), "/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll header={<AppHeader title={t("reset.header")} />}>
      <Text style={styles.title}>{t("reset.title")}</Text>
      {error && <Banner tone="error" text={error} />}
      {step === "email" ? (
        <>
          <Text style={styles.subtitle}>{t("reset.subtitle")}</Text>
          <TextField
            label={t("auth.email")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            onSubmitEditing={sendCode}
          />
          <Button title={t("reset.sendCode")} onPress={sendCode} loading={loading} disabled={!email.includes("@")} />
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>{t("reset.codeSent", { email: email.trim() })}</Text>
          {!features.email && <Banner tone="info" icon="terminal-outline" text={t("verify.devHint")} />}
          <CodeInput value={code} onChange={setCode} label={t("verify.code")} />
          <TextField
            label={t("reset.newPassword")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={password && password.length < 8 ? t("auth.passwordShort") : null}
            onSubmitEditing={submit}
          />
          <Button title={t("reset.submit")} onPress={submit} loading={loading} disabled={code.length !== 6 || password.length < 8} />
          <Button title={t("reset.resend")} variant="ghost" onPress={sendCode} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.md },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
});
