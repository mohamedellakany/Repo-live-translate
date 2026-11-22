import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { AppHeader, Banner, Card, IconButton, Screen } from "@/components/ui";
import { useI18n } from "@/i18n";
import { api, type UsageReport } from "@/lib/api";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

const n = (v: number) => v.toLocaleString("en-US");

/** Private page for the account owner: how many translation characters each provider has used this month. */
export default function Usage() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  const { user, ready } = useAuth();
  const [data, setData] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.usage());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!user?.isAdmin) return;
    api
      .usage()
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [user?.isAdmin]);

  if (ready && (!user || !user.isAdmin)) return <Redirect href="/" />;

  const pastMonths = data ? [...new Set(data.history.map((h) => h.month))].filter((m) => m !== data.month) : [];

  return (
    <Screen header={<AppHeader title={t("usage.title")} right={<IconButton icon="refresh" label={t("usage.refresh")} onPress={load} />} />}>
      {error && <Banner tone="error" text={error} />}
      {!data && !error && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />}
      {data && (
        <ScrollView
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
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
        >
          <Text style={styles.month}>{t("usage.thisMonth", { month: data.month })}</Text>
          {data.providers.map((p, i) => {
            const cap = p.allowance || p.limit;
            const pct = cap ? Math.min(100, (p.used / cap) * 100) : 0;
            const active = data.active === p.name;
            const barColor = pct >= 95 ? colors.danger : pct >= 80 ? colors.warning : colors.primary;
            return (
              <Card key={p.name} style={[{ gap: spacing.sm }, active && { borderWidth: 1.5, borderColor: colors.primary }]}>
                <View style={styles.row}>
                  <Text style={styles.step}>{i + 1}</Text>
                  <Text style={styles.name}>{p.label}</Text>
                  {active && (
                    <View style={styles.activePill}>
                      <Ionicons name="radio-button-on" size={12} color={colors.primary} />
                      <Text style={styles.activeText}>{t("usage.inUse")}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${pct}%`, backgroundColor: barColor }]} />
                </View>
                <Text style={styles.numbers}>
                  {cap ? t("usage.usedOf", { used: n(p.used), cap: n(cap), pct: pct.toFixed(1) }) : t("usage.used", { used: n(p.used) })}
                </Text>
                {cap > 0 && <Text style={styles.left}>{t("usage.left", { left: n(Math.max(0, cap - p.used)) })}</Text>}
              </Card>
            );
          })}
          <Text style={styles.note}>{t("usage.note")}</Text>
          <Text style={styles.note}>
            {t("usage.settings", { langs: data.listenLanguages, live: data.liveMode ? t("usage.on") : t("usage.off") })}
          </Text>

          {pastMonths.length > 0 && (
            <Card style={{ gap: spacing.xs }}>
              <Text style={styles.name}>{t("usage.previous")}</Text>
              {pastMonths.map((m) => (
                <View key={m} style={styles.histRow}>
                  <Text style={styles.histMonth}>{m}</Text>
                  <Text style={styles.histValue}>
                    {data.history
                      .filter((h) => h.month === m)
                      .map((h) => `${h.provider}: ${n(h.chars)}`)
                      .join(" · ")}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  month: { color: colors.textMuted, fontSize: 14, marginTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  step: {
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: "center",
    lineHeight: 22,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  name: { color: colors.text, fontSize: 16, fontWeight: "700", flex: 1 },
  activePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  activeText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  track: { height: 10, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.md },
  numbers: { color: colors.text, fontSize: 14 },
  left: { color: colors.textMuted, fontSize: 13 },
  note: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  histRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 4 },
  histMonth: { color: colors.textMuted, fontSize: 13, width: 70 },
  histValue: { color: colors.text, fontSize: 13, flex: 1 },
}));
