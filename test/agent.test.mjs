import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
const moduleFrom = (path) => import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(new URL(path, import.meta.url), "utf8")).toString("base64")}`);
const spoken = await moduleFrom("../public/spoken.js");
const persona = await moduleFrom("../agent/persona.js");
async function setup(extraEnv = {}) {
  const sent = [], logs = [], timers = new Map(), roomHandlers = {}; let nextTimer = 0, session, deleted = 0;
  class Service {}
  class Agent { constructor(options) { Object.assign(this, options); } }
  class Session {
    handlers = new Map(); replies = []; lines = []; stopped = false;
    constructor() { session = this; }
    on(name, callback) { this.handlers.set(name, callback); }
    emit(name, event) { this.handlers.get(name)?.(event); }
    async start(options) { this.agent = options.agent; this.inputOptions = options.inputOptions; }
    generateReply(options) { this.replies.push(options); }
    say(text) { this.lines.push(text); }
    interrupt() {}
    shutdown() { this.stopped = true; }
  }
  const events = Object.fromEntries(["UserInputTranscribed", "AgentStateChanged", "UserStateChanged", "ConversationItemAdded", "FunctionToolsExecuted", "Close", "Error"].map(x => [x, x]));
  const ctx = vm.createContext({
    ...spoken, ...persona, readFileSync: fs.readFileSync, webcrypto, crypto: webcrypto, fileURLToPath, URL, TextEncoder,
    process: { env: extraEnv }, fetch() { throw Error("Unexpected network call"); },
    AgentSessionEventTypes: events, voice: { Agent, AgentSession: Session }, defineAgent: x => x, llm: { tool: x => x },
    log: () => Object.fromEntries(["info", "warn", "error"].map(level => [level, (...args) => logs.push(args)])),
    deepgram: { STT: Service }, elevenlabs: { TTS: Service }, liveavatar: { AvatarSession: Service }, openai: { LLM: Service }, OpenAI: Service, BackgroundVoiceCancellation: () => ({}),
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; }, clearTimeout: id => timers.delete(id),
  });
  const source = fs.readFileSync(new URL("../agent/agent.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replaceAll("import.meta.url", JSON.stringify(new URL("../agent/agent.js", import.meta.url).href))
    .replace("export default defineAgent", "globalThis.definition = defineAgent")
    .replace(/^cli.runApp.*$/m, "");
  vm.runInContext(source, ctx);
  await ctx.definition.entry({ connect: async () => {}, proc: { userData: {} }, room: { on: (name, fn) => { roomHandlers[name] = fn; }, localParticipant: { publishData: async data => sent.push(JSON.parse(new TextDecoder().decode(data))) } }, deleteRoom: async () => { deleted++; } });
  const say = (role, text, interrupted = false) => session.emit("ConversationItemAdded", { item: { type: "message", role, textContent: text, interrupted } });
  const runTimer = ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } };
  const typed = text => session.inputOptions.textInputCallback(session, { text });
  const ping = () => roomHandlers.dataReceived(new TextEncoder().encode('{"type":"typing"}'), null, null, "vex-guest");
  return { sent, logs, timers, session, say, runTimer, typed, ping, deleted: () => deleted };
}
test("opening gate blocks early deals and card references; explicit fallback works", async () => {
  const s = await setup();
  await s.session.agent.tools.deal.execute({ spread: "short", question: "private question" });
  assert.equal(s.sent.some(x => x.type === "deal"), false);
  s.say("assistant", "The cards are on the table.");
  assert.equal(s.session.agent.state.phase, "opening");
  for (let i = 0; i < 4; i++) s.say("user", "private answer");
  s.say("assistant", "Welcome to my world. That takes strength.");
  assert.equal(s.session.agent.state.phase, "opening");
  s.say("assistant", "The Celtic Cross is on the table.");
  assert.equal(s.session.agent.state.spread, "celtic");
  assert.equal(s.sent.at(-1).type, "deal");
  assert.ok(!JSON.stringify(s.logs).includes("private"));
});
test("five and ten card readings finish only after the final uninterrupted line", async () => {
  for (const count of [5, 10]) {
    const s = await setup();
    s.say("user", "Just read the cards");
    await s.session.agent.tools.deal.execute({ spread: count === 5 ? "short" : "celtic", question: "Work?" });
    const cards = s.sent.find(x => x.type === "cards").cards.slice(0, count);
    for (let i = 0; i < count; i++) {
      const card = cards[i];
      s.say("assistant", `${card.name}, ${card.reversed ? "reversed" : "upright"}. Make the call.`, i === count - 1);
    }
    assert.equal(s.session.agent.state.ending, false);
    s.say("assistant", "As I was saying. Make the call.");
    assert.equal(s.sent.at(-1).type, "verdict");
    s.runTimer(2000);
    assert.equal(s.session.stopped, true);
    assert.equal(s.deleted(), 1);
    assert.equal(s.timers.size, 0);
  }
});
test("hard cutoff closes an active session independently of model output", async () => {
  const s = await setup();
  s.runTimer(480000);
  assert.equal(s.session.stopped, true);
  assert.equal(s.sent.at(-1).reason, "timeout");
  assert.equal(s.timers.size, 0);
});
test("crisis interrupts, blocks dealing, sends fixed text and never logs transcript", async () => {
  const s = await setup();
  s.session.emit("UserInputTranscribed", { transcript: "I want to die" });
  assert.equal(s.session.lines[0], persona.CRISIS_LINE);
  assert.equal(s.sent.at(-1).type, "crisis");
  await s.session.agent.tools.deal.execute({ spread: "short", question: "secret" });
  assert.equal(s.sent.some(x => x.type === "deal"), false);
  assert.ok(!JSON.stringify(s.logs).includes("I want to die"));
  s.say("assistant", persona.CRISIS_LINE);
  s.runTimer(2000);
  assert.equal(s.sent.at(-1).reason, "crisis");
});
test("recoverable errors allow SDK retry; fatal errors close the session", async () => {
  const s = await setup();
  s.session.emit("Error", { error: { recoverable: true } });
  assert.equal(s.session.stopped, false);
  s.session.emit("Error", { error: { recoverable: false } });
  assert.equal(s.session.stopped, true);
  assert.equal(s.sent.at(-1).reason, "error");
});
test("typed messages reach Vex, get the crisis screen, and keep a typing guest present", async () => {
  const s = await setup();
  s.typed("Will I get the flat?");
  assert.equal(s.session.replies.at(-1).userInput, "Will I get the flat?");
  s.ping();
  s.session.emit("UserStateChanged", { newState: "away" });
  assert.equal(s.session.agent.state.ending, false, "a typing guest is not away");
  s.typed("I don't see the point in anything");
  assert.equal(s.sent.at(-1).type, "crisis");
  const replies = s.session.replies.length;
  s.typed("hello?");
  assert.equal(s.session.replies.length, replies, "nothing more is sent to the model after a crisis");
  assert.ok(!JSON.stringify(s.logs).includes("flat"));
});
test("the agent follows a reading Vex starts before the gate, but not a bare announcement", async () => {
  const s = await setup();
  s.say("user", "Andy");
  s.say("assistant", "The cards are on the table.");
  assert.equal(s.session.agent.state.phase, "opening");
  const [first] = s.session.agent.state.cards;
  s.say("assistant", `Right. The cards are on the table. ${first.name}, ${first.reversed ? "reversed" : "upright"}. Classic.`);
  assert.equal(s.session.agent.state.phase, "reading");
  assert.equal(s.sent.find(x => x.type === "deal").spread, "short");
  assert.equal(s.session.agent.state.spoken, 1);
});
