import * as Clipboard from "expo-clipboard";
import { Redirect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { AppHeader, Banner, Button, Card, IconButton, Screen, Sheet, SwitchRow, TextField } from "@/components/ui";
import { useI18n } from "@/i18n";
import { adminApi, type ManagedSpeaker } from "@/lib/adminApi";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

/*
 * Admin only (ADMIN_USERNAMES): create ready-to-use speaker accounts (no email code; speaking on; optional expiry),
 * see everyone who can speak, change expiry, turn speaking on/off, and approve speaking requests.
 * Texts live here (not in the shared language files) because only the admin sees this page.
 */
const TEXT = {
  en: {
    title: "Manage speakers",
    add: "Add speaker account",
    addTitle: "New speaker account",
    name: "Name",
    username: "Speaker ID",
    usernameHint: "3-20 letters, numbers or _. Listeners use it to find them.",
    email: "Email",
    password: "Password",
    passwordHint: "Leave empty to generate one automatically.",
    expiry: "Account expires",
    create: "Create account",
    createdTitle: "Account ready",
    createdText: "Send these details to the speaker. The password is shown only now.",
    copy: "Copy details",
    copied: "Copied",
    done: "Done",
    requests: "Speaking requests",
    approve: "Approve",
    speakers: "Speakers",
    none: "No speakers yet.",
    speaking: "Can speak",
    changeExpiry: "Expiry",
    expiryTitle: "Change expiry",
    save: "Save",
    never: "Never",
    today: "Today",
    tomorrow: "Tomorrow",
    week: "1 week",
    month: "1 month",
    pick: "Pick a date",
    dateHint: "Year-month-day, e.g. 2026-12-31. Works until the end of that day.",
    expires: "Expires {date}",
    expired: "Expired {date}",
    noExpiry: "No expiry",
    createdByAdmin: "Created by admin",
    details: "LisanCast speaker account\nSign in: {url}/login\nSpeaker ID: {username}\nEmail: {email}\nPassword: {password}",
  },
  ar: {
    title: "إدارة المتحدثين",
    add: "إضافة حساب متحدث",
    addTitle: "حساب متحدث جديد",
    name: "الاسم",
    username: "معرّف المتحدث",
    usernameHint: "من 3 إلى 20 حرفاً إنجليزياً أو رقماً أو _. يستخدمه المستمعون للعثور عليه.",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    passwordHint: "اتركها فارغة لإنشاء واحدة تلقائياً.",
    expiry: "انتهاء صلاحية الحساب",
    create: "إنشاء الحساب",
    createdTitle: "الحساب جاهز",
    createdText: "أرسل هذه البيانات إلى المتحدث. تظهر كلمة المرور الآن فقط.",
    copy: "نسخ البيانات",
    copied: "تم النسخ",
    done: "تم",
    requests: "طلبات التحدث",
    approve: "موافقة",
    speakers: "المتحدثون",
    none: "لا يوجد متحدثون بعد.",
    speaking: "يمكنه التحدث",
    changeExpiry: "الصلاحية",
    expiryTitle: "تغيير تاريخ الانتهاء",
    save: "حفظ",
    never: "بدون انتهاء",
    today: "اليوم",
    tomorrow: "غداً",
    week: "أسبوع",
    month: "شهر",
    pick: "اختر تاريخاً",
    dateHint: "سنة-شهر-يوم، مثل 2026-12-31. يعمل حتى نهاية ذلك اليوم.",
    expires: "ينتهي {date}",
    expired: "انتهى {date}",
    noExpiry: "بدون انتهاء",
    createdByAdmin: "أنشأه المشرف",
    details: "حساب متحدث في لسان كاست\nتسجيل الدخول: {url}/login\nمعرّف المتحدث: {username}\nالبريد: {email}\nكلمة المرور: {password}",
  },
};
type Key = keyof typeof TEXT.en;

type ExpiryChoice = "never" | "today" | "tomorrow" | "week" | "month" | "pick";
const CHOICES: ExpiryChoice[] = ["today", "tomorrow", "week", "month", "never", "pick"];

/** End of a local day (23:59:59), `days` from today. */
function endOfDay(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 0);
  return d;
}
/** The chosen expiry as an ISO date-time, null for never, or undefined if the picked date isn't valid. */
function expiryFor(choice: ExpiryChoice, picked: string): string | null | undefined {
  switch (choice) {
    case "never":
      return null;
    case "today":
      return endOfDay(0).toISOString();
    case "tomorrow":
      return endOfDay(1).toISOString();
    case "week":
      return endOfDay(7).toISOString();
    case "month":
      return endOfDay(30).toISOString();
    case "pick": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(picked.trim());
      if (!m) return undefined;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
      return Number.isNaN(d.getTime()) || d.getTime() <= Date.now() ? undefined : d.toISOString();
    }
  }
}
const suggestUsername = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);

