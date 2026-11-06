import { AudioContext, type AudioBufferSourceNode } from "react-native-audio-api";

/**
 * Plays the server's streamed read-aloud speech (`caption:audio` events) as it arrives, so listeners
 * hear a sentence about a second after reading it. Sentences play in order, one after another.
 * Works on iOS, Android and web (react-native-audio-api exposes the browser's Web Audio API on web).
 */
export interface AudioEvent {
  seq: number;
  lang: string;
  /** Raw 16-bit signed little-endian PCM, mono. */
  data?: ArrayBuffer | ArrayBufferView;
  end?: boolean;
}

const SAMPLE_RATE = 24_000; // matches the server's TTS_SAMPLE_RATE
/** Small head start when playback (re)starts, so network jitter between chunks doesn't cause gaps. */
const JITTER_SECONDS = 0.12;
/** Give up on a sentence whose audio stopped arriving (e.g. the server failed mid-way). */
const STALL_MS = 8_000;

interface Stream {
  pending: Float32Array<ArrayBuffer>[];
  ended: boolean;
  /** Odd trailing byte carried over to the next chunk (samples are 2 bytes). */
  carry: number | null;
  lastActivity: number;
}

export class LiveSpeechPlayer {
  private ctx: AudioContext | null = null;
  private streams = new Map<number, Stream>();
  private current: number | null = null;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  /** Must be called from a user tap: browsers only allow audio to start after a gesture. */
  async start() {
    this.ctx ??= new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.ctx.resume();
  }

  /** Drop everything queued or playing, but keep the audio output ready (e.g. when the language changes). */
  reset() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already finished
      }
    }
    this.sources.clear();
    this.streams.clear();
    this.current = null;
    this.nextTime = 0;
  }

  /** Stop and release the audio output. */
  stop() {
    this.reset();
    void this.ctx?.close();
    this.ctx = null;
  }

  onAudio(event: AudioEvent) {
    if (!this.ctx) return;
    let stream = this.streams.get(event.seq);
    if (!stream) {
      stream = { pending: [], ended: false, carry: null, lastActivity: Date.now() };
      this.streams.set(event.seq, stream);
    }
    stream.lastActivity = Date.now();
    if (event.data) stream.pending.push(toSamples(stream, event.data));
    if (event.end) stream.ended = true;
    this.pump();
  }

  /** Schedule audio for the current sentence; move to the next one when it's complete. */
  private pump() {
    for (;;) {
      if (this.current === null) {
        if (!this.streams.size) return;
        this.current = Math.min(...this.streams.keys());
      }
      const stream = this.streams.get(this.current);
      if (!stream) {
        this.current = null;
        continue;
      }
      for (const samples of stream.pending) this.schedule(samples);
      stream.pending = [];
      const stalled = Date.now() - stream.lastActivity > STALL_MS;
      if (!stream.ended && !stalled) return;
      this.streams.delete(this.current);
      this.current = null;
    }
  }

  private schedule(samples: Float32Array<ArrayBuffer>) {
    const ctx = this.ctx;
    if (!ctx || !samples.length) return;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + JITTER_SECONDS;
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => this.sources.delete(source);
    source.start(this.nextTime);
    this.sources.add(source);
    this.nextTime += buffer.duration;
  }
}

/** 16-bit little-endian PCM bytes → float samples in [-1, 1]. */
function toSamples(stream: Stream, data: ArrayBuffer | ArrayBufferView): Float32Array<ArrayBuffer> {
  const raw = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let bytes = raw;
  if (stream.carry !== null) {
    bytes = new Uint8Array(raw.length + 1);
    bytes[0] = stream.carry;
    bytes.set(raw, 1);
    stream.carry = null;
  }
  const count = Math.floor(bytes.length / 2);
  if (bytes.length % 2) stream.carry = bytes[bytes.length - 1];
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}
