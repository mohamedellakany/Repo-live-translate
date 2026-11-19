import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Button, Sheet } from "@/components/ui";
import { useI18n } from "@/i18n";
import { storage } from "@/lib/storage";
import { makeStyles, spacing, useTheme } from "@/theme";

/*
 * Web only: offer to install LisanCast as an app (PWA).
 *  - Android / desktop Chrome and Edge fire `beforeinstallprompt`; we keep it and show an "Install app" button.
 *  - iPhone Safari has no such event, so we explain "Share → Add to Home Screen" instead.
 * Hidden once installed (opened from the home screen) or after the user dismisses it.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISSED_KEY = "lt.installDismissed";
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (Platform.OS === "web" && typeof window !== "undefined") {
  // Registered when this module loads, so an early event isn't missed before the Home screen mounts.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
const isIosSafari = () =>
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

export function InstallAppPrompt() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  const [dismissed, setDismissed] = useState(true);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    storage.get(DISMISSED_KEY).then((v) => setDismissed(v === "1"));
    const update = () => setCanPrompt(!!deferred);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);

  if (Platform.OS !== "web" || dismissed || isStandalone()) return null;
  const ios = isIosSafari();
  if (!canPrompt && !ios) return null;

  const dismiss = () => {
    setDismissed(true);
    storage.set(DISMISSED_KEY, "1");
  };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    setCanPrompt(false);
  };

  const steps: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }[] = [
    { icon: "share-outline", text: t("install.step1") },
    { icon: "add-circle-outline", text: t("install.step2") },
    { icon: "checkmark-circle-outline", text: t("install.step3") },
  ];

  return (
    <>
      <View style={styles.box}>
        {/* iPhone can't install from a button, so tapping the text opens the steps as well. */}
        <Pressable
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }}
          onPress={ios ? () => setShowSteps(true) : undefined}
          disabled={!ios}
          accessible={ios}
          accessibilityRole={ios ? "button" : undefined}
          accessibilityLabel={ios ? t("install.howTo") : undefined}
        >
          <Ionicons name="phone-portrait-outline" size={22} color={colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>{t("install.title")}</Text>
            <Text style={styles.text}>{ios ? t("install.iosHint") : t("install.text")}</Text>
          </View>
        </Pressable>
        {ios ? (
          <Button title={t("install.howTo")} variant="secondary" onPress={() => setShowSteps(true)} />
        ) : (
          <Button title={t("install.button")} onPress={install} />
        )}
        <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel={t("install.dismiss")} hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.textDim} />
        </Pressable>
      </View>

      <Sheet visible={showSteps} onClose={() => setShowSteps(false)} title={t("install.stepsTitle")}>
        {steps.map((s, i) => (
          <View key={s.icon} style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{s.text}</Text>
            <Ionicons name={s.icon} size={26} color={colors.primary} />
          </View>
        ))}
        <Text style={styles.text}>{t("install.stepsNote")}</Text>
        <Button title={t("install.gotIt")} onPress={() => setShowSteps(false)} />
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  text: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  stepText: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 23 },
}));
