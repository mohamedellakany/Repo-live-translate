import { reloadAppAsync } from "expo";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";
import { useBroadcast } from "@/broadcast/BroadcastProvider";
import { useTheme } from "@/theme";
import { storage } from "@/lib/storage";
import { useI18n, type UiLang } from ".";

const LABEL: Record<UiLang, string> = { en: "English", ar: "العربية" };
const FADE_IN_MS = 160;
const FADE_OUT_MS = 240;
/** Remembered across the reload so the new language fades in instead of popping. */
const FADE_IN_KEY = "lt.langFadeIn";

const SwitchContext = createContext<(lang: UiLang) => void>(() => {});

/**
 * Smooth language switching: the screen fades to the background color showing the new language's name,
 * switches underneath, then fades back. On phones, Arabic ⇄ English also flips the layout direction,
 * which needs an app reload; that happens automatically behind the fade (but never during a live broadcast).
 */
export function LanguageTransition({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const { lang, setLang } = useI18n();
  const { phase } = useBroadcast();
  const [opacity] = useState(() => new Animated.Value(0));
  const [label, setLabel] = useState<string | null>(null);
  const busy = useRef(false);

  const fade = useCallback(
    (to: number, duration: number) =>
      new Promise<void>((resolve) =>
        Animated.timing(opacity, { toValue: to, duration, easing: Easing.out(Easing.quad), useNativeDriver: false }).start(() =>
          resolve(),
        ),
      ),
    [opacity],
  );

  // After a reload for a direction change, start covered and fade the new layout in.
  useEffect(() => {
    storage.get(FADE_IN_KEY).then((pending) => {
      if (!pending) return;
      storage.remove(FADE_IN_KEY);
      opacity.setValue(1);
      setLabel(LABEL[pending as UiLang] ?? "");
      setTimeout(() => fade(0, FADE_OUT_MS).then(() => setLabel(null)), 120);
    });
  }, [fade, opacity]);

  const switchLang = useCallback(
    async (next: UiLang) => {
      if (next === lang || busy.current) return;
      busy.current = true;
      setLabel(LABEL[next]);
      await fade(1, FADE_IN_MS);
      const needsReload = setLang(next);
      if (needsReload && phase === "setup") {
        await storage.set(FADE_IN_KEY, next);
        try {
          await reloadAppAsync("Switching the layout direction for the new language");
          return;
        } catch {
          await storage.remove(FADE_IN_KEY); // couldn't reload: carry on; Account shows the restart note
        }
      }
      // Give the new language a frame to render before revealing it.
      await new Promise((r) => setTimeout(r, 60));
      await fade(0, FADE_OUT_MS);
      setLabel(null);
      busy.current = false;
    },
    [fade, lang, phase, setLang],
  );

  return (
    <SwitchContext.Provider value={switchLang}>
      {children}
      {label !== null && (
        <Animated.View
          pointerEvents="auto"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity, alignItems: "center", justifyContent: "center" }]}
        >
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "700" }}>{label}</Text>
        </Animated.View>
      )}
    </SwitchContext.Provider>
  );
}

/** Switch the interface language with the smooth transition (use instead of `setLang` from useI18n). */
export const useSwitchLanguage = () => useContext(SwitchContext);
