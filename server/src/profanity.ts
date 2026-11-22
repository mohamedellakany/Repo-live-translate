/*
 * Profanity filter for translated text (English). Machine translation sometimes produces an offensive word by
 * mistake; it's masked before readers, the speaker, saved transcripts, summaries or the read-aloud voice see it.
 *
 * Azure Translator's own filter (profanityAction=Marked) is the first layer; this list is the second, and also
 * covers providers without a filter (e.g. Google). Words with a religious meaning are deliberately NOT here
 * (hell, damned, damnation, curse/cursed, devil, satan, ...), so sermons and lectures stay accurate. Neither are
 * words with an everyday meaning (ass as in donkey, cock as in rooster, crap, piss, ...).
 */

/** Word stems, matched as whole words (with the listed endings), case-insensitively. */
const BLOCKED: string[] = [
  "fuck(?:s|ed|er|ers|ing|in|ings|face|head|wit)?",
  "motherfuck(?:er|ers|ing|in)?",
  "shit(?:s|ty|ting|ted|head|heads)?",
  "bullshit(?:s|ting)?",
  "bitch(?:es|y|ing)?",
  "bastards?",
  "assholes?",
  "dickheads?",
  "cunts?",
  "whores?",
  "sluts?",
  "twats?",
  "wankers?",
  "pricks?",
  "bollocks",
  "goddamn(?:ed|it)?",
  "damn(?:it)?",
  "dammit",
  // Slurs
  "nigg(?:er|ers|a|as)",
  "fag(?:s|got|gots)?",
  "retards?",
  "kikes?",
  "spics?",
  "chinks?",
  "trann(?:y|ies)",
];

const PATTERN = new RegExp(`\\b(?:${BLOCKED.join("|")})\\b`, "gi");

/** Mark used for a masked word, the same as Azure's own filter. */
export const MASK = "***";

/** Mask offensive words in text translated into `lang` (only English is checked; other languages pass through). */
export function maskProfanity(text: string, lang: string): string {
  if (lang !== "en" || !text) return text;
  return text.replace(PATTERN, MASK);
}

/** Text for the read-aloud voice: masked words are left out instead of being read as symbols. */
export function forSpeech(text: string): string {
  return text
    .replace(/\*{2,}/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/^[\s,;:]+/, "")
    .trim();
}
