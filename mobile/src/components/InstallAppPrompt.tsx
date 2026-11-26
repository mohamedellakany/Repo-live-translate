import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n";
import { storage } from "@/lib/storage";
import { makeStyles, spacing, useTheme } from "@/theme";

/*
 * Website on a computer only: offer to install LisanCast as an app (Chrome and Edge fire `beforeinstallprompt`;
 * we keep it and show an "Install" button). Phones don't see this card: Android gets the Google Play app instead
 * (GetTheApp), and iPhones will get the App Store app.
 * Hidden once installed (opened as an app) or after the user dismisses it.
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
const isPhone = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function InstallAppPrompt() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    storage.get(DISMISSED_KEY).then((v) => setDismissed(v === "1"));
    const update = () => setCanPrompt(!!deferred);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);

  if (Platform.OS !== "web" || dismissed || isStandalone() || isPhone() || !canPrompt) return null;

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

  return (
    <View style={styles.box}>
      <Ionicons name="desktop-outline" size={22} color={colors.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>{t("install.title")}</Text>
        <Text style={styles.text}>{t("install.text")}</Text>
      </View>
      <Button title={t("install.button")} onPress={install} />
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel={t("install.dismiss")} hitSlop={10}>
        <Ionicons name="close" size={20} color={colors.textDim} />
      </Pressable>
    </View>
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
}));
