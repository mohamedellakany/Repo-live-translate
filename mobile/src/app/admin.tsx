import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { AppHeader, Banner, Button, Card, IconButton, Screen, Sheet, SwitchRow } from "@/components/ui";
import { useI18n } from "@/i18n";
import { adminApi, type ManagedSpeaker } from "@/lib/adminApi";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

/*
 * Admin pages (admins only):
 *  - "Speaking requests": approve people who asked to speak.
 *  - "Accounts": search anyone by username/email, turn speaking on/off, delete accounts, Reset guest accounts
 *    (new password + 6 hours), and (main admin only) make or remove admins.
 * Texts live here (not in the shared language files) because only admins see these pages.
 */
const TEXT = {
  en: {
    title: "Admin",
    tabRequests: "Speaking requests",
    tabAccounts: "Accounts",
    search: "Search by username or email",
    noRequests: "No pending speaking requests.",
    noResults: "No accounts found.",
    requested: "Asked {date}",
    approve: "Approve",
    speaking: "Can speak",
    admin: "Admin",
    adminHint: "Can use the admin pages, but can't make other admins.",
    mainAdmin: "Main admin",
    guest: "Guest",
    guestOff: "Off until Reset",
    del: "Delete",
    deleteConfirmTitle: "Delete @{username}?",
    deleteConfirm: "This permanently deletes the account and its saved sessions. It can't be undone.",
    cancel: "Cancel",
    guestOn: "Active until {time} ({left} left)",
    reset: "Reset · {hours} hours",
    resetConfirmTitle: "Reset the guest account?",
    resetConfirm: "It gets a new password and works for {hours} hours. Anyone using it now is signed out.",
    resetTitle: "Guest account ready",
    resetText: "Give these details to the guest speaker. The password is shown only now.",
    copy: "Copy details",
    copied: "Copied",
    done: "Done",
    details: "LisanCast guest speaker\nSign in: {url}/login\nSpeaker ID: {username}\nPassword: {password}\nWorks until: {until}\nListeners: {url}/listen/{username}",
  },
  ar: {
    title: "الإدارة",
    tabRequests: "طلبات التحدث",
    tabAccounts: "الحسابات",
    search: "ابحث باسم المستخدم أو البريد",
    noRequests: "لا توجد طلبات تحدث معلّقة.",
    noResults: "لم يتم العثور على حسابات.",
    requested: "طُلب {date}",
    approve: "موافقة",
    speaking: "يمكنه التحدث",
    admin: "مشرف",
    adminHint: "يمكنه استخدام صفحات الإدارة، لكن لا يمكنه تعيين مشرفين آخرين.",
    mainAdmin: "المشرف الرئيسي",
    guest: "ضيف",
    guestOff: "متوقف حتى إعادة التعيين",
    del: "حذف",
    deleteConfirmTitle: "حذف الحساب ‎@{username}‎؟",
    deleteConfirm: "سيتم حذف الحساب وجلساته المحفوظة نهائياً. لا يمكن التراجع عن ذلك.",
    cancel: "إلغاء",
    guestOn: "فعّال حتى {time} (متبقٍ {left})",
    reset: "إعادة تعيين · {hours} ساعات",
    resetConfirmTitle: "إعادة تعيين حساب الضيف؟",
    resetConfirm: "سيحصل على كلمة مرور جديدة ويعمل لمدة {hours} ساعات. سيُسجَّل خروج من يستخدمه الآن.",
    resetTitle: "حساب الضيف جاهز",
    resetText: "أعطِ هذه البيانات للمتحدث الضيف. تظهر كلمة المرور الآن فقط.",
    copy: "نسخ البيانات",
    copied: "تم النسخ",
    done: "تم",
    details: "متحدث ضيف في لسان كاست\nتسجيل الدخول: {url}/login\nمعرّف المتحدث: {username}\nكلمة المرور: {password}\nيعمل حتى: {until}\nللمستمعين: {url}/listen/{username}",
  },
};
type Key = keyof typeof TEXT.en;