export default function Admin() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { lang } = useI18n();
  const { user, ready } = useAuth();
  const t = (key: Key, params: Record<string, string> = {}) =>
    Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), (TEXT[lang] ?? TEXT.en)[key]);
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar" : "en", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  const [speakers, setSpeakers] = useState<ManagedSpeaker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add form
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ displayName: "", username: "", email: "", password: "" });
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [choice, setChoice] = useState<ExpiryChoice>("tomorrow");
  const [picked, setPicked] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ speaker: ManagedSpeaker; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Change expiry
  const [editing, setEditing] = useState<ManagedSpeaker | null>(null);
  const [editChoice, setEditChoice] = useState<ExpiryChoice>("week");
  const [editPicked, setEditPicked] = useState("");

  const load = useCallback(async () => {
    try {
      setSpeakers((await adminApi.speakers()).speakers);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!user?.isAdmin) return;
    adminApi
      .speakers()
      .then((r) => setSpeakers(r.speakers))
      .catch((e) => setError((e as Error).message));
  }, [user?.isAdmin]);

  if (ready && (!user || !user.isAdmin)) return <Redirect href="/" />;

  const replace = (s: ManagedSpeaker) => setSpeakers((list) => (list ? list.map((x) => (x.id === s.id ? s : x)) : list));
  const update = async (s: ManagedSpeaker, patch: { canSpeak?: boolean; expiresAt?: string | null }) => {
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

  const openAdd = () => {
    setForm({ displayName: "", username: "", email: "", password: "" });
    setUsernameTouched(false);
    setChoice("tomorrow");
    setPicked("");
    setFormError(null);
    setAdding(true);
  };
  const create = async () => {
    const expiresAt = expiryFor(choice, picked);
    if (expiresAt === undefined) return setFormError(t("dateHint"));
    setSaving(true);
    setFormError(null);
    try {
      const res = await adminApi.createSpeaker({
        displayName: form.displayName.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password.trim() || undefined,
        expiresAt,
      });
      setSpeakers((list) => [res.speaker, ...(list ?? [])]);
      setAdding(false);
      setCopied(false);
      setCreated(res);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const details = created
    ? t("details", {
        url: typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://app.lisancast.com",
        username: created.speaker.username,
        email: created.speaker.email,
        password: created.password,
      })
    : "";

  const status = (s: ManagedSpeaker) =>
    s.expiresAt ? t(s.expired ? "expired" : "expires", { date: formatDate(s.expiresAt) }) : t("noExpiry");
  const requests = (speakers ?? []).filter((s) => !s.canSpeak && s.speakRequestedAt && !s.expired);
  const others = (speakers ?? []).filter((s) => !requests.includes(s));

  const choiceRow = (value: ExpiryChoice, set: (c: ExpiryChoice) => void, allowNever = true) => (
    <View style={styles.chips}>
      {CHOICES.filter((c) => allowNever || c !== "never").map((c) => (
        <Pressable key={c} onPress={() => set(c)} style={[styles.chip, value === c && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: value === c }}>
          <Text style={[styles.chipText, value === c && styles.chipTextOn]}>{t(c)}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Screen header={<AppHeader title={t("title")} right={<IconButton icon="refresh" label={t("title")} onPress={load} />} />}>
      {error && <Banner tone="error" text={error} />}
      {!speakers && !error && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />}
      {speakers && (
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
          <Button title={t("add")} icon="person-add-outline" onPress={openAdd} />

          {requests.length > 0 && (
            <>
              <Text style={styles.section}>
                {t("requests")} ({requests.length})
              </Text>
              {requests.map((s) => (
                <Card key={s.id} style={{ gap: spacing.xs, borderWidth: 1, borderColor: colors.warning }}>
                  <Text style={styles.name}>{s.displayName}</Text>
                  <Text style={styles.meta}>
                    @{s.username} · {s.email}
                  </Text>
                  {!!s.speakRequestNote && <Text style={styles.note}>“{s.speakRequestNote}”</Text>}
                  <Button title={t("approve")} icon="checkmark" onPress={() => update(s, { canSpeak: true })} loading={busyId === s.id} />
                </Card>
              ))}
            </>
          )}

          <Text style={styles.section}>{t("speakers")}</Text>
          {others.length === 0 && <Text style={styles.meta}>{t("none")}</Text>}
          {others.map((s) => (
            <Card key={s.id} style={[{ gap: spacing.xs }, s.expired && { opacity: 0.6 }]}>
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name}>{s.displayName}</Text>
                  <Text style={styles.meta}>
                    @{s.username} · {s.email}
                  </Text>
                  <Text style={[styles.meta, s.expired ? { color: colors.danger } : s.expiresAt ? { color: colors.warning } : null]}>
                    {status(s)}
                    {s.createdByAdmin ? ` · ${t("createdByAdmin")}` : ""}
                  </Text>
                </View>
                {!s.isAdmin && (
                  <Button
                    title={t("changeExpiry")}
                    variant="secondary"
                    onPress={() => {
                      setEditChoice(s.expired ? "week" : s.expiresAt ? "week" : "never");
                      setEditPicked("");
                      setEditing(s);
                    }}
                  />
                )}
              </View>
              {!s.isAdmin && (
                <SwitchRow label={t("speaking")} value={s.canSpeak} onValueChange={(on) => void update(s, { canSpeak: on })} />
              )}
            </Card>
          ))}
        </ScrollView>
      )}

      {/* Add a speaker */}
      <Sheet visible={adding} onClose={() => setAdding(false)} title={t("addTitle")}>
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">
          {formError && <Banner tone="error" text={formError} />}
          <TextField
            label={t("name")}
            value={form.displayName}
            onChangeText={(displayName) =>
              setForm((f) => ({ ...f, displayName, username: usernameTouched ? f.username : suggestUsername(displayName) }))
            }
          />
          <TextField
            label={t("username")}
            prefix="@"
            value={form.username}
            onChangeText={(username) => {
              setUsernameTouched(true);
              setForm((f) => ({ ...f, username }));
            }}
            autoCapitalize="none"
            autoCorrect={false}
            hint={t("usernameHint")}
          />
          <TextField
            label={t("email")}
            value={form.email}
            onChangeText={(email) => setForm((f) => ({ ...f, email }))}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextField
            label={t("password")}
            value={form.password}
            onChangeText={(password) => setForm((f) => ({ ...f, password }))}
            autoCapitalize="none"
            autoCorrect={false}
            hint={t("passwordHint")}
          />
          <Text style={styles.label}>{t("expiry")}</Text>
          {choiceRow(choice, setChoice)}
          {choice === "pick" && <TextField value={picked} onChangeText={setPicked} placeholder="2026-12-31" hint={t("dateHint")} />}
          <Button
            title={t("create")}
            icon="checkmark"
            onPress={create}
            loading={saving}
            disabled={!form.displayName.trim() || !form.username.trim() || !form.email.trim()}
          />
        </ScrollView>
      </Sheet>

      {/* Created: show the login details once */}
      <Sheet visible={!!created} onClose={() => setCreated(null)} title={t("createdTitle")}>
        <Text style={styles.meta}>{t("createdText")}</Text>
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
          <Button title={t("done")} onPress={() => setCreated(null)} style={{ flex: 1 }} />
        </View>
      </Sheet>

      {/* Change expiry */}
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={t("expiryTitle")}>
        {editing && (
          <Text style={styles.meta}>
            {editing.displayName} · @{editing.username} · {status(editing)}
          </Text>
        )}
        {choiceRow(editChoice, setEditChoice)}
        {editChoice === "pick" && <TextField value={editPicked} onChangeText={setEditPicked} placeholder="2026-12-31" hint={t("dateHint")} />}
        <Button
          title={t("save")}
          icon="checkmark"
          loading={!!editing && busyId === editing.id}
          onPress={async () => {
            if (!editing) return;
            const expiresAt = expiryFor(editChoice, editPicked);
            if (expiresAt === undefined) return setError(t("dateHint"));
            if (await update(editing, { expiresAt })) setEditing(null);
          }}
        />
      </Sheet>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  section: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.text, fontSize: 14, fontStyle: "italic" },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: "600", marginTop: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: "#fff", fontWeight: "700" },
  details: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  detailsText: { color: colors.text, fontSize: 14, lineHeight: 22, fontFamily: "monospace" },
}));
