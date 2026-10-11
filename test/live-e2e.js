// End-to-end run of a live session. Chrome's fake microphone plays
// test/guest.wav (silence, a question, silence, a follow-up, silence).
// Needs `npm run dev` (kiosk) and `cd agent && npm run dev` (worker) running.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const wav = new URL(process.env.WAV || "./guest.wav", import.meta.url).pathname;
const shots = new URL("./shots/", import.meta.url).pathname;
const LIMIT_S = Number(process.env.LIMIT_S || 300);
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}%noloop`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s";
page.on("console", (m) => m.text().startsWith("[vex]") && console.log(at(), m.text().slice(6)));
page.on("pageerror", (e) => console.log(at(), "PAGE ERROR", e.message));

await page.goto(process.env.SITE || "http://localhost:8787/");
await page.keyboard.press("Space");

let lastSubs = "", shot = 0, turned = 0;
while ((Date.now() - t0) / 1000 < LIMIT_S) {
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    subs: document.getElementById("subs").textContent,
    state: document.getElementById("stage").dataset.state,
    flipped: document.querySelectorAll(".card.flipped").length,
  }));
  if (s.subs && s.subs !== lastSubs && !s.subs.startsWith(lastSubs.slice(0, 20))) console.log(at(), "VEX:", lastSubs || "(start)");
  lastSubs = s.subs;
  if (s.flipped > turned) {
    turned = s.flipped;
    await page.screenshot({ path: `${shots}live-${String(++shot).padStart(2, "0")}-card${turned}.png` });
  }
  if (Math.floor((Date.now() - t0) / 20000) > shot) await page.screenshot({ path: `${shots}live-t${String(++shot).padStart(2, "0")}.png` });
  if (s.state === "idle" && (Date.now() - t0) > 10_000) break;
}
console.log(at(), "VEX:", lastSubs);
await page.screenshot({ path: `${shots}live-final.png` });
console.log(at(), "done; cards turned:", turned);
await browser.close();
