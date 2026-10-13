import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../public/spoken.js", import.meta.url), "utf8");
const { advance, readingStart, lastSentence } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const cards = [{ name: "The World", reversed: false }, { name: "Strength", reversed: true }, { name: "The Sun", reversed: false }];
test("ordinary speech and incomplete or wrong announcements never flip cards", () => {
  for (const text of ["Welcome to my world.", "The World is your oyster.", "The World. Upright citizens everywhere.", "Strength, reversed."]) assert.equal(advance(text, cards, 0), 0, text);
});
test("minor arcana flip when Vex adds \"The\" (the bug guests hit on 13 Oct)", () => {
  const minor = [{ name: "Queen of Cups", reversed: false }, { name: "King of Cups", reversed: false }, { name: "The Chariot", reversed: true }, { name: "Queen of Swords", reversed: false }, { name: "Six of Swords", reversed: false }];
  const text = "The cards are on the table.  First, the heart of it.  The Queen of Cups, upright.  You're overwhelmed. Next, what crosses you.  The King of Cups, upright.  Ah. Now, the root of the issue.  The Chariot, reversed.  Stuck. What's coming? The Queen of Swords, upright.  Clarity. And finally, where this ends up.  The Six of Swords, upright.  Hope.";
  assert.equal(advance(text, minor, 0), 5);
  assert.equal(advance("First: Queen of Cups — upright. Then the King of Cups, and it's upright.", minor, 0), 2);
  assert.equal(advance("The Queen of Cups, up", minor, 0), 0, "partial transcription waits");
});
test("complete announcements advance in order, including streamed accumulations", () => {
  const text = "The cards are on the table. The World, upright. A change. Strength, reversed. Be brave. The Sun, upright. Go.";
  assert.equal(advance(text, cards, 0), 3);
  assert.equal(advance(text, cards, 1), 3);
  assert.equal(advance("The World, upright. The Sun, upright.", cards, 0), 1);
});
test("only a deliberate table cue starts the speech fallback", () => {
  assert.equal(readingStart("The cards are on the table."), "short");
  assert.equal(readingStart("Very well. The Celtic Cross is on the table."), "celtic");
  assert.equal(readingStart("You think the cards are on the table."), null);
  assert.equal(readingStart("The cards are on the table"), null);
});
test("keepsake extracts the final sentence", () => assert.equal(lastSentence("The World, upright. Enough waiting. Make the call."), "Make the call."));
