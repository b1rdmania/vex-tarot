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
      instructions: INSTRUCTIONS,
      tools: {
        deal: llm.tool({
          description: "Shuffle and lay the spread face down. Call once, after you have the guest's question.",
          parameters: {
            type: "object",
            properties: {
              spread: { type: "string", enum: ["short", "celtic"], description: "short = 5 cards (default), celtic = full 10-card Celtic Cross" },
              question: { type: "string", description: "The guest's question, in one plain sentence" },
            },
            required: ["spread", "question"],
          },
          execute: async ({ spread, question }) => {
            if (state.cards) return "The cards are already dealt. Call turn_card for the next one.";
            const positions = SPREADS[spread] || SPREADS.short;
            state.cards = draw(positions.length).map((c, i) => ({ ...c, pos: positions[i] }));
            state.question = question;
            state.next = 0;
            send({ type: "deal", spread, positions, question });
            return `${positions.length} cards are face down. Positions in order: ${positions.join("; ")}. Say one line while they settle, then call turn_card.`;
          },
        }),
        turn_card: llm.tool({
          description: "Turn the next card face up. Returns its position, name and orientation. Read it before turning another.",
          execute: async () => {
            if (!state.cards) return "Nothing is dealt yet. Call deal first.";
            if (state.next >= state.cards.length) return "Every card is turned. Give your verdict and call end_reading.";
            const i = state.next++;
            const c = state.cards[i];
            send({ type: "turn", index: i, card: c });
            const left = state.cards.length - state.next;
            return `Card ${i + 1} of ${state.cards.length}, ${c.pos}: ${c.name}, ${c.reversed ? "reversed" : "upright"}. ${left ? `${left} still face down.` : "That was the last card."}`;
          },
        }),
        end_reading: llm.tool({
          description: "End the session after your final verdict.",
          execute: async (_args, { ctx }) => {
            state.ending = true;
            send({ type: "end" });
            // Backstop in case the verdict was spoken before this call and no further line comes.
            setTimeout(() => state.finish?.(), 90_000);
            return "Session ending. Say nothing more.";
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
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx) => {
    const logger = log();
    await ctx.connect();
    const state = { cards: null, next: 0, ending: false, crisis: false, closing: false };
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
        interruption: { minDuration: 800, minWords: 2, resumeFalseInterruption: true },
        endpointing: { minDelay: 500, maxDelay: 3000 },
      },
      maxToolSteps: 16, // a Celtic Cross chains deal + 10 turns + end without the guest speaking
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
        send({ type: "end" });
        session.say("Gone, then. The cards will remember.", { allowInterruptions: false });
      }
    });
    session.on(AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (item?.type !== "message") return;
      logger.info({ role: item.role, text: item.textContent }, "turn");
      // Her last line has finished playing: close the room. The tool that set
      // `ending` runs while that line is still being spoken, so wait for the item.
      const last = !state.crisis || (item.textContent || "").includes("Samaritans");
      if (state.ending && item.role === "assistant" && last && !state.closing) {
        setTimeout(() => state.finish(), 2000);
      }
    });
    session.on(AgentSessionEventTypes.FunctionToolsExecuted, (ev) =>
      logger.info({ tools: ev.functionCalls?.map((c) => c.name) }, "tools"));
    // Her last line has already played, so there is nothing to drain. (A draining
    // shutdown also waits on the empty reply after end_reading and never ends.)
    // Deleting the room disconnects the kiosk, which then resets.
    state.finish = () => {
      if (state.closing) return;
      state.closing = true;
      logger.info("session finished, deleting room");
      ctx.deleteRoom().catch((err) => logger.warn({ err: String(err) }, "deleteRoom failed"));
      session.shutdown({ drain: false });
    };
    session.on(AgentSessionEventTypes.Close, () => state.finish());
    session.on(AgentSessionEventTypes.Error, (ev) => logger.error({ err: String(ev.error?.message || ev.error) }, "session error"));

    const avatarKey = env("LIVEAVATAR_API_KEY");
    if (avatarKey) {
      const sandbox = env("LIVEAVATAR_SANDBOX", "1") === "1";
      const avatar = new liveavatar.AvatarSession({
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

    const wrap = setTimeout(() => {
      if (!state.ending) session.generateReply({ instructions: WRAP_UP });
    }, MAX_SESSION_MS - 45_000);
    ctx.addShutdownCallback(async () => clearTimeout(wrap));

    session.generateReply({ instructions: GREETING });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: env("LIVEKIT_AGENT_NAME", "vex") }));
