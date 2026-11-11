// Measures what the camera bank costs per frame, and how often a ride is
// actually banked. Needs the DEV build (window.__hof is dev-only):
//
//   npx vite --port 5194 --strictPort &
//   URL=http://localhost:5194/ node tools/perf/roll-cost.mjs
//
// Part 1 freezes a scene (paused) and changes only state.camRoll and the detail
// tier, alternating arms so machine drift cancels. Part 2 rides each tour with
// no steering input and reports the share of frames the renderer banks, which
// is a floor: a player who steers leans, and lean adds roll.
//
// Headless Chromium rasterises in software by default, which is the case the
// potato tier exists for. GPU=1 asks for accelerated canvas instead. The figure
// is CPU time summed over every browser process per rAF frame; it ranks costs,
// it does not predict a phone.
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5194/';
const GPU = process.env.GPU === '1';
const EPS = 0.0005; // keep in step with ROLL_EPS in src/render.ts
const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = v => Math.round(v * 100) / 100;

const browser = await chromium.launch(GPU
  ? { headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] }
  : { headless: true });
const bcdp = await browser.newBrowserCDPSession();
const info = await bcdp.send('SystemInfo.getInfo').catch(() => null);
console.log(`raster: ${info?.gpu?.featureStatus?.['2d_canvas'] ?? 'unknown'}`);
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
await context.addInitScript(() => {
  // Freezes the adaptive resolution scaler, which only reads visibilityState.
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'hidden', configurable: true });
  window.__fc = 0; window.__rolls = null;
  const tick = () => {
    window.__fc += 1;
    if (window.__rolls && window.__hof) window.__rolls.push(window.__hof.state.camRoll);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__keep = false;
  setInterval(() => { const h = window.__hof; if (!h || !window.__keep) return; h.timer.timeLeft = 60; h.player.x = 0; h.state.invuln = 5; h.player.speed = h.player.maxSpeed * 0.6; }, 100);
});
const page = await context.newPage();
const cpu = async () => (await bcdp.send('SystemInfo.getProcessInfo')).processInfo.reduce((s, p) => s + p.cpuTime, 0);
async function win(ms = 900) {
  const f0 = await page.evaluate('window.__fc'); const c0 = await cpu();
  await sleep(ms);
  const f1 = await page.evaluate('window.__fc'); const c1 = await cpu();
  return (c1 - c0) * 1000 / Math.max(1, f1 - f0);
}
async function startTour(tour) {
  await page.evaluate(t => { window.__hof.startRun(t); }, tour);
  await sleep(150);
  await page.evaluate(() => { const o = document.getElementById('v4v-overlay'); if (o && !o.hidden) document.getElementById('v4v-later').click(); });
  await sleep(150);
  await page.evaluate(() => { window.__keep = true; });
}
const seek = (stage, off) => page.evaluate(async ([stage, off]) => {
  const s = await import('/src/stages.ts'); const h = window.__hof; const m = stage * s.STAGE_M + off;
  h.score.distance = m; h.player.z = (m * 100) % h.track.length; h.world.odometerM = m; h.world.traffic.length = 0;
  return s.stageAt(m).name;
}, [stage, off]);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__hof && window.__hof.state.phase !== 'loading', null, { timeout: 60000 });
await sleep(600);

// ---- Part 1: cost of roll on a frozen scene -------------------------------
console.log('\nfrozen scene, CPU ms per frame (median of 4 alternating rounds)');
const ARMS = [['full roll 0', false, 0], ['full roll 0.0003', false, 0.0003], ['full roll 0.02', false, 0.02], ['low roll 0', true, 0], ['low roll 0.02', true, 0.02]];
for (const [tour, stage] of [['grand', 5], ['grand', 9], ['stone', 4]]) {
  await startTour(tour); const name = await seek(stage, 1500); await sleep(2200);
  await page.evaluate(() => { window.__hof.pause(true); });
  const acc = ARMS.map(() => []);
  for (let r = 0; r < 4; r += 1) for (let i = 0; i < ARMS.length; i += 1) {
    await page.evaluate(([low, roll]) => { window.__hof.setLowDetail(low); window.__hof.state.camRoll = roll; }, [ARMS[i][1], ARMS[i][2]]);
    await sleep(220); acc[i].push(await win());
  }
  await page.evaluate(() => { window.__hof.setLowDetail(false); window.__hof.state.camRoll = 0; window.__hof.pause(false); });
  console.log(`${name.padEnd(16)} ` + ARMS.map((a, i) => `${a[0]} ${r2(median(acc[i]))}`).join(' | '));
}

// ---- Part 2: how much of a ride is banked ----------------------------------
console.log(`\nriding with no steering, share of frames with |roll| >= ${EPS} (drawn banked) and with roll != 0 (banked before the snap)`);
for (const tour of ['grand', 'world', 'stone']) {
  await startTour(tour);
  const stages = await page.evaluate(async () => (await import('/src/stages.ts')).levelCount());
  const rolls = [];
  for (let s = 0; s < stages; s += 1) for (const off of [600, 1500, 2400, 3300]) {
    await seek(s, off); await sleep(700); // let the camera settle after the jump
    await page.evaluate(() => { window.__rolls = []; });
    await sleep(1500);
    rolls.push(...await page.evaluate(() => { const r = window.__rolls; window.__rolls = null; return r; }));
  }
  const banked = rolls.filter(v => Math.abs(v) >= EPS).length; const nonzero = rolls.filter(v => v !== 0).length;
  console.log(`${tour.padEnd(6)} frames ${rolls.length}  drawn banked ${Math.round(banked / rolls.length * 100)}%  non-zero ${Math.round(nonzero / rolls.length * 100)}%`);
}
await browser.close();
