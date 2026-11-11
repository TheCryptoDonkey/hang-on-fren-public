// Measures what the paused, game-over and victory screens cost per frame, and
// checks that their cached layers show the same picture as a full repaint.
// Needs the DEV build (window.__hof is dev-only):
//
//   npx vite --port 5195 --strictPort &
//   URL=http://localhost:5195/ node tools/perf/static-screens.mjs            # CPU per frame
//   URL=... SHOTS=out/shots node tools/perf/static-screens.mjs              # screenshots + behaviour checks
//   COMPARE=out/shots/cached:out/shots/live node tools/perf/static-screens.mjs   # pixel diff of the cached screens against a full repaint
//
// CPU mode: mobile landscape (844x390, dpr 2, touch). state.camRoll is pinned
// before entering each screen because the camera bank alone moves scene cost by
// 2 to 3x under software raster. A visibilityState override freezes the
// resolution scaler. Both arms run alternating in one process through the same
// dev switch (the parent commit has none and reports a single 'parent' arm).
// CPU time is summed over every browser process per rAF
// frame, so a screen that stops painting reads as the idle floor. Windows in
// which state.phase changed are discarded. Run it on the parent commit too, back to back,
// and trust only comparisons made in the same run of the machine; it ranks costs, it does not predict a phone.
//
// SHOTS mode takes over requestAnimationFrame and steps it with a FIXED
// timestamp, so state.time does not advance between frames. Each screen is shot
// through the cached path and then, at the same instant, through the full
// repaint (window.__hof.setStaticScreens(false)); the two must match. Math.random
// is seeded. It also checks that resuming from pause
// moves the scene on the very next frames, that a resize while paused repaints,
// and that flipping the detail tier or the roll while paused repaints.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.URL || 'http://localhost:5195/';
const SHOTS = process.env.SHOTS || '';
const COMPARE = process.env.COMPARE || '';
const REPS = Number(process.env.REPS || 4);
const ONLY = process.env.ONLY || ''; // comma list of screens, default all
const SETTLE = Number(process.env.SETTLE || 500); // ms to ride a screen before the CPU window
const ROLLS = [0, 0.02];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = v => Math.round(v * 100) / 100;

if (COMPARE) {
  const [da, db] = COMPARE.split(':');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let worst = 0;
  for (const f of fs.readdirSync(da).filter(n => n.endsWith('.png')).sort()) {
    if (!fs.existsSync(path.join(db, f))) { console.log(`${f}: missing in ${db}`); continue; }
    const enc = p => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
    const res = await page.evaluate(async ([a, b]) => {
      const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
      const px = i => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
      const pa = px(ia); const pb = px(ib);
      let n = 0; let max = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]), Math.abs(pa[i + 3] - pb[i + 3]));
        if (d > 0) n += 1;
        if (d > max) max = d;
      }
      return { differing: n, total: pa.length / 4, max };
    }, [enc(path.join(da, f)), enc(path.join(db, f))]);
    if (res.max > worst) worst = res.max;
    console.log(`${f.padEnd(34)} ${res.size ? 'SIZE ' + res.size : `differing px ${res.differing}/${res.total}  max channel delta ${res.max}`}`);
  }
  await browser.close();
  process.exit(0);
}

