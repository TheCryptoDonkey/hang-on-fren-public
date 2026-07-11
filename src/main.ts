// Hang On, Fren — bootstrap, game states, main loop and input. Orchestrates the
// road (road.ts), dynamic world (world.ts), clock economy (timer.ts), scoring
// (scoring.ts), audio (audio.ts), rendering (render.ts) and HUD (hud.ts).

import { buildTrack, decorateTrack, createPlayer, updatePlayer, speedKph, DEFAULT_TUNING, ROAD, RIDER_FWD, type DriveInput } from './road.js';
import { createWorld, resetWorld, updateWorld, addPickup, addMarker, signedForward, draftAt } from './world.js';
import { createTimer, tickTimer, addRoseTime, addCanTime, timerUrgency, DEFAULT_TIMER } from './timer.js';
import { createScore, addDistance, addRose, addFuel, addBonus, addStuntBonus, penalise, addOvertake, addNearMiss, registerCrash, summarise, type RunSummary } from './scoring.js';
import type { PickupKind } from './world.js';
import { SpriteStore, loadSpriteInto, loadSpritesInto, buildSignVariants, buildBillboardVariants, brandPetrol } from './sprites.js';
import { renderScene, drawTitleArt } from './render.js';
import { drawHud, addPopup, updatePopups, type HudState, type Popup } from './hud.js';
import { loadBoard, saveBoard, insertScore, qualifies, topScore, type HighScore } from './highscore.js';
import { unlockAudio, updateEngine, updateRumble, updateScreech, updateTurbo, playSfx, playVoiceClip, preloadVoiceClip, toggleMuted, isMuted } from './audio.js';
import { initMusic, startMusic } from './music.js';
import { paletteAt, stageAt, stageIndexAt, sceneryKitAt, timeOfDayAt, marketPhaseAt, CHECKPOINT_BONUS, LEVELS, STAGE_M, FINISH_M } from './stages.js';
import { appendChar, backspace, cleanName, layout as nameLayout, keyAt as nameKeyAt, drawNameEntry } from './nameentry.js';
import { connectNostr, fetchGlobalBoard, getIdentity, renameGuest, restoreIdentity, submitScore, useGuestMode, type GlobalScore } from './nostr.js';
import { MODES, loadModeIndex, saveModeIndex } from './difficulty.js';
import { clamp } from './util.js';
import { assetUrl } from './asset-url.js';
import { fetchBtcSnapshot, type BtcSnapshot } from './bitcoin.js';

// Voice one-liners lifted from Neon Sentinel for the special treat pickups.
const VOICE: Partial<Record<PickupKind, string>> = {
  rose: assetUrl('sfx/want-rose-fren.m4a'),
  cake: assetUrl('sfx/slice-of-cake.m4a'),
  wholecake: assetUrl('sfx/whole-cake-sir.m4a'),
  meme: assetUrl('sfx/600b-meme.m4a'),
  ath: assetUrl('sfx/600b-all-time-high.m4a'),
  timelock: assetUrl('sfx/600b-time-lock.m4a'),
  fiatnam: assetUrl('sfx/600b-fiat-nam.m4a'),
  fourtwenty: assetUrl('sfx/four-twenty.m4a'),
};
const MUSIC_URL = assetUrl('music/the-descent.m4a');
// Arcade vocal stings (The Crypto Donkey / Dubstep Cult). Short DJ-style shouts
// layered over the action — fired rate-limited so they punctuate rather than
// nag. Missing files simply no-op (playVoiceClip tolerates a 404/decode fail).
const STING = {
  overtake: assetUrl('sfx/sting-wuh.m4a'), // "wuh!" — a stab when you carve past traffic
  checkpoint: assetUrl('sfx/sting-whoo.m4a'), // "whoo hooooo!" — the triumphant checkpoint holler
} as const;
const STING_COOLDOWN = 2.2; // min seconds between stings so they stay a treat
// Clock-scheduled pickups (the 21 / 4.20 / 42 numerology).
const CAN_INTERVAL = 21; // a petrol can every 21s
const ROSE_INTERVAL = 42; // a rose (or a rarer special treat) every 42s
const EMERGENCY_AT = 2.1; // and a rescue can when only 2.1s remain
const SPIN_TIME = 1.1; // seconds of wipeout before remount
const INVULN_TIME = 1.4; // grace after remount
const VOICE_COOLDOWN = 1.3;
const PICKUP_GRACE = 0.3; // brief crash-immunity when grabbing a pickup
const ROSE_BOOST_TIME = 4.5; // seconds of nitro after a rose
const BOOST_SPEED_MUL = 1.4;
// Beer: a cheeky speed-up whose wobbly-vision hangover OUTLASTS the speed —
// the classic risk/reward trade: take the pace, ride the wobble.
const BEER_INTERVAL = 34; // a beer rolls onto the road every 34s
const BEER_SPEED_TIME = 5; // seconds of beer speed-up
const BEER_SPEED_MUL = 1.3;
const BEER_WOBBLE_TIME = 8; // seconds of wobbly vision
// Fly agaric: a few seconds of invincibility inside a full psychedelic trip.
// It gets its own clock slot (like beer) — buried in the 42s treat lottery it
// only had a 9% roll, so whole runs went by without a single one spawning.
const SHROOM_INTERVAL = 63; // a fly agaric sprouts every 63s (3 × 21 numerology)
const SHROOM_TIME = 6;
// Slipstream: tuck in behind a car to charge a draft, then break out of the
// wake for a slingshot — the classic risk-for-speed overtaking move.
const DRAFT_CHARGE_TIME = 1.1; // seconds tucked in for a full charge
const DRAFT_DECAY_TIME = 0.7; // charge bleed once out of the wake
const SLING_TIME_MAX = 1.5; // slingshot duration at full charge
const SLING_SPEED_MUL = 1.22; // top-speed bonus while slingshotting
const SLING_MIN_CHARGE = 0.55; // needs a committed tuck, not a graze
const SLING_COOLDOWN = 2.5; // seconds before the next slingshot can fire
// A gate/finish arch is dropped onto the road this many metres before its
// boundary, so it scrolls in and the rider drives through it as the region
// turns over (or the run is won).
const MARKER_LOOKAHEAD_M = 340;
// End-of-race time bonus: every whole second still on the clock at the finish
// line is worth this many points (classic OutRun goal bonus).
const TIME_BONUS_PER_SEC = 100;

type Phase = 'loading' | 'title' | 'playing' | 'gameover';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const track = buildTrack();
const player = createPlayer();
const BASE_MAX_SPEED = player.maxSpeed;
const world = createWorld();
let timer = createTimer();
let score = createScore();
let board: HighScore[] = loadBoard();
let modeIndex = loadModeIndex();

function cycleMode(step: number): void {
  modeIndex = (modeIndex + step + MODES.length) % MODES.length;
  saveModeIndex(modeIndex);
  playSfx('combo', 0.8, 1 + modeIndex * 0.12);
}

const state = {
  phase: 'loading' as Phase,
  store: null as SpriteStore | null,
  paused: false, // Escape mid-run: clock, physics and audio all hold
  invuln: 0,
  wipeout: 0, // 0 = riding, else 0..1 spin progress
  spinTimer: 0,
  time: 0,
  runTime: 0,
  lastMilestoneKm: 0,
  voiceCooldown: 0,
  stingCooldown: 0,
  tickAccum: 0,
  canAccum: 0,
  roseAccum: 0,
  emergencyArmed: true,
  timeFrozen: 0, // seconds of clock-freeze remaining (timelock / 4:20)
  endedBy: 'time' as 'time' | 'crashes',
  // How the run ended: ran out of time, or reached the finish line (a win).
  outcome: 'time' as 'time' | 'finish',
  finishBonus: 0, // end-of-race time bonus banked at the finish
  finishTimeLeft: 0, // clock reading as the finish was crossed
  summary: null as RunSummary | null,
  popups: [] as Popup[],
  nameValue: '',
  lastStageIndex: 0,
  lastGateSpawned: 0, // highest checkpoint boundary index a gate has been dropped for
  finishSpawned: false, // finish arch dropped yet?
  confettiAccum: 0, // drip-feeds confetti on the victory screen
  qualifies: false,
  // --- gamestr (nostr) layer ---
  runId: '',
  runStartedAt: 0, // wall-clock ms — the claim service sanity-checks the run window
  runFinishedAt: 0,
  submitted: false, // this run's score has been handed to the claim service
  submitStatus: '', // shown on the game-over card
  btc: {} as BtcSnapshot, // block height + price stamped onto saved scores
  titleNotice: { text: '', until: 0 }, // transient identity/publish notice on the title
  globalBoard: [] as GlobalScore[],
  boardFlip: false, // title board alternates local / gamestr
  sparks: [] as Spark[],
  flash: 0, // brief flash on pickup
  boost: 0, // seconds of rose nitro remaining
  beerAccum: 0,
  beerSpeed: 0, // seconds of beer speed-up remaining
  beerWobble: 0, // seconds of beer wobbly-vision remaining (outlasts the speed)
  shroomAccum: 0,
  shroom: 0, // seconds of fly-agaric invincibility/trip remaining
  shield: false, // HODL shield held — absorbs one wipeout
  drafting: 0, // current slipstream intensity 0..1
  draftCharge: 0, // banked draft 0..1 — converts to a slingshot on wake exit
  slingshot: 0, // seconds of slingshot speed remaining
  slingCooldown: 0,
};

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  petal: boolean;
}

