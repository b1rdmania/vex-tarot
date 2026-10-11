// Vex: a live tarot session. LiveKit worker.
// Deepgram hears the guest, Kimi K3 (via OpenRouter) talks, ElevenLabs speaks,
// LiveAvatar (optional) puts a face on it. The server draws the cards.
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AgentSessionEventTypes, ServerOptions, cli, defineAgent, llm, log, voice } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as liveavatar from "@livekit/agents-plugin-liveavatar";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import OpenAI from "openai";
import { advance } from "../public/spoken.js";
import { CRISIS_LINE, CRISIS_PATTERN, GREETING, INSTRUCTIONS, SPREADS, WRAP_UP } from "./persona.js";

const DECK = JSON.parse(readFileSync(new URL("../src/deck.json", import.meta.url), "utf8"));
const SANDBOX_AVATAR = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"; // "Wayne", the only sandbox avatar
const env = (k, d) => process.env[k] || d;
const MAX_SESSION_MS = Number(env("VEX_MAX_SESSION_S", "480")) * 1000;

// K3 reasons by default, which adds ~10 s a turn. The plugin has no field for
// OpenRouter's `reasoning` flag, so add it to every request body here.
function openRouterClient() {
  return new OpenAI({
    apiKey: env("OPENROUTER_KEY"),
    baseURL: "https://openrouter.ai/api/v1",
    fetch: async (url, init) => {
      if (init?.body && typeof init.body === "string") {
        const body = JSON.parse(init.body);
        body.reasoning = { enabled: false };
        init = { ...init, body: JSON.stringify(body) };
      }
      return fetch(url, init);
    },
  });
}

// Crypto-random card draw without replacement, each card upright or reversed.
function draw(n) {
  const order = [...DECK.keys()];
  const rand = new Uint32Array(order.length + n);
  webcrypto.getRandomValues(rand);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, n).map((idx, i) => ({ ...DECK[idx], reversed: (rand[order.length + i] & 1) === 1 }));
}

// The deck is shuffled before she speaks. The cards go into her instructions,
// so she cannot invent one, and nothing on screen waits on a tool call.
// (K3 sometimes writes tool calls as text instead of making them.)
function cardBrief(cards) {
  const list = (positions) =>
    positions.map((pos, i) => `${i + 1}. ${pos}: ${cards[i].name}, ${cards[i].reversed ? "reversed" : "upright"}`).join("\n");
  return `\n\nTHE CARDS\nThe deck is already shuffled. These are this guest's cards. Do not mention any of them until you have called deal.\nShort spread:\n${list(SPREADS.short)}\nCeltic Cross, only if they ask for it:\n${list(SPREADS.celtic)}`;
}

// The plugin only tells the avatar to stop if her line is still being sent to
// it. TTS runs faster than speech, so the whole line is usually sent already, and
// then an interruption is ignored: the avatar talks on for seconds and the agent
// waits 5 s before giving up. Stop the avatar whenever it is still speaking.
class StoppableAvatar extends liveavatar.AvatarSession {
  onClearBuffer(ev) {
    if (ev.wasCapturing || !this.avatarSpeaking) return super.onClearBuffer(ev);
    this.audioPlaying = false;
    this.sendEvent({ type: "agent.interrupt", event_id: crypto.randomUUID() });
    this.audioBuffer?.notifyPlaybackFinished(this.playbackPosition, true);
    this.playbackPosition = 0;
  }
}

// Drop the act: cut her off, speak the fixed helpline line, then close.
function stopForCrisis(session, state, send) {
  if (state.crisis) return;
  state.crisis = state.ending = true;
  send({ type: "crisis" });
  try {
    session.interrupt({ force: true });
  } catch {}
  session.say(CRISIS_LINE, { allowInterruptions: false });
}

class Vex extends voice.Agent {
  constructor(state, send) {
    super({
      instructions: INSTRUCTIONS + cardBrief(state.cards),
      tools: {
        deal: llm.tool({
          description: "Lay the spread face down. Call once, after you have the guest's question.",
          parameters: {
            type: "object",
            properties: {
              spread: { type: "string", enum: ["short", "celtic"], description: "short = 5 cards (default), celtic = full 10-card Celtic Cross" },
              question: { type: "string", description: "The guest's question, in one plain sentence" },
            },
            required: ["spread", "question"],
          },
          execute: async ({ spread, question }) => {
            if (state.spread) return "The cards are already dealt. Read them.";
            state.spread = SPREADS[spread] ? spread : "short";
            send({ type: "deal", spread: state.spread, question });
            return "The cards are on the table. Say one line, then read them in order.";
          },
        }),
        crisis: llm.tool({
          description: "Stop the reading because the guest has raised self-harm, suicide, grief, abuse, a health scare or another real crisis.",
          execute: async (_args, { ctx }) => {
            stopForCrisis(ctx.session, state, send);
            return "The kiosk has spoken. Say nothing more.";
          },
        }),
      },
    });
    this.state = state;
  }

  // After a crisis or the final verdict the model gets no more turns.
  async llmNode(chatCtx, toolCtx, modelSettings) {
    if (this.state.ending) return null;
    return super.llmNode(chatCtx, toolCtx, modelSettings);
  }
}

