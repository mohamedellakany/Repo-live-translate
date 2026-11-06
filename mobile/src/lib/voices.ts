import * as Speech from "expo-speech";
import { useCallback, useEffect, useMemo, useState } from "react";
import { storage } from "./storage";

/**
 * Text-to-speech voice selection. Devices don't report a voice's gender, so "automatic" prefers
 * voices whose names are known to be male (iOS, Android Google TTS, Chrome, Edge) and the
 * listener can always pick a specific voice instead.
 */
export const AUTO_VOICE = "auto";
const KEY = "lt.voices"; // { [languageCode]: voiceIdentifier | "auto" }

/** Male voice names on Apple, Microsoft (Edge) and other common engines. */
const MALE_NAMES = new Set(
  [
    // Apple (iOS / macOS)
    "maged", "majed", "tarik", "daniel", "aaron", "arthur", "fred", "gordon", "lee", "oliver", "reed", "rishi",
    "thomas", "jacques", "nicolas", "jorge", "diego", "juan", "carlos", "luca", "yuri", "xander", "tom", "alex",
    "eddy", "ralph", "albert", "martin", "markus", "yannick", "otoya", "hattori", "ahmet", "maarten",
    // Microsoft (Edge "Online (Natural)" voices)
    "guy", "hamed", "shakir", "hamdan", "fahed", "bassel", "rami", "taim", "omar", "jamal", "moaz", "davis",
    "andrew", "brian", "christopher", "eric", "roger", "steffan", "ryan", "william", "liam", "henri", "remy",
    "alvaro", "conrad", "killian", "florian", "antonio", "dmitry", "yunxi", "yunjian", "keita",
    "injoon", "ardi",
  ].map((n) => n.toLowerCase()),
);
const FEMALE_NAMES = new Set(
  [
    "samantha", "victoria", "karen", "moira", "tessa", "fiona", "veena", "zuzana", "amelie", "anna", "laila",
    "mariam", "hoda", "zariyah", "salma", "amina", "aria", "jenny", "michelle", "sonia", "libby", "denise",
    "elvira", "katja", "seraphina", "svetlana", "xiaoxiao", "nanami", "sunhi", "gadis", "colette", "kyoko",
    "ting-ting", "sin-ji", "yuna", "joana", "luciana", "paulina", "monica", "alice", "ellen", "melina",
  ].map((n) => n.toLowerCase()),
);
/** Android Google TTS variant codes that are male, e.g. "en-us-x-iom-local". */
const ANDROID_MALE_CODES = new Set(["iol", "iom", "tpd", "gbb", "gbd", "rjs", "ard", "are"]);

/** +1 likely male, -1 likely female, 0 unknown. */
export function voiceGender(v: Speech.Voice): 1 | -1 | 0 {
  const text = `${v.name} ${v.identifier}`.toLowerCase();
  if (/female|woman|#female/.test(text)) return -1;
  if (/(^|[^e])male\b|#male/.test(text)) return 1;
  const android = /-x-([a-z]{3})(?:[-#]|$)/.exec(v.identifier.toLowerCase());
  if (android) return ANDROID_MALE_CODES.has(android[1]) ? 1 : 0;
  // "Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)" → "hamed"; "Maged (Enhanced)" → "maged"
  const words = v.name.toLowerCase().replace(/^(microsoft|google|apple)\s+/, "").split(/[\s(,-]+/);
  if (words.some((w) => MALE_NAMES.has(w))) return 1;
  if (words.some((w) => FEMALE_NAMES.has(w))) return -1;
  return 0;
}

const matchesLanguage = (voiceLang: string, lang: string) => voiceLang.toLowerCase().split(/[-_]/)[0] === lang.toLowerCase();

/** The best male voice for a language, or undefined if none is recognizable (the default voice is used). */
export function pickMaleVoice(voices: Speech.Voice[], lang: string): Speech.Voice | undefined {
  let best: Speech.Voice | undefined;
  let bestScore = 0;
  for (const v of voices) {
    if (!matchesLanguage(v.language, lang) || voiceGender(v) !== 1) continue;
    // Prefer enhanced voices and on-device voices (no network needed).
    const score = 10 + (v.quality === Speech.VoiceQuality.Enhanced ? 2 : 0) + (/network|online/i.test(v.identifier) ? 0 : 1);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

let allVoices: Promise<Speech.Voice[]> | null = null;
/** All voices on this device. Browsers load them asynchronously, so an empty list is retried once. */
function loadVoices(): Promise<Speech.Voice[]> {
  allVoices ??= Speech.getAvailableVoicesAsync()
    .then(async (list) => (list.length ? list : (await new Promise((r) => setTimeout(r, 500)), Speech.getAvailableVoicesAsync())))
    .then((list) => {
      if (!list.length) allVoices = null; // try again next time
      return list;
    })
    .catch(() => {
      allVoices = null;
      return [];
    });
  return allVoices;
}

/** A human-friendly voice name; Android's identifiers like "ar-xa-x-ard-local" become "ARD (on device)". */
export function voiceLabel(v: Speech.Voice) {
  const android = /^[a-z]{2,3}-[a-z]{2,4}-x-([a-z]{3})-(local|network)/i.exec(v.identifier);
  if (android) return `${android[1].toUpperCase()} (${android[2] === "local" ? "on device" : "online"})`;
  return v.name.replace(/^Microsoft\s+/, "").replace(/\s+Online \(Natural\)/, "");
}

/** Voice for reading a language aloud: the listener's choice, or an automatic male voice. */
export function useVoice(lang: string) {
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const [choice, setChoiceState] = useState<string>(AUTO_VOICE);

  useEffect(() => {
    let alive = true;
    loadVoices().then((list) => alive && setVoices(list));
    storage.getJSON<Record<string, string>>(KEY, {}).then((saved) => alive && setChoiceState(saved[lang] ?? AUTO_VOICE));
    return () => {
      alive = false;
    };
  }, [lang]);

  const setChoice = useCallback(
    async (id: string) => {
      setChoiceState(id);
      const saved = await storage.getJSON<Record<string, string>>(KEY, {});
      await storage.setJSON(KEY, { ...saved, [lang]: id });
    },
    [lang],
  );

  return useMemo(() => {
    const forLanguage = voices.filter((v) => matchesLanguage(v.language, lang));
    const auto = pickMaleVoice(voices, lang);
    const chosen = choice !== AUTO_VOICE ? forLanguage.find((v) => v.identifier === choice) : undefined;
    return { voices: forLanguage, auto, choice, setChoice, voiceId: (chosen ?? auto)?.identifier };
  }, [voices, lang, choice, setChoice]);
}
