import { Room, RoomEvent, Track } from "./vendor/livekit-client.esm.mjs";
import { advance, readingStart } from "./spoken.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage"), portal = $("portal"), face = $("face"), table = $("table");
const subs = $("subs"), question = $("question"), prompt = $("prompt"), debug = $("debug");
const RESET_AFTER_MS = 30_000;
const CONNECT_TIMEOUT_MS = 35_000;
const store = { get(key) { try { return localStorage.getItem(key); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, value); } catch {} } };
const accessCode = new URLSearchParams(location.search).get("code") || store.get("vexCode") || "";
if (accessCode) store.set("vexCode", accessCode);
let current = null;
let started = 0;
let captions = store.get("vexCaptions") === "1";
let deck = null, spread = null, positions = null, flipped = 0;
let ready = false, crisis = false, verdict = "";

function log(...args) {
  const line = `${((performance.now() - started) / 1000).toFixed(1)}s ${args.join(" ")}`;
  console.log("[vex]", line);
  debug.textContent = `${line}\n${debug.textContent}`.slice(0, 6000);
}
function status(text) { $("status-text").textContent = text; }
function phase(name) { stage.dataset.phase = name; }
function schedule(run, callback, delay) {
  const timer = setTimeout(() => { run.timers.delete(timer); if (current === run) callback(); }, delay);
  run.timers.add(timer);
  return timer;
}
function clearTimers(run) { for (const timer of run.timers) clearTimeout(timer); run.timers.clear(); }
function setCaptions() {
  $("captions").textContent = captions ? "Captions on" : "Captions off";
  $("captions").setAttribute("aria-pressed", String(captions));
  subs.hidden = !captions;
}
setCaptions();
$("captions").addEventListener("click", () => { captions = !captions; store.set("vexCaptions", captions ? "1" : "0"); setCaptions(); });
addEventListener("keydown", (event) => {
  const interactive = event.target.closest?.("button, a, input, textarea, select");
  if (event.code === "Space" && !event.repeat && !interactive && stage.dataset.state === "idle") { event.preventDefault(); start(); }
  if (event.key === "d" && !interactive) debug.hidden = !debug.hidden;
  if (event.key === "Escape" && current && !current.closing) finish(current, "cancelled");
});
prompt.addEventListener("click", start);
$("end").addEventListener("click", () => current && finish(current, "cancelled"));
$("again").addEventListener("click", reset);

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
  face.srcObject = null;
  portal.classList.remove("has-video");
  portal.style.removeProperty("--voice");
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
  $("reading-focus").hidden = $("afterword").hidden = true;
  $("invitation").hidden = false;
  $("end").hidden = $("again").hidden = true;
  $("chapter").textContent = "A private audience";
  $("headline").innerHTML = "Your future.<br>My condolences.";
  $("intro").innerHTML = "Sit close. Tell me what’s on your mind.<br>I’ll consult the cards. And judge you a little.";
  prompt.textContent = "Take a seat ↗";
  prompt.hidden = $("hint").hidden = false;
  stage.dataset.state = "idle";
  phase("idle");
  status("Ready when you are.");
}
function fail(run, message) {
  if (current !== run || run.closing) return;
  release(run);
  stage.dataset.state = "idle";
  phase("error");
  $("reading-focus").hidden = $("afterword").hidden = true;
  $("invitation").hidden = false;
  $("chapter").textContent = "A disturbance in the connection";
  $("headline").textContent = "The spirits are offline.";
  $("intro").textContent = message;
  prompt.textContent = "Try again ↗";
  prompt.hidden = false;
  $("hint").hidden = $("end").hidden = true;
  status(message);
}
async function start() {
  if (stage.dataset.state !== "idle") return;
  reset();
  started = performance.now();
  const run = { room: null, abort: new AbortController(), timers: new Set(), audio: new Set(), closing: false, heardAgent: false };
  current = run;
  stage.dataset.state = "session";
  phase("connecting");
  prompt.hidden = $("hint").hidden = true;
  $("end").hidden = false;
  $("headline").textContent = "One moment, mortal.";
  $("intro").textContent = "Allow your microphone when asked. Sit close and speak normally.";
  status("Connecting to Vex…");
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
    if (!run.heardAgent) status("Microphone ready. Waiting for Vex…");
  } catch (err) {
    if (current !== run || run.closing) return;
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
  $("chapter").textContent = "The introduction";
  $("headline").textContent = "Tell me everything.";
  $("intro").textContent = "Speak naturally. You can interrupt her. She’ll cope.";
  status("Vex is here. Say hello.");
}
function wire(run) {
  const room = run.room;
  const active = () => current === run && !run.closing;
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (!active()) return;
    if (track.kind === Track.Kind.Video) { track.attach(face); portal.classList.add("has-video"); }
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach(); el.dataset.vex = ""; document.body.appendChild(el); run.audio.add(el);
      animateMirror(run, track.mediaStreamTrack);
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (!active()) return;
    track.detach().forEach((el) => { if (el !== face) { el.remove(); run.audio.delete(el); } });
    if (track.kind === Track.Kind.Video) portal.classList.remove("has-video");
  });
  room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    if (!active() || topic !== "vex" || participant?.identity === room.localParticipant.identity) return;
    try { onEvent(run, JSON.parse(new TextDecoder().decode(payload))); } catch { log("invalid table event"); }
  });
  room.registerTextStreamHandler("lk.transcription", async (reader, from) => {
    if (!active() || from.identity === room.localParticipant.identity) return;
    let text = "";
    try {
      for await (const chunk of reader) {
        if (!active()) return;
        text += chunk;
        agentArrived(run);
        subs.textContent = tail(text);
        if (crisis) continue;
        if (!spread && ready) {
          const announced = readingStart(text);
          if (announced) deal(run, announced);
        }
        if (!spread) continue;
        const reached = advance(text, spread, flipped);
        for (; flipped < reached; flipped++) turn(flipped, spread[flipped]);
      }
    } catch { if (active()) log("caption stream interrupted"); }
  });
  room.on(RoomEvent.Reconnecting, () => { if (active()) { status("Connection lost. Reconnecting…"); clearTimeout(run.reconnectTimer); run.timers.delete(run.reconnectTimer); run.reconnectTimer = schedule(run, () => fail(run, "The connection could not be restored. Please try again."), CONNECT_TIMEOUT_MS); } });
  room.on(RoomEvent.Reconnected, () => { if (active()) { clearTimeout(run.reconnectTimer); run.timers.delete(run.reconnectTimer); status("Connected again. Carry on."); } });
  room.on(RoomEvent.Disconnected, () => {
    if (!active()) return;
    if (verdict || crisis) finish(run, crisis ? "crisis" : "complete");
    else fail(run, "The connection ended before the reading finished. Please try again.");
  });
}
function onEvent(run, msg) {
  if (msg.type === "state") {
    if (["listening", "thinking", "speaking"].includes(msg.state)) agentArrived(run);
    stage.dataset.agent = msg.state;
    if (!crisis) status(({ listening: "Vex is listening. Your turn.", thinking: "Vex is considering her response…", speaking: "Vex is speaking. You can interrupt." })[msg.state] || "Connecting to Vex…");
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
    $("invitation").hidden = false;
    prompt.hidden = true;
    phase("crisis");
    $("chapter").textContent = "The reading is paused";
    $("headline").textContent = "Let’s stop the cards here.";
    $("intro").textContent = msg.text || "Please find your host or someone you trust to talk to.";
    status("Take your time. Your host can help.");
  }
}
function finish(run, reason) {
  if (current !== run || run.closing) return;
  if (reason === "error") { fail(run, "Vex lost her connection. Please try again."); return; }
  release(run);
  subs.textContent = "";
  $("end").hidden = true;
  $("again").hidden = false;
  delete stage.dataset.agent;
  if (crisis || reason === "crisis") { phase("crisis"); status("Take your time. Choose Next guest when you’re ready."); return; }
  phase("verdict");
  $("reading-focus").hidden = true;
  $("invitation").hidden = false;
  $("chapter").textContent = "The audience is over";
  $("headline").textContent = reason === "complete" ? "The cards have spoken." : "We’ll leave it there.";
  $("intro").textContent = reason === "timeout" ? "Our time is up. Take a breath before your next reading." : reason === "away" ? "Gone, then. The cards will remember." : reason === "cancelled" ? "Your reading has ended." : "Your future is now your problem.";
  $("verdict").textContent = verdict;
  $("afterword").hidden = !verdict;
  prompt.hidden = true;
  status(spread ? "Your cards will stay for 30 seconds. Take a photograph." : "Ready for the next guest.");
  schedule(run, reset, RESET_AFTER_MS);
}
function deal(run, name, q) {
  if (spread || !deck || crisis || run.closing) return;
  positions = deck.spreads[name] || deck.spreads.short;
  spread = deck.cards.slice(0, positions.length);
  phase("reading");
  $("invitation").hidden = true;
  $("reading-focus").hidden = false;
  $("hero-image").hidden = true;
  $("hero-name").textContent = "Let’s see what follows you.";
  $("hero-position").textContent = "The cards are on the table";
  $("hero-orientation").textContent = "";
  question.textContent = q ? `“${q}”` : "";
  table.dataset.count = positions.length;
  table.replaceChildren();
  positions.forEach((pos, i) => {
    const slot = document.createElement("div"); slot.className = "slot";
    slot.innerHTML = '<div class="card"><div class="inner"><div class="back"></div><div class="front"><img alt=""></div></div></div><div class="name"></div>';
    slot.querySelector(".name").textContent = `${i + 1}. ${pos}`;
    slot.setAttribute("aria-label", `Card ${i + 1}: ${pos}, face down`);
    table.append(slot);
    schedule(run, () => slot.querySelector(".card").classList.add("dealt"), i * 100);
  });
  log("deal", name);
}
function turn(i, card) {
  const slots = table.querySelectorAll(".slot"), slot = slots[i];
  if (!slot) return;
  slots.forEach((s) => s.querySelector(".card").classList.remove("lit"));
  const front = slot.querySelector(".front");
  front.classList.toggle("reversed", card.reversed);
  const img = front.querySelector("img"); img.src = `/cards/${card.img}`; img.alt = card.name;
  slot.querySelector(".name").textContent = card.name;
  slot.setAttribute("aria-label", `${positions[i]}: ${card.name}, ${card.reversed ? "reversed" : "upright"}`);
  slot.querySelector(".card").classList.add("dealt", "flipped", "lit");
  const hero = $("hero-image"); hero.src = img.src; hero.alt = `${card.name}, ${card.reversed ? "reversed" : "upright"}`; hero.hidden = false;
  $("hero-card").classList.toggle("reversed", card.reversed);
  $("hero-position").textContent = `${i + 1} / ${spread.length} · ${positions[i]}`;
  $("hero-name").textContent = card.name;
  $("hero-orientation").textContent = card.reversed ? "Reversed" : "Upright";
  log("flip", i, card.name);
}
function tail(text) { return (text.match(/[^.!?]+[.!?]*\s*/g) || [text]).slice(-2).join("").trim(); }
function animateMirror(run, mediaTrack) {
  run.mouthStop?.();
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize); let raf;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      const level = Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + (value - 128) ** 2, 0) / samples.length) / 28);
      portal.style.setProperty("--voice", level.toFixed(2));
      raf = requestAnimationFrame(tick);
    };
    tick();
    run.mouthStop = () => { cancelAnimationFrame(raf); source.disconnect(); ctx.close().catch(() => {}); };
  } catch { log("mirror audio animation unavailable"); }
}
