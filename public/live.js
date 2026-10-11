// Vex kiosk, live session. Joins a LiveKit room; the `vex` worker joins too.
// The worker sends table events on the "vex" data topic; this page draws them.
import { Room, RoomEvent, Track } from "./vendor/livekit-client.esm.mjs";
import { advance } from "./spoken.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage"), portal = $("portal"), face = $("face"), table = $("table");
const subs = $("subs"), question = $("question"), prompt = $("prompt"), debug = $("debug");
const RESET_AFTER_MS = 12_000;

let room = null;
let started = 0;
let mouthStop = null;
// The worker sends every card at the start. A card flips when her subtitles
// reach its name, so the table follows her voice, not the model's tool calls.
let deck = null; // { cards, spreads }
let spread = null; // the dealt cards, in order
let flipped = 0;

function log(...args) {
  const line = `${((performance.now() - started) / 1000).toFixed(1).padStart(6)}s  ${args.join(" ")}`;
  console.log("[vex]", line);
  debug.textContent = `${line}\n${debug.textContent}`.slice(0, 6000);
}

addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat) { e.preventDefault(); if (stage.dataset.state === "idle") start(); }
  if (e.key === "d") debug.hidden = !debug.hidden;
  if (e.key === "Escape" && room) room.disconnect();
});
prompt.addEventListener("click", () => stage.dataset.state === "idle" && start());

async function start() {
  stage.dataset.state = "session";
  started = performance.now();
  subs.textContent = "";
  question.textContent = "";
  try {
    const res = await fetch("/api/token", { method: "POST" });
    if (!res.ok) throw new Error(`token ${res.status}`);
    const { url, token, room: name } = await res.json();
    log("room", name);
    room = new Room({ adaptiveStream: true, dynacast: true });
    wire(room);
    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    log("connected, mic on");
    subs.textContent = "…";
  } catch (err) {
    log("start failed:", err.message);
    subs.textContent = "The spirits are offline. Find a human.";
    setTimeout(reset, 5000);
  }
}

function wire(r) {
  r.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    log("track", track.kind, "from", participant.identity);
    if (track.kind === Track.Kind.Video) {
      track.attach(face);
      portal.classList.add("has-video");
    } else if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      el.dataset.vex = "";
      document.body.appendChild(el);
      animateMouth(track.mediaStreamTrack);
    }
  });
  r.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el !== face && el.remove());
    if (track.kind === Track.Kind.Video) portal.classList.remove("has-video");
  });
  r.on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
    if (topic !== "vex") return;
    const msg = JSON.parse(new TextDecoder().decode(payload));
    if (msg.type !== "state") log("event", msg.type, msg.index ?? "", msg.card?.name ?? "");
    onEvent(msg);
  });
  r.registerTextStreamHandler("lk.transcription", async (reader, from) => {
    if (from.identity === r.localParticipant.identity) return; // the guest's own words
    let text = "";
    for await (const chunk of reader) {
      text += chunk;
      subs.textContent = tail(text);
      flipIfSpoken(text);
    }
  });
  r.on(RoomEvent.Disconnected, () => {
    log("disconnected");
    prompt.textContent = "";
    setTimeout(reset, RESET_AFTER_MS);
  });
}

function onEvent(msg) {
  if (msg.type === "state") stage.dataset.agent = msg.state;
  if (msg.type === "cards") deck = msg;
  // The worker is closing the session. Hang up here too, in case it can't delete the room.
  if (msg.type === "end") setTimeout(() => room?.disconnect(), 1000);
  if (msg.type === "deal") deal(msg.spread, msg.question);
  if (msg.type === "crisis") table.replaceChildren();
}

function deal(name, q) {
  if (spread || !deck) return;
  const positions = deck.spreads[name] || deck.spreads.short;
  spread = deck.cards.slice(0, positions.length);
  log("deal", name);
  question.textContent = q ? `“${q}”` : "";
  table.dataset.count = positions.length;
  table.replaceChildren();
  positions.forEach((pos, i) => {
    if (positions.length === 10 && i === 5) table.append(Object.assign(document.createElement("div"), { className: "break" }));
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML = `<div class="pos">${pos}</div><div class="card"><div class="inner"><div class="back"></div><div class="front"><img alt=""></div></div></div><div class="name"></div>`;
    table.append(slot);
    setTimeout(() => slot.querySelector(".card").classList.add("dealt"), 250 + i * 220);
  });
}

// Show only what she is saying now: the last sentence or two, about two lines.
function tail(text, max = 150) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  let out = "";
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (out && (sentences[i] + out).length > max) break;
    out = sentences[i] + out;
  }
  return out.trim();
}

function flipIfSpoken(text) {
  if (!deck) return;
  // No deal from the worker but she has started reading: lay the short spread now.
  if (!spread && advance(text, deck.cards.slice(0, deck.spreads.short.length), 0)) deal("short");
  if (!spread) return;
  const reached = advance(text, spread, flipped);
  // Let the deal animation land before the first flip.
  for (; flipped < reached; flipped++) {
    const i = flipped;
    setTimeout(() => turn(i, spread[i]), table.dataset.dealt ? 0 : 1400);
  }
  table.dataset.dealt = "1";
}

function turn(i, c) {
  const slots = table.querySelectorAll(".slot");
  const slot = slots[i];
  if (!slot) return;
  slots.forEach((s) => s.querySelector(".card").classList.remove("lit"));
  const front = slot.querySelector(".front");
  front.classList.toggle("reversed", c.reversed);
  front.querySelector("img").src = `/cards/${c.img}`;
  slot.querySelector(".name").textContent = c.reversed ? `${c.name}, reversed` : c.name;
  const card = slot.querySelector(".card");
  card.classList.add("flipped", "lit");
  log("flip", i, c.name);
}

// Stand-in face: open the mouth with her audio level when there is no video.
function animateMouth(mediaTrack) {
  mouthStop?.();
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const mouth = $("mouth");
  let raf;
  const tick = () => {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += (v - 128) ** 2;
    const level = Math.min(1, Math.sqrt(sum / buf.length) / 28);
    mouth.setAttribute("ry", (2.2 + level * 7).toFixed(2));
    raf = requestAnimationFrame(tick);
  };
  tick();
  mouthStop = () => { cancelAnimationFrame(raf); ctx.close(); };
}

function reset() {
  deck = spread = null;
  flipped = 0;
  delete table.dataset.dealt;
  mouthStop?.();
  mouthStop = null;
  room = null;
  document.querySelectorAll("audio[data-vex]").forEach((el) => el.remove());
  portal.classList.remove("has-video");
  table.replaceChildren();
  delete table.dataset.count;
  delete stage.dataset.agent;
  subs.textContent = "";
  question.textContent = "";
  prompt.innerHTML = "Sit down. Press <kbd>space</kbd>.";
  stage.dataset.state = "idle";
}