function spawnRoseBurst(x: number, y: number, kind: 'petrol' | 'rose' = 'rose'): void {
  const petalColors = kind === 'rose' ? ['#e5344e', '#ff5d78', '#c81e3a', '#ff8aa0'] : ['#e23b2e', '#ff7a3c', '#ffb43c', '#c62828'];
  const sparkColors = kind === 'rose' ? ['#ffd76b', '#ffffff', '#8fe6c4'] : ['#ffd76b', '#ffffff', '#ff9d3c'];
  const petalCount = kind === 'rose' ? 20 : 12;
  for (let i = 0; i < petalCount; i += 1) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.5;
    const sp = 120 + Math.random() * 220;
    state.sparks.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 120,
      life: 0.7 + Math.random() * 0.4,
      ttl: 1.0,
      size: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 12,
      color: petalColors[i % petalColors.length],
      petal: true,
    });
  }
  for (let i = 0; i < 12; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 300;
    state.sparks.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 80,
      life: 0.35 + Math.random() * 0.3,
      ttl: 0.6,
      size: 2 + Math.random() * 3,
      rot: 0,
      vr: 0,
      color: sparkColors[i % sparkColors.length],
      petal: false,
    });
  }
  state.flash = 0.5;
}

/** Rain a burst of celebratory confetti petals from the top of the screen —
 *  fired on the finish line and drip-fed while the victory card is up. */
function spawnConfetti(count = 60): void {
  const colors = ['#ff5d78', '#ffd76b', '#8fe6c4', '#8fd0ff', '#c8ff8f', '#ff9d3c', '#ffffff', '#ff7ac4'];
  for (let i = 0; i < count; i += 1) {
    state.sparks.push({
      x: Math.random() * W,
      y: -20 - Math.random() * H * 0.25,
      vx: (Math.random() - 0.5) * 180,
      vy: 60 + Math.random() * 200,
      life: 1.8 + Math.random() * 1.6,
      ttl: 3.2,
      size: 6 + Math.random() * 9,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 16,
      color: colors[i % colors.length],
      petal: true,
    });
  }
}

function updateSparks(dt: number): void {
  if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.2);
  for (let i = state.sparks.length - 1; i >= 0; i -= 1) {
    const s = state.sparks[i];
    s.life -= dt;
    if (s.life <= 0) {
      state.sparks.splice(i, 1);
      continue;
    }
    s.vy += 520 * dt; // gravity
    s.vx *= 1 - dt * 1.6;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.rot += s.vr * dt;
  }
}

function drawSparks(ctx2: CanvasRenderingContext2D): void {
  if (state.flash > 0) {
    ctx2.fillStyle = `rgba(143, 230, 196, ${state.flash * 0.18})`;
    ctx2.fillRect(0, 0, W, H);
  }
  for (const s of state.sparks) {
    const a = Math.min(1, s.life / s.ttl);
    ctx2.globalAlpha = a;
    ctx2.fillStyle = s.color;
    if (s.petal) {
      ctx2.save();
      ctx2.translate(s.x, s.y);
      ctx2.rotate(s.rot);
      ctx2.beginPath();
      ctx2.ellipse(0, 0, s.size, s.size * 0.55, 0, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.restore();
    } else {
      ctx2.beginPath();
      ctx2.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx2.fill();
    }
  }
  ctx2.globalAlpha = 1;
}

const input: DriveInput = { left: false, right: false, throttle: true, brake: false };
const keys = new Set<string>();
let touchSteer = 0; // -1,0,1
let touchBrake = false;

// ---- sizing ----------------------------------------------------------------

let W = 1280;
let H = 720;
/**
 * Size the DRAWING BUFFER to match the canvas element's actual laid-out size.
 *
 * The element itself always fills the viewport via CSS (`position:fixed;
 * inset:0` in style.css) — we deliberately never set its width/height from JS.
 * The old code drove the element width from `innerWidth` in px, which desynced
 * on desktop/Retina and left the scene drawn into only part of the window with
 * a black bar. Reading `getBoundingClientRect()` takes the size straight from
 * layout, so the buffer can never disagree with what's on screen. Only the
 * (expensive) buffer realloc is gated on an actual change, so this is safe to
 * call every frame.
 */
function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  // Fall back to the viewport if layout hasn't settled yet (rect can read 0
  // for a frame right after attach / an orientation change).
  const cssW = rect.width || window.innerWidth;
  const cssH = rect.height || window.innerHeight;
  const nw = Math.max(1, Math.round(cssW * dpr));
  const nh = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== nw || canvas.height !== nh) {
    canvas.width = nw;
    canvas.height = nh;
  }
  W = nw;
  H = nh;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
window.visualViewport?.addEventListener('resize', resize);
window.visualViewport?.addEventListener('scroll', resize);

const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch-device', isTouch);

type TouchControl = 'left' | 'right' | 'slow';
type ActiveTouchControl = { action: TouchControl; button: HTMLButtonElement };

const mobileControls = document.getElementById('mobile-controls');
const touchControlButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-touch-control]'));
const activeTouchControls = new Map<number, ActiveTouchControl>();

function isTouchControl(value: string | undefined): value is TouchControl {
  return value === 'left' || value === 'right' || value === 'slow';
}

function touchControlButtonFromTarget(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest<HTMLButtonElement>('[data-touch-control]');
  return button && isTouchControl(button.dataset.touchControl) ? button : null;
}

function refreshTouchControlButtons(): void {
  for (const button of touchControlButtons) button.classList.remove('is-active');
  for (const active of activeTouchControls.values()) active.button.classList.add('is-active');
}

function setActiveTouchControl(pointerId: number, button: HTMLButtonElement): void {
  const action = button.dataset.touchControl;
  if (!isTouchControl(action)) return;
  activeTouchControls.set(pointerId, { action, button });
  refreshTouchControlButtons();
}

function releaseActiveTouchControl(pointerId: number): void {
  if (!activeTouchControls.delete(pointerId)) return;
  refreshTouchControlButtons();
}

function clearTouchInput(): void {
  touchSteer = 0;
  touchBrake = false;
  activeTouchControls.clear();
  refreshTouchControlButtons();
}

function controlButtonSteer(): number {
  let left = false;
  let right = false;
  for (const active of activeTouchControls.values()) {
    if (active.action === 'left') left = true;
    if (active.action === 'right') right = true;
  }
  return (right ? 1 : 0) - (left ? 1 : 0);
}

function isControlSlowActive(): boolean {
  for (const active of activeTouchControls.values()) {
    if (active.action === 'slow') return true;
  }
  return false;
}

function mobileHudBottomInset(): number {
  return isTouch && state.phase === 'playing' ? 126 * uiScale() : 0;
}

/** Name-entry keyboard layout, lifted clear of the browser's bottom tap-zone on
 *  touch devices (Safari steals taps on the last ~40px for its own chrome). */
function nameEntryLayout(): ReturnType<typeof nameLayout> {
  return nameLayout(W, H, uiScale(), isTouch ? 44 * uiScale() : 0);
}

function syncDomState(): void {
  document.body.dataset.phase = state.phase;
}

