// Recognise deliberate announcements, not card names embedded in conversation.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const boundary = "(?:^|[.!?]\\s+|\\n\\s*)";

export function readingStart(text) {
  if (new RegExp(`${boundary}The Celtic Cross is on the table[.!]`, "i").test(text)) return "celtic";
  if (new RegExp(`${boundary}The cards are on the table[.!]`, "i").test(text)) return "short";
  return null;
}

// Which spread to lay, if this text starts a reading. After the opening gate the
// announcement is enough. Before it, Vex must also name the first drawn card: she
// has gone ahead with the reading, so the table follows her rather than staying empty.
export function readingUnderway(text, cards, spreads, ready) {
  const announced = readingStart(text);
  if (!announced || ready) return announced;
  return advance(text, cards.slice(0, spreads[announced].length), 0) > 0 ? announced : null;
}

export function advance(text, cards, next) {
  let at = 0;
  while (next < cards.length) {
    const card = cards[next];
    // Require the full name, its announced orientation, and punctuation. Waiting
    // for punctuation also prevents a partial transcription from flipping a card.
    const orientation = card.reversed ? "reversed" : "upright";
    const announcement = new RegExp(`${boundary}${escape(card.name)}\\s*[,.:—–-]\\s*${orientation}\\s*[.!:—–-]`, "ig");
    announcement.lastIndex = at;
    const match = announcement.exec(text);
    if (!match) break;
    at = match.index + match[0].length - 1;
    next++;
  }
  return next;
}

export function lastSentence(text) {
  const sentences = text.trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return (sentences.at(-1) || "").trim().slice(0, 280);
}
