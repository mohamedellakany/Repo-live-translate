import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nManager, Platform } from "react-native";
import { setApiLanguage } from "@/lib/api";
import { storage } from "@/lib/storage";
import { ar } from "./ar";
import { en, type TKey } from "./en";

export type UiLang = "en" | "ar";
export type { TKey };
type Params = Record<string, string | number>;

const DICTS: Record<UiLang, Record<TKey, string>> = { en, ar };
const KEY = "lt.uiLang";

const deviceLang = (): UiLang => (getLocales()[0]?.languageCode === "ar" ? "ar" : "en");

export function translate(lang: UiLang, key: TKey, params?: Params) {
  let s = DICTS[lang][key] ?? en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

interface I18nState {
  lang: UiLang;
  isRTL: boolean;
  /** Native only: the layout direction changes after the app restarts. */
  needsRestart: boolean;
  setLang: (lang: UiLang) => void;
  t: (key: TKey, params?: Params) => string;
}

const I18nContext = createContext<I18nState | null>(null);

function applyDirection(lang: UiLang): boolean {
  setApiLanguage(lang);
  const rtl = lang === "ar";
  if (Platform.OS === "web") {
    if (typeof document !== "undefined") {
      document.documentElement.dir = rtl ? "rtl" : "ltr";
      document.documentElement.lang = lang;
    }
    return false;
  }
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.forceRTL(rtl);
    return true;
  }
  return false;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(deviceLang);
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    storage.get(KEY).then((saved) => {
      const initial = saved === "ar" || saved === "en" ? saved : deviceLang();
      setLangState(initial);
      setNeedsRestart(applyDirection(initial));
    });
  }, []);

  const setLang = useCallback((next: UiLang) => {
    setLangState(next);
    storage.set(KEY, next);
    setNeedsRestart(applyDirection(next));
  }, []);

  const value = useMemo<I18nState>(
    () => ({
      lang,
      isRTL: lang === "ar",
      needsRestart,
      setLang,
      t: (key, params) => translate(lang, key, params),
    }),
    [lang, needsRestart, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
