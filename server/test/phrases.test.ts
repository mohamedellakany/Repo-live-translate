import { test } from "node:test";
import assert from "node:assert/strict";
import { PHRASE_MIN_WORDS, settledPhraseEnd, toWords } from "../src/phrases.js";

test("a phrase is ready only once enough words are settled", () => {
  const w = toWords("one two three four five six seven eight");
  // Words still changing between interim results aren't voiced.
  assert.equal(settledPhraseEnd([], w, 0), null);
  assert.equal(settledPhraseEnd(toWords("one two three"), w, 0), null);
  // Two results agree on 7 words: everything but the last agreed word is voiced.
  assert.equal(settledPhraseEnd(toWords("one two three four five six seven"), w, 0), 6);
  // Already-voiced words don't count again.
  assert.equal(settledPhraseEnd(w, [...w, "nine"], 6), null);
  assert.equal(settledPhraseEnd([...w, "nine", "ten", "eleven", "twelve"], [...w, "nine", "ten", "eleven", "twelve", "x"], 6), 11);
});

test("a word revised by speech recognition stops the settled prefix", () => {
  const previous = toWords("أهلا وسهلا بكم في الجلسة الأولى اليوم");
  const latest = toWords("أهلا وسهلا بكم في جلسة الأولى اليوم مع");
  assert.equal(settledPhraseEnd(previous, latest, 0), null); // only 4 words agree before the revision
  assert.ok(PHRASE_MIN_WORDS >= 3);
});
