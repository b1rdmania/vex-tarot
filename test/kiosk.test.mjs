import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const deck = JSON.parse(await readFile(new URL("../src/deck.json", import.meta.url)));
const cards = deck.slice(0, 10).map((card, i) => ({ ...card, reversed: i % 2 === 1 }));
const spreads = { short: ["The heart of it", "What crosses you", "The root", "What’s coming", "Where this ends up"], celtic: Array.from({ length: 10 }, (_, i) => `Position ${i + 1}`) };
let server, browser, base;
before(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = resolve(publicDir, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(publicDir + "/")) { res.writeHead(403).end(); return; }
    try {
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png" })[extname(file)] || "application/octet-stream");
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({ executablePath: process.env.CHROME || (existsSync(chrome) ? chrome : undefined), headless: true });
});
after(async () => { await browser?.close(); await new Promise(done => server?.close(done)); });
async function pageFor(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  t.after(() => page.close());
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], "no uncaught browser errors"));
  await page.clock.install();
  await page.route("**/vendor/livekit-client.esm.mjs", route => route.fulfill({ path: fileURLToPath(new URL("./fixtures/livekit.js", import.meta.url)), contentType: "text/javascript" }));
  await page.route("**/api/token", route => route.fulfill({ status: options.status || 200, json: { url: "mock", token: "mock" } }));
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  if (options.denied) await page.addInitScript(() => { window.__micDenied = true; });
  await page.goto(base + (options.query || ""));
  return page;
}
const event = (page, msg) => page.evaluate(msg => window.__vexMock.event(msg), msg);
const say = (page, text) => page.evaluate(text => window.__vexMock.say(text), text);
async function start(page) {
  await page.getByRole("button", { name: "Talk to Vex" }).click();
  await page.waitForFunction(() => window.__vexMock.rooms.length === 1);
}
async function ready(page) { await event(page, { type: "cards", cards, spreads }); await event(page, { type: "state", state: "listening" }); }
async function shot(page, name) {
  if (!process.env.VEX_SHOTS) return;
  await mkdir(process.env.VEX_SHOTS, { recursive: true });
  await page.screenshot({ path: resolve(process.env.VEX_SHOTS, name + ".png"), fullPage: true, animations: "disabled" });
}
test("denied microphone carries on as a typed reading", async t => {
  const page = await pageFor(t, { denied: true });
  await start(page);
  await page.waitForFunction(() => /Type to Vex/.test(document.querySelector("#status-text").textContent));
  assert.equal(await page.evaluate(() => window.__vexMock.disconnects), 0);
  await ready(page);
  assert.equal(await page.locator("#stage").getAttribute("data-phase"), "conversation");
  assert.equal(await page.evaluate(() => document.activeElement.id), "type", "type box is focused");
  await page.keyboard.type("Will I get the flat?");
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => window.__vexMock.sent), [{ text: "Will I get the flat?", topic: "lk.chat" }]);
  assert.equal(await page.locator("#type").inputValue(), "");
  // Events from a discarded room cannot reset or end this guest's session.
  await page.evaluate(() => window.__vexMock.rooms[0].event({ type: "deal", spread: "short" }));
});
test("bad access code gives a visible recovery message", async t => {
  const page = await pageFor(t, { status: 401 });
  await page.getByRole("button", { name: "Talk to Vex" }).click();
  await page.getByRole("button", { name: "Try again" }).waitFor();
  assert.match(await page.locator("#intro").innerText(), /valid access code/);
});
test("missing agent times out visibly", async t => {
  const page = await pageFor(t);
  await start(page);
  await page.clock.fastForward(36_000);
  assert.equal(await page.locator("#stage").getAttribute("data-phase"), "error");
  assert.equal(await page.evaluate(() => window.__vexMock.disconnects), 1);
});
test("five-card laptop reading preserves verdict then resets for next guest", async t => {
  const page = await pageFor(t);
  await shot(page, "laptop-idle");
  await start(page); await ready(page);
  await say(page, "The cards are on the table.");
  assert.equal(await page.locator(".slot").count(), 0, "a bare announcement before the gate does not deal");
  await event(page, { type: "reading-ready" });
  await say(page, "Welcome to my world. This is a strength of yours.");
  assert.equal(await page.locator(".slot").count(), 0);
  await say(page, "The cards are on the table.");
  assert.equal(await page.locator(".slot").count(), 5);
  for (let i = 0; i < 5; i++) await say(page, `${cards[i].name}, ${cards[i].reversed ? "reversed" : "upright"}. Take a chance.`);
  await page.clock.runFor(1500);
  assert.equal(await page.locator(".card.flipped").count(), 5);
  assert.equal(await page.locator("#hero-name").innerText(), cards[4].name);
  assert.match(await page.locator("#subs").textContent(), /Take a chance/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await shot(page, "laptop-reading");
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, "laptop reading fits vertically");
  await event(page, { type: "verdict", text: "Make the call." });
  await event(page, { type: "end", reason: "complete", verdict: "Make the call." });
  assert.equal(await page.locator("#verdict").innerText(), "Make the call.");
  assert.equal(await page.locator("#afterword").isHidden(), false);
  await shot(page, "laptop-verdict");
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, "laptop verdict fits vertically");
  await page.clock.fastForward(31_000);
  assert.equal(await page.locator("#stage").getAttribute("data-state"), "idle");
  assert.equal(await page.locator(".slot").count(), 0);
  assert.equal(await page.evaluate(() => window.__vexMock.disconnects), 1);
});
test("ten-card reading handles early deal delivery", async t => {
  const page = await pageFor(t);
  await start(page);
  await event(page, { type: "deal", spread: "celtic", question: "What next?" });
  await ready(page);
  assert.equal(await page.locator(".slot").count(), 10);
  for (const card of cards) await say(page, `${card.name}, ${card.reversed ? "reversed" : "upright"}. Carry on.`);
  assert.equal(await page.locator(".card.flipped").count(), 10);
  await page.clock.runFor(1500);
  await shot(page, "laptop-celtic");
});
test("crisis clears cards, rejects late deals and stays until host resets", async t => {
  const page = await pageFor(t);
  await start(page); await ready(page);
  await event(page, { type: "deal", spread: "short" });
  await event(page, { type: "crisis", text: "Please find your host." });
  await event(page, { type: "deal", spread: "short" });
  await say(page, "The cards are on the table. The Fool, upright.");
  assert.equal(await page.locator(".slot").count(), 0);
  await event(page, { type: "end", reason: "crisis" });
  await page.clock.fastForward(60_000);
  assert.equal(await page.locator("#stage").getAttribute("data-phase"), "crisis");
  await page.getByRole("button", { name: "Next guest" }).click();
  assert.equal(await page.locator("#stage").getAttribute("data-state"), "idle");
});
test("mobile layout remains usable without horizontal overflow", async t => {
  const page = await pageFor(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page); await ready(page);
  await event(page, { type: "deal", spread: "short" });
  await say(page, `${cards[0].name}, upright. Take a chance.`);
  await page.clock.runFor(1500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.getByRole("button", { name: "Leave" }).isVisible(), true);
  await shot(page, "phone-reading");
});

