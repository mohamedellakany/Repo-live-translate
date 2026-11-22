import { test } from "node:test";
import assert from "node:assert/strict";
import { forSpeech, maskProfanity } from "../src/profanity.js";

test("offensive words in English translations are masked", () => {
  assert.equal(maskProfanity("This is a shit mistake", "en"), "This is a *** mistake");
  assert.equal(maskProfanity("Damn, that's nonsense. What the FUCK?", "en"), "***, that's nonsense. What the ***?");
  assert.equal(maskProfanity("You son of a bitch", "en"), "You son of a ***");
  assert.equal(maskProfanity("Bullshitting again", "en"), "*** again");
});

test("religious and everyday words are never masked", () => {
  const sermon =
    "We seek refuge in Allah from the fire of Hell. Satan is cursed until the Day of Judgment; " +
    "the damned and the devil face damnation. Like a donkey (an ass) carrying books, the cock crowed at dawn.";
  assert.equal(maskProfanity(sermon, "en"), sermon);
});

test("only whole words: longer words that contain a blocked one are left alone", () => {
  const text = "The class took an assessment in Scunthorpe; shiitake and cocktails; Dickens; the Pricking ritual.";
  assert.equal(maskProfanity(text, "en"), text);
});

test("other languages pass through unchanged", () => {
  assert.equal(maskProfanity("shit", "ar"), "shit");
});

test("the read-aloud voice skips masked words instead of reading symbols", () => {
  assert.equal(forSpeech("This is a *** mistake."), "This is a mistake.");
  assert.equal(forSpeech("***, that's nonsense."), "that's nonsense.");
  assert.equal(forSpeech("***"), "");
});