for (const button of touchControlButtons) {
  button.addEventListener('pointerdown', e => {
    if (state.phase !== 'playing') return;
    e.preventDefault();
    unlockAudio();
    setActiveTouchControl(e.pointerId, button);
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail if the pointer has already ended; the window fallback still releases it.
    }
  });
  button.addEventListener('pointermove', e => {
    if (!activeTouchControls.has(e.pointerId)) return;
    e.preventDefault();
    const nextButton = touchControlButtonFromTarget(document.elementFromPoint(e.clientX, e.clientY));
    if (nextButton) setActiveTouchControl(e.pointerId, nextButton);
  });
  button.addEventListener('pointerup', e => {
    e.preventDefault();
    releaseActiveTouchControl(e.pointerId);
  });
  button.addEventListener('pointercancel', e => {
    releaseActiveTouchControl(e.pointerId);
  });
  button.addEventListener('lostpointercapture', e => {
    releaseActiveTouchControl(e.pointerId);
  });
}
window.addEventListener('pointerup', e => releaseActiveTouchControl(e.pointerId));
window.addEventListener('pointercancel', e => releaseActiveTouchControl(e.pointerId));
// Losing focus (Cmd+Tab, a phone call, a system dialog) can eat keyup / touch
// end events — drop EVERY held input so steering can never latch on, and hold
// the run so nobody rides blind into the clock while they're away.
function clearAllInput(): void {
  keys.clear();
  clearTouchInput();
}
function onFocusLost(): void {
  clearAllInput();
  if (state.phase === 'playing') state.paused = true;
}
window.addEventListener('blur', onFocusLost);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onFocusLost();
});

// Diagonal-based UI scale so text is legible in both portrait and landscape.
function uiScale(): number {
  return Math.hypot(W, H) / 1468;
}

/** Haptic pulse on touch devices; silently no-ops where unsupported. */
function vibrate(pattern: number | number[]): void {
  if (!isTouch || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* blocked by browser policy — purely a nicety */
  }
}

// ---- input -----------------------------------------------------------------

function onKeyDown(e: KeyboardEvent): void {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  keys.add(k);

  // Escape pauses/resumes a run; Q from the pause screen abandons it.
  if (state.phase === 'playing') {
    if (k === 'escape') {
      state.paused = !state.paused;
      playSfx('combo', 0.6, state.paused ? 0.8 : 1.15);
      return;
    }
    if (state.paused && k === 'q') {
      quitRun();
      return;
    }
  }

  if (state.phase === 'title') {
    if (k === 'enter' || k === ' ') startRun();
    else if (k === 'arrowleft' || k === 'a') { unlockAudio(); cycleMode(-1); }
    else if (k === 'arrowright' || k === 'd') { unlockAudio(); cycleMode(1); }
    else if (k === 'n') { unlockAudio(); toggleIdentity(); }
  } else if (state.phase === 'gameover') handleGameOverKey(e.key);
  // While typing a name, M is a letter — don't hijack it for mute.
  const typingName = state.phase === 'gameover' && state.qualifies;
  if (!typingName) {
    if (k === 'm') toggleMuted();
  }
}
function onKeyUp(e: KeyboardEvent): void {
  const k = e.key.toLowerCase();
  // macOS swallows the keyup of any key released while ⌘ is held, so that key
  // would stay "down" forever and the bike would grind into the verge. When
  // the Cmd key itself comes up, drop everything held.
  if (k === 'meta') keys.clear();
  else keys.delete(k);
}
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

/** Map a viewport pointer position into canvas BUFFER coordinates (dpr-aware). */
function canvasPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / (rect.width || 1);
  const sy = canvas.height / (rect.height || 1);
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

// Vertical bands of the title-screen difficulty selector and the identity
// (guest/nostr) row (fractions of H).
const MODE_ROW_Y = 0.57;
const IDENTITY_ROW_Y = 0.775;

function pointerAction(clientX: number, clientY: number): void {
  // Tap advances title; during play it is handled by steering zones.
  if (state.phase === 'title') {
    // Tapping the difficulty row picks that mode; the identity row toggles
    // guest/nostr; anywhere else starts the run.
    const { x, y } = canvasPoint(clientX, clientY);
    const u = uiScale();
    const rowMid = H * MODE_ROW_Y;
    if (y > rowMid - 36 * u && y < rowMid + 20 * u) {
      const picked = clamp(Math.floor((x / W) * MODES.length), 0, MODES.length - 1);
      if (picked !== modeIndex) {
        modeIndex = picked;
        saveModeIndex(modeIndex);
        playSfx('combo', 0.8, 1 + modeIndex * 0.12);
      }
      return;
    }
    const identMid = H * IDENTITY_ROW_Y;
    if (y > identMid - 18 * u && y < identMid + 12 * u) {
      toggleIdentity();
      return;
    }
    startRun();
    return;
  }
  if (state.phase !== 'gameover' || !state.summary) return;
  // Not a new best — any tap continues.
  if (!state.qualifies) {
    confirmGameOver();
    return;
  }
  // New best: hit-test the on-screen keyboard so touch users can type a name.
  const { x, y } = canvasPoint(clientX, clientY);
  const key = nameKeyAt(nameEntryLayout().rects, x, y);
  if (!key) return;
  if (key.act === 'char' && key.ch) state.nameValue = appendChar(state.nameValue, key.ch);
  else if (key.act === 'space') state.nameValue = appendChar(state.nameValue, ' ');
  else if (key.act === 'del') state.nameValue = backspace(state.nameValue);
  else if (key.act === 'ok') confirmGameOver();
}
function updateTouchFromEvent(touches: TouchList): void {
  touchSteer = 0;
  touchBrake = false;
  for (let i = 0; i < touches.length; i += 1) {
    const t = touches[i];
    if (mobileControls?.contains(t.target as Node | null)) continue;
    const x = (t.clientX / window.innerWidth);
    const y = (t.clientY / window.innerHeight);
    if (y < 0.35) touchBrake = true;
    else if (x < 0.5) touchSteer = -1;
    else touchSteer = 1;
  }
}
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  unlockAudio();
  if (state.phase === 'playing') {
    // A paused game must never trap a touch player — any tap resumes.
    if (state.paused) state.paused = false;
    else updateTouchFromEvent(e.touches);
  } else pointerAction(e.touches[0]?.clientX ?? 0, e.touches[0]?.clientY ?? 0);
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (state.phase === 'playing') updateTouchFromEvent(e.touches);
}, { passive: false });
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (state.phase === 'playing') updateTouchFromEvent(e.touches);
}, { passive: false });
// A system gesture (edge swipe, notification shade) CANCELS the touch rather
// than ending it — without this the last steer direction stays latched and the
// bike grinds into the barrier until the player taps again.
canvas.addEventListener('touchcancel', e => {
  if (state.phase === 'playing') updateTouchFromEvent(e.touches);
  else clearTouchInput();
});
canvas.addEventListener('mousedown', e => {
  unlockAudio();
  if (state.phase !== 'playing') pointerAction(e.clientX, e.clientY);
  else if (state.paused) state.paused = false;
});

// ---- gamepad ----------------------------------------------------------------
// Polled alongside keys/touch: left stick or d-pad steers, bottom/left face
// button or either trigger brakes, and face/Start buttons advance the menus
// (edge-detected so a held button doesn't machine-gun through screens).

const PAD_DEADZONE = 0.3;
let padPrevMenu = false;
let padPrevLeft = false;
let padPrevRight = false;

interface PadState {
  steer: number; // -1..1
  brake: boolean;
  menu: boolean; // any "advance" button held
  left: boolean;
  right: boolean;
}

function readGamepad(): PadState {
  const out: PadState = { steer: 0, brake: false, menu: false, left: false, right: false };
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const x = pad.axes[0] ?? 0;
    if (Math.abs(x) > PAD_DEADZONE) {
      out.steer += x;
      if (x < 0) out.left = true;
      else out.right = true;
    }
    if (pad.buttons[14]?.pressed) { out.steer -= 1; out.left = true; }
    if (pad.buttons[15]?.pressed) { out.steer += 1; out.right = true; }
    if (pad.buttons[0]?.pressed || pad.buttons[2]?.pressed || pad.buttons[6]?.pressed || pad.buttons[7]?.pressed) out.brake = true;
    for (const bi of [0, 1, 2, 3, 9]) if (pad.buttons[bi]?.pressed) out.menu = true;
  }
  out.steer = clamp(out.steer, -1, 1);
  return out;
}

/** Menu navigation from a pad (title / game-over), edge-triggered. */
function pollPadMenu(): void {
  const pad = readGamepad();
  const menuEdge = pad.menu && !padPrevMenu;
  const leftEdge = pad.left && !padPrevLeft;
  const rightEdge = pad.right && !padPrevRight;
  padPrevMenu = pad.menu;
  padPrevLeft = pad.left;
  padPrevRight = pad.right;
  if (state.phase === 'title') {
    if (leftEdge) cycleMode(-1);
    if (rightEdge) cycleMode(1);
    if (menuEdge) startRun();
  } else if (state.phase === 'gameover' && menuEdge && !state.qualifies) {
    // While typing a high-score name the pad can't confirm — that stays on
    // Enter / the on-screen OK so a held button can't wipe the entry.
    confirmGameOver();
  }
}

