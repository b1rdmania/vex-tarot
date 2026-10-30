// The retro room: one 320x212 canvas (320x200 room + 12px status strip),
// drawn at native pixels and scaled up with nearest-neighbour sampling.
// Art and layout come from art/ via scripts/build-retro.mjs. live.js drives it.

const W = 320, ROOM_H = 200, H = 212;
const BASE = "/retro/";
// Card sizes in native pixels. Card art is built at CARD_RES times this, so cards
// carry finer detail than the room. xs is the table size for long spreads, lg the reveal.
const CARD = { xs: [18, 30], sm: [22, 38], lg: [60, 103] };
const CARD_RES = 2;
const C = { ink: 0, shade: 1, dim: 4, muted: 5, speech: 7, label: 30, hover: 27, gold: 25, back: 3, line: 29 };

// 5x7 bitmap font. A-Z and ' . , ? come from art/scripts/build.mjs; the rest is added here.
const GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [31, 4, 4, 4, 4, 4, 31], J: [7, 2, 2, 2, 18, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 25, 21, 19, 19, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  ".": [0, 0, 0, 0, 0, 0, 4], ",": [0, 0, 0, 0, 0, 4, 8], "?": [14, 17, 1, 2, 4, 0, 4], "'": [4, 4, 0, 0, 0, 0, 0],
  "!": [4, 4, 4, 4, 4, 0, 4], "-": [0, 0, 0, 14, 0, 0, 0], ":": [0, 0, 4, 0, 0, 4, 0], ";": [0, 0, 4, 0, 0, 4, 8],
  "/": [1, 1, 2, 4, 8, 16, 16], "(": [2, 4, 8, 8, 8, 4, 2], ")": [8, 4, 2, 2, 2, 4, 8], '"': [10, 10, 0, 0, 0, 0, 0],
  "&": [12, 18, 20, 8, 21, 18, 13], "+": [0, 4, 4, 31, 4, 4, 0], "%": [24, 25, 2, 4, 8, 19, 3], " ": [],
};
const normalise = (text) => String(text).toUpperCase()
  .replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/·/g, "-")
  .replace(/\s+/g, " ").trim();

function loadImage(src) {
  return new Promise((done, fail) => { const img = new Image(); img.onload = () => done(img); img.onerror = () => fail(new Error(`missing ${src}`)); img.src = src; });
}
const json = (path) => fetch(BASE + path).then((r) => { if (!r.ok) throw new Error(`missing ${path}`); return r.json(); });

export function wrap(text, maxChars) {
  const lines = [];
  let line = "";
  for (const word of normalise(text).split(" ")) {
    if (!word) continue;
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) { line = next; continue; }
    if (line) lines.push(line);
    line = word.slice(0, maxChars);
  }
  if (line) lines.push(line);
  return lines;
}

// The words Vex is saying now: the latest sentence, plus the one before if both fit.
export function currentPhrase(text, maxChars, maxLines) {
  const sentences = String(text).match(/[^.!?]+[.!?]*\s*/g) || [String(text)];
  let lines = wrap(sentences.at(-1), maxChars);
  const both = wrap(sentences.slice(-2).join(""), maxChars);
  if (sentences.length > 1 && both.length <= maxLines) lines = both;
  return lines.slice(-maxLines);
}

