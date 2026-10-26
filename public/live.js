import { Room, RoomEvent, Track } from "./vendor/livekit-client.esm.mjs";
import { advance, readingUnderway } from "./spoken.js";
import { createScene } from "./retro.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage"), frame = $("frame"), canvas = $("scene"), table = $("table");
const subs = $("subs"), question = $("question"), debug = $("debug"), notice = $("notice");
const buttons = { talk: $("talk"), leave: $("leave") };
const typeBox = $("type");
const TYPING_PING_MS = 5_000;
const RESET_AFTER_MS = 30_000;
const CONNECT_TIMEOUT_MS = 35_000;
// Longer than any real turn, tool calls included. Past this, the agent is gone or stuck.
const THINKING_TIMEOUT_MS = 30_000;
const params = new URLSearchParams(location.search);
const store = { get(key) { try { return localStorage.getItem(key); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, value); } catch {} } };
const accessCode = params.get("code") || store.get("vexCode") || "";
if (accessCode) store.set("vexCode", accessCode);
let current = null;
let started = 0;
let deck = null, spread = null, positions = null, flipped = 0;
let ready = false, crisis = false, verdict = "";
let stopDemo = null;

const scene = await createScene(canvas, params.get("room") || undefined);
// Real controls sit over what the canvas draws (scene.layout, native 320x212 pixels).
for (const [id, el] of Object.entries({ talk: buttons.talk, type: typeBox, leave: buttons.leave })) {
  const r = scene.layout[id];
  for (const [k, v] of Object.entries({ x: r.x, y: r.y, w: r.width, h: r.height })) el.style.setProperty(`--${k}`, v);
  const on = () => scene.hover(id), off = () => scene.hover(null);
  el.addEventListener("pointerenter", on); el.addEventListener("focus", on);
  el.addEventListener("pointerleave", off); el.addEventListener("blur", off);
}
// Fill the screen. Above x4 the slight unevenness of a fractional scale is invisible.
// clientWidth, not innerWidth: on phones an oversized frame widens innerWidth, which kept the frame oversized.
function fit() {
  const { clientWidth, clientHeight } = document.documentElement;
  const room = Math.min(clientWidth / 320, clientHeight / 212);
  frame.style.setProperty("--scale", room >= 2 && room < 4 ? Math.floor(room) : (Math.floor(room * 1000) / 1000));
}
function fullscreen(on = !document.fullscreenElement) {
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
fit();
addEventListener("resize", fit);

function log(...args) {
  const line = `${((performance.now() - started) / 1000).toFixed(1)}s ${args.join(" ")}`;
  console.log("[vex]", line);
  debug.textContent = `${line}\n${debug.textContent}`.slice(0, 6000);
}
function status(text) { $("status-text").textContent = text; scene.status(text); }
function phase(name) { stage.dataset.phase = name; }
// One place sets the three controls, for both the canvas and the real buttons.
// talk is the large prompt in the middle of the table; it only shows between readings.
function controls({ talk = null, type = false, leave = null }) {
  buttons.talk.hidden = !talk; buttons.talk.textContent = talk || "";
  buttons.leave.hidden = !leave; buttons.leave.textContent = leave || "";
  typeBox.disabled = !type;
  if (!type) { typeBox.value = ""; typeBox.blur(); }
  scene.controls({ talk, leave });
  scene.typing({ enabled: type, value: typeBox.value });
}
function schedule(run, callback, delay) {
  const timer = setTimeout(() => { run.timers.delete(timer); if (current === run) callback(); }, delay);
  run.timers.add(timer);
  return timer;
}
function clearTimers(run) { for (const timer of run.timers) clearTimeout(timer); run.timers.clear(); }

addEventListener("keydown", (event) => {
  const interactive = event.target.closest?.("button, a, input, textarea, select");
  if (event.code === "Space" && !event.repeat && !interactive && stage.dataset.state === "idle") { event.preventDefault(); fullscreen(true); start(); }
  if (event.key === "d" && !interactive) debug.hidden = !debug.hidden;
  if (event.key === "f" && !interactive) fullscreen();
  if (event.key === "Escape") {
    if (event.target === typeBox && typeBox.value) { typeBox.value = ""; scene.typing({ value: "" }); }
    else if (current && !current.closing) finish(current, "cancelled");
  }
});
buttons.talk.addEventListener("click", () => { fullscreen(true); if (stage.dataset.state !== "idle") reset(); start(); });

buttons.leave.addEventListener("click", () => { if (current && !current.closing) finish(current, "cancelled"); else reset(); });
canvas.addEventListener("click", () => { if (!typeBox.disabled) typeBox.focus(); });

// Typing: for noisy rooms or guests without a microphone. The agent screens it like speech.
typeBox.addEventListener("focus", () => scene.typing({ focused: true }));
typeBox.addEventListener("blur", () => scene.typing({ focused: false }));
typeBox.addEventListener("input", () => {
  scene.typing({ value: typeBox.value });
  const run = current;
  if (!run?.room || run.closing || performance.now() - (run.pingedAt || -Infinity) < TYPING_PING_MS) return;
  run.pingedAt = performance.now();
  Promise.resolve(run.room.localParticipant.publishData(new TextEncoder().encode('{"type":"typing"}'), { reliable: true, topic: "vex-guest" })).catch(() => {});
});
typeBox.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  const text = typeBox.value.trim(), run = current;
  if (!text || !run?.room || run.closing || crisis) return;
  typeBox.value = "";
  scene.typing({ value: "" });
  run.typedAt = performance.now();
  scene.say(text, { guest: true });
  Promise.resolve(run.room.localParticipant.sendText(text, { topic: "lk.chat" })).catch(() => log("typed message failed"));
  log("typed", text.length, "chars");
});

