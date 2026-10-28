/** Mirror of server/src/languages.ts. Add new languages in both places. */
export interface Language {
  code: string;
  name: string;
  nativeName: string;
  ttsLocale: string;
  rtl: boolean;
}

export const LANGUAGES: Record<string, Language> = {
  ar: { code: "ar", name: "Arabic", nativeName: "العربية", ttsLocale: "ar-SA", rtl: true },
  en: { code: "en", name: "English", nativeName: "English", ttsLocale: "en-US", rtl: false },
  fr: { code: "fr", name: "French", nativeName: "Français", ttsLocale: "fr-FR", rtl: false },
  es: { code: "es", name: "Spanish", nativeName: "Español", ttsLocale: "es-ES", rtl: false },
  de: { code: "de", name: "German", nativeName: "Deutsch", ttsLocale: "de-DE", rtl: false },
  tr: { code: "tr", name: "Turkish", nativeName: "Türkçe", ttsLocale: "tr-TR", rtl: false },
  it: { code: "it", name: "Italian", nativeName: "Italiano", ttsLocale: "it-IT", rtl: false },
  pt: { code: "pt", name: "Portuguese", nativeName: "Português", ttsLocale: "pt-BR", rtl: false },
  ru: { code: "ru", name: "Russian", nativeName: "Русский", ttsLocale: "ru-RU", rtl: false },
  zh: { code: "zh", name: "Chinese", nativeName: "中文", ttsLocale: "zh-CN", rtl: false },
  ja: { code: "ja", name: "Japanese", nativeName: "日本語", ttsLocale: "ja-JP", rtl: false },
  ko: { code: "ko", name: "Korean", nativeName: "한국어", ttsLocale: "ko-KR", rtl: false },
  id: { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", ttsLocale: "id-ID", rtl: false },
  nl: { code: "nl", name: "Dutch", nativeName: "Nederlands", ttsLocale: "nl-NL", rtl: false },
};

export const SOURCE_LANGUAGES = ["ar"];
export const TARGET_LANGUAGES = ["en", "fr", "es", "de", "tr", "it", "pt", "ru", "zh", "ja", "ko", "id", "nl"];
export const DEFAULT_SOURCE = "ar";
export const DEFAULT_TARGET = "en";

/** Speech-recognition locales for Arabic. Picking the speaker's dialect improves accuracy. */
export const ARABIC_DIALECTS = [
  "ar-SA",
  "ar-EG",
  "ar-AE",
  "ar-KW",
  "ar-QA",
  "ar-JO",
  "ar-LB",
  "ar-PS",
  "ar-IQ",
  "ar-MA",
  "ar-DZ",
  "ar-TN",
] as const;
export type ArabicDialect = (typeof ARABIC_DIALECTS)[number];
export const DEFAULT_DIALECT: ArabicDialect = "ar-SA";

export type TranslationMode = "live" | "balanced" | "sentences";
export const TRANSLATION_MODES: TranslationMode[] = ["live", "balanced", "sentences"];