const browser = await chromium.launch({ headless: true, args: (process.env.CHROMIUM_ARGS || '').split(' ').filter(Boolean) });
const bcdp = await browser.newBrowserCDPSession();
const SHOT_MODE = !!SHOTS;
const context = await browser.newContext(SHOT_MODE
  ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, serviceWorkers: 'block' } // not touch: no 12 ms paint throttle
  : { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
await context.addInitScript(() => {
  // Freezes the adaptive resolution scaler, which only reads visibilityState.
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'hidden', configurable: true });
  window.__fc = 0;
  // The game's rAF callbacks go through a queue that a driver steps once per real
  // frame (__auto), so SHOT mode can switch to hand-fed timestamps without a
  // stray real-time frame sneaking in.
  const realRAF = window.requestAnimationFrame.bind(window);
  window.__auto = true; window.__q = [];
  window.requestAnimationFrame = cb => { window.__q.push(cb); return 0; };
  window.__step = ts => { const q = window.__q; window.__q = []; for (const cb of q) cb(ts); };
  const drive = t => { if (window.__auto) window.__step(t); realRAF(drive); };
  realRAF(drive);
  const tick = () => { window.__fc += 1; realRAF(tick); };
  realRAF(tick);
  window.__keep = false;
  setInterval(() => { const h = window.__hof; if (!h || !window.__keep) return; h.timer.timeLeft = 60; h.player.x = 0; h.state.invuln = 5; h.player.speed = h.player.maxSpeed * 0.6; }, 100);
  window.__seed = a => { Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
});
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
const cpu = async () => (await bcdp.send('SystemInfo.getProcessInfo')).processInfo.reduce((s, p) => s + p.cpuTime, 0);
const phase = () => page.evaluate('window.__hof.state.phase');
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
}, [stage, off]);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__hof && window.__hof.state.phase !== 'loading', null, { timeout: 60000 });
await sleep(600);

// Puts the game on one of the screens with the roll pinned. Real time.
async function enter(screen, roll) {
  await startTour('grand'); await seek(5, 1500); await sleep(1200); // ride a few frames so the world is live
  await page.evaluate(() => { window.__keep = false; });
  if (screen === 'paused') {
    await page.evaluate(r => { const h = window.__hof; h.state.camRoll = r; h.state.paused = true; }, roll);
  } else if (screen === 'victory') {
    await page.evaluate(r => { const h = window.__hof; h.state.camRoll = r; h.showVictory(); h.state.camRoll = r; }, roll);
  } else if (screen === 'gameover') {
    await page.evaluate(() => { window.__hof.timer.timeLeft = 0.02; });
    await page.waitForFunction(() => window.__hof.state.phase === 'gameover', null, { timeout: 5000 });
    await page.evaluate(r => { window.__hof.state.camRoll = r; }, roll);
  } else if (screen === 'gameover-finish') {
    await page.evaluate(r => { const h = window.__hof; h.state.camRoll = r; h.showVictory(); }, roll);
    await page.waitForFunction(() => window.__hof.state.phase === 'gameover', null, { timeout: 20000 });
    await page.evaluate(r => { window.__hof.state.camRoll = r; }, roll);
  }
}
async function leave() {
  await page.evaluate(() => {
    const h = window.__hof; h.state.paused = false; h.state.phase = 'title'; window.__keep = false;
  });
  await sleep(250);
}
async function windowCpu(ms) {
  const p0 = await phase(); const f0 = await page.evaluate('window.__fc'); const c0 = await cpu();
  await sleep(ms);
  const f1 = await page.evaluate('window.__fc'); const c1 = await cpu(); const p1 = await phase();
  return p0 === p1 ? (c1 - c0) * 1000 / Math.max(1, f1 - f0) : null;
}

if (!SHOT_MODE) {
  const SCREENS = ['paused', 'gameover', 'victory', 'gameover-finish'].filter(x => !ONLY || ONLY.split(',').includes(x));
  // The change ships a dev switch for a full repaint, so both arms run in one
  // process, alternating. The parent commit has no switch and gets one arm.
  const hasSwitch = await page.evaluate(() => typeof window.__hof.setStaticScreens === 'function');
  const ARMS = hasSwitch ? ['cached', 'repaint'] : ['parent'];
  const acc = {};
  for (let rep = 0; rep < REPS; rep += 1) {
    for (const roll of ROLLS) for (const screen of rep % 2 ? [...SCREENS].reverse() : SCREENS) for (const arm of rep % 2 ? [...ARMS].reverse() : ARMS) {
      if (hasSwitch) await page.evaluate(on => { window.__hof.setStaticScreens(on); }, arm === 'cached');
      await enter(screen, roll); await sleep(SETTLE);
      const v = await windowCpu(1200);
      await leave();
      if (v !== null) (acc[`${screen} roll ${roll} ${arm}`] ||= []).push(v);
    }
  }
  console.log(`\nCPU ms per rAF frame, median of ${REPS} reps (n kept in brackets), 844x390 dpr2 touch, software raster`);
  for (const [k, v] of Object.entries(acc)) console.log(`${k.padEnd(36)} ${String(r2(median(v))).padStart(7)}  [${v.length}]  ${v.map(r2).join(' ')}`);
  await browser.close();
  process.exit(0);
}

