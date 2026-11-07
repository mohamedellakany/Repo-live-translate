/**
 * Live read-aloud doesn't wait for the end of a sentence: while the speaker is still talking, phrases
 * of the interim transcript that speech recognition has stopped revising are voiced right away,
 * like a human interpreter. The rest of the sentence is voiced when it's finished.
 */

/** Minimum number of new settled words before a phrase is voiced (shorter phrases sound choppy). */
export const PHRASE_MIN_WORDS = 5;
/** The last word(s) of the agreed prefix may still be growing ("مرح" → "مرحبا"), so they're held back. */
const HOLD_BACK_WORDS = 1;

export const toWords = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/**
 * Given the previous and the latest interim transcript (as words) and how many words were already
 * voiced, return the end index of a new phrase that's ready to voice, or null if none is ready yet.
 * Words are "settled" when two consecutive interim results agree on them.
 */
export function settledPhraseEnd(previous: string[], latest: string[], voiced: number): number | null {
  let agreed = 0;
  while (agreed < previous.length && agreed < latest.length && previous[agreed] === latest[agreed]) agreed++;
  const end = agreed - HOLD_BACK_WORDS;
  return end - voiced >= PHRASE_MIN_WORDS ? end : null;
}
