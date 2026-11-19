import { config } from "./config.js";

/**
 * Supported languages. Mirror of mobile/src/constants/languages.ts.
 * `code` is ISO 639-1 and is what translation providers receive.
 */
export interface Language {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
}

export const LANGUAGES: Record<string, Language> = {
  ar: { code: "ar", name: "Arabic", nativeName: "العربية", rtl: true },
  en: { code: "en", name: "English", nativeName: "English", rtl: false },
  fr: { code: "fr", name: "French", nativeName: "Français", rtl: false },
  es: { code: "es", name: "Spanish", nativeName: "Español", rtl: false },
  de: { code: "de", name: "German", nativeName: "Deutsch", rtl: false },
  tr: { code: "tr", name: "Turkish", nativeName: "Türkçe", rtl: false },
  it: { code: "it", name: "Italian", nativeName: "Italiano", rtl: false },
  pt: { code: "pt", name: "Portuguese", nativeName: "Português", rtl: false },
  ru: { code: "ru", name: "Russian", nativeName: "Русский", rtl: false },
  zh: { code: "zh", name: "Chinese", nativeName: "中文", rtl: false },
  ja: { code: "ja", name: "Japanese", nativeName: "日本語", rtl: false },
  ko: { code: "ko", name: "Korean", nativeName: "한국어", rtl: false },
  id: { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", rtl: false },
  nl: { code: "nl", name: "Dutch", nativeName: "Nederlands", rtl: false },
  // Pakistan, Afghanistan and Bangladesh
  ur: { code: "ur", name: "Urdu", nativeName: "اردو", rtl: true },
  ps: { code: "ps", name: "Pashto", nativeName: "پښتو", rtl: true },
  fa: { code: "fa", name: "Dari (Persian)", nativeName: "دری", rtl: true },
  bn: { code: "bn", name: "Bengali", nativeName: "বাংলা", rtl: false },
};

/** Languages a speaker may speak in. Arabic is the default and listed first. */
export const SOURCE_LANGUAGES = ["ar", "en", "fr", "es", "de", "tr", "it", "pt", "ru", "zh", "ja", "ko", "id", "nl"];
export const DEFAULT_SOURCE = "ar";
/** Languages a listener may read in (all supported by Google, DeepL and Claude). */
export const TARGET_LANGUAGES = ["en", "ar", "ur", "ps", "fa", "bn", "fr", "es", "de", "tr", "it", "pt", "ru", "zh", "ja", "ko", "id", "nl"];
export const DEFAULT_TARGET = "en";

export const isSourceLanguage = (code: string) => SOURCE_LANGUAGES.includes(code);
export const isTargetLanguage = (code: string) => TARGET_LANGUAGES.includes(code);

/**
 * Listening languages currently offered (LISTEN_LANGUAGES), always including the default. The others stay
 * supported in code, just switched off; listeners who ask for one get the default instead.
 */
export const LISTEN_LANGUAGES: string[] = (() => {
  const wanted = (config.LISTEN_LANGUAGES ?? "").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  const unknown = wanted.filter((c) => !TARGET_LANGUAGES.includes(c));
  if (unknown.length) console.warn(`[languages] LISTEN_LANGUAGES has unknown codes, ignored: ${unknown.join(", ")}`);
  const chosen = TARGET_LANGUAGES.filter((c) => wanted.includes(c));
  if (!chosen.length) return TARGET_LANGUAGES;
  return chosen.includes(DEFAULT_TARGET) ? chosen : [DEFAULT_TARGET, ...chosen];
})();
/** A listening language that is switched on, or the default one. */
export const listenLanguage = (code: string) => (LISTEN_LANGUAGES.includes(code) ? code : DEFAULT_TARGET);
