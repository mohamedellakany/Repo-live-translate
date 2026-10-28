import { Ionicons } from "@expo/vector-icons";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { AppHeader, Banner, Button, LiveBadge, Screen } from "@/components/ui";
import { useI18n } from "@/i18n";
import { api, type SessionSummary } from "@/lib/api";
import { formatDateTime, formatDuration, parseDbDate } from "@/lib/format";
import { colors, maxContentWidth, radius, spacing } from "@/theme";

export default function History() {
  const { t, isRTL } = useI18n();
  const { user, ready } = useAuth();
  const [items, setItems] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems((await api.sessions()).sessions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) load();
    }, [user, load]),
  );

  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { next: "/history" } }} />;

  return (
    <Screen header={<AppHeader title={t("history.header")} />} contentStyle={{ padding: 0, maxWidth: undefined }}>
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
              <Ionicons name="albums-outline" size={44} color={colors.textDim} />
              <Text style={styles.emptyTitle}>{t("history.emptyTitle")}</Text>
              <Text style={styles.emptyText}>{t("history.emptyText")}</Text>
              <Button title={t("home.startSpeaking")} icon="mic" variant="live" onPress={() => router.replace("/speak")} />
            </View>
          }
          renderItem={({ item }) => {
            const duration = item.endedAt
              ? formatDuration(parseDbDate(item.endedAt).getTime() - parseDbDate(item.startedAt).getTime())
              : null;
            const meta = [
              formatDateTime(item.startedAt),
              duration,
              t("history.lines", { count: item.segmentCount }),
              t("history.listeners", { count: item.peakListeners }),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
                onPress={() => router.push({ pathname: "/history/[id]", params: { id: item.id } })}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.titleRow}>
                    {item.isPrivate && <Ionicons name="lock-closed" size={14} color={colors.warning} />}
                    {item.hasSummary && <Ionicons name="sparkles" size={14} color={colors.primary} />}
                    <Text style={styles.title} numberOfLines={1}>
                      {item.title || t("history.untitled")}
                    </Text>
                  </View>
                  <Text style={styles.meta}>{meta}</Text>
                  {item.charsTranslated > 0 && (
                    <Text style={styles.chars}>{t("history.chars", { count: item.charsTranslated.toLocaleString() })}</Text>
                  )}
                </View>
                {!item.endedAt ? (
                  <LiveBadge state="live" />
                ) : (
                  <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={18} color={colors.textDim} />
                )}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  meta: { color: colors.textMuted, fontSize: 13 },
  chars: { color: colors.textDim, fontSize: 12 },
  empty: { alignItems: "center", gap: spacing.md, paddingTop: spacing.xxl },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  emptyText: { color: colors.textMuted, textAlign: "center" },
});