const GUEST_HOURS = 6;
export default function Admin() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { lang } = useI18n();
  const { user, ready } = useAuth();
  const params = useLocalSearchParams<{ tab?: string }>();
  const t = (key: Key, p: Record<string, string> = {}) =>
    Object.entries(p).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), (TEXT[lang] ?? TEXT.en)[key]);
  const locale = lang === "ar" ? "ar" : "en";
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  // A clock that ticks every 30 s, so guest countdowns stay current without calling Date.now() while drawing.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const timeLeft = (iso: string) => {
    const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  };

  const [tab, setTab] = useState<"requests" | "accounts">(params.tab === "accounts" ? "accounts" : "requests");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ManagedSpeaker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ speaker: ManagedSpeaker; password: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const latestQuery = useRef("");

  const load = useCallback(async (q: string) => {
    latestQuery.current = q;
    try {
      const res = await adminApi.speakers(q);
      if (latestQuery.current === q) setList(res.speakers); // ignore answers to older searches
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  // Search as you type (after a short pause); the first load happens straight away.
  useEffect(() => {
    if (!user?.isAdmin) return;
    const timer = setTimeout(() => void load(query), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, user?.isAdmin, load]);

  if (ready && (!user || !user.isAdmin)) return <Redirect href="/" />;

  const replace = (s: ManagedSpeaker) => setList((l) => (l ? l.map((x) => (x.id === s.id ? s : x)) : l));
  const update = async (s: ManagedSpeaker, patch: { canSpeak?: boolean; isAdmin?: boolean }) => {
    setBusyId(s.id);
    setError(null);
    try {
      replace((await adminApi.updateSpeaker(s.id, patch)).speaker);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusyId(null);
    }
  };
  /** Yes/No question: the browser's dialog on the web, a native alert in the apps. */
  const confirm = (title: string, message: string, yes: string, onYes: () => void, destructive = false) => {
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(`${title}\n${message}`)) onYes();
    } else {
      Alert.alert(title, message, [
        { text: t("cancel"), style: "cancel" },
        { text: yes, style: destructive ? "destructive" : "default", onPress: onYes },
      ]);
    }
  };
  const remove = (s: ManagedSpeaker) =>
    confirm(
      t("deleteConfirmTitle", { username: s.username }),
      t("deleteConfirm"),
      t("del"),
      async () => {
        setBusyId(s.id);
        setError(null);
        try {
          await adminApi.deleteSpeaker(s.id);
          setList((l) => (l ? l.filter((x) => x.id !== s.id) : l));
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusyId(null);
        }
      },
      true,
    );
  const reset = (s: ManagedSpeaker) => {
    const doReset = async () => {
      setBusyId(s.id);
      setError(null);
      try {
        const res = await adminApi.resetGuest(s.id);
        replace(res.speaker);
        setCopied(false);
        setResetResult(res);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusyId(null);
      }
    };
    const hours = String(GUEST_HOURS);
    confirm(t("resetConfirmTitle"), t("resetConfirm", { hours }), t("reset", { hours }), () => void doReset());
  };

  const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://app.lisancast.com";
  const details = resetResult
    ? t("details", {
        url: origin,
        username: resetResult.speaker.username,
        password: resetResult.password,
        until: `${formatDate(resetResult.expiresAt)} ${formatTime(resetResult.expiresAt)}`,
      })
    : "";

  const pending = (list ?? []).filter((s) => !s.canSpeak && s.speakRequestedAt && !s.expired);
  const accounts = (list ?? []).filter((s) => !pending.includes(s));
  const viewerIsOwner = !!user?.isOwner;

  const guestStatus = (s: ManagedSpeaker) =>
    s.expiresAt && !s.expired ? t("guestOn", { time: formatTime(s.expiresAt), left: timeLeft(s.expiresAt) }) : t("guestOff");
  const badge = (label: string, color: string) => (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );

  return (
    <Screen header={<AppHeader title={t("title")} right={<IconButton icon="refresh" label={t("title")} onPress={() => void load(query)} />} />}>
      {/* Tabs */}
      <View style={styles.tabs}>
        {(["requests", "accounts"] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => {
              setTab(k);
              router.setParams({ tab: k });
            }}
            style={[styles.tab, tab === k && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
          >
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>
              {k === "requests" ? `${t("tabRequests")}${pending.length ? ` (${pending.length})` : ""}` : t("tabAccounts")}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Search */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("search")}
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel={t("search")}
        />
        {!!query && (
          <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={18} color={colors.textDim} />
          </Pressable>
        )}
      </View>

      {error && <Banner tone="error" text={error} />}
      {!list && !error && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />}
      {list && (
        <ScrollView
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.primary}
              onRefresh={async () => {
                setRefreshing(true);
                await load(query);
                setRefreshing(false);
              }}
            />
          }
        >
          {tab === "requests" ? (
            pending.length === 0 ? (
              <Text style={styles.meta}>{query ? t("noResults") : t("noRequests")}</Text>
            ) : (
              pending.map((s) => (
                <Card key={s.id} style={{ gap: spacing.xs, borderWidth: 1, borderColor: colors.warning }}>
                  <Text style={styles.name}>{s.displayName}</Text>
                  <Text style={styles.meta}>
                    @{s.username} · {s.email}
                  </Text>
                  {!!s.speakRequestedAt && <Text style={styles.meta}>{t("requested", { date: formatDate(s.speakRequestedAt) })}</Text>}
                  {!!s.speakRequestNote && <Text style={styles.note}>“{s.speakRequestNote}”</Text>}
                  <Button title={t("approve")} icon="checkmark" onPress={() => update(s, { canSpeak: true })} loading={busyId === s.id} />
                </Card>
              ))
            )
          ) : accounts.length === 0 ? (
            <Text style={styles.meta}>{t("noResults")}</Text>
          ) : (
            accounts.map((s) => {
              // The main admin can't be changed; other admins only by the main admin.
              const locked = s.isOwner || (s.isAdmin && !viewerIsOwner);
              return (
                <Card key={s.id} style={{ gap: spacing.xs }}>
                  <View style={styles.row}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name}>{s.displayName}</Text>
                        {s.isOwner ? badge(t("mainAdmin"), colors.primary) : s.isAdmin ? badge(t("admin"), colors.primary) : null}
                        {s.isGuest && badge(t("guest"), colors.warning)}
                      </View>
                      <Text style={styles.meta}>
                        @{s.username} · {s.email}
                      </Text>
                      {s.isGuest && <Text style={[styles.meta, !s.expired && !!s.expiresAt && { color: colors.warning }]}>{guestStatus(s)}</Text>}
                    </View>
                    {!locked && s.id !== user?.id && (
                      <Button title={t("del")} icon="trash-outline" variant="danger" onPress={() => remove(s)} loading={busyId === s.id} />
                    )}
                  </View>
                  {s.isGuest && (
                    <Button
                      title={t("reset", { hours: String(GUEST_HOURS) })}
                      icon="refresh"
                      onPress={() => reset(s)}
                      loading={busyId === s.id}
                    />
                  )}
                  {!locked && !s.isGuest && (
                    <SwitchRow label={t("speaking")} value={s.canSpeak} onValueChange={(on) => void update(s, { canSpeak: on })} />
                  )}
                  {viewerIsOwner && !s.isOwner && !s.isGuest && (
                    <SwitchRow label={t("admin")} hint={t("adminHint")} value={!!s.isAdmin} onValueChange={(on) => void update(s, { isAdmin: on })} />
                  )}
                </Card>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Guest reset: show the new login once */}
      <Sheet visible={!!resetResult} onClose={() => setResetResult(null)} title={t("resetTitle")}>
        <Text style={styles.meta}>{t("resetText")}</Text>
        <View style={styles.details}>
          <Text style={styles.detailsText} selectable>
            {details}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button
            title={copied ? t("copied") : t("copy")}
            icon={copied ? "checkmark" : "copy-outline"}
            variant="secondary"
            onPress={async () => {
              await Clipboard.setStringAsync(details);
              setCopied(true);
            }}
            style={{ flex: 1 }}
          />
          <Button title={t("done")} onPress={() => setResetResult(null)} style={{ flex: 1 }} />
        </View>
      </Sheet>

    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  tabs: { flexDirection: "row", gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.md - 2, alignItems: "center" },
  tabOn: { backgroundColor: colors.primary },
  tabText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  tabTextOn: { color: "#fff" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.text, fontSize: 14, fontStyle: "italic" },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  details: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  detailsText: { color: colors.text, fontSize: 14, lineHeight: 22, fontFamily: "monospace" },
}));
