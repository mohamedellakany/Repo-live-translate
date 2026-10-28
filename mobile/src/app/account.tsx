import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { AppHeader, Banner, Button, Card, OptionSheet, Screen, SelectRow, Sheet, TextField } from "@/components/ui";
import { useI18n, type UiLang } from "@/i18n";
import { API_URL } from "@/lib/config";
import { colors, spacing } from "@/theme";

const UI_LANGS: { value: UiLang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

export default function Account() {
  const { t, lang, setLang, needsRestart } = useI18n();
  const { user, ready, signOut, updateDisplayName, deleteAccount } = useAuth();
  // null = untouched, so the field shows the current name even if the account loads after first render.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [langPicker, setLangPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmValue, setConfirmValue] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  if (ready && !user) return <Redirect href="/login" />;
  if (!user) return null;
  const name = nameDraft ?? user.displayName;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateDisplayName(name.trim());
      setNameDraft(null);
      setMessage({ tone: "info", text: t("common.saved") });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount(user.hasPassword ? { password: confirmValue } : { confirmUsername: confirmValue });
      setDeleting(false);
      router.replace("/");
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Screen scroll header={<AppHeader title={t("account.header")} />}>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user.displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{user.displayName}</Text>
        <Text style={styles.meta}>
          @{user.username} · {user.email}
        </Text>
      </View>

      {!user.emailVerified && (
        <Card style={{ borderColor: colors.warning }}>
          <Banner tone="warning" text={t("account.unverified")} />
          <Button title={t("account.verifyNow")} onPress={() => router.push("/verify-email")} />
        </Card>
      )}
      {message && <Banner tone={message.tone} text={message.text} />}

      <Card>
        <TextField label={t("account.displayName")} value={name} onChangeText={setNameDraft} maxLength={60} />
        <Button title={t("common.save")} onPress={save} loading={saving} disabled={!name.trim() || name.trim() === user.displayName} />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SelectRow
          icon="globe-outline"
          label={t("account.language")}
          value={UI_LANGS.find((l) => l.value === lang)!.label}
          onPress={() => setLangPicker(true)}
        />
        {needsRestart && Platform.OS !== "web" && <Banner tone="info" text={t("account.restartNote")} />}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.section}>{t("account.security")}</Text>
        {user.googleLinked && <Text style={styles.meta}>✓ {t("account.googleLinked")}</Text>}
        <Button
          title={user.hasPassword ? t("account.changePassword") : t("account.addPassword")}
          icon="key-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: "/forgot-password", params: { email: user.email } })}
        />
        <Button title={t("home.pastSessions")} icon="time-outline" variant="secondary" onPress={() => router.push("/history")} />
        <Button
          title={t("account.signOut")}
          icon="log-out-outline"
          variant="ghost"
          onPress={async () => {
            await signOut();
            router.replace("/");
          }}
        />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.section}>{t("account.legal")}</Text>
        <SelectRow icon="shield-checkmark-outline" label={t("legal.privacyTitle")} value="" onPress={() => router.push("/privacy")} />
        <SelectRow icon="document-text-outline" label={t("legal.termsTitle")} value="" onPress={() => router.push("/terms")} />
      </Card>

      <Card style={{ borderColor: colors.danger }}>
        <Text style={[styles.section, { color: colors.danger }]}>{t("account.dangerZone")}</Text>
        <Text style={styles.meta}>{t("account.deleteText")}</Text>
        <Button
          title={t("account.deleteButton")}
          icon="trash-outline"
          variant="danger"
          onPress={() => {
            setConfirmValue("");
            setDeleteError(null);
            setDeleting(true);
          }}
        />
      </Card>

      <Text style={styles.server}>{t("account.server", { url: API_URL })}</Text>

      <OptionSheet
        visible={langPicker}
        onClose={() => setLangPicker(false)}
        title={t("account.language")}
        options={UI_LANGS}
        selected={lang}
        onSelect={setLang}
      />

      <Sheet visible={deleting} onClose={() => setDeleting(false)} title={t("account.deleteConfirmTitle")}>
        <Text style={styles.meta}>
          {user.hasPassword ? t("account.deleteConfirmPassword") : t("account.deleteConfirmUsername", { username: user.username })}
        </Text>
        <TextField
          value={confirmValue}
          onChangeText={setConfirmValue}
          secureTextEntry={user.hasPassword}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={user.hasPassword ? t("auth.password") : user.username}
          error={deleteError}
          autoFocus
        />
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button title={t("common.cancel")} variant="secondary" onPress={() => setDeleting(false)} style={{ flex: 1 }} />
          <Button
            title={t("account.deleteForever")}
            variant="danger"
            icon="trash"
            onPress={confirmDelete}
            loading={deleteBusy}
            disabled={!confirmValue}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.lg },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  avatarText: { color: "#fff", fontSize: 30, fontWeight: "800" },
  name: { color: colors.text, fontSize: 22, fontWeight: "700" },
  meta: { color: colors.textMuted, lineHeight: 21 },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  server: { color: colors.textDim, fontSize: 12, textAlign: "center", paddingBottom: spacing.lg },
});