function readInput(): void {
  const buttonSteer = controlButtonSteer();
  const pad = readGamepad();
  const steer = clamp(touchSteer + buttonSteer + pad.steer, -1, 1);
  input.left = keys.has('arrowleft') || keys.has('a') || steer < 0;
  input.right = keys.has('arrowright') || keys.has('d') || steer > 0;
  input.brake = keys.has('arrowdown') || keys.has('s') || keys.has(' ') || touchBrake || isControlSlowActive() || pad.brake;
  input.throttle = !input.brake; // auto-accelerate; brake overrides
}

// ---- run lifecycle ---------------------------------------------------------

function startRun(): void {
  unlockAudio();
  startMusic();
  for (const url of Object.values(VOICE)) if (url) preloadVoiceClip(url);
  for (const url of Object.values(STING)) preloadVoiceClip(url);
  playSfx('rev', 1);
  player.z = 0;
  player.x = 0;
  player.speed = player.maxSpeed * 0.35;
  player.lean = 0;
  const mode = MODES[modeIndex];
  timer = createTimer(DEFAULT_TIMER);
  score = createScore(mode.scoreMul);
  world.mods.density = mode.density;
  world.mods.speed = mode.speed;
  resetWorld(world, player, track);
  state.invuln = INVULN_TIME;
  state.wipeout = 0;
  state.spinTimer = 0;
  state.runTime = 0;
  state.lastMilestoneKm = 0;
  state.lastStageIndex = 0;
  state.lastGateSpawned = 0;
  state.finishSpawned = false;
  state.outcome = 'time';
  state.finishBonus = 0;
  state.finishTimeLeft = 0;
  state.confettiAccum = 0;
  state.canAccum = 0;
  state.roseAccum = 0;
  state.emergencyArmed = true;
  state.timeFrozen = 0;
  state.voiceCooldown = 0;
  state.stingCooldown = 0;
  state.popups = [];
  state.sparks = [];
  state.flash = 0;
  state.boost = 0;
  state.beerAccum = 0;
  state.beerSpeed = 0;
  state.beerWobble = 0;
  state.shroomAccum = 0;
  state.shroom = 0;
  state.shield = false;
  state.drafting = 0;
  state.draftCharge = 0;
  state.slingshot = 0;
  state.slingCooldown = 0;
  player.maxSpeed = BASE_MAX_SPEED;
  state.runId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  state.runStartedAt = Date.now();
  state.runFinishedAt = 0;
  state.submitted = false;
  state.submitStatus = '';
  state.paused = false;
  state.phase = 'playing';
}

// ---- gamestr submission ------------------------------------------------------

function setTitleNotice(text: string, seconds = 4): void {
  state.titleNotice = { text, until: state.time + seconds };
}

/**
 * Hand the finished run to the gamestr claim service exactly once (it signs
 * the board event with the GAME key after plausibility checks). For a
 * board-qualifying run this is deferred to confirmGameOver so the typed
 * callsign rides along on the event (and renames the guest profile).
 */
function submitRunScore(playerName?: string): void {
  if (state.submitted || !state.summary) return;
  state.submitted = true;
  const identity = getIdentity();
  const name = playerName ?? identity.name;
  if (identity.mode === 'guest' && playerName) renameGuest(playerName);
  state.submitStatus = 'CLAIMING ON GAMESTR…';
  const summary = state.summary;
  // Wait for the chain snapshot (bounded by its own fetch timeout) so the
  // claim carries the block height + price the run finished at.
  void (btcFetch ?? Promise.resolve<BtcSnapshot>({}))
    .then(btc => submitScore(summary, {
      runId: state.runId,
      playerName: name,
      level: stageIndexAt(summary.distanceM) + 1,
      startedAt: state.runStartedAt,
      finishedAt: state.runFinishedAt || Date.now(),
      endedBy: state.outcome,
      btcBlock: btc.block,
      btcUsdCents: btc.usdCents,
    }))
    .then(result => {
      state.submitStatus = result === null
        ? 'SCORE KEPT LOCAL — NO CLAIM SERVICE'
        : result.status === 'published'
          ? `SCORE ON GAMESTR ✓  ${result.ok}/${result.total} relays`
          : 'SCORE ACCEPTED — PUBLISHING SOON';
      setTitleNotice(state.submitStatus);
      if (result !== null) {
        void fetchGlobalBoard(5, true)
          .then(board => { state.globalBoard = board; })
          .catch(() => undefined);
      }
    })
    .catch(() => {
      state.submitStatus = 'SCORE KEPT LOCAL';
      setTitleNotice(state.submitStatus);
    });
}

/** Toggle guest ↔ nostr identity from the title screen (N or tap). The nostr
 *  path opens the signet-login picker (extension / QR / bunker / nsec /
 *  Amber), so it works on phones with no extension. */
function toggleIdentity(): void {
  if (getIdentity().mode === 'guest') {
    setTitleNotice('SIGN IN WITH NOSTR — PICK A METHOD…', 180);
    void connectNostr().then(pk => {
      setTitleNotice(pk ? 'NOSTR CONNECTED — SCORES CLAIM AS YOU' : 'SIGN-IN CANCELLED — STAYING GUEST');
    });
  } else {
    useGuestMode();
    setTitleNotice('GUEST MODE — LOCAL KEY CLAIMS YOUR SCORES');
  }
  playSfx('combo', 0.7, 1.2);
}

/** Abandon the run from the pause screen — no score entry, straight home. */
function quitRun(): void {
  state.paused = false;
  state.phase = 'title';
  playSfx('milestone', 0.6, 0.8);
}

/**
 * The 42s "treat" slot: usually a rose, but sometimes a Neon-Sentinel-flavoured
 * special. Weighted so roses stay the headline and the rare ones feel rare.
 */
function pickTreatKind(): PickupKind {
  const r = Math.random();
  if (r < 0.33) return 'rose';
  if (r < 0.46) return 'cake';
  if (r < 0.57) return 'meme';
  if (r < 0.67) return 'shield';
  if (r < 0.75) return 'wholecake';
  if (r < 0.83) return 'ath';
  if (r < 0.90) return 'timelock';
  if (r < 0.96) return 'fiatnam';
  return 'fourtwenty';
}

/** Play a pickup voice one-liner, rate-limited so they never talk over each other. */
function playVoice(kind: PickupKind): void {
  const url = VOICE[kind];
  if (!url || state.voiceCooldown > 0) return;
  playVoiceClip(url, 1);
  state.voiceCooldown = VOICE_COOLDOWN;
}

/** Fire an arcade vocal sting, rate-limited so it stays a treat, not a nag. */
function playSting(url: string, gain = 1): void {
  if (state.stingCooldown > 0) return;
  playVoiceClip(url, gain);
  state.stingCooldown = STING_COOLDOWN;
}

// A wipeout is now purely a momentary spin-out: you lose your momentum and your
// pickup streak, which costs you time on the clock — but it NO LONGER ends the
// run. The clock is the only thing that can finish you (out of time), so runs
// end when the timer expires, never on a tally of crashes.
function startWipeout(): void {
  if (state.wipeout > 0) return;
  state.wipeout = 0.0001;
  state.spinTimer = SPIN_TIME;
  state.drafting = 0;
  state.draftCharge = 0;
  state.slingshot = 0;
  registerCrash(score);
  playSfx('crash', 1.1);
  playSfx('wipeout', 0.9);
  vibrate([60, 40, 90]);
  addPopup(state.popups, 'WIPEOUT!', W / 2, H * 0.5, '#ff5d78', 1.3);
}

// The chain snapshot fetch kicked off when a run ends — submitRunScore awaits
// it so the claim carries the block/price; the resolved values also land in
// state.btc for the local board save.
let btcFetch: Promise<BtcSnapshot> | null = null;

function snapshotBitcoin(): void {
  state.btc = {};
  btcFetch = fetchBtcSnapshot()
    .then(snap => {
      state.btc = snap;
      return snap;
    })
    .catch(() => ({}));
}

function endRun(endedBy: 'time' | 'crashes'): void {
  state.endedBy = endedBy;
  state.outcome = 'time';
  state.runFinishedAt = Date.now();
  snapshotBitcoin();
  state.summary = summarise(score, state.runTime, endedBy);
  state.qualifies = qualifies(board, state.summary.score);
  state.nameValue = ''; // blank — the rider types their own name
  state.phase = 'gameover';
  // A board run submits on name confirm (so the callsign rides along);
  // anything else publishes straight away under the stored identity.
  if (!state.qualifies) submitRunScore();
  playSfx('milestone', 0.8);
}

