import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { AppHeader, Banner, Button, Card, Screen, TextField } from "@/components/ui";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { makeStyles, spacing, useTheme } from "@/theme";

const MIN = 10;
const MAX = 1000;

/** Ask for speaking access. The app owner gets an email with a one-click approval link. */
export default function RequestSpeaking() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  const { user, ready, refresh } = useAuth();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { next: "/request-speaking" } }} />;
  if (!user) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
      </Screen>
    );
  }
  if (!user.emailVerified) return <Redirect href={{ pathname: "/verify-email", params: { next: "/request-speaking" } }} />;
  if (user.canSpeak) return <Redirect href="/speak" />;

  const header = <AppHeader title={t("request.header")} />;

  if (user.speakRequestedAt) {
    return (
      <Screen scroll header={header}>
        <Card style={{ gap: spacing.md, alignItems: "center" }}>
          <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
          <Text style={styles.title}>{t("request.sentTitle")}</Text>
          <Text style={styles.centered}>{t("request.sentText", { email: user.email })}</Text>
          <Text style={styles.dim}>{t("request.sentOn", { date: formatDateTime(user.speakRequestedAt) })}</Text>
          <Button title={t("request.backHome")} icon="home-outline" variant="secondary" onPress={() => router.replace("/")} />
        </Card>
      </Screen>
    );
  }

  const trimmed = note.trim();
  const submit = async () => {
    if (trimmed.length < MIN) return setError(t("request.tooShort"));
    setError(null);
    setLoading(true);
    try {
      await api.requestSpeaking(trimmed);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll header={header}>
      <Text style={styles.heading}>{t("request.title")}</Text>
      <Text style={styles.body}>{t("request.intro")}</Text>
      {error && <Banner tone="error" text={error} />}

      <Card style={{ gap: spacing.xs }}>
        <Text style={styles.label}>{t("request.account")}</Text>
        <Text style={styles.value}>
          {user.displayName} · @{user.username}
        </Text>
        <Text style={styles.dim}>{user.email}</Text>
      </Card>

      <TextField
        label={t("request.noteLabel")}
        placeholder={t("request.notePlaceholder")}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={MAX}
        textAlignVertical="top"
        style={{ minHeight: 120 }}
        hint={`${trimmed.length}/${MAX}`}
      />
      <View style={{ gap: spacing.sm }}>
        <Button title={t("request.send")} icon="send-outline" onPress={submit} loading={loading} disabled={trimmed.length < MIN} />
        <Text style={styles.dim}>{t("request.privacy")}</Text>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  heading: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.md },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", textAlign: "center" },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 23 },
  centered: { color: colors.textMuted, fontSize: 15, lineHeight: 23, textAlign: "center" },
  label: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  value: { color: colors.text, fontSize: 16, fontWeight: "600" },
  dim: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
}));
