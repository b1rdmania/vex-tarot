const { chromium } = require('playwright');
const T = __dirname; require('fs').mkdirSync(T + '/shots', { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: [
    '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.route('**/__q.wav', r => r.fulfill({ path: `${T}/question.wav`, contentType: 'audio/wav' }));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(); const dest = ctx.createMediaStreamDestination();
      const buf = await ctx.decodeAudioData(await (await fetch('/__q.wav')).arrayBuffer());
      window.__playQuestion = () => { ctx.resume(); const s = ctx.createBufferSource(); s.buffer = buf; s.connect(dest); s.start(); };
      return dest.stream;
    };
  });
  await page.goto('http://localhost:8787/');
  await page.screenshot({ path: `${T}/shots/s0-asleep.png` });
  const t0 = Date.now();
  await page.click('#wake');
  await page.waitForFunction(() => document.getElementById('stage').dataset.state === 'idle', null, { timeout: 30000 });
  await page.screenshot({ path: `${T}/shots/s1-idle.png` });
  await page.keyboard.down('Space');
  await page.evaluate(() => window.__playQuestion());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${T}/shots/s2-listening.png` });
  await page.waitForTimeout(3600);
  await page.keyboard.up('Space');
  const seen = new Set(['asleep', 'idle', 'listening']);
  const end = Date.now() + 120000;
  let n = 3;
  while (Date.now() < end) {
    const s = await page.evaluate(() => document.getElementById('stage').dataset.state);
    if (!seen.has(s)) { seen.add(s); await page.waitForTimeout(s === 'reveal' ? 2500 : 900); await page.screenshot({ path: `${T}/shots/s${n++}-${s}.png` }); }
    if (s === 'done' || (s === 'idle' && seen.has('thinking') && Date.now() > end - 115000)) break;
    await page.waitForTimeout(150);
  }
  console.log('STATES', [...seen].join(' > '));
  console.log(await page.evaluate(() => document.getElementById('debug').textContent));
  console.log('HEARD', await page.textContent('#heard'));
  console.log('SUBS', await page.textContent('#subs'));
  await browser.close();
})();
