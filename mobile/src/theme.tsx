import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, Platform, StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import { storage } from "@/lib/storage";

const dark = {
  bg: "#0B1020",
  surface: "#131A2E",
  surfaceAlt: "#1A2340",
  border: "#27304F",
  text: "#F4F6FF",
  textMuted: "#8B94B5",
  textDim: "#5D6688",
  primary: "#5B8CFF",
  primaryPressed: "#4A78E6",
  live: "#FF4D5E",
  livePressed: "#E63E4E",
  success: "#2ECC8F",
  warning: "#FFB547",
  danger: "#FF5C6C",
  dangerPressed: "#3A1D26",
};
export type ThemeColors = typeof dark;

const light: ThemeColors = {
  bg: "#F5F7FC",
  surface: "#FFFFFF",
  surfaceAlt: "#EDF0F7",
  border: "#D7DCE8",
  text: "#0B1020",
  textMuted: "#4E5878",
  textDim: "#6B7594",
  primary: "#2D5FD6",
  primaryPressed: "#244FB8",
  live: "#CF2A3C",
  livePressed: "#B32334",
  success: "#1E9E6C",
  warning: "#8F5500",
  danger: "#C42A3B",
  dangerPressed: "#FCE4E7",
};

export const palettes = { dark, light };
export type ThemeName = keyof typeof palettes;
/** What the user picked: a fixed theme, or follow the device. */
export type ThemePreference = ThemeName | "system";
export const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];
/** The app was designed dark-first, so that stays the default until the user picks otherwise. */
const DEFAULT_PREFERENCE: ThemePreference = "dark";
const KEY = "lt.theme";

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };
export const maxContentWidth = 760;

interface ThemeState {
  name: ThemeName;
  colors: ThemeColors;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState>({
  name: "dark",
  colors: dark,
  preference: DEFAULT_PREFERENCE,
  setPreference: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const device = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_PREFERENCE);

  useEffect(() => {
    storage.get(KEY).then((saved) => {
      if (saved && (THEME_PREFERENCES as string[]).includes(saved)) setPreferenceState(saved as ThemePreference);
    });
  }, []);

  // Native alerts, pickers and the keyboard follow the in-app choice too.
  useEffect(() => {
    if (Platform.OS !== "web") Appearance.setColorScheme(preference === "system" ? "auto" : preference);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    void storage.set(KEY, p);
  }, []);

  const value = useMemo<ThemeState>(() => {
    const name: ThemeName = preference === "system" ? (device === "light" ? "light" : "dark") : preference;
    return { name, colors: palettes[name], preference, setPreference };
  }, [preference, device, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/**
 * Theme-aware StyleSheet: define styles as a function of the colors, then call the returned hook
 * inside components. Each theme's sheet is created once and cached.
 */
export function makeStyles<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(factory: (colors: ThemeColors) => T) {
  const cache = new Map<ThemeName, T>();
  return function useStyles(): T {
    const { name, colors } = useTheme();
    const cached = cache.get(name);
    if (cached) return cached;
    const sheet = StyleSheet.create(factory(colors)) as T;
    cache.set(name, sheet);
    return sheet;
  };
}