// Reaching the finish line WINS the run: bank a time bonus for every second left
// on the clock, throw confetti and a fanfare, then show a celebratory game-over
// card (OutRun-style goal) before the normal high-score flow.
function winRun(): void {
  state.endedBy = 'time';
  state.outcome = 'finish';
  snapshotBitcoin();
  state.finishTimeLeft = timer.timeLeft;
  const bonus = Math.ceil(Math.max(0, timer.timeLeft)) * TIME_BONUS_PER_SEC;
  state.finishBonus = bonus;
  score.score += bonus; // flat goal bonus (no streak multiplier)
  state.runFinishedAt = Date.now();
  state.summary = summarise(score, state.runTime, 'time');
  state.qualifies = qualifies(board, state.summary.score);
  state.nameValue = '';
  state.phase = 'gameover';
  state.confettiAccum = 0;
  if (!state.qualifies) submitRunScore();
  playSfx('milestone', 1);
  playSfx('combo', 0.9);
  playSting(STING.checkpoint, 1);
  spawnConfetti(90);
}

function confirmGameOver(): void {
  if (state.phase !== 'gameover' || !state.summary) return;
  if (state.qualifies) {
    const name = cleanName(state.nameValue);
    board = insertScore(board, {
      name,
      score: state.summary.score,
      distanceM: state.summary.distanceM,
      roses: state.summary.roses,
      btcBlock: state.btc.block,
      btcUsdCents: state.btc.usdCents,
    });
    saveBoard(board);
    state.qualifies = false;
    submitRunScore(name);
  }
  state.phase = 'title';
}

function handleGameOverKey(key: string): void {
  if (!state.qualifies) {
    if (key === 'Enter' || key === ' ') confirmGameOver();
    return;
  }
  if (key === 'Enter') confirmGameOver();
  else if (key === 'Backspace') state.nameValue = backspace(state.nameValue);
  else if (key.length === 1) state.nameValue = appendChar(state.nameValue, key);
}

// ---- update ----------------------------------------------------------------

let devPaused = false;

