import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import { Platform } from "react-native";
import { API_URL } from "./config";

/**
 * Reads sentences aloud one after another. Uses the server's natural AI voice (/api/tts) when a
 * sentence has a TTS token, and falls back to the device's own voice otherwise or if that fails.
 */
export interface ReadItem {
  text: string;
  /** Language code of `text` (e.g. "en"). */
  lang: string;
  /** Token from the server that allows /api/tts for this exact text. */
  tts?: string | null;
  /** Device fallback: BCP-47 locale and optional device voice identifier. */
  ttsLocale?: string;
  voice?: string;
  onStart?: () => void;
  onDone?: () => void;
}

interface Queued extends ReadItem {
  /** Resolves to true once the server has the audio ready (also warms its cache for the player). */
  ready?: Promise<boolean>;
}

/** How many upcoming sentences to prepare while one is playing. */
const PREFETCH = 2;
const START_TIMEOUT_MS = 15_000;

const audioUrl = (item: ReadItem) =>
  `${API_URL}/api/tts?text=${encodeURIComponent(item.text)}&lang=${encodeURIComponent(item.lang)}&token=${encodeURIComponent(item.tts ?? "")}`;

let audioModeSet = false;

export class Reader {
  private queue: Queued[] = [];
  private player: AudioPlayer | null = null;
  private running = false;
  /** Bumped by stop() so callbacks from an old run are ignored. */
  private generation = 0;

  /** Add a sentence to the end of the queue. */
  say(item: ReadItem) {
    this.queue.push({ ...item });
    this.prepare();
    if (!this.running) void this.run();
  }

  /** Stop speaking and clear the queue. */
  stop() {
    this.generation++;
    this.queue = [];
    this.running = false;
    this.player?.pause();
    void Speech.stop();
  }

  /** Stop and free the audio player (call when the screen closes). */
  dispose() {
    this.stop();
    this.player?.remove();
    this.player = null;
  }

  /** Ask the server to generate the next few sentences ahead of time. */
  private prepare() {
    for (const item of this.queue.slice(0, PREFETCH + 1)) {
      if (item.tts && !item.ready) {
        item.ready = fetch(audioUrl(item))
          .then((r) => r.ok)
          .catch(() => false);
      }
    }
  }

  private async run() {
    const generation = this.generation;
    this.running = true;
    while (this.queue.length && generation === this.generation) {
      const item = this.queue[0];
      this.prepare();
      const useServer = !!item.tts && (await item.ready);
      if (generation !== this.generation) return;
      item.onStart?.();
      try {
        if (useServer) await this.playAudio(item, generation);
        else await this.speakOnDevice(item);
      } catch {
        // The AI voice failed mid-way (e.g. network): read this sentence with the device voice instead.
        if (generation === this.generation) await this.speakOnDevice(item).catch(() => {});
      }
      if (generation !== this.generation) return;
      this.queue.shift();
      item.onDone?.();
    }
    if (generation === this.generation) this.running = false;
  }

  private async playAudio(item: ReadItem, generation: number) {
    if (!audioModeSet && Platform.OS !== "web") {
      audioModeSet = true;
      await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    }
    this.player ??= createAudioPlayer(null);
    const player = this.player;
    await new Promise<void>((resolve, reject) => {
      let started = false;
      const timer = setTimeout(() => !started && finish(new Error("Audio didn't start")), START_TIMEOUT_MS);
      const sub = player.addListener("playbackStatusUpdate", (status) => {
        if (generation !== this.generation) return finish();
        if (status.playing) started = true;
        if (status.didJustFinish) finish();
      });
      function finish(err?: Error) {
        clearTimeout(timer);
        sub.remove();
        if (err) reject(err);
        else resolve();
      }
      player.replace({ uri: audioUrl(item) });
      player.play();
    });
  }

  private speakOnDevice(item: ReadItem) {
    return new Promise<void>((resolve) => {
      Speech.speak(item.text, {
        language: item.ttsLocale,
        voice: item.voice,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    });
  }
}
