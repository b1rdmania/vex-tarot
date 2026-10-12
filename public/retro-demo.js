// Scripted sample reading for judging the look without an agent or credits.
// Open /?demo (add &room=02-corner-booth or 03-attic-window to compare rooms).
// Vex's mouth is mimed from the text here; in a live session it follows her voice.
const POSITIONS = ["The heart of it", "What crosses you", "The root", "What's coming", "Where this ends up"];
const CARDS = [
  { name: "The Tower", img: "m16.jpg", reversed: false, line: "The Tower, upright. Your plan is on fire. Good. It was badly built." },
  { name: "The Fool", img: "m00.jpg", reversed: true, line: "The Fool, reversed. Walking off a cliff, but slower. Progress." },
  { name: "Death", img: "m13.jpg", reversed: false, line: "Death, upright. Calm down. It means change. Mostly." },
  { name: "The Lovers", img: "m06.jpg", reversed: true, line: "The Lovers, reversed. Someone is texting you back. Not quickly." },
  { name: "The Moon", img: "m18.jpg", reversed: false, line: "The Moon, upright. Nothing is what it seems. Including you." },
];
const SCRIPT = [
  [5000, (s) => s.idle(false) || s.say("Oh. A guest. Sit. Don't touch the mirror.", { mime: true })],
  [4000, (s) => s.say("What do you want to know? Love? Money? Whether to text them?", { mime: true })],
  [4500, (s, ui) => { ui.status("Your turn. Speak normally."); s.say(""); }],
  [3000, (s, ui) => { ui.status("Vex is considering you..."); s.react("eye_roll"); }],
  [1500, (s, ui) => { ui.status("Vex is speaking. You can interrupt."); s.say("Whether to text them. Of course it is. The cards are on the table.", { mime: true }); }],
  [3500, (s, ui) => { s.deal(POSITIONS); s.label("The cards are on the table."); ui.controls({ talk: "Talk to Vex", talkOn: false, inspect: true, leave: "Leave" }); }],
  ...CARDS.flatMap((card, i) => [[1500, (s) => {
    s.say(card.line, { mime: true });
    s.turn(i, card);
    s.label(`${i + 1}/5 ${POSITIONS[i]}: ${card.name}${card.reversed ? ", reversed" : ""}`);
  }], [4200, () => {}]]),
  [800, (s, ui) => {
    s.say("Don't text them. Text me. Next.", { mime: true, persistent: true });
    s.react("smirk");
    ui.controls({ talk: "Talk to Vex", inspect: true, leave: "Next guest" });
    ui.status("Your cards stay for 30 seconds. Take a photo.");
  }],
];

// Returns a stop function; live.js calls it when a real session starts.
export function demo(scene, ui) {
  let t = 0;
  const timers = SCRIPT.map(([wait, step]) => { t += wait; return setTimeout(() => step(scene, ui), t); });
  return () => timers.forEach(clearTimeout);
}
