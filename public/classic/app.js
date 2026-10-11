// Vex kiosk. One reading at a time: hold space, ask, watch.
(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), subs = $("subs"), heard = $("heard"), table = $("table"), prompt = $("prompt"), debug = $("debug"), mouth = $("mouth");

  const MAX_RECORD_MS = 15000;
  const MIN_RECORD_MS = 500;
  const LINES = {
    speakUp: "Speak up, darling. I'm dead, not deaf. Hold the space bar and try again.",
    slow: "The cards are being dramatic. Give them a moment.",
    broken: "The spirits have lost the wifi password. Ask me again.",
  };

  let state = "asleep";
  let stream, recorder, chunks = [], recStart = 0, recTimer = null;
  let audioCtx, analyser, canned = {};
  const log = [];

  // ---------- state + UI ----------
  function setState(s) {
    state = s;
    stage.dataset.state = s;
    prompt.innerHTML = {
      idle: "Hold <kbd>space</kbd> and ask your question",
      listening: "Listening… let go when you're done",
      thinking: "",
      done: "Next guest: hold <kbd>space</kbd>",
    }[s] ?? "";
  }

  function dbg(msg) {
    log.push(`${(performance.now() / 1000).toFixed(1)}s  ${msg}`);
    debug.textContent = log.slice(-40).join("\n");
  }

  function buildTable() {
    table.querySelectorAll(".slot").forEach((n) => n.remove());
    for (let i = 0; i < 3; i++) {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.innerHTML = `<span class="pos"></span>
        <div class="card"><div class="inner"><div class="back"></div><div class="front"><img alt=""></div></div></div>
        <span class="rev"></span>`;
      table.appendChild(slot);
    }
  }

  function resetTable() {
    table.querySelectorAll(".slot").forEach((slot) => {
      slot.querySelector(".card").className = "card";
      slot.querySelector(".pos").classList.remove("on");
      slot.querySelector(".rev").textContent = "";
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timeout = (p, ms) => Promise.race([p, sleep(ms).then(() => { throw new Error(`timed out after ${ms} ms`); })]);

  // ---------- sound ----------
  function initAudio() {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(audioCtx.destination);
    const buf = new Uint8Array(analyser.fftSize);
    (function moveMouth() {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      mouth.setAttribute("ry", (2.2 + Math.min(peak / 9, 7)).toFixed(2));
      requestAnimationFrame(moveMouth);
    })();
  }

  // Play a base64 mp3 through the analyser so the mouth moves; type the words out over the clip's length.
  async function speak(b64, text) {
    if (text != null) subs.textContent = "";
    if (!b64) { if (text) subs.textContent = text; await sleep(1500); return; }
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buffer = await audioCtx.decodeAudioData(bytes.buffer);
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(analyser);
    stage.classList.add("speaking");
    if (text) typeOut(text, buffer.duration * 1000 * 0.85);
    await new Promise((resolve) => { src.onended = resolve; src.start(); });
    stage.classList.remove("speaking");
    if (text) subs.textContent = text;
  }

  let typing;
  function typeOut(text, ms) {
    clearInterval(typing);
    const step = Math.max(12, ms / text.length);
    let n = 0;
    typing = setInterval(() => {
      subs.textContent = text.slice(0, ++n);
      if (n >= text.length) clearInterval(typing);
    }, step);
  }

  // Small synthetic effects, so there are no sound files to ship.
  function noiseBurst({ dur = 0.08, freq = 2500, q = 0.8, gain = 0.25, at = 0 }) {
    const t = audioCtx.currentTime + at;
    const len = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
    const g = audioCtx.createGain();
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(audioCtx.destination);
    src.start(t);
  }
  const sfx = {
    shuffle: (secs) => { for (let t = 0; t < secs; t += 0.045) noiseBurst({ dur: 0.03, freq: 3000 + Math.random() * 1500, gain: 0.12, at: t }); },
    deal: () => noiseBurst({ dur: 0.12, freq: 1800, gain: 0.3 }),
    flip: () => { noiseBurst({ dur: 0.06, freq: 4000, gain: 0.25 }); noiseBurst({ dur: 0.1, freq: 900, gain: 0.3, at: 0.08 }); },
  };

  // ---------- network ----------
  // The access code arrives once in the link (?code=...) and is kept for reloads.
  const accessCode = new URLSearchParams(location.search).get("code") || localStorage.getItem("vexCode") || "";
  if (accessCode) localStorage.setItem("vexCode", accessCode);
  async function post(path, body, isJson = true) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "X-Vex-Code": accessCode, "Content-Type": isJson ? "application/json" : body.type || "audio/webm" },
      body: isJson ? JSON.stringify(body) : body,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ---------- recording ----------
  async function startListening() {
    if (state !== "idle" && state !== "done") return;
    resetTable();
    heard.textContent = "";
    subs.textContent = "";
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start();
    recStart = performance.now();
    recTimer = setTimeout(stopListening, MAX_RECORD_MS);
    setState("listening");
    dbg("listening");
  }

  function stopListening() {
    if (state !== "listening") return;
    clearTimeout(recTimer);
    const held = performance.now() - recStart;
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (held < MIN_RECORD_MS) { dbg(`too short (${held | 0} ms)`); setState("idle"); return; }
      reading(blob).catch(async (err) => {
        dbg(`ERROR ${err.message}`);
        console.error(err);
        heard.textContent = "";
        await speak(canned.broken, LINES.broken);
        setState("idle");
      });
    };
    recorder.stop();
    setState("thinking");
  }

  // ---------- the reading ----------
  async function reading(blob) {
    const t0 = performance.now();
    const since = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

    const { text } = await timeout(post("/api/stt", blob, false), 10000);
    dbg(`stt ${since()}: "${text}"`);
    if (!text) { await speak(canned.speakUp, LINES.speakUp); setState("idle"); return; }
    heard.textContent = `“${text}”`;

    // Fire both at once. The roast plays while the reading is written.
    const roastP = timeout(post("/api/roast", { q: text }), 15000);
    const readingP = timeout(post("/api/reading", { q: text }), 30000);
    readingP.then(() => dbg(`reading ready ${since()}`), () => {});

    let roast = null;
    try { roast = await roastP; dbg(`roast ready ${since()}`); } catch (e) { dbg(`roast failed: ${e.message}`); }

    if (roast?.crisis) {
      setState("roast");
      await speak(roast.audio, roast.crisis_line);
      await sleep(4000);
      subs.textContent = "";
      heard.textContent = "";
      setState("idle");
      return;
    }
    if (roast && !roast.heard && roast.roast) {
      // Gibberish: she asks them to try again.
      setState("roast");
      await speak(roast.audio, roast.roast);
      setState("idle");
      return;
    }
    if (roast) {
      setState("roast");
      await speak(roast.audio, [roast.heard, roast.roast].filter(Boolean).join(" "));
    }

    // Shuffle at least 2.5 s, longer if the reading isn't back yet.
    setState("shuffle");
    subs.textContent = "";
    sfx.shuffle(2.5);
    const minShuffle = sleep(2500);
    let r = await Promise.race([readingP.catch(() => null), sleep(9000).then(() => "slow")]);
    if (r === "slow") {
      dbg("reading slow, stalling");
      sfx.shuffle(2.5);
      await speak(canned.slow, LINES.slow);
      r = await readingP.catch(() => null);
    }
    await minShuffle;
    if (!r) throw new Error("reading failed");
    window.lastReading = r;
    dbg(`letter (${r.letter.split(/\s+/).length} words) saved to window.lastReading`);

    // Deal face down.
    setState("deal");
    const slots = [...table.querySelectorAll(".slot")];
    r.cards.forEach((c, i) => {
      const img = slots[i].querySelector("img");
      img.src = `/cards/${c.img}`;
      img.alt = c.name + (c.reversed ? ", reversed" : "");
      slots[i].querySelector(".front").classList.toggle("reversed", c.reversed);
      slots[i].querySelector(".pos").textContent = c.pos;
    });
    await Promise.all(slots.map((s) => s.querySelector("img").decode().catch(() => {})));
    for (const s of slots) {
      s.querySelector(".card").classList.add("dealt");
      s.querySelector(".pos").classList.add("on");
      sfx.deal();
      await sleep(450);
    }
    await sleep(1200);

    // Reveal one at a time. The next card waits for her to finish.
    setState("reveal");
    for (let i = 0; i < 3; i++) {
      const card = slots[i].querySelector(".card");
      card.classList.add("flipped", "lit");
      sfx.flip();
      await sleep(1100);
      slots[i].querySelector(".rev").textContent = r.cards[i].reversed ? "reversed" : "";
      await speak(r.cards[i].audio, r.cards[i].spoken);
      card.classList.remove("lit");
      await sleep(500);
    }

    setState("verdict");
    await speak(r.verdict.audio, r.verdict.text);
    dbg(`done ${since()}`);
    setState("done");
    await sleep(20000);
    if (state === "done") { resetTable(); subs.textContent = ""; heard.textContent = ""; setState("idle"); }
  }

  // ---------- wiring ----------
  async function wake() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      prompt.textContent = "Vex needs the microphone. Allow it and reload.";
      return;
    }
    initAudio();
    buildTable();
    // Pre-make the canned lines so failures still sound like her.
    await Promise.all(Object.entries(LINES).map(async ([k, text]) => {
      try { canned[k] = (await post("/api/tts", { text })).audio; } catch (e) { dbg(`canned ${k} failed`); }
    }));
    document.documentElement.requestFullscreen?.().catch(() => {});
    setState("idle");
    dbg("awake");
  }

  $("wake").addEventListener("click", wake);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); if (!e.repeat) startListening(); }
    if (e.key === "d") debug.hidden = !debug.hidden;
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") { e.preventDefault(); stopListening(); }
  });
})();