// ---- SHOT mode -------------------------------------------------------------
fs.mkdirSync(SHOTS, { recursive: true });
const png = async (name, sub = '') => {
  const url = await page.evaluate(() => document.getElementById('game').toDataURL('image/png'));
  fs.mkdirSync(path.join(SHOTS, sub), { recursive: true });
  fs.writeFileSync(path.join(SHOTS, sub, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
};
const hash = () => page.evaluate(() => {
  const s = document.getElementById('game').toDataURL('image/jpeg', 0.4); let h = 0;
  for (let i = 0; i < s.length; i += 7) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
});
let ts = 0;
const stepTo = async (frames, dt) => { for (let i = 0; i < frames; i += 1) { ts += dt; await page.evaluate(t => window.__step(t), ts); } };
async function manualEnter(screen, roll) {
  // Fully deterministic from here: seeded Math.random, hand-fed timestamps, no
  // wall-clock input. state.time is zeroed because the title ran in real time.
  await page.evaluate(() => { window.__auto = false; window.__seed(1234); window.__hof.state.time = 0; });
  ts = await page.evaluate(() => performance.now()) + 1000;
  await page.evaluate(() => {
    const h = window.__hof; h.startRun('grand');
    const o = document.getElementById('v4v-overlay'); if (o && !o.hidden) document.getElementById('v4v-later').click();
  });
  await stepTo(20, 16);
  await seek(5, 1500);
  await page.evaluate(() => { const h = window.__hof; h.timer.timeLeft = 60; h.player.x = 0; h.state.invuln = 5; h.player.speed = h.player.maxSpeed * 0.6; });
  await stepTo(60, 16);
  if (screen === 'paused') await page.evaluate(r => { const h = window.__hof; h.state.camRoll = r; h.state.paused = true; }, roll);
  else if (screen === 'victory') await page.evaluate(r => { const h = window.__hof; h.state.camRoll = r; h.showVictory(); }, roll);
  else if (screen === 'gameover') await page.evaluate(r => { const h = window.__hof; h.state.camRoll = r; h.timer.timeLeft = 0.01; }, roll);
  else if (screen === 'gameover-finish') {
    await page.evaluate(r => { const h = window.__hof; h.state.camRoll = r; h.showVictory(); h.state.victoryTime = 8.99; }, roll);
  }
  await stepTo(1, 16); // the one frame that advances the clock
  if (screen === 'gameover-finish') await stepTo(2, 16);
  await stepTo(4, 0); // fixed timestamp: state.time holds
}
async function manualLeave() {
  await page.evaluate(() => { const h = window.__hof; h.state.paused = false; h.state.phase = 'title'; window.__auto = true; });
  await sleep(400);
}
for (const screen of ['paused', 'victory', 'gameover', 'gameover-finish']) for (const roll of ROLLS) {
  await manualEnter(screen, roll);
  const ph = await phase();
  await png(`${screen}-roll${roll}`, 'cached');
  const sw = await page.evaluate(() => typeof window.__hof.setStaticScreens === 'function');
  if (sw) { // the same instant through the full-repaint path
    await page.evaluate(() => { window.__hof.setStaticScreens(false); });
    await stepTo(3, 0);
    await png(`${screen}-roll${roll}`, 'live');
    await page.evaluate(() => { window.__hof.setStaticScreens(true); });
    await stepTo(2, 0);
    // A focus event drops the cached layer; the rebuilt one is shot as well, to
    // tell a first-frame warm-up (lazy ground tiles) from a real cache mismatch.
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
    await stepTo(3, 0);
    await png(`${screen}-roll${roll}`, 'rebuilt');
  }
  console.log(`${screen} roll ${roll}: phase ${ph}, shot saved${sw ? ' (cached + full repaint)' : ''}`);
  await manualLeave();
}

// ---- behaviour checks (real time) ---------------------------------------------
console.log('\nbehaviour checks');
// 1. Resume from pause: a moving scene on the very next frames.
await startTour('grand'); await seek(5, 1500); await sleep(1500);
await page.evaluate(() => { window.__keep = true; window.__hof.state.paused = true; });
await sleep(700);
const still = [];
for (let i = 0; i < 5; i += 1) { still.push(await hash()); await sleep(60); }
await page.evaluate(() => { window.__hof.state.paused = false; });
const live = await page.evaluate(() => new Promise(res => {
  const out = []; const s = document.getElementById('game');
  const h = () => { const u = s.toDataURL('image/jpeg', 0.4); let x = 0; for (let i = 0; i < u.length; i += 7) x = (x * 31 + u.charCodeAt(i)) | 0; return x; };
  let n = 0; const go = () => { out.push({ hash: h(), paused: window.__hof.state.paused }); if (++n < 6) requestAnimationFrame(go); else res(out); };
  requestAnimationFrame(go);
}));
const distinctPaused = new Set(still).size;
const distinctLive = new Set(live.map(l => l.hash)).size;
console.log(`paused: ${distinctPaused} distinct hash(es) over 5 samples (new build expects 1)`);
console.log(`after resume: ${distinctLive} distinct hashes over 6 consecutive frames (expects 6, a moving scene); paused flag ${live.map(l => l.paused).join(',')}`);

// 2. Detail tier and roll while paused repaint.
await page.evaluate(() => { window.__keep = false; window.__hof.state.paused = true; });
await sleep(500);
const base = await hash();
await page.evaluate(() => { window.__hof.setLowDetail(true); }); await sleep(200);
const lowH = await hash();
await page.evaluate(() => { window.__hof.setLowDetail(false); }); await sleep(200);
const backH = await hash();
await page.evaluate(() => { window.__hof.state.camRoll = 0.03; }); await sleep(200);
const rollH = await hash();
// The scene is repainted at a later state.time after each flip, so only repaint is asserted, not equality.
console.log(`paused, detail tier flip full -> low: ${lowH !== base ? 'repainted' : 'NOT repainted'}; low -> full: ${backH !== lowH ? 'repainted' : 'NOT repainted'}`);
console.log(`paused, camRoll 0.03: ${rollH !== backH ? 'repainted' : 'NOT repainted'}`);
await page.evaluate(() => { window.__hof.state.camRoll = 0; }); await sleep(200);

// 3. Resize while paused repaints at the new size with the overlay in place.
const dims0 = await page.evaluate(() => { const c = document.getElementById('game'); return [c.width, c.height]; });
await page.setViewportSize({ width: 600, height: 380 }); await sleep(500);
const dims1 = await page.evaluate(() => { const c = document.getElementById('game'); return [c.width, c.height]; });
await png('paused-resized-600x380');
await page.screenshot({ path: path.join(SHOTS, 'paused-resized-600x380-page.png') });
const filled = await page.evaluate(() => { // the paused scrim leaves no transparent pixel in the centre band
  const c = document.getElementById('game'); const d = c.getContext('2d').getImageData(0, Math.floor(c.height * 0.4), c.width, 4).data;
  let t = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) t += 1; return t;
});
console.log(`resize 844x390 -> 600x380 while paused: buffer ${dims0.join('x')} -> ${dims1.join('x')}, transparent pixels in centre band ${filled} (expects 0)`);
await page.setViewportSize({ width: 844, height: 390 }); await sleep(500);
await png('paused-resized-back');
await page.evaluate(() => { window.__hof.state.paused = false; });
await sleep(300);
console.log(`phase ${await phase()}, paused flag ${await page.evaluate('window.__hof.state.paused')}`);
await browser.close();
