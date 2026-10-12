// Paid integration test against running kiosk + agent services. Local deterministic
// coverage lives in *.test.mjs and does not need credentials or provider calls.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const scenario = process.env.SCENARIO || "reading";
assert.ok(["reading", "crisis", "mic-denied", "agent-unavailable"].includes(scenario), "Unknown SCENARIO");
const wav = fileURLToPath(new URL(process.env.WAV || "./guest.wav", import.meta.url));
if (["reading", "crisis"].includes(scenario)) assert.ok(existsSync(wav), `Missing microphone fixture: ${wav}`);
const shots = fileURLToPath(new URL("./shots/", import.meta.url));
const LIMIT_S = Number(process.env.LIMIT_S || 360);
const expectedCards = Number(process.env.EXPECT_CARDS || 5);
assert.ok([5, 10].includes(expectedCards));
mkdirSync(shots, { recursive: true });
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  executablePath: process.env.CHROME || (existsSync(chrome) ? chrome : undefined),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(existsSync(wav) ? [`--use-file-for-fake-audio-capture=${wav}%noloop`] : []), "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  if (scenario === "mic-denied") await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Test denial", "NotAllowedError"); };
  });
  await page.goto(process.env.SITE || "http://localhost:8787/");
  await page.getByRole("button", { name: "Talk to Vex" }).click();
  const start = Date.now();
  let turned = 0, completed = false, sawVerdict = false, sawCrisis = false;
  while (Date.now() - start < LIMIT_S * 1000) {
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({
      phase: document.getElementById("stage").dataset.phase,
      flipped: document.querySelectorAll(".card.flipped").length,
      verdict: document.getElementById("verdict").textContent,
      message: document.getElementById("intro").textContent,
      nextVisible: !document.getElementById("again").hidden,
    }));
    if (state.flipped > turned) {
      turned = state.flipped;
      await page.screenshot({ path: `${shots}live-card${turned}.png` });
    }
    if (scenario === "mic-denied" || scenario === "agent-unavailable") {
      if (state.phase === "error") {
        assert.match(state.message, scenario === "mic-denied" ? /microphone access was denied/i : /hasn’t answered/i);
        assert.equal(await page.getByRole("button", { name: "Try again" }).isVisible(), true);
        completed = true;
        break;
      }
      continue;
    }
    assert.notEqual(state.phase, "error", `Session failed: ${state.message}`);
    sawCrisis ||= state.phase === "crisis";
    sawVerdict ||= state.phase === "verdict" && Boolean(state.verdict);
    if (scenario === "crisis" && sawCrisis && state.nextVisible) {
      assert.equal(state.flipped, 0, "crisis clears cards");
      await page.waitForTimeout(1500);
      assert.equal(await page.locator(".slot").count(), 0, "cards stay cleared after crisis");
      await page.getByRole("button", { name: "Next guest" }).click();
      assert.equal(await page.locator("#stage").getAttribute("data-phase"), "idle");
      completed = true;
      break;
    }
    if (scenario === "reading" && state.phase === "idle") {
      assert.equal(turned, expectedCards, "all expected cards must flip");
      assert.equal(sawVerdict, true, "reading must show a verdict before reset");
      assert.equal(sawCrisis, false, "normal fixture must not trigger crisis");
      completed = true;
      break;
    }
  }
  await page.screenshot({ path: `${shots}live-final.png` });
  assert.deepEqual(errors, [], "no uncaught page errors");
  assert.equal(completed, true, `${scenario} did not complete within ${LIMIT_S}s; cards flipped: ${turned}`);
  console.log(`PASS ${scenario}; cards flipped: ${turned}`);
} finally {
  await browser.close();
}