function update(dt: number): void {
  state.time += dt;
  updatePopups(state.popups, dt);
  updateSparks(dt);
  if (devPaused) return; // dev-only: freeze physics so art can be inspected
  if (state.phase !== 'playing') {
    pollPadMenu();
    clearTouchInput();
    updateEngine({ playing: false, speed: 0, throttle: 0 });
    updateRumble({ active: false, intensity: 0, speed: 0 });
    updateScreech({ active: false, load: 0, speed: 0 });
    updateTurbo({ active: false, intensity: 0 });
    // Keep the confetti falling while the victory card is up.
    if (state.phase === 'gameover' && state.outcome === 'finish') {
      state.confettiAccum += dt;
      if (state.confettiAccum >= 0.5) {
        state.confettiAccum -= 0.5;
        spawnConfetti(16);
      }
    }
    return;
  }

  // Paused: hold the clock, physics and world exactly where they are; just
  // keep the audio chains silent until Escape (or a tap) resumes.
  if (state.paused) {
    updateEngine({ playing: false, speed: 0, throttle: 0 });
    updateRumble({ active: false, intensity: 0, speed: 0 });
    updateScreech({ active: false, load: 0, speed: 0 });
    updateTurbo({ active: false, intensity: 0 });
    return;
  }

  state.runTime += dt;
  readInput();

  // Rose nitro and slipstream slingshot both raise top speed (they stack for a
  // rare, glorious double-rush).
  if (state.boost > 0) state.boost = Math.max(0, state.boost - dt);
  if (state.slingshot > 0) state.slingshot = Math.max(0, state.slingshot - dt);
  if (state.slingCooldown > 0) state.slingCooldown -= dt;
  if (state.beerSpeed > 0) state.beerSpeed = Math.max(0, state.beerSpeed - dt);
  if (state.beerWobble > 0) state.beerWobble = Math.max(0, state.beerWobble - dt);
  if (state.shroom > 0) state.shroom = Math.max(0, state.shroom - dt);
  player.maxSpeed = BASE_MAX_SPEED
    * (state.boost > 0 ? BOOST_SPEED_MUL : 1)
    * (state.slingshot > 0 ? SLING_SPEED_MUL : 1)
    * (state.beerSpeed > 0 ? BEER_SPEED_MUL : 1);

  if (state.wipeout > 0) {
    // Spin-out: kill throttle, bleed speed, run the tumble animation.
    input.left = input.right = false;
    input.throttle = false;
    input.brake = true;
    state.spinTimer -= dt;
    state.wipeout = clamp(1 - state.spinTimer / SPIN_TIME, 0, 1);
    if (state.spinTimer <= 0) {
      state.wipeout = 0;
      state.invuln = INVULN_TIME;
      // Respawn back on the tarmac so you don't instantly re-hit whatever you
      // wiped out on — the old off-road death-spiral that felt like the controls
      // had broken just before you died.
      player.x = clamp(player.x, -0.85, 0.85);
      player.vx = 0;
    }
  }
  if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - dt);

  const prevZ = player.z;
  updatePlayer(player, track, input, dt);
  const moved = ((player.z - prevZ + track.length) % track.length);
  addDistance(score, moved / 100, speedKph(player));

  // Reaching the finish line completes the game — hand off to the victory flow.
  if (score.distance >= FINISH_M) {
    winRun();
    return;
  }

  // Turbo (rose boost) NO LONGER makes you a ghost through traffic — that made
  // collisions feel broken. It keeps its speed/time/score reward; you still have
  // to dodge. Only the post-wipeout grace, pickup grace and the fly-agaric trip
  // suppress crashes.
  const shielded = state.invuln > 0 || state.wipeout > 0 || state.shroom > 0;
  const events = updateWorld(world, player, track, dt, shielded);
  for (const ev of events) {
    if (ev.type === 'pickup') {
      // Brief grace so grabbing a pickup near traffic never feels like a crash.
      state.invuln = Math.max(state.invuln, PICKUP_GRACE);
      vibrate(ev.kind === 'petrol' ? 12 : [15, 25, 20]);
      const bx = W / 2 + clamp(ev.offset, -1, 1) * W * 0.13;
      const by = H * 0.72;
      const topUp = DEFAULT_TIMER.roseBonus;
      switch (ev.kind) {
        case 'rose':
          // Rose = rare NITRO: time + speed boost + big score + voice.
          addRoseTime(timer, DEFAULT_TIMER);
          addRoseTime(timer, DEFAULT_TIMER);
          addRose(score);
          state.boost = ROSE_BOOST_TIME;
          playSfx('milestone', 0.9);
          playSfx('overtake', 0.7);
          playVoice('rose');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'TURBO!', bx, by - H * 0.06, '#ff5d78', 1.5);
          break;
        case 'cake':
          addRoseTime(timer, DEFAULT_TIMER);
          addBonus(score, 250);
          playSfx('rose', 1, 1.1);
          playVoice('cake');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, `CAKE!  +${topUp}s`, bx, by - H * 0.06, '#ffd1e0', 1.2);
          break;
        case 'wholecake':
          addRoseTime(timer, DEFAULT_TIMER);
          addRoseTime(timer, DEFAULT_TIMER);
          addBonus(score, 600);
          playSfx('milestone', 0.85);
          playVoice('wholecake');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'WHOLE CAKE, SIR!', bx, by - H * 0.06, '#ffd1e0', 1.5);
          break;
        case 'meme':
          addBonus(score, 300);
          playSfx('overtake', 0.8);
          playVoice('meme');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'MEME!', bx, by - H * 0.06, '#8fe6c4', 1.2);
          break;
        case 'ath':
          addBonus(score, 1000);
          state.flash = 0.7;
          playSfx('milestone', 1);
          playSfx('combo', 0.9);
          playVoice('ath');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'ALL-TIME HIGH!', W / 2, H * 0.44, '#3fff7a', 1.8);
          break;
        case 'timelock':
          state.timeFrozen = Math.max(state.timeFrozen, 10);
          addBonus(score, 150);
          playSfx('milestone', 0.7);
          playVoice('timelock');
          spawnRoseBurst(bx, by, 'petrol');
          addPopup(state.popups, 'TIME LOCK', W / 2, H * 0.5, '#8fd0ff', 1.6);
          break;
        case 'fourtwenty':
          state.timeFrozen = Math.max(state.timeFrozen, 21);
          addBonus(score, 420);
          playSfx('milestone', 0.8);
          playVoice('fourtwenty');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, '4:20 — CLOCK PAUSED 21s', W / 2, H * 0.5, '#c8ff8f', 1.9);
          break;
        case 'beer':
          // Beer: faster for a bit — but the world goes wobbly for longer.
          addBonus(score, 150);
          state.beerSpeed = BEER_SPEED_TIME;
          state.beerWobble = BEER_WOBBLE_TIME;
          playSfx('rose', 1, 0.85);
          playSfx('combo', 0.7, 0.8);
          spawnRoseBurst(bx, by, 'petrol');
          addPopup(state.popups, 'BEER!', bx, by - H * 0.06, '#f5b53c', 1.4);
          addPopup(state.popups, 'FASTER… WOBBLIER', W / 2, H * 0.5, '#ffe9a8', 1.2);
          break;
        case 'shroom':
          // Fly agaric: untouchable for a few seconds — inside a full-on trip.
          addBonus(score, 300);
          state.shroom = SHROOM_TIME;
          state.flash = 0.7;
          playSfx('milestone', 0.9);
          playSfx('combo', 0.9, 1.5);
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'FLY AGARIC!', bx, by - H * 0.06, '#e5342e', 1.5);
          addPopup(state.popups, `INVINCIBLE ${SHROOM_TIME}s`, W / 2, H * 0.5, '#8fe6c4', 1.6);
          break;
        case 'shield':
          // HODL shield: hold through the next wipeout unscathed.
          state.shield = true;
          addBonus(score, 300);
          playSfx('milestone', 0.8);
          playSfx('combo', 0.9, 1.3);
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'HODL SHIELD!', bx, by - H * 0.06, '#8fd0ff', 1.5);
          break;
        case 'fiatnam':
          penalise(score, 200);
          timer.timeLeft = Math.max(0, timer.timeLeft - 3);
          playSfx('crash', 0.5);
          playVoice('fiatnam');
          addPopup(state.popups, 'FIAT!  -3s', bx, by - H * 0.06, '#ff7a7a', 1.3);
          break;
        case 'petrol':
        default:
          // Petrol can = the everyday clock top-up (+21s — the 21 numerology).
          addCanTime(timer, DEFAULT_TIMER);
          addFuel(score);
          playSfx('rose', 1, 1 + Math.min(score.roseStreak, 6) * 0.05);
          if (score.roseStreak > 1) playSfx('combo', 0.8, 1 + score.roseStreak * 0.06);
          spawnRoseBurst(bx, by, 'petrol');
          addPopup(state.popups, `+${DEFAULT_TIMER.canBonus}s`, bx, by - H * 0.06, '#ffd76b', 1.1);
          break;
      }
    } else if (ev.type === 'crash') {
      if (state.shield) {
        // The HODL shield eats the hit: no spin-out, no streak loss — just a
        // moment of grace to get clear of whatever you clipped.
        state.shield = false;
        state.invuln = Math.max(state.invuln, 1.2);
        state.flash = 0.6;
        playSfx('milestone', 0.9);
        playSfx('nearMiss', 0.8);
        vibrate([25, 30, 25]);
        addPopup(state.popups, 'SHIELD SAVED YOU!', W / 2, H * 0.5, '#8fd0ff', 1.5);
      } else {
        startWipeout();
      }
    } else if (ev.type === 'overtake') {
      addOvertake(score);
      playSfx('overtake', 0.8);
      // A "wuh!" shout when you're carving through the pack (streak of 2+).
      if (score.overtakes >= 2) playSting(STING.overtake, 0.9);
    } else if (ev.type === 'nearMiss') {
      addNearMiss(score);
      playSfx('nearMiss', 0.7);
      addPopup(state.popups, 'NEAR MISS', W * 0.5, H * 0.62, '#ffd76b', 0.9);
    }
  }
  if (state.voiceCooldown > 0) state.voiceCooldown -= dt;
  if (state.stingCooldown > 0) state.stingCooldown -= dt;

  // Slipstream: tucked in a car's wake at speed, the draft charges; breaking
  // out of the wake with a committed charge fires the SLINGSHOT. Skill move —
  // you must ride right up behind traffic (where a mistake is a crash) to earn
  // the burst that carves past it.
  const draftNow = state.wipeout === 0 && player.speed > player.maxSpeed * 0.6
    ? draftAt(world, player, track)
    : 0;
  if (draftNow > 0) {
    state.draftCharge = clamp(state.draftCharge + dt / DRAFT_CHARGE_TIME, 0, 1);
  } else {
    if (state.drafting > 0 && state.draftCharge >= SLING_MIN_CHARGE && state.slingCooldown <= 0 && state.wipeout === 0) {
      state.slingshot = SLING_TIME_MAX * state.draftCharge;
      state.slingCooldown = SLING_COOLDOWN;
      addStuntBonus(score, Math.round(200 * state.draftCharge));
      playSfx('overtake', 1, 1.3);
      playSfx('nearMiss', 0.5, 0.8);
      vibrate(20);
      addPopup(state.popups, 'SLINGSHOT!', W / 2, H * 0.58, '#8fd0ff', 1.2);
      state.draftCharge = 0;
    }
    state.draftCharge = Math.max(0, state.draftCharge - dt / DRAFT_DECAY_TIME);
  }
  state.drafting = draftNow;

  // Clock-scheduled pickups: a can every 21s, a rose every 42s, a beer every
  // 34s, a fly agaric every 63s, and — the safety net — a definitely-reachable
  // rescue can dropped in your lane when only 2.1s remain, re-armed once you've
  // topped back up. So there is ALWAYS a way out, but you have to grab it:
  // miss the rescue can and you're done.
  state.canAccum += dt;
  if (state.canAccum >= CAN_INTERVAL) {
    state.canAccum -= CAN_INTERVAL;
    addPickup(world, player, track, 'petrol');
  }
  state.roseAccum += dt;
  if (state.roseAccum >= ROSE_INTERVAL) {
    state.roseAccum -= ROSE_INTERVAL;
    addPickup(world, player, track, pickTreatKind());
  }
  state.beerAccum += dt;
  if (state.beerAccum >= BEER_INTERVAL) {
    state.beerAccum -= BEER_INTERVAL;
    addPickup(world, player, track, 'beer');
  }
  state.shroomAccum += dt;
  if (state.shroomAccum >= SHROOM_INTERVAL) {
    state.shroomAccum -= SHROOM_INTERVAL;
    addPickup(world, player, track, 'shroom');
  }
  if (timer.timeLeft <= EMERGENCY_AT && state.emergencyArmed) {
    state.emergencyArmed = false;
    addPickup(world, player, track, 'petrol', true); // near + in-lane so it's grabbable
    addPopup(state.popups, 'GRAB THE CAN!', W / 2, H * 0.52, '#ffd76b', 1.2);
  } else if (timer.timeLeft > EMERGENCY_AT * 3) {
    state.emergencyArmed = true; // re-arm once comfortably topped up
  }

  // Clock. Running out ends the run (but the rescue can above makes that a
  // miss-your-chance death, not an unavoidable one). A timelock / 4:20 pickup
  // freezes the countdown for a while instead of ticking.
  if (state.timeFrozen > 0) {
    state.timeFrozen = Math.max(0, state.timeFrozen - dt);
  } else if (tickTimer(timer, dt)) {
    endRun('time');
  }
  // low-time tick — a nudge to grab the rescue can
  const urg = timerUrgency(timer);
  if (urg > 0 && timer.timeLeft > 0) {
    state.tickAccum += dt;
    if (state.tickAccum >= 0.5) {
      state.tickAccum = 0;
      playSfx('tick', 0.4 + urg * 0.4);
    }
  }

  // OutRun checkpoints: crossing into a new stage tops up the clock and swaps
  // the region (biome) + car class. Pure reward + flavour (time isn't fatal).
  const stageIdx = stageIndexAt(score.distance);
  if (stageIdx > state.lastStageIndex) {
    state.lastStageIndex = stageIdx;
    timer.timeLeft = clamp(timer.timeLeft + CHECKPOINT_BONUS, 0, DEFAULT_TIMER.maxTime);
    const stage = stageAt(score.distance);
    playSfx('milestone', 0.9);
    playSfx('combo', 0.7);
    playSting(STING.checkpoint, 1);
    vibrate([20, 40, 20]);
    addPopup(state.popups, 'CHECKPOINT', W / 2, H * 0.24, '#8fe6c4', 1.3);
    addPopup(state.popups, `LEVEL ${stage.index + 1} / ${LEVELS}`, W / 2, H * 0.3, '#ffffff', 1.7);
    addPopup(state.popups, stage.name, W / 2, H * 0.37, '#ffd76b', 1.9);
    addPopup(state.popups, marketPhaseAt(score.distance), W / 2, H * 0.43, '#9fd0ff', 1.7);
  }

  // Drop the checkpoint gate / finish arch onto the road as each boundary nears,
  // so the rider physically drives through it as the region turns over.
  const nextGate = state.lastGateSpawned + 1;
  if (nextGate <= LEVELS - 1) {
    const ahead = nextGate * STAGE_M - score.distance;
    if (ahead > 0 && ahead <= MARKER_LOOKAHEAD_M) {
      addMarker(world, player, track, 'prop-gate', ahead, 'gate');
      state.lastGateSpawned = nextGate;
    }
  }
  if (!state.finishSpawned) {
    const ahead = FINISH_M - score.distance;
    if (ahead > 0 && ahead <= MARKER_LOOKAHEAD_M) {
      addMarker(world, player, track, 'prop-finish', ahead, 'finish');
      state.finishSpawned = true;
    }
  }

  // Distance milestones every 1 km.
  const km = Math.floor(score.distance / 1000);
  if (km > state.lastMilestoneKm) {
    state.lastMilestoneKm = km;
    playSfx('milestone', 0.7);
    addPopup(state.popups, `${km} KM!`, W / 2, H * 0.4, '#ffd76b', 1.2);
  }

  updateEngine({
    playing: true,
    speed: player.speed / player.maxSpeed,
    throttle: input.throttle ? 1 : 0,
  });

  // Off-road rumble: the tarmac spans |x| <= 1, so the rumble strip bites right
  // at the painted edge (~0.9) and the roar maxes out once you're properly into
  // the grass. It scales with speed too, so drifting a wheel wide in a fast
  // sweeper growls, and crawling off the edge barely whispers.
  const edge = Math.abs(player.x);
  const rumbleI = clamp((edge - 0.9) / 0.6, 0, 1);
  updateRumble({
    active: rumbleI > 0,
    intensity: rumbleI,
    speed: player.speed / player.maxSpeed,
  });

  // Tyre screech: how hard the bike is loaded up laterally (steering hard or
  // running wide in a bend). |vx| near its cap = a corner being pushed hard; the
  // scrub only bites past ~45% of that, and never mid-wipeout.
  const speedPct = player.speed / player.maxSpeed;
  const corner = clamp((Math.abs(player.vx) / DEFAULT_TUNING.maxSteerVel - 0.45) / 0.55, 0, 1);
  updateScreech({
    active: state.wipeout === 0 && corner > 0,
    load: corner,
    speed: speedPct,
  });

  // One rushing-air chain serves three intensities: the rose turbo roars, a
  // slingshot whooshes, and a held draft whispers as the wake builds.
  updateTurbo({
    active: (state.boost > 0 || state.slingshot > 0 || state.drafting > 0 || state.beerSpeed > 0) && state.wipeout === 0,
    intensity: Math.max(
      state.boost / ROSE_BOOST_TIME,
      state.slingshot > 0 ? 0.7 * (state.slingshot / SLING_TIME_MAX) + 0.2 : 0,
      state.draftCharge * 0.35,
      state.beerSpeed > 0 ? 0.35 : 0,
    ),
  });
}

