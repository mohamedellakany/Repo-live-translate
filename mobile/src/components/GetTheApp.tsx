import { Image, Platform, Pressable, Text, View } from "react-native";
import { useI18n } from "@/i18n";
import { makeStyles, spacing } from "@/theme";

/** Store listings. Add the App Store link here once the iPhone app is published. */
export const STORE_LINKS = {
  googlePlay: "https://play.google.com/store/apps/details?id=com.lisancast.app",
} as const;

// Google's official badges (their artwork must be used as-is), in the app's two languages.
const PLAY_BADGE = {
  en: require("../../assets/badges/google-play-en.png"),
  ar: require("../../assets/badges/google-play-ar.png"),
};
const TEXT = {
  en: { cardTitle: "Get the LisanCast app", cardText: "Faster, works in the background, and always one tap away.", footer: "Get the app", alt: "Get it on Google Play" },
  ar: { cardTitle: "حمّل تطبيق لسان كاست", cardText: "أسرع، ويعمل في الخلفية، ودائماً على بُعد لمسة واحدة.", footer: "حمّل التطبيق", alt: "احصل عليه من Google Play" },
};

const isAndroidBrowser = () => Platform.OS === "web" && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
const isIosBrowser = () => Platform.OS === "web" && typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

function open(url: string) {
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
}

function PlayBadge({ height }: { height: number }) {
  const { lang } = useI18n();
  const t = TEXT[lang] ?? TEXT.en;
  return (
    <Pressable onPress={() => open(STORE_LINKS.googlePlay)} accessibilityRole="link" accessibilityLabel={t.alt}>
      <Image source={PLAY_BADGE[lang] ?? PLAY_BADGE.en} style={{ height, width: (height * 646) / 250 }} resizeMode="contain" />
    </Pressable>
  );
}

/**
 * Website only (the phone apps never show it).
 * - Android browsers: a card with the Google Play badge (shown instead of the "install the website" card).
 * - Computers: a small "Get the app" row, for people who'll use LisanCast on their phone.
 * - iPhone browsers: nothing yet; the App Store badge goes here once the iPhone app is out.
 */
export function GetTheApp({ variant }: { variant: "card" | "footer" }) {
  const styles = useStyles();
  const { lang } = useI18n();
  const t = TEXT[lang] ?? TEXT.en;
  if (Platform.OS !== "web") return null;

  if (variant === "card") {
    if (!isAndroidBrowser()) return null;
    return (
      <View style={styles.card}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>{t.cardTitle}</Text>
          <Text style={styles.text}>{t.cardText}</Text>
        </View>
        <PlayBadge height={52} />
      </View>
    );
  }
  // Footer: computers only (phones get the card, or the iPhone add-to-home-screen card).
  if (isAndroidBrowser() || isIosBrowser()) return null;
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>{t.footer}</Text>
      <PlayBadge height={44} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
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
  footer: { alignItems: "center", gap: spacing.xs, paddingTop: spacing.md },
  footerText: { color: colors.textDim, fontSize: 13 },
}));