export default defineAgent({
  prewarm: async (proc) => {
    // A little stricter than the defaults (0.5, 50 ms) so a laugh doesn't count as a turn.
    proc.userData.vad = await silero.VAD.load({ activationThreshold: 0.55, minSpeechDuration: 100 });
  },
  entry: async (ctx) => {
    const logger = log();
    await ctx.connect();
    const state = { cards: draw(SPREADS.celtic.length), spread: null, spoken: 0, ending: false, crisis: false, closing: false };
    const encoder = new TextEncoder();
    const send = (msg) =>
      ctx.room.localParticipant
        ?.publishData(encoder.encode(JSON.stringify(msg)), { reliable: true, topic: "vex" })
        .catch((err) => logger.warn({ err: String(err) }, "publishData failed"));

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad,
      stt: new deepgram.STT({ model: "nova-3", language: "en-GB", keyterm: ["tarot", "Vex", "Celtic Cross"] }),
      llm: new openai.LLM({ client: openRouterClient(), model: env("LLM_MODEL", "moonshotai/kimi-k3"), temperature: 0.9 }),
      tts: new elevenlabs.TTS({
        voiceId: env("VOICE_ID", "X6VIT9ZXy5Nr7EmuLOGz"),
        model: env("TTS_MODEL", "eleven_flash_v2_5"),
        apiKey: env("ELEVENLABS_KEY"),
        voiceSettings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, speed: Number(env("TTS_SPEED", "1.1")), use_speaker_boost: true },
      }),
      turnHandling: {
        turnDetection: "vad",
        // A party is loud. Only a deliberate interruption should cut her off.
        interruption: { minDuration: 600, minWords: 1, resumeFalseInterruption: true },
        // Wait for a real pause before she answers, so she doesn't jump in mid-sentence.
        endpointing: { minDelay: 900, maxDelay: 3500 },
      },
      userAwayTimeout: 30,
    });

    session.on(AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (!state.crisis && CRISIS_PATTERN.test(ev.transcript)) {
        logger.warn({ transcript: ev.transcript }, "crisis screen matched");
        stopForCrisis(session, state, send);
      }
    });
    session.on(AgentSessionEventTypes.AgentStateChanged, (ev) => send({ type: "state", state: ev.newState }));
    session.on(AgentSessionEventTypes.UserStateChanged, (ev) => {
      if (ev.newState === "away" && !state.ending) {
        state.ending = true;
        session.say("Gone, then. The cards will remember.", { allowInterruptions: false });
      }
    });
    session.on(AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (item?.type !== "message") return;
      logger.info({ role: item.role, text: item.textContent }, "turn");
      // Her last line has finished playing: close the room. The tool that set
      // `ending` runs while that line is still being spoken, so wait for the item.
      if (item.role !== "assistant" || state.closing) return;
      // The reading ends with the line that reaches the last card (the verdict
      // follows in the same breath). Without a deal, she was reading the short spread.
      const spread = state.cards.slice(0, SPREADS[state.spread || "short"].length);
      state.spoken = advance(item.textContent || "", spread, state.spoken);
      if (!state.ending && state.spoken === spread.length) {
        state.ending = true;
      }
      const last = !state.crisis || (item.textContent || "").includes("Samaritans");
      if (state.ending && last) setTimeout(() => state.finish(), 2000);
    });
    session.on(AgentSessionEventTypes.FunctionToolsExecuted, (ev) =>
      logger.info({ tools: ev.functionCalls?.map((c) => c.name) }, "tools"));
    // Her last line has already played, so there is nothing to drain. (A draining
    // shutdown also waits on the empty reply after her last line and never ends.)
    // Deleting the room disconnects the kiosk, which then resets.
    state.finish = () => {
      if (state.closing) return;
      state.closing = true;
      clearTimeout(state.wrap);
      send({ type: "end" }); // the kiosk hangs up too, in case deleting the room fails
      logger.info("session finished, deleting room");
      ctx.deleteRoom().catch((err) => logger.warn({ err: String(err) }, "deleteRoom failed"));
      session.shutdown({ drain: false });
    };
    session.on(AgentSessionEventTypes.Close, () => state.finish());
    session.on(AgentSessionEventTypes.Error, (ev) => logger.error({ err: String(ev.error?.message || ev.error) }, "session error"));

    const avatarKey = env("LIVEAVATAR_API_KEY");
    if (avatarKey) {
      const sandbox = env("LIVEAVATAR_SANDBOX", "1") === "1";
      const avatar = new StoppableAvatar({
        apiKey: avatarKey,
        avatarId: sandbox ? SANDBOX_AVATAR : env("LIVEAVATAR_AVATAR_ID"),
        isSandbox: sandbox,
        videoQuality: "high",
      });
      try {
        await avatar.start(session, ctx.room);
        send({ type: "avatar", ok: true });
      } catch (err) {
        // No face is better than no Vex: fall back to voice only.
        logger.error({ err: String(err) }, "avatar failed, running voice only");
        send({ type: "avatar", ok: false });
      }
    }

    await session.start({
      agent: new Vex(state, send),
      room: ctx.room,
      inputOptions: { closeOnDisconnect: true, deleteRoomOnClose: true },
      record: false,
    });

    state.wrap = setTimeout(() => {
      if (!state.ending && !state.closing) session.generateReply({ instructions: WRAP_UP });
    }, MAX_SESSION_MS - 45_000);
    // The kiosk keeps every card so it can flip them as she names them, even if deal never arrives.
    send({ type: "cards", cards: state.cards, spreads: SPREADS });

    session.generateReply({ instructions: GREETING });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: env("LIVEKIT_AGENT_NAME", "vex") }));
