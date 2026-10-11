import deck from "./deck.json";
import { PERSONA, ROAST_TASK, READING_TASK } from "./persona.js";

const POSITIONS = ["Past", "Present", "Future"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/api/token") return json(await token(env));
      if (request.method === "POST" && url.pathname === "/api/stt") return json(await stt(request, env));
      if (request.method === "POST" && url.pathname === "/api/roast") return json(await roast(await request.json(), env));
      if (request.method === "POST" && url.pathname === "/api/reading") return json(await reading(await request.json(), env));
      if (request.method === "POST" && url.pathname === "/api/tts") {
        const { text } = await request.json();
        return json({ audio: await tts(text, env) });
      }
    } catch (err) {
      console.error(url.pathname, err.stack || err);
      return json({ error: String(err.message || err) }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};

// LiveKit access token for one guest in a fresh room. The token's room config
// dispatches the `vex` agent worker into that room.
async function token(env) {
  const room = `vex-${crypto.randomUUID().slice(0, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.LIVEKIT_API_KEY,
    sub: `guest-${crypto.randomUUID().slice(0, 6)}`,
    nbf: now,
    exp: now + 15 * 60,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    roomConfig: { agents: [{ agentName: env.LIVEKIT_AGENT_NAME || "vex" }] },
  };
  const b64 = (v) => btoa(typeof v === "string" ? v : String.fromCharCode(...new Uint8Array(v))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LIVEKIT_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return { url: env.LIVEKIT_URL, room, token: `${body}.${b64(sig)}` };
}

// Speech to text: raw audio body from the kiosk -> ElevenLabs Scribe.
async function stt(request, env) {
  const audio = await request.blob();
  if (audio.size < 2000) return { text: "" };
  const form = new FormData();
  form.append("model_id", env.STT_MODEL || "scribe_v1");
  form.append("language_code", "en");
  form.append("tag_audio_events", "false");
  form.append("file", audio, "question.webm");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`stt ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { text: (data.text || "").trim() };
}

// Call 1: fast confirm + roast, spoken while the reading is written.
async function roast({ q }, env) {
  const out = await kimi(env, ROAST_TASK, `Transcript of the guest's question: "${q}"`, 400, 15000);
  const r = {
    heard: str(out.heard),
    roast: str(out.roast),
    crisis: out.crisis === true,
    crisis_line: str(out.crisis_line),
  };
  // The helpline is fixed text, never model output.
  if (r.crisis) r.crisis_line = `${r.crisis_line} If you need someone now, Samaritans are free on one one six, one two three, any time.`.trim();
  const say = r.crisis ? r.crisis_line : [r.heard, r.roast].filter(Boolean).join(" ");
  r.audio = say ? await tts(say, env) : null;
  return r;
}

// Call 2: the server draws the cards, Kimi reads them.
async function reading({ q }, env) {
  const cards = draw(3);
  const spread = cards
    .map((c, i) => `${i + 1}. ${c.pos}: ${c.name}${c.reversed ? " (reversed)" : " (upright)"}`)
    .join("\n");
  let out;
  try {
    out = await kimi(env, READING_TASK, `Guest's question: "${q}"\n\nCards drawn:\n${spread}`, 1500, 25000);
    if (!Array.isArray(out.cards) || out.cards.length !== 3) throw new Error("reading had wrong card count");
  } catch (err) {
    console.error("reading fallback:", err.message);
    out = fallback(cards);
  }
  cards.forEach((c, i) => (c.spoken = str(out.cards[i].spoken) || fallback(cards).cards[i].spoken));
  const verdict = str(out.verdict) || "Go and get a drink. The cards have spoken, mostly about you.";
  const clips = await Promise.all([...cards.map((c) => tts(c.spoken, env)), tts(verdict, env)]);
  cards.forEach((c, i) => (c.audio = clips[i]));
  return { cards, verdict: { text: verdict, audio: clips[3] }, letter: str(out.letter) };
}

function draw(n) {
  const picked = new Set();
  const rand = new Uint32Array(n * 4);
  crypto.getRandomValues(rand);
  const cards = [];
  let k = 0;
  while (cards.length < n) {
    const idx = rand[k++ % rand.length] % deck.length;
    if (picked.has(idx)) { crypto.getRandomValues(rand); continue; }
    picked.add(idx);
    cards.push({ pos: POSITIONS[cards.length], name: deck[idx].name, img: deck[idx].img, reversed: (rand[k++ % rand.length] & 1) === 1 });
  }
  return cards;
}

function fallback(cards) {
  return {
    cards: cards.map((c) => ({
      spoken: `${c.name}${c.reversed ? ", reversed" : ""}. The cards are being cagey tonight. So am I. Draw your own conclusions, darling.`,
    })),
    verdict: "Go and get a drink. Ask me again when you've decided what you want.",
    letter: "",
  };
}

async function kimi(env, task, user, maxTokens, timeoutMs) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${env.OPENROUTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.LLM_MODEL || "moonshotai/kimi-k3",
      temperature: 0.9,
      max_tokens: maxTokens,
      // K3 reasons by default, which spends the token budget and adds ~10 s. Vex doesn't need to think.
      reasoning: { enabled: false },
      messages: [
        { role: "system", content: `${PERSONA}\n\n${task}` },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseJson(data.choices?.[0]?.message?.content || "");
}

function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`no JSON in model reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

// Text to speech: returns base64 mp3 so the kiosk can hold clips in memory.
async function tts(text, env) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${env.VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: env.TTS_MODEL || "eleven_flash_v2_5",
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, speed: Number(env.TTS_SPEED || 1.15) },
      }),
    },
  );
  if (!res.ok) throw new Error(`tts ${res.status}: ${await res.text()}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const str = (v) => (typeof v === "string" ? v.trim() : "");
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