// ---- render ----------------------------------------------------------------

function render(): void {
  const store = state.store;
  if (!store) return;
  ctx.clearRect(0, 0, W, H);

  if (state.phase === 'title') {
    renderTitle(store);
    return;
  }

  // Beer wobble / shroom trip ramp in fast and ease out at the tail, so neither
  // effect ever snaps on or off mid-frame.
  const wobble = clamp(Math.min(state.beerWobble / 1.5, (BEER_WOBBLE_TIME - state.beerWobble) / 0.6), 0, 1);
  const trip = clamp(Math.min(state.shroom / 1.2, (SHROOM_TIME - state.shroom) / 0.4), 0, 1);
  renderScene({ ctx, width: W, height: H, track, player, world, store, time: state.time, wipeout: state.wipeout, boost: state.boost > 0 ? state.boost / ROSE_BOOST_TIME : 0, sling: state.slingshot > 0 ? state.slingshot / SLING_TIME_MAX : 0, draft: state.draftCharge, wobble, trip, palette: paletteAt(score.distance), scenery: sceneryKitAt(score.distance), timeOfDay: timeOfDayAt(score.distance) });
  drawSparks(ctx);

  // The game-over card carries the score/stats itself — drawing the live HUD
  // under it just bled the speed/distance pills through the name-entry keys.
  if (state.phase !== 'gameover') {
    const hud: HudState = {
      score: score.score,
      hiScore: topScore(board),
      timeLeft: timer.timeLeft,
      urgency: timerUrgency(timer),
      speedKph: speedKph(player),
      distanceM: score.distance,
      roseStreak: score.roseStreak,
      level: stageIndexAt(score.distance) + 1,
      levels: LEVELS,
      region: stageAt(score.distance).name,
      shield: state.shield,
      popups: state.popups,
    };
    drawHud(ctx, W, H, hud, { bottomInset: mobileHudBottomInset() });
  }

  if (state.phase === 'playing' && state.paused) renderPaused();
  if (state.phase === 'gameover') renderGameOver(store);
  // Confetti pops over the victory card, not behind its scrim.
  if (state.phase === 'gameover' && state.outcome === 'finish') drawSparks(ctx);
  if (isMuted()) renderMuteBadge();
}

