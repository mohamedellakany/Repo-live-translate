import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

export interface CaptionLine {
  seq: number;
  original: string;
  translation: string | null;
  sourceFinal: boolean;
  translationFinal: boolean;
  error: boolean;
}

export interface HistoryItem {
  seq: number;
  original: string;
  translation: string | null;
  isFinal: boolean;
}

const MAX_LINES = 500;

/**
 * Merges the `caption:source` and `caption:translation` streams into ordered lines.
 * Updates are batched (~60 fps) so rapid interim results stay smooth. A timer is used rather than
 * requestAnimationFrame because rAF is paused in background browser tabs.
 */
export function useCaptions(
  socket: Socket | null,
  lang: string,
  onFinalTranslation?: (line: CaptionLine) => void,
) {
  const map = useRef(new Map<number, CaptionLine>());
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const frame = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyFinal = useEffectEvent((line: CaptionLine) => onFinalTranslation?.(line));

  const flush = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = setTimeout(() => {
      frame.current = null;
      const sorted = [...map.current.values()].sort((a, b) => a.seq - b.seq);
      if (sorted.length > MAX_LINES) {
        sorted.splice(0, sorted.length - MAX_LINES).forEach((l) => map.current.delete(l.seq));
      }
      setLines(sorted);
    }, 16);
  }, []);

  const upsert = useCallback(
    (seq: number, patch: Partial<CaptionLine>) => {
      const prev = map.current.get(seq) ?? {
        seq,
        original: "",
        translation: null,
        sourceFinal: false,
        translationFinal: false,
        error: false,
      };
      map.current.set(seq, { ...prev, ...patch });
      flush();
    },
    [flush],
  );

  const reset = useCallback(
    (history: HistoryItem[] = []) => {
      map.current.clear();
      for (const h of history) {
        map.current.set(h.seq, {
          seq: h.seq,
          original: h.original,
          translation: h.translation,
          sourceFinal: h.isFinal,
          translationFinal: h.isFinal && h.translation !== null,
          error: false,
        });
      }
      flush();
    },
    [flush],
  );

  useEffect(() => {
    if (!socket) return;
    const onSource = (d: { seq: number; text: string; isFinal: boolean }) => {
      const existing = map.current.get(d.seq);
      if (existing?.sourceFinal && !d.isFinal) return; // late interim after final
      if (d.isFinal && !d.text) {
        map.current.delete(d.seq);
        return flush();
      }
      upsert(d.seq, { original: d.text, sourceFinal: d.isFinal });
    };
    const onTranslation = (d: { seq: number; lang: string; text: string; isFinal: boolean; error?: boolean }) => {
      if (d.lang !== lang) return;
      const existing = map.current.get(d.seq);
      if (existing?.translationFinal && !d.isFinal) return;
      if (d.error) return upsert(d.seq, { translationFinal: true, error: true });
      upsert(d.seq, { translation: d.text, translationFinal: d.isFinal });
      if (d.isFinal) notifyFinal(map.current.get(d.seq)!);
    };
    socket.on("caption:source", onSource);
    socket.on("caption:translation", onTranslation);
    return () => {
      socket.off("caption:source", onSource);
      socket.off("caption:translation", onTranslation);
    };
  }, [socket, lang, upsert, flush]);

  useEffect(
    () => () => {
      if (frame.current !== null) clearTimeout(frame.current);
      frame.current = null;
    },
    [],
  );

  return { lines, reset };
}
