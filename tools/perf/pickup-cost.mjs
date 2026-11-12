// Measures the frame cost of ordinary pickups, dense pill trails, and the
// sustained beer / fly-agaric effects. Needs the DEV build (window.__hof):
//
//   npx vite --port 5196 --strictPort &
//   URL=http://localhost:5196/ node tools/perf/pickup-cost.mjs
//
// CPU time is summed over every browser process per rAF frame. It ranks costs
// under headless Chromium's software rasteriser; it does not predict a phone.
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5196/';
const REPS = Number(process.env.REPS || 3);
const DURATION = Number(process.env.DURATION || 2400);
const ONLY = process.env.ONLY || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const percentile = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
const r2 = v => Math.round(v * 100) / 100;

const browser = await chromium.launch({ headless: true });
const bcdp = await browser.newBrowserCDPSession();
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
await context.addInitScript(() => {
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'hidden', configurable: true });
  window.__gaps = [];
  let previous = 0;
  const tick = now => {
    if (previous) window.__gaps.push(now - previous);
    previous = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__keep = false;
  window.__pickupTimer = 0;
  setInterval(() => {
    const h = window.__hof;
    if (!h || !window.__keep) return;
    h.timer.timeLeft = 60;
    h.player.x = 0;
    h.state.invuln = 5;
    h.player.speed = h.player.maxSpeed * 0.6;
  }, 50);
});
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
const cpu = async () => (await bcdp.send('SystemInfo.getProcessInfo')).processInfo.reduce((s, p) => s + p.cpuTime, 0);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__hof && window.__hof.state.phase !== 'loading', null, { timeout: 60000 });
await page.evaluate(async () => {
  const { RIDER_FWD } = await import('/src/road.ts');
  window.__plantPickup = kind => {
    const h = window.__hof;
    h.world.pickups.push({ z: (h.player.z + RIDER_FWD) % h.track.length, offset: h.player.x, bob: 0, taken: false, kind });
  };
});
await sleep(500);

async function start(tour) {
  await page.evaluate(t => {
    clearInterval(window.__pickupTimer);
    window.__keep = false;
    window.__hof.startRun(t);
  }, tour);
  await sleep(150);
  await page.evaluate(() => {
    const overlay = document.getElementById('v4v-overlay');
    if (overlay && !overlay.hidden) document.getElementById('v4v-later').click();
    window.__keep = true;
  });
  await sleep(1000);
}

async function measure(arm) {
  await page.evaluate(arm => {
    const h = window.__hof;
    h.world.pickups.length = 0;
    h.state.sparks.length = 0;
    h.state.popups.length = 0;
    h.state.flash = 0;
    h.state.boost = 0;
    h.state.beerWobble = 0;
    h.state.shroom = 0;
    window.__gaps.length = 0;
    clearInterval(window.__pickupTimer);
    if (arm.kind) {
      window.__plantPickup(arm.kind);
      if (arm.every) window.__pickupTimer = setInterval(() => window.__plantPickup(arm.kind), arm.every);
    }
  }, arm);
  await sleep(100);
  const f0 = await page.evaluate(() => window.__gaps.length);
  const c0 = await cpu();
  await sleep(DURATION);
  const f1 = await page.evaluate(() => window.__gaps.length);
  const c1 = await cpu();
  const sample = await page.evaluate(() => {
    clearInterval(window.__pickupTimer);
    return { gaps: window.__gaps.slice(1), sparks: window.__hof.state.sparks.length };
  });
  const gaps = sample.gaps.slice(Math.max(0, f0 - 1), f1);
  return { cpu: (c1 - c0) * 1000 / Math.max(1, f1 - f0), p95: percentile(gaps, 0.95), sparks: sample.sparks };
}

const ARMS = [
  { name: 'grand baseline', tour: 'grand' },
  { name: 'stone baseline', tour: 'stone' },
  { name: 'petrol / 900ms', tour: 'grand', kind: 'petrol', every: 900 },
  { name: 'pill / 112ms', tour: 'stone', kind: 'pill', every: 112 },
  { name: 'beer effect', tour: 'grand', kind: 'beer' },
  { name: 'shroom effect', tour: 'stone', kind: 'shroom' },
].filter(arm => !ONLY || ONLY.split(',').includes(arm.name));
const results = new Map(ARMS.map(arm => [arm.name, []]));
for (let rep = 0; rep < REPS; rep += 1) {
  const order = rep % 2 ? [...ARMS].reverse() : ARMS;
  for (const arm of order) {
    await start(arm.tour);
    const result = await measure(arm);
    results.get(arm.name).push(result);
    console.log(`${arm.name.padEnd(18)} ${r2(result.cpu)} CPU ms/frame, p95 gap ${r2(result.p95)}ms, live sparks ${result.sparks}`);
  }
}
console.log(`\nmedians, ${REPS} alternating rounds at 844x390 dpr2, software raster`);
for (const arm of ARMS) {
  const values = results.get(arm.name);
  console.log(`${arm.name.padEnd(18)} ${r2(median(values.map(v => v.cpu)))} CPU ms/frame | p95 gap ${r2(median(values.map(v => v.p95)))}ms`);
}
await browser.close();