function outlinedText(text: string, x: number, y: number, fill: string, u: number, stroke = 6): void {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(4,12,18,0.92)';
  ctx.lineWidth = stroke * u;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function renderTitle(store: SpriteStore): void {
  const art = store.get('title-art');
  if (art) drawTitleArt(ctx, W, H, art);
  else {
    ctx.fillStyle = '#0a2a3a';
    ctx.fillRect(0, 0, W, H);
  }
  const u = uiScale();
  const portrait = H > W;

  // Strong top + bottom scrims so text always reads over the bright art.
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.42);
  top.addColorStop(0, 'rgba(6,19,28,0.82)');
  top.addColorStop(1, 'rgba(6,19,28,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.42);
  const bottom = ctx.createLinearGradient(0, H * 0.5, 0, H);
  bottom.addColorStop(0, 'rgba(6,19,28,0)');
  bottom.addColorStop(0.5, 'rgba(6,19,28,0.72)');
  bottom.addColorStop(1, 'rgba(6,19,28,0.92)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  ctx.textAlign = 'center';
  const titleSize = Math.min(96 * u, W * 0.11);
  ctx.font = `900 ${titleSize}px 'Trebuchet MS', sans-serif`;
  outlinedText('HANG ON, FREN', W / 2, H * (portrait ? 0.16 : 0.2), '#ffd76b', u, 8);
  ctx.font = `700 ${24 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText('Ten regions, one finish line — a Vespa road-tribute', W / 2, H * (portrait ? 0.22 : 0.27), '#ffffff', u, 5);

  // --- difficulty selector ---
  const rowY = H * MODE_ROW_Y;
  ctx.font = `700 ${13 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText('DIFFICULTY  ·  ◄ ► OR TAP TO CHANGE', W / 2, rowY - 32 * u, '#9fd0ff', u, 4);
  MODES.forEach((m, i) => {
    const x = W * ((i * 2 + 1) / (MODES.length * 2));
    const sel = i === modeIndex;
    ctx.font = `${sel ? 900 : 700} ${(sel ? 30 : 21) * u}px 'Trebuchet MS', sans-serif`;
    outlinedText(m.label, x, rowY, sel ? '#ffd76b' : 'rgba(255,255,255,0.55)', u, sel ? 6 : 4);
  });
  ctx.font = `600 ${15 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(MODES[modeIndex].tagline, W / 2, rowY + 24 * u, '#bdeddb', u, 4);

  const blink = Math.floor(state.time * 2) % 2 === 0;
  if (blink) {
    ctx.font = `800 ${30 * u}px 'Trebuchet MS', sans-serif`;
    outlinedText('PRESS ENTER / TAP TO RIDE', W / 2, H * 0.67, '#ffffff', u, 6);
  }
  ctx.font = `600 ${18 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText('◄ ► steer   ·   grab fuel for time   ·   roses = turbo   ·   don’t wipe out', W / 2, H * 0.73, '#bdeddb', u, 4);

  // identity row: who signs your gamestr scores (tap / N to switch)
  ctx.font = `700 ${14 * u}px 'Trebuchet MS', sans-serif`;
  if (state.titleNotice.text && state.time < state.titleNotice.until) {
    outlinedText(state.titleNotice.text, W / 2, H * IDENTITY_ROW_Y, '#8fe6c4', u, 4);
  } else {
    const id = getIdentity();
    const label = id.mode === 'nostr'
      ? `RIDING AS  NOSTR · ${id.name}   —   N / TAP FOR GUEST`
      : `RIDING AS  GUEST · ${id.name}   —   N / TAP FOR NOSTR`;
    outlinedText(label, W / 2, H * IDENTITY_ROW_Y, '#9fd0ff', u, 4);
  }

  // score board — alternates between the local best riders and the global
  // gamestr board (when the fetch has produced one).
  const showGlobal = state.globalBoard.length > 0 && Math.floor(state.time / 6) % 2 === 1;
  ctx.font = `800 ${17 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(showGlobal ? 'TOP FRENS — GAMESTR' : 'BEST RIDERS', W / 2, H * 0.81, '#ffd76b', u, 4);
  ctx.font = `700 ${16 * u}px 'Trebuchet MS', sans-serif`;
  if (showGlobal) {
    state.globalBoard.slice(0, 5).forEach((e, i) => {
      outlinedText(`${i + 1}.  ${e.name}   ${e.score.toLocaleString('en-GB')}`, W / 2, H * 0.85 + i * 22 * u, '#ffffff', u, 4);
    });
  } else {
    board.slice(0, 5).forEach((e, i) => {
      outlinedText(`${i + 1}.  ${e.name}   ${e.score.toLocaleString('en-GB')}`, W / 2, H * 0.85 + i * 22 * u, '#ffffff', u, 4);
    });
  }
}

function renderPaused(): void {
  const u = uiScale();
  ctx.fillStyle = 'rgba(6,19,28,0.66)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = `900 ${64 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText('PAUSED', W / 2, H * 0.42, '#ffd76b', u, 8);
  ctx.font = `700 ${22 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(isTouch ? 'TAP TO RESUME' : 'ESC — RESUME', W / 2, H * 0.52, '#ffffff', u, 5);
  ctx.font = `600 ${17 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText('Q — QUIT TO TITLE', W / 2, H * 0.58, '#bdeddb', u, 4);
}

function renderGameOver(_store: SpriteStore): void {
  const s = state.summary;
  if (!s) return;
  const u = uiScale();
  const won = state.outcome === 'finish';
  // A darker scrim for a defeat, a warmer one for the victory card.
  ctx.fillStyle = won ? 'rgba(10,26,20,0.66)' : 'rgba(6,19,28,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  if (won) {
    ctx.font = `900 ${72 * u}px 'Trebuchet MS', sans-serif`;
    outlinedText('FINISH!', W / 2, H * 0.2, '#ffd76b', u, 8);
    ctx.font = `800 ${30 * u}px 'Trebuchet MS', sans-serif`;
    outlinedText('YOU REACHED THE GOAL, FREN!', W / 2, H * 0.28, '#8fe6c4', u, 6);
  } else {
    ctx.font = `900 ${64 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#ff5d78';
    // The clock is the only way a run ends short (wipeouts cost time, never a life).
    ctx.fillText('OUT OF TIME', W / 2, H * 0.24);
  }

  ctx.font = `800 ${40 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`SCORE  ${s.score.toLocaleString('en-GB')}`, W / 2, H * 0.36);

  if (won && state.finishBonus > 0) {
    ctx.font = `700 ${22 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#ffd76b';
    ctx.fillText(
      `TIME BONUS  ${Math.ceil(state.finishTimeLeft)}s × ${TIME_BONUS_PER_SEC}  =  +${state.finishBonus.toLocaleString('en-GB')}`,
      W / 2,
      H * 0.41,
    );
  }

  ctx.font = `600 ${20 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = '#8fe6c4';
  ctx.fillText(
    `${(s.distanceM / 1000).toFixed(2)} km   ·   ${s.roses} roses   ·   ${s.overtakes} overtakes   ·   ${s.topSpeedKph} km/h top`,
    W / 2,
    won ? H * 0.46 : H * 0.44,
  );

  // gamestr publish status (non-qualifying runs publish immediately; a board
  // run publishes on DONE and the title notice carries the outcome instead).
  if (state.submitStatus && !state.qualifies) {
    ctx.font = `700 ${15 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#9fd0ff';
    ctx.fillText(state.submitStatus, W / 2, won ? H * 0.52 : H * 0.5);
  }

  if (state.qualifies) {
    drawNameEntry(ctx, W, uiScale(), state.nameValue, state.time, nameEntryLayout());
  } else {
    const blink = Math.floor(state.time * 2) % 2 === 0;
    if (blink) {
      ctx.font = `800 ${26 * u}px 'Trebuchet MS', sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('PRESS ENTER / TAP TO CONTINUE', W / 2, H * 0.64);
    }
  }
}

function renderMuteBadge(): void {
  const u = uiScale();
  ctx.textAlign = 'left';
  ctx.font = `700 ${14 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('🔇 muted (M)', 24 * u, H - mobileHudBottomInset() - 70 * u);
}

// ---- loop ------------------------------------------------------------------

// Fixed-timestep simulation: physics and collision always advance in identical
// quanta regardless of the display (a 30 Hz phone, a 60 Hz laptop, a 144 Hz
// monitor), so the bike handles and crashes IDENTICALLY everywhere — variable
// per-frame dt was a quiet source of device-dependent collision behaviour.
// Rendering still happens once per display frame; sub-step remainders carry
// over in the accumulator. 1/240 keeps at least one sim step landing per frame
// on every common refresh rate, so motion never visibly hitches.
const SIM_DT = 1 / 240;
const MAX_FRAME = 0.05; // clamp big pauses (tab switch) rather than fast-forward
let last = performance.now();
let simAccum = 0;
function frame(now: number): void {
  const elapsed = clamp((now - last) / 1000, 0, MAX_FRAME);
  last = now;
  // Never let a transient error kill the loop — if it did, resize() would stop
  // and the canvas would freeze at its old size (black bars on window growth).
  try {
    resize();
    simAccum += elapsed;
    while (simAccum >= SIM_DT) {
      simAccum -= SIM_DT;
      update(SIM_DT);
    }
    syncDomState();
    render();
  } catch (err) {
    console.error('frame error:', err);
  }
  requestAnimationFrame(frame);
}

// Dev-only visual harness: lets a headless browser jump the region/biome by
// distance (and speed) so background art can be reviewed without a 60s drive.
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  (window as unknown as { __hof: unknown }).__hof = {
    startRun,
    setDistance: (m: number) => { score.distance = m; },
    freezeSpeed: (mul: number) => { player.speed = player.maxSpeed * mul; },
    pause: (v: boolean) => { devPaused = v; },
    // Nudge the rider off the tarmac so the off-road rumble can be exercised.
    setLateral: (x: number) => { player.x = x; },
    // Slam a stopped car into the rider's path to force a wipeout on demand.
    plantCrashCar: () => {
      const car = world.traffic[0];
      car.z = player.z + RIDER_FWD + ROAD.segmentLength * 2; // just ahead of the drawn bike
      car.offset = player.x;
      car.driftAmp = 0;
      car.speed = 0;
      car.prevFwd = signedForward(car.z, player.z, track.length);
      car.prevLateral = player.x - car.offset;
      player.speed = Math.max(player.speed, player.maxSpeed * 0.6);
      state.invuln = 0;
    },
    state,
    player,
    world,
    track,
    get timer() { return timer; },
    get score() { return score; },
  };
}

async function boot(): Promise<void> {
  resize();
  // Offline/PWA support in production builds only — the service worker would
  // fight Vite's dev-server module graph.
  if ('serviceWorker' in navigator && !(import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    navigator.serviceWorker.register(assetUrl('sw.js')).catch(() => undefined);
  }
  initMusic(MUSIC_URL);
  // Restore the persisted identity (reconnects a NIP-07 session quietly) and
  // warm the global gamestr board for the title screen. Both best-effort.
  void restoreIdentity().catch(() => undefined);
  void fetchGlobalBoard()
    .then(entries => { state.globalBoard = entries; })
    .catch(() => undefined);
  const store = new SpriteStore();
  brandPetrol(store);
  decorateTrack(track, buildSignVariants(store), buildBillboardVariants(store));
  state.store = store;
  state.phase = 'title';
  last = performance.now();
  requestAnimationFrame(frame);
  void loadSpriteInto(store, 'title-art')
    .then(() => loadSpritesInto(store))
    .then(() => {
      brandPetrol(store);
      // Rebuild + rescatter now the real art is in — this is also when the
      // rose-meme billboard first becomes available (its sticker art loads here).
      decorateTrack(track, buildSignVariants(store), buildBillboardVariants(store));
    })
    .catch(() => undefined);
}

void boot();
