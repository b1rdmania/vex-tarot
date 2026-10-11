// Which cards has Vex reached? Shared by the kiosk (to flip cards as she says
// them) and the worker (to end the session after the last one).
// She reads in order, so only the next card or the one after it can match.
// That keeps "the world" in a stray sentence from flipping card five early.
const key = (name) => name.toLowerCase().replace(/^the /, "");

export function advance(text, cards, next) {
  const said = text.toLowerCase();
  let at = 0;
  while (next < cards.length) {
    let found = -1, j;
    for (j = next; j < Math.min(next + 2, cards.length); j++) {
      found = said.indexOf(key(cards[j].name), at);
      if (found >= 0) break;
    }
    if (found < 0) break;
    at = found + 1;
    next = j + 1;
  }
  return next;
}
