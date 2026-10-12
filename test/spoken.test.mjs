import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../public/spoken.js", import.meta.url), "utf8");
const { advance, readingStart, lastSentence } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const cards = [{ name: "The World", reversed: false }, { name: "Strength", reversed: true }, { name: "The Sun", reversed: false }];
test("ordinary speech and incomplete or wrong announcements never flip cards", () => {
  for (const text of ["Welcome to my world.", "The World is your oyster.", "The World, upright", "The World, reversed.", "I see The World, upright.", "Strength, reversed."]) assert.equal(advance(text, cards, 0), 0, text);
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
