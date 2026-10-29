import { Ionicons } from "@expo/vector-icons";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { AppHeader, Banner, Button, Screen } from "@/components/ui";
import { LANGUAGES } from "@/constants/languages";
import { useI18n } from "@/i18n";
import { api, type LibraryItem } from "@/lib/api";
import { formatDateTime, formatSessionDate, formatTime } from "@/lib/format";
import { pendingLibrary } from "@/lib/pendingLibrary";
import { makeStyles, maxContentWidth, radius, spacing, useTheme } from "@/theme";

/** "My sessions": sessions this listener attended and can read again. */
export default function Library() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t, isRTL, lang } = useI18n();
  const { user, ready } = useAuth();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      await pendingLibrary.claim(); // sessions followed before signing in
      setItems((await api.library()).sessions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) load();
    }, [user, load]),
  );

  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { next: "/library" } }} />;

  return (
    <Screen header={<AppHeader title={t("library.header")} />} contentStyle={{ padding: 0, maxWidth: undefined }}>
      {error && (
        <View style={{ padding: spacing.lg }}>
          <Banner tone="error" text={error} />
        </View>
      )}
      {items === null && !error ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.primary}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="bookmarks-outline" size={44} color={colors.textDim} />
              <Text style={styles.emptyTitle}>{t("library.emptyTitle")}</Text>
              <Text style={styles.emptyText}>{t("library.emptyText")}</Text>
              <Button title={t("library.findSpeaker")} icon="arrow-forward" onPress={() => router.replace("/")} />
            </View>
          }
          renderItem={({ item }) => {
            // Untitled sessions are named after their date, so the meta line only needs the time.
            const title = item.title || formatSessionDate(item.startedAt, lang);
            const meta = [
              item.title ? formatDateTime(item.startedAt) : formatTime(item.startedAt, lang),
              LANGUAGES[item.lang]?.nativeName,
              t("history.lines", { count: item.segmentCount }),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
                onPress={() => router.push({ pathname: "/library/[id]", params: { id: item.id } })}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.titleRow}>
                    {item.hasSummary && <Ionicons name="sparkles" size={14} color={colors.primary} />}
                    <Text style={styles.title} numberOfLines={1}>
                      {title}
                    </Text>
                  </View>
                  <Text style={styles.speaker} numberOfLines={1}>
                    {item.speaker.displayName} · @{item.speaker.username}
                  </Text>
                  <Text style={styles.meta}>{meta}</Text>
                </View>
                <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={18} color={colors.textDim} />
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { padding: spacing.lg, gap: spacing.sm, width: "100%", maxWidth: maxContentWidth, alignSelf: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { color: colors.text, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  speaker: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  meta: { color: colors.textMuted, fontSize: 13 },
  empty: { alignItems: "center", gap: spacing.md, paddingTop: spacing.xxl },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  emptyText: { color: colors.textMuted, textAlign: "center" },
}));