export async function createScene(canvas, roomId = "01-velvet-alcove") {
  const [palette, sheet, room] = await Promise.all([json("palette.json"), json("sprites/vex-sheet.json"), json(`rooms/${roomId}.json`)]);
  const [atlas, plate] = await Promise.all([loadImage(BASE + "sprites/vex-sheet.png"), loadImage(BASE + "rooms/" + room.background)]);
  const colour = (i) => palette.colors[i];
  const ctx = canvas.getContext("2d");
  // The backing store is CARD_RES times native; everything else is drawn at native
  // coordinates and scaled up whole, so only the card art gains detail.
  canvas.width = W * CARD_RES; canvas.height = H * CARD_RES;
  ctx.setTransform(CARD_RES, 0, 0, CARD_RES, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const sprite = room.rects.sprite, safe = room.safeAreas.cards, speechRect = room.rects.speech;
  const contact = sheet.hand.contactPoint;
  const maxChars = Math.floor(speechRect.width / room.speech.glyphAdvance);
  const cards = new Map();
  const cardImage = (size, file) => {
    const key = `${size}/${file}`;
    if (!cards.has(key)) { const img = new Image(); img.src = `${BASE}cards/${size}/${file.replace(/\.jpg$/, ".png")}`; cards.set(key, img); }
    return cards.get(key);
  };

  // Text is rendered once per string and colour, then blitted.
  const textCache = new Map();
  function textImage(text, fg, bg = C.ink) {
    const key = `${fg}/${bg}/${text}`;
    if (textCache.has(key)) return textCache.get(key);
    const c = document.createElement("canvas");
    c.width = text.length * 6 + 2; c.height = 9;
    const t = c.getContext("2d");
    const paint = (index, dx, dy) => {
      t.fillStyle = colour(index);
      [...text].forEach((ch, i) => (GLYPHS[ch] || []).forEach((bits, row) => {
        for (let col = 0; col < 5; col++) if (bits & (1 << (4 - col))) t.fillRect(1 + i * 6 + col + dx, 1 + row + dy, 1, 1);
      }));
    };
    if (bg !== null) for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) paint(bg, dx, dy);
    paint(fg, 0, 0);
    if (textCache.size > 300) textCache.clear();
    textCache.set(key, c);
    return c;
  }
  function text(str, x, y, fg, { align = "left", bg = C.ink } = {}) {
    const s = normalise(str);
    const img = textImage(s, fg, bg);
    const left = align === "center" ? Math.round(x - img.width / 2) : align === "right" ? x - img.width : x;
    ctx.drawImage(img, left - 1, y - 1);
  }
  const frame = (name, dx, dy) => { const f = sheet.frames[name]; ctx.drawImage(atlas, f.x, f.y, f.width, f.height, dx, dy, f.width, f.height); };
  function stipple(x0, y0, w, h) {
    ctx.fillStyle = colour(C.ink);
    for (let y = y0; y < y0 + h; y++) for (let x = x0 + ((y + x0) & 1); x < x0 + w; x += 2) ctx.fillRect(x, y, 1, 1);
  }

  const state = {
    voice: 0, mouth: 0, mouthAt: 0,
    speech: [], speechUntil: 0, speechAt: 0, mime: 0, persistent: false,
    reaction: null, blinkAt: 0, blinkStart: -1,
    spread: [], lit: -1, hand: null, reveal: null,
    label: "", status: "",
    controls: { talk: "Talk to Vex", leave: null }, hint: "or press space", hover: null,
    typing: { value: "", focused: false, enabled: false }, speechColour: C.speech, dimmed: false,
  };

  function bodyFrame(now) {
    if (state.reaction && now < state.reaction.until) return sheet.frames[`body/${state.reaction.name}`] ? `body/${state.reaction.name}` : "body/idle";
    if (state.blinkStart >= 0) {
      const t = now - state.blinkStart, d = sheet.animations.blink.durationsMs;
      if (t < d[0]) return "body/blink_half";
      if (t < d[0] + d[1]) return "body/blink";
      if (t < d[0] + d[1] + d[2]) return "body/blink_half";
      state.blinkStart = -1;
      state.blinkAt = now + 2500 + Math.random() * 3500;
    }
    if (now > state.blinkAt) { state.blinkStart = now; return "body/blink_half"; }
    const idle = sheet.animations.idle, total = idle.durationsMs.reduce((a, b) => a + b, 0);
    let t = now % total;
    for (let i = 0; i < idle.frames.length; i++) { if (t < idle.durationsMs[i]) return idle.frames[i]; t -= idle.durationsMs[i]; }
    return "body/idle";
  }

  // Four mouth frames from smoothed output volume, with a short hold so it doesn't chatter.
  // Thresholds set from a live run (12 Oct): voiced level p25 0.03, p50 0.16, p75 0.43, p95 0.78.
  // The widest mouth (teeth) is never used: Andy found it odd. Loud speech holds at "open".
  function mouthFrame(now) {
    let target;
    if (state.mime && now < state.mime) target = [1, 2, 0, 2, 1, 0, 2][Math.floor(now / 90) % 7];
    else { const v = state.voice; target = v < 0.06 ? 0 : v < 0.22 ? 1 : 2; }
    if (target !== state.mouth && now - state.mouthAt > 70) { state.mouth = target; state.mouthAt = now; }
    if (state.mouth === 0 && state.reaction?.rest && now < state.reaction.until) return state.reaction.rest;
    return sheet.mouth.frames[state.mouth];
  }

  // Five cards get the larger table size; ten need the small one to fit the safe area.
  const tableSize = () => state.spread.length * (CARD.sm[0] + 2) <= safe.width ? "sm" : "xs";
  function slots() {
    const n = state.spread.length, [w, h] = CARD[tableSize()];
    const gap = n > 1 ? Math.max(1, Math.min(6, Math.floor((safe.width - n * w) / (n - 1)))) : 0;
    const left = safe.x + Math.floor((safe.width - (n * w + (n - 1) * gap)) / 2);
    const top = safe.y + Math.floor((safe.height - h) / 2);
    return state.spread.map((_, i) => ({ x: left + i * (w + gap), y: top, w, h }));
  }
  function drawCard(card, size, x, y, now) {
    const [w, h] = CARD[size];
    const faceUp = card.face && now >= card.faceAt;
    if (!faceUp) {
      ctx.fillStyle = colour(C.gold); ctx.fillRect(x, y, w, h);
      ctx.fillStyle = colour(C.back); ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.fillStyle = colour(C.line);
      for (let yy = y + 3; yy < y + h - 3; yy += 4) for (let xx = x + 3 + ((yy - y) % 8 ? 2 : 0); xx < x + w - 3; xx += 4) ctx.fillRect(xx, yy, 1, 1);
      return;
    }
    const img = cardImage(size, card.face.img);
    if (!img.complete || !img.naturalWidth) { ctx.fillStyle = colour(C.label); ctx.fillRect(x, y, w, h); return; }
    if (card.face.reversed) { ctx.save(); ctx.translate(x + w, y + h); ctx.rotate(Math.PI); ctx.drawImage(img, 0, 0, w, h); ctx.restore(); }
    else ctx.drawImage(img, x, y, w, h);
  }
  // Flip: the back narrows to its edge over FLIP_MS, then the face widens over FLIP_MS,
  // in stepped widths so it reads as pixel animation. Centred on faceAt; the card lifts 2px.
  // Used for the small table card and the large reveal, one after the other.
  const FLIP_MS = 300, FLIP_STEPS = 6;
  function flipWidth(t, w) {
    if (Math.abs(t) >= FLIP_MS) return w;
    return Math.max(2, Math.round(w * Math.max(0.08, Math.round((Math.abs(t) / FLIP_MS) * FLIP_STEPS) / FLIP_STEPS)));
  }
  function flipCard(card, size, x, y, now) {
    const t = card.face ? now - card.faceAt : Infinity;
    if (Math.abs(t) >= FLIP_MS) { drawCard(card, size, x, y, now); return; }
    const [w] = CARD[size], sw = flipWidth(t, w);
    ctx.save();
    ctx.translate(x + Math.floor((w - sw) / 2), y - 2);
    ctx.scale(sw / w, 1);
    drawCard(t >= 0 ? { face: card.face, faceAt: 0 } : { face: null }, size, 0, 0, now);
    ctx.restore();
  }
  function outline(r, index) { ctx.fillStyle = colour(index); ctx.fillRect(r.x - 1, r.y - 1, r.w + 2, 1); ctx.fillRect(r.x - 1, r.y + r.h, r.w + 2, 1); ctx.fillRect(r.x - 1, r.y, 1, r.h); ctx.fillRect(r.x + r.w, r.y, 1, r.h); }

  function drawHand(now) {
    const h = state.hand;
    if (!h) return;
    const anim = sheet.animations.deal;
    let t = now - h.start, name = null;
    for (let i = 0; i < anim.frames.length; i++) { if (t < anim.durationsMs[i]) { name = anim.frames[i]; break; } t -= anim.durationsMs[i]; }
    if (!name) { state.hand = null; return; }
    if (name !== "hand/rest") frame(name, h.x - contact.x, h.y - contact.y);
  }

  function drawReveal(now) {
    const r = state.reveal;
    // The large card appears face down as the table card lands, then flips the same way.
    if (!r || now < r.faceAt - FLIP_MS || now > r.until) return;
    const [w, h] = CARD.lg, sw = flipWidth(now - r.faceAt, w);
    const x = r.x + Math.floor((w - sw) / 2), y = Math.abs(now - r.faceAt) < FLIP_MS ? r.y - 2 : r.y;
    ctx.fillStyle = colour(C.ink); ctx.fillRect(x - 2, y - 2, sw + 4, h + 4);
    ctx.fillStyle = colour(C.gold); ctx.fillRect(x - 1, y - 1, sw + 2, h + 2);
    flipCard({ face: r.card, faceAt: r.faceAt }, "lg", r.x, r.y, now);
  }

  // Bottom row: a wide type box (Codex's first two slots) and Leave. Before a reading,
  // a large Talk to Vex prompt sits in the middle of the table instead.
  const [slotA, slotB, slotC] = room.controlItems.map((item) => item.rect);
  const layout = {
    type: { x: slotA.x, y: slotA.y, width: slotB.x + slotB.width - slotA.x, height: slotA.height },
    leave: slotC,
    talk: (() => { const t = room.rects.table, w = 150, h = 34; return { x: Math.round(t.x + t.width / 2 - w / 2), y: Math.round(t.y + t.height / 2 - h / 2), width: w, height: h }; })(),
  };
  function typedLabel(rect) {
    const t = state.typing;
    if (!t.enabled || (!t.value && !t.focused)) return "Type to Vex";
    const caret = t.focused && (!t.value || Math.floor(performance.now() / 500) % 2) ? "_" : " ";
    const room = Math.floor(rect.width / 6) - 3;
    return `> ${normalise(t.value).slice(-room)}${caret}`;
  }
  function drawControls() {
    const t = state.typing;
    if (t.enabled) {
      const r = layout.type;
      text(typedLabel(r), r.x + r.width / 2, r.y + 4, t.value ? C.hover : state.hover === "type" ? C.hover : C.label, { align: "center" });
    }
    if (state.controls.leave) {
      const r = layout.leave;
      text(state.controls.leave, r.x + r.width / 2, r.y + 4, state.hover === "leave" ? C.hover : C.label, { align: "center" });
      if (t.enabled) { ctx.fillStyle = colour(C.dim); ctx.fillRect(r.x - 6, r.y + 3, 1, 9); }
    }
    if (state.controls.talk && !state.dimmed) {
      const r = layout.talk;
      ctx.fillStyle = colour(C.gold); ctx.fillRect(r.x - 1, r.y - 1, r.width + 2, r.height + 2);
      ctx.fillStyle = colour(C.ink); ctx.fillRect(r.x, r.y, r.width, r.height);
      const img = textImage(normalise(state.controls.talk), state.hover === "talk" ? C.hover : C.label);
      ctx.drawImage(img, Math.round(r.x + r.width / 2 - img.width), r.y + 5, img.width * 2, img.height * 2);
      text(state.hint, r.x + r.width / 2, r.y + 24, state.hint === "or press space" ? C.muted : C.gold, { align: "center" });
    }
  }

  function draw(now) {
    ctx.drawImage(plate, 0, 0);
    frame(bodyFrame(now), sprite.x, sprite.y);
    frame(mouthFrame(now), sprite.x, sprite.y);
    const boxes = slots();
    state.spread.forEach((card, i) => { flipCard(card, tableSize(), boxes[i].x, boxes[i].y, now); if (i === state.lit && now >= card.faceAt) outline(boxes[i], C.hover); });
    drawHand(now);
    drawReveal(now);
    if (state.label) text(state.label.slice(0, 52), W / 2, Math.min(room.rects.table.y + room.rects.table.height, room.rects.controls.y - 9), C.gold, { align: "center" });
    if (state.dimmed) stipple(0, 0, W, room.rects.controls.y);
    if (!state.dimmed) drawSpeech(now);
    drawControls();
    ctx.fillStyle = colour(C.ink); ctx.fillRect(0, ROOM_H, W, H - ROOM_H);
    if (state.status) text(state.status.slice(0, 52), W / 2, ROOM_H + 3, C.muted, { align: "center" });
  }

  function drawSpeech(now) {
    if (!state.persistent && state.speech.length && now > state.speechUntil) state.speech = [];
    speechLines(now).forEach((line, i) => text(line, speechRect.x + speechRect.width / 2, speechRect.y + room.speech.padding + i * 9, state.speechColour, { align: "center" }));
  }

  // Held text longer than three lines is shown a page at a time, LucasArts style.
  const PAGE_LINES = 3, PAGE_MS = 4500;
  function speechLines(now) {
    if (state.speech.length <= PAGE_LINES) return state.speech;
    const pages = Math.ceil(state.speech.length / PAGE_LINES);
    const page = Math.floor((now - state.speechAt) / PAGE_MS) % pages;
    return state.speech.slice(page * PAGE_LINES, page * PAGE_LINES + PAGE_LINES);
  }

  // Public API --------------------------------------------------------------
  // guest: true shows the guest's typed line in the controls colour until Vex answers.
  function say(str, { mime = false, persistent = false, guest = false } = {}) {
    state.speechColour = guest ? C.label : C.speech;
    const now = performance.now();
    // A held line (the verdict, an error) is shown whole; live speech shows the current phrase.
    state.speech = !str ? [] : persistent ? wrap(str, maxChars) : currentPhrase(str, maxChars, 3);
    state.speechAt = now;
    const chars = state.speech.join(" ").length;
    state.speechUntil = now + 1800 + chars * 45;
    state.persistent = persistent && !!str;
    state.mime = mime ? now + chars * 55 : 0;
  }
  const scene = {
    room,
    layout,
    say,
    silence() { state.voice = 0; },
    voice(level) { state.voice = level > state.voice ? state.voice * 0.4 + level * 0.6 : state.voice * 0.75 + level * 0.25; },
    react(name) {
      const r = sheet.reactions[name];
      if (r) state.reaction = { name, until: performance.now() + r.holdMs, rest: r.restMouth || null };
    },
    deal(positions) { state.spread = positions.map((position) => ({ position, face: null, faceAt: 0 })); state.lit = -1; },
    turn(i, card) {
      const slot = state.spread[i];
      if (!slot) return;
      const now = performance.now(), box = slots()[i], deal = sheet.animations.deal.durationsMs;
      // The table flip starts as the hand turns the card; the large card flips once it lands.
      const faceAt = now + deal[0] + deal[1] + FLIP_MS, revealAt = faceAt + 2 * FLIP_MS;
      slot.face = card; slot.faceAt = faceAt;
      state.lit = i;
      state.hand = { start: now, x: box.x + Math.floor(box.w / 2), y: box.y + Math.floor(box.h / 2) };
      const [w] = CARD.lg, right = sprite.x + sprite.width / 2 <= W / 2;
      state.reveal = { card, faceAt: revealAt, until: revealAt + 3600, x: right ? sprite.x + sprite.width + 14 : sprite.x - 14 - w, y: 34 };
      this.react(card.reversed ? "unimpressed" : "dramatic");
    },
    clearCards() { state.spread = []; state.lit = -1; state.hand = null; state.reveal = null; },
    label(str) { state.label = str || ""; },
    status(str) { state.status = str || ""; },
    controls(next) { Object.assign(state.controls, next); },
    // The small line under Talk to Vex. At most 23 characters (the box is 150 px, glyphs 6 px).
    hint(str) { state.hint = str; },
    typing(next) { Object.assign(state.typing, next); },
    hover(id) { state.hover = id; },
    dim(on) { state.dimmed = on; },
  };
  const loop = (now) => { draw(now); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return scene;
}