test("failed reconnect closes the old room and offers retry", async t => {
  const page = await pageFor(t);
  await start(page); await ready(page);
  await page.evaluate(() => window.__vexMock.rooms[0].handlers.get("Reconnecting")());
  assert.match(await page.locator("#status-text").innerText(), /Reconnecting/);
  await page.clock.fastForward(36_000);
  assert.equal(await page.locator("#stage").getAttribute("data-phase"), "error");
  assert.equal(await page.evaluate(() => window.__vexMock.disconnects), 1);
});
test("agent leaving mid-reading offers retry instead of hanging", async t => {
  const page = await pageFor(t);
  await start(page); await ready(page);
  await event(page, { type: "state", state: "thinking" });
  await page.evaluate(() => window.__vexMock.rooms[0].handlers.get("ParticipantDisconnected")({ identity: "guest-2", isAgent: false }));
  assert.equal(await page.locator("#stage").getAttribute("data-phase"), "conversation");
  await page.evaluate(() => window.__vexMock.rooms[0].handlers.get("ParticipantDisconnected")({ identity: "vex-agent", isAgent: true }));
  assert.equal(await page.locator("#stage").getAttribute("data-phase"), "error");
  assert.equal(await page.getByRole("button", { name: "Try again" }).isVisible(), true);
});

test("Vex stuck thinking gives up after 30 seconds", async t => {
  const page = await pageFor(t);
  await start(page); await ready(page);
  await event(page, { type: "state", state: "thinking" });
  await page.clock.runFor(20_000);
  await event(page, { type: "state", state: "speaking" });
  await event(page, { type: "state", state: "thinking" });
  await page.clock.runFor(20_000);
  assert.equal(await page.locator("#stage").getAttribute("data-phase"), "conversation");
  await page.clock.runFor(11_000);
  assert.equal(await page.locator("#stage").getAttribute("data-phase"), "error");
  assert.equal(await page.evaluate(() => window.__vexMock.disconnects), 1);
});

test("Celtic announcement chooses ten cards without a tool event", async t => {
  const page = await pageFor(t);
  await start(page); await ready(page);
  await event(page, { type: "reading-ready" });
  await say(page, "The Celtic Cross is on the table.");
  assert.equal(await page.locator(".slot").count(), 10);
});
test("typing sends lk.chat, pings typing, and is disabled outside a session", async t => {
  const page = await pageFor(t);
  assert.equal(await page.locator("#type").isDisabled(), true);
  await start(page); await ready(page);
  await page.locator("#type").fill("");
  await page.locator("#type").pressSequentially("hello");
  await page.locator("#type").press("Enter");
  assert.deepEqual(await page.evaluate(() => window.__vexMock.sent), [{ text: "hello", topic: "lk.chat" }]);
  assert.deepEqual(await page.evaluate(() => window.__vexMock.data[0]), { text: '{"type":"typing"}', topic: "vex-guest" });
  await page.locator("#type").press("Enter");
  assert.equal(await page.evaluate(() => window.__vexMock.sent.length), 1, "empty lines are not sent");
  await event(page, { type: "crisis", text: "Please find your host." });
  assert.equal(await page.locator("#type").isDisabled(), true);
});
test("starting a real session stops the scripted demo", async t => {
  const page = await pageFor(t, { query: "/?demo" });
  await page.waitForFunction(() => document.querySelector("#talk"));
  await start(page); await ready(page);
  await page.clock.runFor(70_000);
  assert.equal(await page.getByRole("button", { name: "Leave" }).isVisible(), true, "demo did not swap in its own controls");
  assert.equal(await page.getByRole("button", { name: "Next guest" }).count(), 0);
});
test("a reading Vex starts before the gate still deals and flips the table", async t => {
  const page = await pageFor(t);
  await start(page); await ready(page);
  await say(page, `So, the question is money. Right. The cards are on the table. ${cards[0].name}, upright. This is the heart of it.`);
  assert.equal(await page.locator(".slot").count(), 5);
  assert.equal(await page.locator(".card.flipped").count(), 1);
  await say(page, `${cards[1].name}, reversed. Oh dear.`);
  assert.equal(await page.locator(".card.flipped").count(), 2);
});
