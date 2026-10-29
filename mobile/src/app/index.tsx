import { Ionicons } from "@expo/vector-icons";
import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { Button, Card, Chip, IconButton, Screen, TextField } from "@/components/ui";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { normalizeUsername } from "@/lib/format";
import { recentSpeakers, type RecentSpeaker } from "@/lib/recentSpeakers";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

export default function Home() {
  const { colors, name: themeName, toggleTheme } = useTheme();
  const styles = useStyles();
  const { user } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [speakerId, setSpeakerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [recent, setRecent] = useState<RecentSpeaker[]>([]);

  useFocusEffect(
    useCallback(() => {
      recentSpeakers.list().then(setRecent);
    }, []),
  );

  const join = async (raw = speakerId) => {
    const username = normalizeUsername(raw);
    if (!username) return setError(t("home.enterSpeakerId"));
    setError(null);
    setChecking(true);
    try {
      await api.speaker(username);
      router.push({ pathname: "/listen/[username]", params: { username } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <Image source={require("../../assets/logo.png")} style={styles.logo} accessibilityIgnoresInvertColors />
          <Text style={styles.brandText}>{t("common.appName")}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Pressable
            onPress={() => setLang(lang === "ar" ? "en" : "ar")}
            style={styles.langToggle}
            accessibilityRole="button"
            accessibilityLabel="Change language / تغيير اللغة"
          >
            <Ionicons name="globe-outline" size={16} color={colors.textMuted} />
            <Text style={styles.langText}>{lang === "ar" ? "English" : "العربية"}</Text>
          </Pressable>
          <IconButton
            icon={themeName === "dark" ? "sunny-outline" : "moon-outline"}
            label={themeName === "dark" ? t("theme.toLight") : t("theme.toDark")}
            onPress={toggleTheme}
          />
          <IconButton
            icon={user ? "person-circle" : "person-circle-outline"}
            label={user ? t("home.account") : t("home.signIn")}
            onPress={() => router.push(user ? "/account" : "/login")}
          />
        </View>
      </View>

      <View style={styles.hero}>
        <Text style={styles.title}>{t("home.title")}</Text>
        <Text style={styles.subtitle}>{t("home.subtitle")}</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
          <Chip icon="mic-outline" text={t("home.chipPair")} />
          <Chip icon="flash-outline" text={t("home.chipLive")} />
        </View>
      </View>

      <Card>
        <View style={styles.cardHead}>
          <Ionicons name="chatbubbles-outline" size={22} color={colors.primary} />
          <Text style={styles.cardTitle}>{t("home.followTitle")}</Text>
        </View>
        <Text style={styles.cardText}>{t("home.followText")}</Text>
        <TextField
          prefix="@"
          placeholder={t("home.speakerIdPlaceholder")}
          value={speakerId}
          onChangeText={(v) => {
            setSpeakerId(v);
            setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => join()}
          error={error}
          accessibilityLabel={t("home.speakerIdLabel")}
        />
        <Button title={t("home.startReading")} icon="arrow-forward" onPress={() => join()} loading={checking} />
        {user && (
          <Button title={t("home.mySessions")} icon="bookmarks-outline" variant="secondary" onPress={() => router.push("/library")} />
        )}
        {recent.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.recentLabel}>{t("home.recent")}</Text>
            <View style={styles.recentRow}>
              {recent.map((r) => (
                <Pressable key={r.username} style={styles.recent} onPress={() => join(r.username)}>
                  <Text style={styles.recentName} numberOfLines={1}>
                    {r.displayName}
                  </Text>
                  <Text style={styles.recentId}>@{r.username}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </Card>

      <Card>
        <View style={styles.cardHead}>
          <Ionicons name="mic-outline" size={22} color={colors.live} />
          <Text style={styles.cardTitle}>{user ? t("home.speakTitleUser", { name: user.displayName }) : t("home.speakTitle")}</Text>
        </View>
        {user ? (
          <>
            <Text style={styles.cardText}>{t("home.speakTextUser", { username: user.username })}</Text>
            <Button title={t("home.startSpeaking")} icon="mic" variant="live" size="lg" onPress={() => router.push("/speak")} />
            <Button title={t("home.pastSessions")} icon="time-outline" variant="secondary" onPress={() => router.push("/history")} />
          </>
        ) : (
          <>
            <Text style={styles.cardText}>{t("home.speakText")}</Text>
            <Button title={t("home.createAccount")} icon="person-add-outline" onPress={() => router.push("/register")} />
            <Link href="/login" style={styles.link}>
              {t("home.haveAccount")}
            </Link>
          </>
        )}
      </Card>

      <View style={styles.footer}>
        <Link href="/privacy" style={styles.footerLink}>
          {t("home.privacy")}
        </Link>
        <Text style={styles.footerDot}>·</Text>
        <Link href="/terms" style={styles.footerLink}>
          {t("home.terms")}
        </Link>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logo: { width: 36, height: 36, borderRadius: radius.sm },
  brandText: { color: colors.text, fontSize: 18, fontWeight: "700" },
  langToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  langText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  hero: { gap: spacing.md, paddingVertical: spacing.md },
  title: { color: colors.text, fontSize: 32, fontWeight: "800", lineHeight: 42 },
  subtitle: { color: colors.textMuted, fontSize: 16, lineHeight: 25 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700", flexShrink: 1 },
  cardText: { color: colors.textMuted, fontSize: 15, lineHeight: 23 },
  link: { color: colors.primary, textAlign: "center", fontSize: 15, fontWeight: "600", paddingVertical: spacing.xs },
  recentLabel: { color: colors.textDim, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  recentRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  recent: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 200,
  },
  recentName: { color: colors.text, fontWeight: "600" },
  recentId: { color: colors.textMuted, fontSize: 12 },
  footer: { flexDirection: "row", justifyContent: "center", gap: spacing.sm, paddingBottom: spacing.lg },
  footerLink: { color: colors.textDim, fontSize: 13 },
  footerDot: { color: colors.textDim },
}));
