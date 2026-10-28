import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type { ExpoSpeechRecognitionNativeEventMap } from "expo-speech-recognition";
import type { TKey } from "@/i18n";

type SpeechModule = typeof import("expo-speech-recognition")["ExpoSpeechRecognitionModule"];

/** True inside the Expo Go app, which doesn't include the native speech-recognition module. */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Loaded defensively: in Expo Go the native module is missing and importing it would crash the app.
let Speech: SpeechModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose (see above)
  Speech = (require("expo-speech-recognition") as typeof import("expo-speech-recognition")).ExpoSpeechRecognitionModule;
} catch {
  Speech = null;
}

export type CaptureStatus = "idle" | "starting" | "listening" | "error";

interface Options {
  locale: string;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
}

/** Interim utterances longer than this are force-committed so captions keep flowing. */
const SOFT_COMMIT_CHARS = 280;
const IGNORABLE_ERRORS = new Set(["no-speech", "speech-timeout", "aborted"]);

const ERROR_KEYS: Record<string, TKey> = {
  "not-allowed": "speech.notAllowed",
  "service-not-allowed": "speech.serviceNotAllowed",
  "language-not-supported": "speech.languageNotSupported",
  "audio-capture": "speech.audioCapture",
  network: "speech.network",
};

/**
 * Continuous speech capture on iOS, Android and web (Web Speech API).
 * Recognizers stop on their own (silence, time limits); while `active` we
 * transparently restart them so the broadcast never stalls.
 */
export function useSpeechCapture({ locale, onPartial, onFinal }: Options) {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  /** Translation key describing the latest error (render with t()). */
  const [error, setError] = useState<TKey | null>(null);
  const [volume, setVolume] = useState(0);
  const wantRunning = useRef(false);
  const retryDelay = useRef(150);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supported = !!Speech && (Platform.OS !== "web" || Speech.isRecognitionAvailable());

  const startRecognizer = useCallback(() => {
    Speech?.start({
      lang: locale,
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      maxAlternatives: 1,
      iosTaskHint: "dictation",
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      androidIntentOptions: { EXTRA_LANGUAGE_MODEL: "free_form" },
    });
  }, [locale]);

  /** Restart the recognizer after it stopped on its own, backing off if it fails to start. */
  const scheduleRestart = useCallback(() => {
    const attempt = () => {
      if (!wantRunning.current) return;
      try {
        startRecognizer();
      } catch {
        retryDelay.current = Math.min(retryDelay.current * 2, 4_000);
        restartTimer.current = setTimeout(attempt, retryDelay.current);
      }
    };
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(attempt, retryDelay.current);
  }, [startRecognizer]);

  // Native events are dispatched through an Effect Event so they always see the latest props.
  const onSpeechEvent = useEffectEvent(<K extends keyof ExpoSpeechRecognitionNativeEventMap>(
    name: K,
    event: ExpoSpeechRecognitionNativeEventMap[K],
  ) => {
    switch (name) {
      case "start":
        setStatus("listening");
        setError(null);
        retryDelay.current = 150;
        break;
      case "result": {
        const e = event as ExpoSpeechRecognitionNativeEventMap["result"];
        const text = e.results[0]?.transcript ?? "";
        if (e.isFinal) {
          onFinal(text);
        } else {
          onPartial(text);
          if (text.length > SOFT_COMMIT_CHARS) Speech?.stop(); // yields a final, then restarts
        }
        break;
      }
      case "error": {
        const e = event as ExpoSpeechRecognitionNativeEventMap["error"];
        if (IGNORABLE_ERRORS.has(e.error)) return;
        const fatal = e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "language-not-supported";
        setError(ERROR_KEYS[e.error] ?? "speech.generic");
        if (fatal) {
          wantRunning.current = false;
          setStatus("error");
        } else {
          retryDelay.current = Math.min(retryDelay.current * 2, 4_000);
        }
        break;
      }
      case "end":
        setVolume(0);
        if (wantRunning.current) scheduleRestart();
        else setStatus((s) => (s === "error" ? s : "idle"));
        break;
      case "volumechange": {
        // value ranges roughly -2..10
        const v = (event as ExpoSpeechRecognitionNativeEventMap["volumechange"]).value;
        setVolume(Math.max(0, Math.min(1, (v + 2) / 12)));
        break;
      }
    }
  });

  useEffect(() => {
    if (!Speech) return;
    const events = ["start", "result", "error", "end", "volumechange"] as const;
    const subs = events.map((name) => Speech!.addListener(name, (e: any) => onSpeechEvent(name, e)));
    return () => subs.forEach((sub) => sub.remove());
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!supported || !Speech) {
      setStatus("error");
      setError(isExpoGo ? "speech.expoGo" : "speech.browser");
      return false;
    }
    setStatus("starting");
    const perm = await Speech.requestPermissionsAsync();
    if (!perm.granted) {
      setStatus("error");
      setError("speech.notAllowed");
      return false;
    }
    wantRunning.current = true;
    retryDelay.current = 150;
    startRecognizer();
    return true;
  }, [supported, startRecognizer]);

  const stop = useCallback(() => {
    wantRunning.current = false;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    Speech?.stop();
    setStatus("idle");
  }, []);

  useEffect(
    () => () => {
      wantRunning.current = false;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      Speech?.abort();
    },
    [],
  );

  return { status, error, volume, supported, start, stop };
}