function release(run) {
  if (!run || run.closing) return;
  run.closing = true;
  clearTimers(run);
  run.abort.abort();
  run.mouthStop?.();
  run.mouthStop = null;
  // Detach before disconnecting; late SDK events cannot touch the next guest.
  run.audio.forEach((el) => el.remove());
  run.audio.clear();
  Promise.resolve(run.room?.disconnect()).catch(() => {});
}
function reset() {
  release(current);
  if (current) clearTimers(current);
  current = null;
  deck = spread = positions = null;
  flipped = 0; ready = crisis = false; verdict = "";
  table.replaceChildren();
  delete table.dataset.count;
  delete stage.dataset.agent;
  question.textContent = subs.textContent = debug.textContent = "";
  $("reading-focus").hidden = $("afterword").hidden = notice.hidden = true;
  scene.clearCards(); scene.label(""); scene.dim(false); scene.say("");
  stage.dataset.state = "idle";
  phase("idle");
  controls({ talk: "Talk to Vex" });
  status("");
}
function fail(run, message) {
  if (current !== run || run.closing) return;
  release(run);
  stage.dataset.state = "idle";
  phase("error");
  $("reading-focus").hidden = $("afterword").hidden = true;
  $("chapter").textContent = "A disturbance in the connection";
  $("headline").textContent = "The spirits are offline.";
  $("intro").textContent = message;
  scene.clearCards(); scene.label("");
  scene.say(message, { persistent: true });
  scene.react("unimpressed");
  controls({ talk: "Try again" });
  status("The spirits are offline.");
}
async function start() {
  if (stage.dataset.state !== "idle") return;
  stopDemo?.(); stopDemo = null;
  reset();
  started = performance.now();
  const run = { room: null, abort: new AbortController(), timers: new Set(), audio: new Set(), closing: false, heardAgent: false };
  current = run;
  stage.dataset.state = "session";
  phase("connecting");
  controls({ type: true, leave: "Leave" });
  $("intro").textContent = "Allow your microphone when asked. Sit close and speak normally.";
  status("Allow your microphone. Connecting...");
  run.watchdog = schedule(run, () => fail(run, "Vex hasn’t answered. Check your connection and try again."), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch("/api/token", { method: "POST", headers: { "X-Vex-Code": accessCode }, signal: run.abort.signal });
    if (!res.ok) throw new Error(res.status === 401 ? "This invitation needs a valid access code. Open the link your host gave you." : "We couldn’t start the reading. Please try again.");
    const { url, token } = await res.json();
    if (current !== run || run.closing) return;
    const room = run.room = new Room({ adaptiveStream: true, dynacast: true });
    wire(run);
    await room.connect(url, token);
    if (current !== run || run.closing) { await room.disconnect(); return; }
    await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    if (current !== run || run.closing) { await room.disconnect(); return; }
    run.micReady = true;
    if (run.heardAgent) { clearTimeout(run.watchdog); run.timers.delete(run.watchdog); }
    log("connected, mic on");
    if (!run.heardAgent) status("Microphone ready. Waiting for Vex...");
  } catch (err) {
    if (current !== run || run.closing) return;
    // No microphone: carry on as a typed reading rather than failing.
    if ((err.name === "NotAllowedError" || err.name === "NotFoundError") && run.room) {
      run.micReady = true;
      log("no microphone, typing only");
      status("No microphone. Type to Vex below.");
      typeBox.focus();
      return;
    }
    log("start failed", err.name || "Error");
    const message = err.name === "NotAllowedError" ? "Microphone access was denied. Allow it in your browser, then try again." : err.name === "NotFoundError" ? "No microphone was found. Connect one, then try again." : err.message;
    fail(run, message || "We couldn’t connect. Please try again.");
  }
}
function agentArrived(run) {
  if (run.heardAgent) return;
  run.heardAgent = true;
  if (run.micReady) { clearTimeout(run.watchdog); run.timers.delete(run.watchdog); }
  if (crisis || spread) return;
  phase("conversation");
  status("Vex is here. Say hello.");
}
function wire(run) {
  const room = run.room;
  const active = () => current === run && !run.closing;
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (!active() || track.kind !== Track.Kind.Audio) return;
    // Vex is drawn, so any avatar video track is ignored; only her voice is played.
    const el = track.attach(); el.dataset.vex = ""; document.body.appendChild(el); run.audio.add(el);
    animateMouth(run, track.mediaStreamTrack);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (!active()) return;
    track.detach().forEach((el) => { el.remove(); run.audio.delete(el); });
  });
  room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    if (!active() || topic !== "vex" || participant?.identity === room.localParticipant.identity) return;
    try { onEvent(run, JSON.parse(new TextDecoder().decode(payload))); } catch { log("invalid table event"); }
  });
  room.registerTextStreamHandler("lk.transcription", async (reader, from) => {
    if (!active() || from.identity === room.localParticipant.identity) return;
    let text = "";
    const opened = performance.now();
    try {
      for await (const chunk of reader) {
        if (!active()) return;
        text += chunk;
        agentArrived(run);
        subs.textContent = tail(text);
        if (crisis) continue;
        // A line she was cut off in must not cover what the guest just typed.
        if (!(run.typedAt > opened)) scene.say(text);
        if (!spread && deck) {
          const announced = readingUnderway(text, deck.cards, deck.spreads, ready);
          if (announced) deal(run, announced);
        }
        if (!spread) continue;
        const reached = advance(text, spread, flipped);
        for (; flipped < reached; flipped++) turn(flipped, spread[flipped]);
      }
    } catch { if (active()) log("caption stream interrupted"); }
  });
  room.on(RoomEvent.Reconnecting, () => { if (active()) { status("Connection lost. Reconnecting..."); clearTimeout(run.reconnectTimer); run.timers.delete(run.reconnectTimer); run.reconnectTimer = schedule(run, () => fail(run, "The connection could not be restored. Please try again."), CONNECT_TIMEOUT_MS); } });
  room.on(RoomEvent.Reconnected, () => { if (active()) { clearTimeout(run.reconnectTimer); run.timers.delete(run.reconnectTimer); status("Connected again. Carry on."); } });
  // The agent can die without the room closing (e.g. its process is killed). Don't wait on it.
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (!active() || !participant.isAgent) return;
    if (verdict || crisis) finish(run, crisis ? "crisis" : "complete");
    else fail(run, "Vex lost her connection. Please try again.");
  });
  room.on(RoomEvent.Disconnected, () => {
    if (!active()) return;
    if (verdict || crisis) finish(run, crisis ? "crisis" : "complete");
    else fail(run, "The connection ended before the reading finished. Please try again.");
  });
}
function onEvent(run, msg) {
  if (msg.type === "state") {
    if (["listening", "thinking", "speaking"].includes(msg.state)) agentArrived(run);
    if (msg.state === "thinking" && stage.dataset.agent !== "thinking" && Math.random() < 0.3) scene.react("eye_roll");
    stage.dataset.agent = msg.state;
    clearTimeout(run.stallTimer); run.timers.delete(run.stallTimer);
    if (msg.state === "thinking") run.stallTimer = schedule(run, () => fail(run, "Vex has gone quiet. Please try again."), THINKING_TIMEOUT_MS);
    if (!crisis) status(({ listening: "Your turn. Speak normally.", thinking: "Vex is considering you...", speaking: "Vex is speaking. You can interrupt." })[msg.state] || "Connecting...");
  }
  if (msg.type === "cards") { deck = msg; if (run.pendingDeal) { deal(run, run.pendingDeal.spread, run.pendingDeal.question); run.pendingDeal = null; } }
  if (msg.type === "reading-ready") ready = true;
  if (msg.type === "deal" && !crisis) { agentArrived(run); if (!deck) run.pendingDeal = msg; else deal(run, msg.spread, msg.question); }
  if (msg.type === "verdict" && !crisis) { verdict = msg.text || ""; $("verdict").textContent = verdict; }
  if (msg.type === "end") { if (msg.verdict && !crisis) verdict = msg.verdict; finish(run, msg.reason || "complete"); }
  if (msg.type === "crisis") {
    crisis = true; verdict = ""; spread = null;
    table.replaceChildren();
    $("reading-focus").hidden = $("afterword").hidden = true;
    scene.clearCards(); scene.label(""); scene.say(""); scene.dim(true);
    phase("crisis");
    $("chapter").textContent = "The reading is paused";
    $("headline").textContent = "Let’s stop the cards here.";
    $("intro").textContent = msg.text || "Please find your host or someone you trust to talk to.";
    notice.hidden = false;
    controls({ leave: "Leave" });
    status("Take your time. Your host can help.");
  }
}
function finish(run, reason) {
  if (current !== run || run.closing) return;
  if (reason === "error") { fail(run, "Vex lost her connection. Please try again."); return; }
  release(run);
  subs.textContent = "";
  delete stage.dataset.agent;
  // A card name she said in a way the matcher missed must not stay face down.
  if (spread && !crisis) for (; flipped < spread.length; flipped++) turn(flipped, spread[flipped]);
  if (crisis || reason === "crisis") { phase("crisis"); controls({ leave: "Next guest" }); status("Choose Next guest when you're ready."); return; }
  phase("verdict");
  $("reading-focus").hidden = true;
  const closing = reason === "timeout" ? "Our time is up." : reason === "away" ? "Gone, then. The cards will remember." : reason === "cancelled" ? "We'll leave it there." : "The cards have spoken.";
  $("verdict").textContent = verdict;
  $("afterword").hidden = !verdict;
  scene.say(verdict || closing, { persistent: true });
  scene.react("smirk");
  controls({ leave: "Next guest" });
  status(spread ? "Your cards stay for 30 seconds. Take a photo." : "Ready for the next guest.");
  schedule(run, reset, RESET_AFTER_MS);
}
function deal(run, name, q) {
  if (spread || !deck || crisis || run.closing) return;
  positions = deck.spreads[name] || deck.spreads.short;
  spread = deck.cards.slice(0, positions.length);
  phase("reading");
  $("reading-focus").hidden = false;
  $("hero-name").textContent = "Let’s see what follows you.";
  $("hero-position").textContent = "The cards are on the table";
  $("hero-orientation").textContent = "";
  question.textContent = q ? `“${q}”` : "";
  table.dataset.count = positions.length;
  table.replaceChildren();
  positions.forEach((pos, i) => {
    const slot = document.createElement("div"); slot.className = "slot";
    slot.innerHTML = '<div class="card"></div><div class="name"></div>';
    slot.querySelector(".name").textContent = `${i + 1}. ${pos}`;
    slot.setAttribute("aria-label", `Card ${i + 1}: ${pos}, face down`);
    table.append(slot);
  });
  scene.deal(positions);
  scene.label(q ? `"${q}"` : "The cards are on the table.");
  controls({ type: true, leave: "Leave" });
  log("deal", name);
}
function turn(i, card) {
  const slot = table.querySelectorAll(".slot")[i];
  if (!slot) return;
  const orientation = card.reversed ? "reversed" : "upright";
  slot.querySelector(".name").textContent = card.name;
  slot.setAttribute("aria-label", `${positions[i]}: ${card.name}, ${orientation}`);
  slot.querySelector(".card").classList.add("flipped");
  $("hero-position").textContent = `${i + 1} / ${spread.length} · ${positions[i]}`;
  $("hero-name").textContent = card.name;
  $("hero-orientation").textContent = card.reversed ? "Reversed" : "Upright";
  scene.turn(i, card);
  scene.label(`${i + 1}/${spread.length} ${positions[i]}: ${card.name}${card.reversed ? ", reversed" : ""}`);
  log("flip", i, card.name);
}
function tail(text) { return (text.match(/[^.!?]+[.!?]*\s*/g) || [text]).slice(-2).join("").trim(); }
// Vex's mouth follows the volume of her own voice track, never the guest's microphone.
function animateMouth(run, mediaTrack) {
  run.mouthStop?.();
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize); let raf;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      scene.voice(Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + (value - 128) ** 2, 0) / samples.length) / 28));
      raf = requestAnimationFrame(tick);
    };
    tick();
    run.mouthStop = () => { cancelAnimationFrame(raf); source.disconnect(); ctx.close().catch(() => {}); scene.silence(); };
  } catch { log("mouth animation unavailable"); }
}

reset();
if (params.has("demo")) import("./retro-demo.js").then((m) => { stopDemo = m.demo(scene, { controls, status }); });
