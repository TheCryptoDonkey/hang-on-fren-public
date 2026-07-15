// Hang On, Fren — bootstrap, game states, main loop and input. Orchestrates the
// road (road.ts), dynamic world (world.ts), clock economy (timer.ts), scoring
// (scoring.ts), audio (audio.ts), rendering (render.ts) and HUD (hud.ts).

import { buildTrack, decorateTrack, createPlayer, updatePlayer, resetDrift, speedKph, riderScreenX, enclosureAt, alignFinishToStraight, DEFAULT_TUNING, ROAD, RIDER_FWD, RIDER_SCREEN_FRAC, type DriveInput } from './road.js';
import { createWorld, resetWorld, updateWorld, addPickup, addMarker, signedForward, draftAt, audibleTraffic, getRival, getRivalGapM, retireRival } from './world.js';
import { createTimer, tickTimer, addRoseTime, addCanTime, timerUrgency, DEFAULT_TIMER } from './timer.js';
import { createScore, addDistance, addRose, addFuel, addBonus, addStuntBonus, addDrift, driftPayout, penalise, addOvertake, addNearMiss, registerCrash, summarise, type RunSummary } from './scoring.js';
import type { PickupKind } from './world.js';
import { SpriteStore, loadSpriteInto, loadSpritesInto, buildSignVariants, buildBillboardVariants, brandPetrol } from './sprites.js';
import { renderScene, drawTitleArt } from './render.js';
import { spawnSmoke, updateSmoke, type Smoke } from './smoke.js';
import { setPickupScale } from './geometry.js';
import { riderSize } from './rider.js';
import { drawHud, addPopup, updatePopups, type HudState, type Popup } from './hud.js';
import { loadBoard, saveBoard, insertScore, qualifies, rankOf, topScore, type HighScore } from './highscore.js';
import { unlockAudio, updateEngine, updateRumble, updateScreech, updateTurbo, updateTraffic, silenceTraffic, updateEcho, playSfx, playPassBy, playVoiceClip, preloadVoiceClip, resetGearbox, currentGear, toggleMuted, isMuted } from './audio.js';
import { initMusic, preloadMusic, startMusic, currentMusicUrl } from './music.js';
import { paletteAt, stageAt, stageIndexAt, sceneryKitAt, terrainAt, timeOfDayAt, marketPhaseAt, setActiveTour, getActiveTour, levelCount, finishDistanceM, roseRichAt, CHECKPOINT_BONUS, STAGE_M, TOUR_TITLES, type TourId } from './stages.js';
import { loadSelectedTour, saveSelectedTour } from './progress.js';
import { appendChar, backspace, cleanName, layout as nameLayout, keyAt as nameKeyAt, drawNameEntry } from './nameentry.js';
import { connectNostr, fetchGlobalBoard, getIdentity, renameGuest, restoreIdentity, submitScore, useGuestMode, type GlobalScore } from './nostr.js';
import { MODES, loadModeIndex, saveModeIndex } from './difficulty.js';
import { approach, clamp } from './util.js';
import { isSteeringCode, KeyboardDriveState } from './keyboard-drive.js';
import { createFlick, updateFlick, resetFlick } from './flick.js';
import { assetUrl } from './asset-url.js';
import { fetchBtcSnapshot, type BtcSnapshot } from './bitcoin.js';
import { breakFlow, createFlow, flowLabel, flowMultiplier, gainFlow, tickFlow, FLOW_GAINS } from './flow.js';
import { RIVAL_TOUR_FINISH_M, resolveRivalResult, type RivalResult } from './rival.js';
import { gradeStage, overallGrade, type StageResult } from './grade.js';

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
// Bespoke per-region music beds, keyed by tour and stage index; regions
// without an entry ride the main theme. Adding a bed = drop the compressed
// m4a in public/music/ and add a line here (originals live in art-originals/).
const STAGE_MUSIC: Readonly<Record<TourId, Readonly<Record<number, string>>>> = {
  grand: {
    0: assetUrl('music/amalfi-coast-coastal-velocity.m4a'),
  },
  world: {
    0: assetUrl('music/old-manchester-loose-gears.m4a'),
    1: assetUrl('music/old-prague-allegretto.m4a'),
    2: assetUrl('music/old-mallorca-tramuntana-motion.m4a'),
    3: assetUrl('music/taj-mahal-roses-at-dawn.m4a'),
  },
};

/** The music bed for wherever the rider currently is. */
function stageMusicUrl(): string {
  return STAGE_MUSIC[getActiveTour()][stageIndexAt(score.distance)] ?? MUSIC_URL;
}
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
// The finish arch is dropped further out than the checkpoint gates: it stands on
// a straight (alignFinishToStraight), so a long lead makes the tape visible down
// the whole run-in. Capped by how far the road is actually drawn ahead.
const FINISH_LOOKAHEAD_M = 620;
// End-of-race time bonus: every whole second still on the clock at the finish
// line is worth this many points (classic OutRun goal bonus).
const TIME_BONUS_PER_SEC = 100;
const RIVAL_WIN_BONUS = 3000;
// Hold on the bespoke goal celebration before the score/name card appears.
// Long enough to enjoy the finish cast and several firework volleys, short
// enough that repeat runs still flow like an arcade game.
const VICTORY_SHOW_TIME = 5.5;
// Level-skip cheat: two + presses inside this window jump to the next stage.
// Cheating is honest about itself — a cheated run NEVER submits to gamestr.
const CHEAT_PLUS_WINDOW = 0.6;

/**
 * The camera. A pseudo-3D road is a flat scrolling texture until the EYE moves,
 * so these three are doing most of the work of making the game feel three-
 * dimensional — more than any amount of extra scenery would.
 *
 *  YAW   — the eye turns INTO the corner (and part-way along a slide), so you
 *          see round the bend you are taking rather than staring at a wall.
 *  ROLL  — the whole world banks with the bike. Cheap; enormous.
 *  LAG   — the eye TRAILS the bike laterally, so a hard steer or a powerslide
 *          swings the bike across the frame instead of pinning it dead-centre.
 *
 * All three are smoothed: they should swing, never snap. The lag is capped hard,
 * because the bike is drawn where its true road position projects to, and the
 * road under it is wider than the screen — a lag of 0.1 road-offset units would
 * throw the bike clean out of frame.
 */
const CAM = {
  yawFromCurve: 0.05, // rad at full speed through the sharpest bend
  yawFromSlip: 0.5, // fraction of the bike's slip angle the eye follows
  maxYaw: 0.2,
  rollFromLean: 0.034, // rad at full lean
  rollFromCurve: 0.018,
  maxRoll: 0.052,
  lagRate: 25, // how hard the eye chases the bike (per second)
  maxLag: 0.06, // road-offset units — see above, this cap matters
  yawRate: 5, // smoothing (per second)
  rollRate: 6,
} as const;

/** Curve magnitude treated as "the sharpest bend" when normalising camera swing. */
const CURVE_REF = 6.5;

// Tyre smoke pours off the back once the slide is deep enough to be worth
// looking at, and off both wheels whenever a wheel is in the dirt. The ramp
// SATURATES early (a slide only a third of the way to full lock is already
// smoking hard) — scaling the rate linearly all the way to the spin limit meant
// an ordinary, well-held drift trickled out a handful of puffs a second and
// barely appeared to smoke at all.
const SMOKE_SLIP = 0.22; // slip fraction below which a slide doesn't smoke
const SMOKE_FULL = 0.5; // …and the slip at which it is already pouring
const SMOKE_RATE = 120; // puffs/sec once it is

type Phase = 'loading' | 'title' | 'playing' | 'victory' | 'gameover';

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
// Both tours ride from the title screen; the last pick persists.
let selectedTour: TourId = loadSelectedTour();

function cycleMode(step: number): void {
  modeIndex = (modeIndex + step + MODES.length) % MODES.length;
  saveModeIndex(modeIndex);
  playSfx('combo', 0.8, 1 + modeIndex * 0.12);
}

function selectTour(tour: TourId): void {
  if (tour === selectedTour) return;
  selectedTour = tour;
  saveSelectedTour(tour);
  playSfx('combo', 0.8, tour === 'world' ? 1.35 : 1);
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
  finishDistance: 0, // the finish distance, nudged to land the tape on a straight
  confettiAccum: 0, // drip-feeds confetti on the victory screen
  fireworkAccum: 0,
  victoryTime: 0,
  qualifies: false,
  // --- gamestr (nostr) layer ---
  runId: '',
  runStartedAt: 0, // wall-clock ms — the claim service sanity-checks the run window
  runFinishedAt: 0,
  submitted: false, // this run's score has been handed to the claim service
  submitStatus: '', // shown on the game-over card
  cheated: false, // ++ level-skip used — the run stays local, never claims on gamestr
  lastPlusAt: -1, // state.time of the last + press (cheat chord detection)
  btc: {} as BtcSnapshot, // block height + price stamped onto saved scores
  titleNotice: { text: '', until: 0 }, // transient identity/publish notice on the title
  globalBoard: [] as GlobalScore[],
  boardFlip: false, // title board alternates local / gamestr
  sparks: [] as Spark[],
  fireworks: [] as FireworkParticle[],
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
  /** 0..1 how deep under a tunnel or bridge the BIKE is. Drives light and echo. */
  enclosure: 0,
  // ---- camera (see CAM) ----
  camYaw: 0,
  camRoll: 0,
  camX: 0, // the eye's lateral position; trails player.x
  // ---- powerslide ----
  smoke: [] as Smoke[],
  smokeAccum: 0,
  /** ∫ |slip| × speed-fraction dt over the slide in progress — what it pays out. */
  driftArea: 0,
  driftHeld: 0, // seconds the current slide has been held
  wasDrifting: false,
  flow: createFlow(),
  stageStartedAt: 0,
  stageStartCrashes: 0,
  stageFlowPeak: 0,
  stageResults: [] as StageResult[],
  rivalIntro: 0,
  rivalResult: null as RivalResult | null,
  rivalResultTime: 0,
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

interface FireworkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  color: string;
  size: number;
  twinkle: number;
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

/** Explode a saturated arcade firework in the upper half of the screen. */
function spawnFireworkBurst(x = W * (0.12 + Math.random() * 0.76), y = H * (0.08 + Math.random() * 0.38)): void {
  const palettes = [
    ['#ff3b72', '#ff9bc4', '#fff3f8'],
    ['#ffd23f', '#ff8c2a', '#fff4b0'],
    ['#42e8ff', '#58a6ff', '#e7fbff'],
    ['#8cff66', '#34d399', '#efffe8'],
    ['#c86bff', '#ff71ce', '#f8e6ff'],
  ];
  const colors = palettes[Math.floor(Math.random() * palettes.length)];
  const spokes = 42;
  const twist = Math.random() * Math.PI * 2;
  for (let i = 0; i < spokes; i += 1) {
    const a = twist + (i / spokes) * Math.PI * 2 + (Math.random() - 0.5) * 0.06;
    const speed = 90 + Math.random() * 230;
    state.fireworks.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 0.95 + Math.random() * 0.65,
      ttl: 1.6,
      color: colors[i % colors.length],
      size: 2 + Math.random() * 3.5,
      twinkle: Math.random() * Math.PI * 2,
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

function updateFireworks(dt: number): void {
  for (let i = state.fireworks.length - 1; i >= 0; i -= 1) {
    const p = state.fireworks[i];
    p.life -= dt;
    if (p.life <= 0) {
      state.fireworks.splice(i, 1);
      continue;
    }
    p.vy += 105 * dt;
    p.vx *= 1 - dt * 0.42;
    p.vy *= 1 - dt * 0.18;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function drawFireworks(ctx2: CanvasRenderingContext2D): void {
  ctx2.save();
  ctx2.globalCompositeOperation = 'lighter';
  for (const p of state.fireworks) {
    const a = Math.min(1, p.life / Math.min(0.45, p.ttl));
    const trail = 0.085;
    ctx2.globalAlpha = a * (0.65 + Math.sin(state.time * 18 + p.twinkle) * 0.25);
    ctx2.strokeStyle = p.color;
    ctx2.lineWidth = Math.max(2, p.size);
    ctx2.shadowColor = p.color;
    ctx2.shadowBlur = 9;
    ctx2.beginPath();
    ctx2.moveTo(p.x, p.y);
    ctx2.lineTo(p.x - p.vx * trail, p.y - p.vy * trail);
    ctx2.stroke();
    // Square hot core keeps the burst unmistakably 32-bit arcade rather than
    // soft modern particle fluff.
    ctx2.fillStyle = p.color;
    ctx2.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), Math.ceil(p.size + 1), Math.ceil(p.size + 1));
  }
  ctx2.restore();
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

const input: DriveInput = { left: false, right: false, throttle: true, brake: false, flick: 0 };
const keyboard = new KeyboardDriveState();
// The counter-steer flick that breaks the tyres loose (flick.ts). Fed the net
// steer direction each step; its output arms `input.flick` for the drift entry.
const flick = createFlick();
let touchSteer = 0; // -1,0,1
let touchBrake = false;

// ---- sizing ----------------------------------------------------------------

let W = 1280;
let H = 720;
/** Actual backing pixels per CSS pixel after the budget cap (≤ dpr). The UI
 *  scale floor reads this — perceived text size is css px, not device px. */
let renderScale = 1;
/**
 * Hard ceiling on the drawing buffer, in pixels. Canvas2D rasterises every
 * one of them ~twice a frame; a Retina Mac window is 3200×1800 = 5.8M px and
 * that IS the slowdown. ~2.3M keeps full-HD-class sharpness; past the cap we
 * render smaller and let the browser upscale — with `image-rendering:
 * pixelated`, which on this art reads as MORE chunky-authentic, not less.
 */
const MAX_BACKING_PX = 2_300_000;
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
  const budget = Math.min(1, Math.sqrt(MAX_BACKING_PX / Math.max(1, cssW * cssH * dpr * dpr)));
  const scale = dpr * budget;
  const nw = Math.max(1, Math.round(cssW * scale));
  const nh = Math.max(1, Math.round(cssH * scale));
  if (canvas.width !== nw || canvas.height !== nh) {
    canvas.width = nw;
    canvas.height = nh;
    canvas.style.imageRendering = budget < 0.999 ? 'pixelated' : '';
  }
  renderScale = scale;
  W = nw;
  H = nh;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
window.visualViewport?.addEventListener('resize', resize);
window.visualViewport?.addEventListener('scroll', resize);

const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch-device', isTouch);
// Pickups draw a third bigger on phones — small screens, and they're the thing
// you steer for. Purely visual: collection has its own (wider) window.
setPickupScale(isTouch ? 1.35 : 1);

type TouchControl = 'left' | 'right' | 'slow';
type ActiveTouchControl = { action: TouchControl; button: HTMLButtonElement; seq: number };
// Monotonic press order, so when both steer buttons are held at once the one
// pressed MOST RECENTLY wins. Without this, holding → and then pressing ← nets
// to zero (right − left), so the ← button reads as dead while the bike keeps
// drifting right — the "player stuck on the right, left button does nothing" bug.
let touchControlSeq = 0;

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
  const existing = activeTouchControls.get(pointerId);
  // Keep a stable seq while a pointer stays on the same button (pointermove
  // re-fires); only re-stamp when it actually lands on a different control, so
  // sliding a held thumb onto the other button makes THAT the latest.
  const seq = existing && existing.action === action ? existing.seq : (touchControlSeq += 1);
  activeTouchControls.set(pointerId, { action, button, seq });
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
  // Latest-pressed steer button wins. Holding both no longer cancels to zero;
  // pressing the opposite button always overrides the one you're still holding.
  let bestSeq = -1;
  let dir = 0;
  for (const active of activeTouchControls.values()) {
    if (active.action !== 'left' && active.action !== 'right') continue;
    if (active.seq > bestSeq) {
      bestSeq = active.seq;
      dir = active.action === 'left' ? -1 : 1;
    }
  }
  return dir;
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
  // While the high-score keyboard owns the lower screen, keep the floating
  // SUPPORT button out of the way (CSS hides it on data-naming).
  document.body.dataset.naming = state.phase === 'gameover' && state.qualifies ? '1' : '';
}

// ---- value-for-value support modal -----------------------------------------
// A floating SUPPORT button (title + game-over) opens a modal with a copyable
// Lightning address, a scannable QR and links to Geyser / Ko-fi. All optional,
// and wholly separate from gameplay/score.
const supportBtn = document.getElementById('support-btn');
const donateOverlay = document.getElementById('donate-overlay');
const donateClose = document.getElementById('donate-close');
const donateCopy = document.getElementById('donate-copy');
const LIGHTNING_ADDRESS = 'profusemeat89@walletofsatoshi.com';

function openDonate(): void {
  if (!donateOverlay) return;
  donateOverlay.hidden = false;
  document.body.classList.add('donate-open');
}
function closeDonate(): void {
  if (!donateOverlay) return;
  donateOverlay.hidden = true;
  document.body.classList.remove('donate-open');
}

async function copyLightningAddress(): Promise<void> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(LIGHTNING_ADDRESS);
    ok = true;
  } catch {
    // Fallback for browsers without async clipboard (older iOS Safari).
    try {
      const ta = document.createElement('textarea');
      ta.value = LIGHTNING_ADDRESS;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      ok = false;
    }
  }
  const label = donateCopy?.querySelector('.donate-copy-label');
  if (label) {
    donateCopy?.classList.add('is-copied');
    label.textContent = ok ? 'COPIED!' : 'COPY FAILED — LONG-PRESS TO SELECT';
    setTimeout(() => {
      donateCopy?.classList.remove('is-copied');
      label.textContent = 'TAP TO COPY';
    }, 1800);
  }
}

supportBtn?.addEventListener('click', openDonate);
donateClose?.addEventListener('click', closeDonate);
donateCopy?.addEventListener('click', () => { void copyLightningAddress(); });
// Backdrop tap closes; taps inside the card do not.
donateOverlay?.addEventListener('click', e => { if (e.target === donateOverlay) closeDonate(); });

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
  keyboard.clear();
  input.left = false;
  input.right = false;
  input.brake = false;
  input.throttle = true;
  clearTouchInput();
}
function onFocusLost(): void {
  clearAllInput();
  if (state.phase === 'playing') state.paused = true;
}
window.addEventListener('blur', onFocusLost);
window.addEventListener('pagehide', onFocusLost);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onFocusLost();
});

// Diagonal-based UI scale so text is legible in both portrait and landscape.
// The diagonal alone under-sizes badly on phones: the buffer is dpr-doubled
// but the glass is small, so the 15px labels tuned on a 720p desktop land at
// ~8 CSS px. Floor the PERCEIVED scale on touch devices — the layouts are
// u-spaced and width-capped, so they grow coherently rather than overflowing.
function uiScale(): number {
  const u = Math.hypot(W, H) / 1468;
  if (!isTouch) return u;
  // renderScale, not devicePixelRatio: the buffer may be budget-capped below
  // the display density, and perceived text size is buffer px ÷ renderScale.
  return Math.max(u, 0.78 * renderScale);
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
  // While the support modal is open it owns the keyboard: Escape/Enter close it,
  // and nothing leaks through to start a run behind it.
  if (donateOverlay && !donateOverlay.hidden) {
    if (k === 'escape' || k === 'enter') closeDonate();
    return;
  }
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  keyboard.press(e.code);

  // Escape pauses/resumes a run; Q from the pause screen abandons it.
  if (state.phase === 'playing') {
    if (k === 'escape') {
      state.paused = !state.paused;
      clearAllInput();
      playSfx('combo', 0.6, state.paused ? 0.8 : 1.15);
      return;
    }
    if (state.paused && k === 'q') {
      quitRun();
      return;
    }
    // ++ cheat: two quick + presses skip to the next level (and flag the run
    // so it never claims on gamestr).
    if (!state.paused && k === '+') {
      if (state.time - state.lastPlusAt <= CHEAT_PLUS_WINDOW) {
        state.lastPlusAt = -1;
        skipLevelCheat();
      } else {
        state.lastPlusAt = state.time;
      }
      return;
    }
  }

  if (state.phase === 'title') {
    if (k === 'enter' || k === ' ') startRun();
    else if (k === 'arrowleft' || k === 'a') { unlockAudio(); cycleMode(-1); }
    else if (k === 'arrowright' || k === 'd') { unlockAudio(); cycleMode(1); }
    else if (k === 'arrowup' || k === 'arrowdown' || k === 't') {
      unlockAudio();
      selectTour(selectedTour === 'grand' ? 'world' : 'grand');
    } else if (k === 'n') { unlockAudio(); toggleIdentity(); }
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
  if (k === 'meta') keyboard.clear();
  else {
    const steeringReleased = isSteeringCode(e.code);
    keyboard.release(e.code);
    // Keyboard steering should stop when the physical key comes up. Retain a
    // hint of bike weight, but kill the long lateral coast that read as a stuck
    // key. Other control sources still use the normal analogue physics path.
    if (steeringReleased && keyboard.direction() === 0 && state.phase === 'playing') player.vx *= 0.12;
  }
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

// Vertical bands of the title-screen tour selector, difficulty selector and
// the identity (guest/nostr) row (fractions of H). Render + tap-zones share
// these so a tap always lands on what the rider sees.
// Title-screen menu geometry, published by renderTitle each frame so the tap
// zones land exactly on the rows the rider sees. Kept in device pixels (u-scaled,
// so tight in both orientations) rather than fixed H-fractions.
let titleMenuX = 0;
let titleMenuW = 0;
let titleTourY = 0;
let titleModeY = 0;
let titleIdentY = 0;

function pointerAction(clientX: number, clientY: number): void {
  // Tap advances title; during play it is handled by steering zones.
  if (state.phase === 'title') {
    // Tapping the tour row picks that tour; the difficulty row picks that
    // mode; the identity row toggles guest/nostr; anywhere else starts the run.
    const { x, y } = canvasPoint(clientX, clientY);
    const u = uiScale();
    if (y > titleTourY - 30 * u && y < titleTourY + 22 * u) {
      selectTour(x < W / 2 ? 'grand' : 'world');
      return;
    }
    if (y > titleModeY - 30 * u && y < titleModeY + 22 * u) {
      const frac = titleMenuW > 0 ? (x - titleMenuX) / titleMenuW : x / W;
      const picked = clamp(Math.floor(frac * MODES.length), 0, MODES.length - 1);
      if (picked !== modeIndex) {
        modeIndex = picked;
        saveModeIndex(modeIndex);
        playSfx('combo', 0.8, 1 + modeIndex * 0.12);
      }
      return;
    }
    if (y > titleIdentY - 18 * u && y < titleIdentY + 14 * u) {
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
  // The on-screen buttons are the deliberate control, so they win outright over
  // the canvas tap-zones — otherwise a stray thumb resting in the right half of
  // the screen would silently cancel a left-button press (and vice versa).
  const touch = buttonSteer !== 0 ? buttonSteer : touchSteer;
  const steer = clamp(touch + pad.steer, -1, 1);
  keyboard.applyTo(input);
  input.left = input.left || steer < 0;
  input.right = input.right || steer > 0;
  input.brake = input.brake || touchBrake || isControlSlowActive() || pad.brake;
  input.throttle = !input.brake; // auto-accelerate; brake overrides
}

// ---- run lifecycle ---------------------------------------------------------

function startRun(): void {
  // Menu navigation and the previous run's lateral momentum must never leak
  // into a fresh race. Both used to make the bike veer with no key held.
  clearAllInput();
  unlockAudio();
  // A run always opens on its tour's first region — start that region's bed
  // (score.distance still holds the LAST run here, so don't use stageMusicUrl).
  startMusic(STAGE_MUSIC[selectedTour][0] ?? MUSIC_URL);
  for (const url of Object.values(VOICE)) if (url) preloadVoiceClip(url);
  for (const url of Object.values(STING)) preloadVoiceClip(url);
  playSfx('rev', 1);
  player.z = 0;
  player.x = 0;
  player.vx = 0;
  player.speed = player.maxSpeed * 0.35;
  player.lean = 0;
  const mode = MODES[modeIndex];
  // The tour must be active BEFORE the world resets: traffic rosters and
  // scenery kits are resolved through the active tour's stage data.
  setActiveTour(selectedTour);
  timer = createTimer(DEFAULT_TIMER);
  score = createScore(mode.scoreMul);
  world.mods.density = mode.density;
  world.mods.speed = mode.speed;
  // The Fren rival showdown belongs to the grand tour's opening three regions;
  // the world tour is the victory lap, ridden without them.
  resetWorld(world, player, track, { rival: selectedTour === 'grand' });
  state.invuln = INVULN_TIME;
  state.wipeout = 0;
  state.spinTimer = 0;
  state.runTime = 0;
  state.lastMilestoneKm = 0;
  state.lastStageIndex = 0;
  state.lastGateSpawned = 0;
  state.finishSpawned = false;
  // Land the finish tape at the end of a straight so the arch reads from far out
  // (the nominal distance falls mid-corner — see alignFinishToStraight).
  state.finishDistance = alignFinishToStraight(track, finishDistanceM());
  state.outcome = 'time';
  state.finishBonus = 0;
  state.finishTimeLeft = 0;
  state.confettiAccum = 0;
  state.fireworkAccum = 0;
  state.victoryTime = 0;
  state.canAccum = 0;
  state.roseAccum = 0;
  state.emergencyArmed = true;
  state.timeFrozen = 0;
  state.voiceCooldown = 0;
  state.stingCooldown = 0;
  state.popups = [];
  state.sparks = [];
  state.fireworks = [];
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
  state.flow = createFlow();
  state.stageStartedAt = 0;
  state.stageStartCrashes = 0;
  state.stageFlowPeak = 0;
  state.stageResults = [];
  state.rivalIntro = selectedTour === 'grand' ? 3.4 : 0;
  state.rivalResult = null;
  state.rivalResultTime = 0;
  resetGearbox();
  resetDrift(player);
  resetFlick(flick);
  state.enclosure = 0;
  state.camYaw = 0;
  state.camRoll = 0;
  state.camX = 0;
  state.smoke = [];
  state.smokeAccum = 0;
  state.driftArea = 0;
  state.driftHeld = 0;
  state.wasDrifting = false;
  player.maxSpeed = BASE_MAX_SPEED;
  state.runId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  state.runStartedAt = Date.now();
  state.runFinishedAt = 0;
  state.submitted = false;
  state.submitStatus = '';
  state.cheated = false;
  state.lastPlusAt = -1;
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
  // A cheated run (++ level skip) never leaves the machine: local board only.
  if (state.cheated) {
    state.submitted = true;
    state.submitStatus = 'CHEAT USED — SCORE NOT SENT TO GAMESTR';
    setTitleNotice(state.submitStatus);
    return;
  }
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

/**
 * The ++ cheat: teleport to the next stage boundary (or the finish line on the
 * last leg). The normal checkpoint/finish logic fires off the new distance next
 * frame, so region, music, clock bonus and popups all turn over as usual. No
 * distance points are awarded for the skipped road, and the run is flagged so
 * it never claims on gamestr — the local board is as far as a cheat travels.
 */
function skipLevelCheat(): void {
  if (state.phase !== 'playing' || state.paused) return;
  const target = Math.min((stageIndexAt(score.distance) + 1) * STAGE_M, finishDistanceM());
  const firstUse = !state.cheated;
  state.cheated = true;
  score.distance = target;
  // Keep the world's odometer in step: traffic rosters and scenery hitboxes
  // resolve off it, and a lagging odometer would mismatch the drawn region.
  world.odometerM = target;
  // Boundaries we jumped clean over can't spawn their gate arches any more —
  // mark them handled so later gates (and the finish arch) still appear.
  state.lastGateSpawned = Math.max(state.lastGateSpawned, stageIndexAt(target));
  state.lastMilestoneKm = Math.floor(target / 1000);
  playSfx('combo', 0.9, 1.5);
  addPopup(state.popups, 'LEVEL SKIP!', W / 2, H * 0.42, '#ffd76b', 1.4);
  if (firstUse) {
    addPopup(state.popups, 'CHEAT ON — THIS RUN STAYS OFF GAMESTR', W / 2, H * 0.48, '#ff9b9b', 2.2);
  }
}

/** Abandon the run from the pause screen — no score entry, straight home. */
function quitRun(): void {
  state.paused = false;
  state.phase = 'title';
  startMusic(MUSIC_URL); // the title always rides the main theme
  playSfx('milestone', 0.6, 0.8);
}

/**
 * The 42s "treat" slot: usually a rose, but sometimes a Neon-Sentinel-flavoured
 * special. Weighted so roses stay the headline and the rare ones feel rare.
 */
function pickTreatKind(): PickupKind {
  const r = Math.random();
  // The Taj Mahal finale of the world tour is one long rose garden — its treat
  // slot is nearly all roses (with cake keeping the ceremony fed).
  if (roseRichAt(score.distance)) {
    if (r < 0.78) return 'rose';
    if (r < 0.87) return 'cake';
    if (r < 0.95) return 'wholecake';
    return 'fourtwenty';
  }
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

function rewardFlow(amount: number, hold = 1.45): void {
  const tierUp = gainFlow(state.flow, amount, hold);
  state.stageFlowPeak = Math.max(state.stageFlowPeak, state.flow.value);
  if (tierUp) {
    playSfx('combo', 0.8, flowMultiplier(state.flow));
    addPopup(
      state.popups,
      `FREN FLOW — ${flowLabel(state.flow)}  x${flowMultiplier(state.flow).toFixed(2)}`,
      W / 2,
      H * 0.56,
      '#ffd76b',
      1.25,
    );
  }
}

function finishStage(stageIndex: number, rivalGap: number | null): StageResult {
  const existing = state.stageResults[stageIndex];
  if (existing) return existing;
  const result = gradeStage({
    elapsedS: Math.max(0, state.runTime - state.stageStartedAt),
    crashes: Math.max(0, score.crashes - state.stageStartCrashes),
    peakFlow: Math.max(state.stageFlowPeak, state.flow.value),
    rivalGapM: rivalGap,
  });
  state.stageResults[stageIndex] = result;
  state.stageStartedAt = state.runTime;
  state.stageStartCrashes = score.crashes;
  state.stageFlowPeak = state.flow.value;
  return result;
}

function resolveOpeningRivalTour(): void {
  const rival = getRival(world);
  if (!rival?.rival || state.rivalResult) return;
  const result = resolveRivalResult(rival.rival, state.runTime);
  state.rivalResult = result;
  state.rivalResultTime = 4.6;
  if (result.won) {
    rewardFlow(25, 2.4);
    addStuntBonus(score, RIVAL_WIN_BONUS, flowMultiplier(state.flow));
    playSfx('milestone', 1);
    playSfx('overtake', 1, 1.3);
    vibrate([30, 35, 70]);
  } else {
    playSfx('nearMiss', 0.8, 0.75);
  }
  retireRival(world);
}

// A wipeout is now purely a momentary spin-out: you lose your momentum and your
// pickup streak, which costs you time on the clock — but it NO LONGER ends the
// run. The clock is the only thing that can finish you (out of time), so runs
// end when the timer expires, never on a tally of crashes.
function startWipeout(reason: 'crash' | 'spin' = 'crash'): void {
  if (state.wipeout > 0) return;
  state.wipeout = 0.0001;
  state.spinTimer = SPIN_TIME;
  state.drafting = 0;
  state.draftCharge = 0;
  state.slingshot = 0;
  // Any slide in progress is FORFEIT. A drift only pays when it is caught, so
  // binning it has to cost you the whole thing — otherwise the cheapest way to
  // farm drift points would be to wind one up and throw it at the scenery.
  forfeitDrift();
  breakFlow(state.flow);
  registerCrash(score);
  playSfx('crash', 1.1);
  playSfx('wipeout', 0.9);
  vibrate([60, 40, 90]);
  addPopup(state.popups, reason === 'spin' ? 'SPUN IT!' : 'WIPEOUT!', W / 2, H * 0.5, '#ff5d78', 1.3);
}

/** Throw away the slide in progress — nothing banked, angle wiped. */
function forfeitDrift(): void {
  resetDrift(player);
  resetFlick(flick);
  state.driftArea = 0;
  state.driftHeld = 0;
  state.wasDrifting = false;
}

/** How far the eye is currently trailing the bike, capped so it stays in frame. */
function camLag(): number {
  return clamp(player.x - state.camX, -CAM.maxLag, CAM.maxLag);
}

/**
 * Take a hit — from clipping something, or from spinning a slide you got greedy
 * with. Both resolve identically, including the HODL shield: it absorbs your own
 * mistakes as readily as the road's, which is the only reading of "absorbs one
 * wipeout" that doesn't need a footnote.
 */
function takeHit(reason: 'crash' | 'spin'): void {
  if (!state.shield) {
    startWipeout(reason);
    return;
  }
  // The shield eats it: no spin-out, no streak loss — just a moment of grace to
  // get clear of whatever you clipped.
  state.shield = false;
  state.invuln = Math.max(state.invuln, 1.2);
  state.flash = 0.6;
  forfeitDrift();
  playSfx('milestone', 0.9);
  playSfx('nearMiss', 0.8);
  vibrate([25, 30, 25]);
  addPopup(state.popups, 'SHIELD SAVED YOU!', W / 2, H * 0.5, '#8fd0ff', 1.5);
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
  startMusic(MUSIC_URL); // back to the main theme for the card + title
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
  startMusic(MUSIC_URL); // the celebration rides the main theme
  finishStage(levelCount() - 1, null);
  snapshotBitcoin();
  state.finishTimeLeft = timer.timeLeft;
  const bonus = Math.ceil(Math.max(0, timer.timeLeft)) * TIME_BONUS_PER_SEC;
  state.finishBonus = bonus;
  score.score += bonus; // flat goal bonus (no streak multiplier)
  state.runFinishedAt = Date.now();
  state.summary = summarise(score, state.runTime, 'finish');
  state.qualifies = qualifies(board, state.summary.score);
  state.nameValue = '';
  state.phase = 'victory';
  state.victoryTime = 0;
  state.confettiAccum = 0;
  state.fireworkAccum = 0;
  state.fireworks = [];
  if (!state.qualifies) submitRunScore();
  playSfx('milestone', 1);
  playSfx('combo', 0.9);
  playSting(STING.checkpoint, 1);
  spawnConfetti(90);
  spawnFireworkBurst(W * 0.22, H * 0.22);
  spawnFireworkBurst(W * 0.5, H * 0.13);
  spawnFireworkBurst(W * 0.78, H * 0.25);
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
  updateFireworks(dt);
  if (devPaused) return; // dev-only: freeze physics so art can be inspected
  if (state.phase !== 'playing') {
    pollPadMenu();
    keyboard.clear();
    clearTouchInput();
    updateEngine({ playing: false, speed: 0, throttle: 0 });
    silenceTraffic();
    updateEcho({ amount: 0 });
    updateRumble({ active: false, intensity: 0, speed: 0 });
    updateScreech({ active: false, load: 0, speed: 0 });
    updateTurbo({ active: false, intensity: 0 });
    // Keep the whole finish spectacular alive through the hero shot and the
    // following score card.
    if ((state.phase === 'victory' || state.phase === 'gameover') && state.outcome === 'finish') {
      state.confettiAccum += dt;
      if (state.confettiAccum >= 0.45) {
        state.confettiAccum -= 0.45;
        spawnConfetti(16);
      }
      state.fireworkAccum += dt;
      if (state.fireworkAccum >= 0.58) {
        state.fireworkAccum -= 0.58;
        spawnFireworkBurst();
      }
    }
    if (state.phase === 'victory') {
      state.victoryTime += dt;
      if (state.victoryTime >= VICTORY_SHOW_TIME) state.phase = 'gameover';
    }
    return;
  }

  // Paused: hold the clock, physics and world exactly where they are; just
  // keep the audio chains silent until Escape (or a tap) resumes.
  if (state.paused) {
    updateEngine({ playing: false, speed: 0, throttle: 0 });
    silenceTraffic();
    updateRumble({ active: false, intensity: 0, speed: 0 });
    updateScreech({ active: false, load: 0, speed: 0 });
    updateTurbo({ active: false, intensity: 0 });
    return;
  }

  state.runTime += dt;
  state.rivalIntro = Math.max(0, state.rivalIntro - dt);
  state.rivalResultTime = Math.max(0, state.rivalResultTime - dt);
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

  // Watch the steer direction for a flick (hold one way, stab the other, pin it
  // back) and arm the drift entry for this step. Read BEFORE the wipeout override
  // zeroes the input, and suppressed during a spin so a tumble can't trip it.
  const steerDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  input.flick = state.wipeout > 0 ? 0 : updateFlick(flick, steerDir, dt);

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
  const seg = updatePlayer(player, track, input, dt);
  const moved = ((player.z - prevZ + track.length) % track.length);
  addDistance(score, moved / 100, speedKph(player));

  // Wound the slide past full lock: the bike is gone. Same consequence as any
  // other wipeout — and the shield will still save you from your own greed.
  if (player.spinOut) takeHit('spin');

  // --- powerslide: accrue while sideways, pay out only on a clean catch -------
  const speedFrac = player.speed / BASE_MAX_SPEED;
  if (player.drifting) {
    state.driftHeld += dt;
    state.driftArea += player.slip * clamp(speedFrac, 0, 1.3) * dt;
  } else if (state.wasDrifting) {
    const points = addDrift(score, state.driftHeld, state.driftArea, flowMultiplier(state.flow));
    if (points > 0) {
      rewardFlow(FLOW_GAINS.nearMiss);
      playSfx('combo', 1, 1.25);
      playSfx('overtake', 0.6, 1.2);
      vibrate(18);
      const label = state.driftHeld >= 2 ? 'BIG DRIFT' : 'DRIFT';
      addPopup(state.popups, `${label}  +${points.toLocaleString('en-GB')}`, W / 2, H * 0.56, '#8fd0ff', 1.3);
    }
    state.driftArea = 0;
    state.driftHeld = 0;
  }
  state.wasDrifting = player.drifting;

  // --- camera: yaw into the corner, bank with the bike, trail it laterally ----
  const curveT = clamp(seg.curve / CURVE_REF, -1, 1);
  const camSpeed = clamp(speedFrac, 0, 1);
  const yawTarget = clamp(
    curveT * camSpeed * CAM.yawFromCurve + player.yaw * CAM.yawFromSlip,
    -CAM.maxYaw,
    CAM.maxYaw,
  );
  const rollTarget = clamp(
    player.lean * CAM.rollFromLean + curveT * camSpeed * CAM.rollFromCurve,
    -CAM.maxRoll,
    CAM.maxRoll,
  );
  state.camYaw = approach(state.camYaw, yawTarget, CAM.yawRate, dt);
  state.camRoll = approach(state.camRoll, rollTarget, CAM.rollRate, dt);
  state.camX = approach(state.camX, player.x, CAM.lagRate, dt);

  // --- tyre smoke: off the back in a slide, off both wheels in the dirt -------
  const slideSmoke = player.drifting && player.slip > SMOKE_SLIP
    ? clamp((player.slip - SMOKE_SLIP) / (SMOKE_FULL - SMOKE_SLIP), 0, 1)
    : 0;
  const dirtSmoke = player.offRoad ? clamp((Math.abs(player.x) - 1) / 0.5, 0, 1) * camSpeed : 0;
  const puff = Math.max(slideSmoke, dirtSmoke);
  if (puff > 0.02 && state.wipeout === 0) {
    const rx = riderScreenX(W, state.camYaw, camLag());
    const ry = H * RIDER_SCREEN_FRAC;
    const dir = player.drifting ? player.driftDir : Math.sign(player.x) || 1;
    state.smokeAccum += puff * SMOKE_RATE * dt;
    while (state.smokeAccum >= 1) {
      state.smokeAccum -= 1;
      spawnSmoke(state.smoke, rx, ry, dir, puff, riderSize(W, H), dirtSmoke > slideSmoke);
    }
  } else {
    state.smokeAccum = 0;
  }
  updateSmoke(state.smoke, dt);

  // Reaching the active tour's finish line completes the run — victory flow.
  if (score.distance >= state.finishDistance) {
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
      if (ev.kind !== 'fiatnam') rewardFlow(FLOW_GAINS.pickup);
      const actionMul = flowMultiplier(state.flow);
      switch (ev.kind) {
        case 'rose':
          // Rose = rare NITRO: time + speed boost + big score + voice.
          addRoseTime(timer, DEFAULT_TIMER);
          addRoseTime(timer, DEFAULT_TIMER);
          addRose(score, actionMul);
          state.boost = ROSE_BOOST_TIME;
          playSfx('milestone', 0.9);
          playSfx('overtake', 0.7);
          playVoice('rose');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'TURBO!', bx, by - H * 0.06, '#ff5d78', 1.5);
          break;
        case 'cake':
          addRoseTime(timer, DEFAULT_TIMER);
          addBonus(score, 250, actionMul);
          playSfx('rose', 1, 1.1);
          playVoice('cake');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, `CAKE!  +${topUp}s`, bx, by - H * 0.06, '#ffd1e0', 1.2);
          break;
        case 'wholecake':
          addRoseTime(timer, DEFAULT_TIMER);
          addRoseTime(timer, DEFAULT_TIMER);
          addBonus(score, 600, actionMul);
          playSfx('milestone', 0.85);
          playVoice('wholecake');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'WHOLE CAKE, SIR!', bx, by - H * 0.06, '#ffd1e0', 1.5);
          break;
        case 'meme':
          addBonus(score, 300, actionMul);
          playSfx('overtake', 0.8);
          playVoice('meme');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'MEME!', bx, by - H * 0.06, '#8fe6c4', 1.2);
          break;
        case 'ath':
          addBonus(score, 1000, actionMul);
          state.flash = 0.7;
          playSfx('milestone', 1);
          playSfx('combo', 0.9);
          playVoice('ath');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'ALL-TIME HIGH!', W / 2, H * 0.44, '#3fff7a', 1.8);
          break;
        case 'timelock':
          state.timeFrozen = Math.max(state.timeFrozen, 10);
          addBonus(score, 150, actionMul);
          playSfx('milestone', 0.7);
          playVoice('timelock');
          spawnRoseBurst(bx, by, 'petrol');
          addPopup(state.popups, 'TIME LOCK', W / 2, H * 0.5, '#8fd0ff', 1.6);
          break;
        case 'fourtwenty':
          state.timeFrozen = Math.max(state.timeFrozen, 21);
          addBonus(score, 420, actionMul);
          playSfx('milestone', 0.8);
          playVoice('fourtwenty');
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, '4:20 — CLOCK PAUSED 21s', W / 2, H * 0.5, '#c8ff8f', 1.9);
          break;
        case 'beer':
          // Beer: faster for a bit — but the world goes wobbly for longer.
          addBonus(score, 150, actionMul);
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
          addBonus(score, 300, actionMul);
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
          addBonus(score, 300, actionMul);
          playSfx('milestone', 0.8);
          playSfx('combo', 0.9, 1.3);
          spawnRoseBurst(bx, by, 'rose');
          addPopup(state.popups, 'HODL SHIELD!', bx, by - H * 0.06, '#8fd0ff', 1.5);
          break;
        case 'fiatnam':
          breakFlow(state.flow);
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
          addFuel(score, actionMul);
          playSfx('rose', 1, 1 + Math.min(score.roseStreak, 6) * 0.05);
          if (score.roseStreak > 1) playSfx('combo', 0.8, 1 + score.roseStreak * 0.06);
          spawnRoseBurst(bx, by, 'petrol');
          addPopup(state.popups, `+${DEFAULT_TIMER.canBonus}s`, bx, by - H * 0.06, '#ffd76b', 1.1);
          break;
      }
    } else if (ev.type === 'crash') {
      takeHit('crash');
    } else if (ev.type === 'overtake') {
      rewardFlow(FLOW_GAINS.overtake);
      addOvertake(score, flowMultiplier(state.flow));
      playSfx('overtake', 0.8);
      // Hear it go past: Doppler-swept, panned to the side it actually went by.
      playPassBy(ev.side, 0.45 + ev.closing * 1.1);
      // A "wuh!" shout when you're carving through the pack (streak of 2+).
      if (score.overtakes >= 2) playSting(STING.overtake, 0.9);
    } else if (ev.type === 'nearMiss') {
      rewardFlow(FLOW_GAINS.nearMiss);
      addNearMiss(score, flowMultiplier(state.flow));
      playSfx('nearMiss', 0.7);
      addPopup(state.popups, 'NEAR MISS', W * 0.5, H * 0.62, '#ffd76b', 0.9);
    } else if (ev.type === 'rivalPass') {
      addPopup(state.popups, 'YOU PASSED THE FREN!', W / 2, H * 0.48, '#8fe6c4', 1.35);
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
      rewardFlow(FLOW_GAINS.slingshot);
      addStuntBonus(score, Math.round(200 * state.draftCharge), flowMultiplier(state.flow));
      playSfx('overtake', 1, 1.3);
      playSfx('nearMiss', 0.5, 0.8);
      vibrate(20);
      addPopup(state.popups, 'SLINGSHOT!', W / 2, H * 0.58, '#8fd0ff', 1.2);
      state.draftCharge = 0;
    }
    state.draftCharge = Math.max(0, state.draftCharge - dt / DRAFT_DECAY_TIME);
  }
  state.drafting = draftNow;
  tickFlow(state.flow, dt, draftNow);
  state.stageFlowPeak = Math.max(state.stageFlowPeak, state.flow.value);

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
  // At the rose-rich Taj Mahal finale the treat clock runs twice as fast, so
  // the promised wall of roses actually materialises on the road.
  const roseEvery = roseRichAt(score.distance) ? ROSE_INTERVAL / 2 : ROSE_INTERVAL;
  state.roseAccum += dt;
  if (state.roseAccum >= roseEvery) {
    state.roseAccum -= roseEvery;
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
    const completedStageIndex = stageIdx - 1;
    const rivalGap = completedStageIndex < 3 ? getRivalGapM(world, score.distance) : null;
    const stageResult = finishStage(completedStageIndex, rivalGap);
    state.lastStageIndex = stageIdx;
    timer.timeLeft = clamp(timer.timeLeft + CHECKPOINT_BONUS, 0, DEFAULT_TIMER.maxTime);
    const stage = stageAt(score.distance);
    // Regions can carry their own music bed (Old Prague does) — swap on the
    // checkpoint so the tune turns over with the scenery.
    startMusic(stageMusicUrl());
    playSfx('milestone', 0.9);
    playSfx('combo', 0.7);
    playSting(STING.checkpoint, 1);
    vibrate([20, 40, 20]);
    addPopup(state.popups, 'CHECKPOINT', W / 2, H * 0.24, '#8fe6c4', 1.3);
    addPopup(state.popups, `LEVEL ${stage.index + 1} / ${levelCount()}`, W / 2, H * 0.3, '#ffffff', 1.7);
    addPopup(state.popups, stage.name, W / 2, H * 0.37, '#ffd76b', 1.9);
    addPopup(state.popups, marketPhaseAt(score.distance), W / 2, H * 0.43, '#9fd0ff', 1.7);
    addPopup(
      state.popups,
      `STAGE ${completedStageIndex + 1} — ${stageResult.grade} RANK  ·  ${stageResult.rating}`,
      W / 2,
      H * 0.5,
      stageResult.grade === 'S' ? '#ffd76b' : '#ffffff',
      2.2,
    );
    if (rivalGap !== null && completedStageIndex < 2) {
      const split = rivalGap >= 0
        ? `FREN AHEAD  ${Math.round(rivalGap)}m`
        : `YOU AHEAD  ${Math.round(-rivalGap)}m`;
      addPopup(state.popups, split, W / 2, H * 0.56, rivalGap >= 0 ? '#ff9b9b' : '#8fe6c4', 2.2);
    }
    if (completedStageIndex === 2) resolveOpeningRivalTour();
  }

  // Drop the checkpoint gate / finish arch onto the road as each boundary nears,
  // so the rider physically drives through it as the region turns over.
  const nextGate = state.lastGateSpawned + 1;
  if (nextGate <= levelCount() - 1) {
    const ahead = nextGate * STAGE_M - score.distance;
    if (ahead > 0 && ahead <= MARKER_LOOKAHEAD_M) {
      addMarker(world, player, track, 'prop-gate', ahead, 'gate');
      state.lastGateSpawned = nextGate;
    }
  }
  if (!state.finishSpawned) {
    const ahead = state.finishDistance - score.distance;
    // A bigger lead than the checkpoint gates: the finish now stands at the end
    // of a straight, so dropping it early lets the rider see the tape coming all
    // the way down the run-in instead of having it appear at the last second.
    if (ahead > 0 && ahead <= FINISH_LOOKAHEAD_M) {
      addMarker(world, player, track, 'prop-finish', ahead, 'finish');
      // The finish cast stands BEYOND the tape, waving the rider home — the
      // sim freezes the instant the line is crossed, so they are greeted, not
      // run over (standing in front of the tape, the bike drove through them).
      addMarker(world, player, track, 'finish-line-girls', ahead + 14, 'finish');
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

  // Revs are measured against the BASE top speed, never the current one: a turbo
  // RAISES maxSpeed, so normalising against it would make the bike's biggest
  // lunge read as a drop in revs and kick the box down a gear. Against the base
  // ceiling a boost instead pushes past 1.0 and the engine screams into its
  // limiter — which is what a boost should sound like.
  updateEngine({
    playing: true,
    speed: speedFrac,
    throttle: input.throttle ? 1 : 0,
  });

  // The road around you. Cars you are hunting down are audible while you hunt
  // them, panned to the side they are actually on and pitched by how hard you are
  // closing — so the pass-by whoosh is now the END of a sound you have been
  // hearing build, rather than a noise that appears from nowhere as it goes by.
  updateTraffic(audibleTraffic(world, player, track));

  // Under a tunnel or a bridge: the light goes and your own engine comes back at
  // you off the walls. Measured at the BIKE (RIDER_FWD ahead of the eye), not at
  // the camera — the rider is what is under the roof, and the half-second of lag
  // between the two would have the world going dark before the mouth arrives.
  state.enclosure = enclosureAt(track, player.z + RIDER_FWD);
  updateEcho({ amount: state.enclosure });

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
  // scrub starts building past ~30% of that, with the audio engine itself
  // gating out slow turns, and never speaks mid-wipeout.
  // A SLIDE, by definition, means the tyres have already let go — so a powerslide
  // always squeals, in proportion to how far out it is hung. Whichever of the two
  // is screaming louder wins.
  const speedPct = player.speed / player.maxSpeed;
  const corner = clamp((Math.abs(player.vx) / DEFAULT_TUNING.maxSteerVel - 0.3) / 0.7, 0, 1);
  const scrub = Math.max(corner, player.slip);
  updateScreech({
    active: state.wipeout === 0 && scrub > 0,
    load: scrub,
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
  renderScene({ ctx, width: W, height: H, track, player, world, store, time: state.time, wipeout: state.wipeout, boost: state.boost > 0 ? state.boost / ROSE_BOOST_TIME : 0, sling: state.slingshot > 0 ? state.slingshot / SLING_TIME_MAX : 0, draft: state.draftCharge, wobble, trip, palette: paletteAt(score.distance), scenery: sceneryKitAt(score.distance), terrain: terrainAt(score.distance), timeOfDay: timeOfDayAt(score.distance), camYaw: state.camYaw, camRoll: state.camRoll, camLag: camLag(), smoke: state.smoke, enclosure: state.enclosure, hideRider: state.outcome === 'finish' && (state.phase === 'victory' || state.phase === 'gameover') });
  if (state.phase === 'playing') drawSparks(ctx);

  // The game-over card carries the score/stats itself — drawing the live HUD
  // under it just bled the speed/distance pills through the name-entry keys.
  if (state.phase === 'playing') {
    const hud: HudState = {
      gear: currentGear(),
      drifting: player.drifting,
      driftSlip: player.slip,
      driftPoints: driftPayout(score, state.driftHeld, state.driftArea, flowMultiplier(state.flow)),
      score: score.score,
      hiScore: topScore(board),
      timeLeft: timer.timeLeft,
      urgency: timerUrgency(timer),
      speedKph: speedKph(player),
      distanceM: score.distance,
      roseStreak: score.roseStreak,
      level: stageIndexAt(score.distance) + 1,
      levels: levelCount(),
      region: stageAt(score.distance).name,
      shield: state.shield,
      flowValue: state.flow.value,
      flowLabel: flowLabel(state.flow),
      flowMultiplier: flowMultiplier(state.flow),
      rivalGapM: getRivalGapM(world, score.distance),
      rivalIntro: state.rivalIntro,
      rivalResult: state.rivalResult,
      rivalResultTime: state.rivalResultTime,
      popups: state.popups,
    };
    drawHud(ctx, W, H, hud, { bottomInset: mobileHudBottomInset(), scale: uiScale() });
  }

  if (state.phase === 'playing' && state.paused) renderPaused();
  if (state.phase === 'victory') renderVictory(store);
  if (state.phase === 'gameover') renderGameOver(store);
  // Confetti pops over both celebration layers, never behind their scrims.
  if ((state.phase === 'victory' || state.phase === 'gameover') && state.outcome === 'finish') drawSparks(ctx);
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

// A soft rounded panel — groups the title menus and leaderboard so text reads
// cleanly over the busy key art. Optional stroke for an arcade-cabinet edge.
function panel(x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, lw = 2): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

// Arcade leaderboard rows inside a framed panel: gold/silver/bronze badges for
// the podium, callsign left, score right. Shared by the local + gamestr boards.
function drawLeaderboard(
  title: string,
  rows: readonly { name: string; score: number }[],
  x: number, y: number, w: number, u: number,
): void {
  const rowH = 26 * u;
  const headH = 30 * u;
  const h = headH + rows.length * rowH + 12 * u;
  panel(x, y, w, h, 14 * u, 'rgba(6,16,26,0.74)', 'rgba(255,215,110,0.5)', 1.5 * u);
  ctx.textAlign = 'center';
  ctx.font = `800 ${15 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(title, x + w / 2, y + 21 * u, '#ffd76b', u, 4);
  const medal = ['#ffd23f', '#cfd8e0', '#d99154'];
  const padL = 20 * u;
  const padR = w - 20 * u;
  rows.forEach((e, i) => {
    const ry = y + headH + i * rowH + 18 * u;
    // rank badge
    const bx = x + padL + 6 * u;
    if (i < 3) {
      ctx.beginPath();
      ctx.arc(bx, ry - 5 * u, 9 * u, 0, Math.PI * 2);
      ctx.fillStyle = medal[i];
      ctx.fill();
      ctx.fillStyle = '#0a1a12';
      ctx.font = `900 ${12 * u}px 'Trebuchet MS', sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), bx, ry - 0.5 * u);
    } else {
      ctx.textAlign = 'center';
      ctx.font = `800 ${13 * u}px 'Trebuchet MS', sans-serif`;
      outlinedText(String(i + 1), bx, ry, 'rgba(255,255,255,0.6)', u, 3);
    }
    ctx.textAlign = 'left';
    ctx.font = `800 ${16 * u}px 'Trebuchet MS', sans-serif`;
    outlinedText(e.name, x + padL + 24 * u, ry, '#ffffff', u, 4);
    ctx.textAlign = 'right';
    outlinedText(e.score.toLocaleString('en-GB'), x + padR, ry, '#8fe6c4', u, 4);
  });
  ctx.textAlign = 'center';
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

  // A single full-frame wash so the panels + logo pop off the busy key art —
  // brighter behind the logo, deeper behind the leaderboard.
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0, 'rgba(5,14,24,0.74)');
  wash.addColorStop(0.30, 'rgba(5,14,24,0.28)');
  wash.addColorStop(0.58, 'rgba(5,14,24,0.5)');
  wash.addColorStop(1, 'rgba(5,14,24,0.93)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';

  // --- logo -----------------------------------------------------------------
  // Portrait drops the logo a touch to clear the top-right SUPPORT button.
  const logoY = H * (portrait ? 0.135 : 0.145);
  // Also capped by height: on a landscape PHONE the touch-floored u would
  // otherwise push the logo's cap line above the top of the frame.
  const titleSize = Math.min((portrait ? 58 : 104) * u, W * (portrait ? 0.125 : 0.11), H * 0.16);
  ctx.font = `900 ${titleSize}px 'Trebuchet MS', sans-serif`;
  outlinedText('HANG ON, FREN', W / 2, logoY, '#ffd23f', u, 9);
  ctx.font = `700 ${(portrait ? 13 : 18) * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(
    selectedTour === 'world' ? 'THE 600B VICTORY LAP' : 'AN ENDLESS RIVIERA VESPA ROAD-TRIBUTE',
    W / 2, logoY + (portrait ? 24 : 34) * u, '#bfe9ff', u, 4,
  );

  // --- menu cabinet: tour + difficulty selectors ---------------------------
  // Laid out in u-space from the cabinet top, so it stays tight whether the
  // screen is wide or tall; tap anchors are published in pixels below.
  const cabW = portrait ? W * 0.9 : W * 0.6;
  const cabX = (W - cabW) / 2;
  const cabY = H * (portrait ? 0.29 : 0.235);
  const cabH = 244 * u;
  const tourLabelY = cabY + 30 * u;
  const tourY = cabY + 66 * u;
  const tourDetailY = cabY + 92 * u;
  const dividerY = cabY + 118 * u;
  const diffLabelY = cabY + 136 * u;
  const modeY = cabY + 172 * u;
  const modeTagY = cabY + 197 * u;
  const hintY = cabY + 226 * u;
  titleMenuX = cabX;
  titleMenuW = cabW;
  titleTourY = tourY;
  titleModeY = modeY;
  panel(cabX, cabY, cabW, cabH, 20 * u, 'rgba(7,17,28,0.78)', 'rgba(255,215,110,0.4)', 1.5 * u);

  // tour selector — tap the left half for GRAND, the right half for the WORLD tour
  ctx.font = `800 ${12 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(isTouch ? 'TOUR   ·   TAP TO SWITCH' : 'TOUR   ·   ▲▼ / T · TAP', W / 2, tourLabelY, '#9fd0ff', u, 3);
  (['grand', 'world'] as const).forEach((tour, i) => {
    const x = cabX + cabW * (i === 0 ? 0.28 : 0.72);
    const sel = tour === selectedTour;
    ctx.font = `${sel ? 900 : 700} ${(sel ? 22 : 15) * u}px 'Trebuchet MS', sans-serif`;
    outlinedText(TOUR_TITLES[tour], x, tourY, sel ? '#ffd23f' : 'rgba(255,255,255,0.5)', u, sel ? 5 : 4);
  });
  ctx.font = `700 ${13 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(
    selectedTour === 'world'
      ? 'MANCHESTER · PRAGUE · MALLORCA · TAJ MAHAL'
      : `FREN RIVAL SHOWDOWN · ${(RIVAL_TOUR_FINISH_M / 1000).toFixed(1)} KM`,
    W / 2, tourDetailY, '#8fe6c4', u, 3,
  );

  // difficulty selector — tap across the row (left→right = CRUISE→DEGEN)
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cabX + 26 * u, dividerY);
  ctx.lineTo(cabX + cabW - 26 * u, dividerY);
  ctx.stroke();
  ctx.font = `800 ${12 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(isTouch ? 'DIFFICULTY   ·   TAP TO PICK' : 'DIFFICULTY   ·   ◄ ► · TAP', W / 2, diffLabelY, '#9fd0ff', u, 3);
  MODES.forEach((m, i) => {
    const x = cabX + cabW * ((i * 2 + 1) / (MODES.length * 2));
    const sel = i === modeIndex;
    ctx.font = `${sel ? 900 : 700} ${(sel ? 26 : 18) * u}px 'Trebuchet MS', sans-serif`;
    outlinedText(m.label, x, modeY, sel ? '#ffd23f' : 'rgba(255,255,255,0.5)', u, sel ? 6 : 4);
  });
  ctx.font = `600 ${14 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(MODES[modeIndex].tagline, W / 2, modeTagY, '#bdeddb', u, 4);
  // one compact control cue, tucked into the cabinet footer
  ctx.font = `700 ${11 * u}px 'Trebuchet MS', sans-serif`;
  outlinedText(
    isTouch
      ? 'FUEL = TIME · ROSES = TURBO · FLICK TO DRIFT'
      : '◄ ► STEER · GRAB FUEL FOR TIME · ROSES = TURBO · FLICK THE BARS TO DRIFT',
    W / 2, hintY, 'rgba(159,208,255,0.85)', u, 3,
  );

  // --- primary call to action: a steady pill so it always reads on the art ---
  const ctaY = cabY + cabH + 46 * u;
  const cta = isTouch ? 'TAP TO RIDE' : 'PRESS ENTER / TAP TO RIDE';
  const ctaSize = (portrait ? 24 : 30) * u;
  ctx.font = `900 ${ctaSize}px 'Trebuchet MS', sans-serif`;
  const ctaW = ctx.measureText(cta).width + 48 * u;
  const ctaH = ctaSize + 22 * u;
  panel(W / 2 - ctaW / 2, ctaY - ctaSize * 0.78 - 6 * u, ctaW, ctaH, ctaH / 2, 'rgba(7,17,28,0.82)', 'rgba(255,215,110,0.6)', 1.5 * u);
  const blink = Math.floor(state.time * 2) % 2 === 0;
  outlinedText(cta, W / 2, ctaY, blink ? '#ffd23f' : '#ffffff', u, 6);

  // identity row: who signs your gamestr scores (tap / N to switch)
  const identY = cabY + cabH + 84 * u;
  titleIdentY = identY;
  ctx.font = `700 ${13 * u}px 'Trebuchet MS', sans-serif`;
  if (state.titleNotice.text && state.time < state.titleNotice.until) {
    outlinedText(state.titleNotice.text, W / 2, identY, '#8fe6c4', u, 4);
  } else {
    const id = getIdentity();
    const label = id.mode === 'nostr'
      ? `RIDING AS  NOSTR · ${id.name}   —   N / TAP FOR GUEST`
      : `RIDING AS  GUEST · ${id.name}   —   N / TAP FOR NOSTR`;
    outlinedText(label, W / 2, identY, '#9fd0ff', u, 4);
  }

  // --- leaderboard: alternates local best riders / global gamestr board -----
  // Show only as many rows as actually fit above the bottom edge (a landscape
  // phone runs out of height), and drop the board entirely rather than draw a
  // panel that runs off the frame.
  const showGlobal = state.globalBoard.length > 0 && Math.floor(state.time / 6) % 2 === 1;
  const lbY = cabY + cabH + 104 * u;
  // (clamped at 0 — a negative fit would flow through slice() as "all but the
  // last row" and draw the panel half off the frame anyway)
  const lbRowsFit = Math.max(0, Math.floor((H - lbY - 16 * u - 42 * u) / (26 * u)));
  const rows = (showGlobal ? state.globalBoard : board).slice(0, Math.min(5, lbRowsFit));
  if (rows.length > 0) {
    const lbW = portrait ? W * 0.9 : W * 0.44;
    drawLeaderboard(showGlobal ? 'TOP FRENS · GAMESTR' : 'BEST RIDERS', rows, (W - lbW) / 2, lbY, lbW, u);
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

function drawCheckeredRibbon(y: number, height: number): void {
  const sq = Math.max(10, Math.round(height / 2));
  for (let row = 0; row < 2; row += 1) {
    for (let x = 0, col = 0; x < W; x += sq, col += 1) {
      ctx.fillStyle = (row + col) % 2 ? '#f7f4df' : '#11131a';
      ctx.fillRect(x, y + row * sq, sq + 1, sq + 1);
    }
  }
}

function drawFinishCast(store: SpriteStore): void {
  const cast = store.get('finish-line-girls');
  if (!cast) return;
  const portrait = H > W;
  const maxW = W * (portrait ? 0.94 : 0.64);
  const maxH = H * (portrait ? 0.5 : 0.62);
  const scale = Math.min(maxW / cast.w, maxH / cast.h);
  const dw = cast.w * scale;
  const dh = cast.h * scale;
  const bounce = Math.round(Math.abs(Math.sin(state.victoryTime * 5.5)) * 4 * uiScale());
  const dx = Math.round((W - dw) / 2);
  const dy = Math.round(H * 0.98 - dh - bounce);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.shadowColor = 'rgba(255,210,63,0.48)';
  ctx.shadowBlur = 18 * uiScale();
  ctx.drawImage(cast.canvas, dx, dy, dw, dh);
  ctx.restore();
}

/** The dedicated five-second finish tableau: race scene still visible behind
 *  fireworks, checkered ribbons, the flag marshal cast and the banked bonus. */
function renderVictory(store: SpriteStore): void {
  const u = uiScale();
  const topShade = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  topShade.addColorStop(0, 'rgba(15,10,30,0.76)');
  topShade.addColorStop(0.72, 'rgba(15,10,30,0.18)');
  topShade.addColorStop(1, 'rgba(15,10,30,0)');
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, W, H * 0.55);
  const groundGlow = ctx.createLinearGradient(0, H * 0.62, 0, H);
  groundGlow.addColorStop(0, 'rgba(255,87,51,0)');
  groundGlow.addColorStop(1, 'rgba(255,70,110,0.36)');
  ctx.fillStyle = groundGlow;
  ctx.fillRect(0, H * 0.6, W, H * 0.4);

  // Above the darkening scrims so every burst punches through the bright
  // golden sky, but behind the cast and typography.
  drawFireworks(ctx);

  drawCheckeredRibbon(0, 28 * u);
  drawCheckeredRibbon(H - 24 * u, 24 * u);
  drawFinishCast(store);

  ctx.textAlign = 'center';
  const pulse = 1 + Math.sin(state.time * 6) * 0.035;
  ctx.save();
  ctx.translate(W / 2, H * 0.16);
  ctx.scale(pulse, pulse);
  ctx.font = `900 ${Math.min(92 * u, W * 0.16)}px 'Trebuchet MS', sans-serif`;
  outlinedText('GOAL!', 0, 0, '#ffd23f', u, 10);
  ctx.restore();
  ctx.font = `900 ${Math.min(31 * u, W * 0.055)}px 'Trebuchet MS', sans-serif`;
  outlinedText(`${TOUR_TITLES[getActiveTour()]} COMPLETE`, W / 2, H * 0.24, '#ffffff', u, 6);
  ctx.font = `800 ${Math.min(23 * u, W * 0.042)}px 'Trebuchet MS', sans-serif`;
  outlinedText(
    `TIME BONUS  ${Math.ceil(state.finishTimeLeft)}s × ${TIME_BONUS_PER_SEC}  =  +${state.finishBonus.toLocaleString('en-GB')}`,
    W / 2,
    H * 0.305,
    '#8fe6c4',
    u,
    5,
  );
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function renderGameOver(_store: SpriteStore): void {
  const s = state.summary;
  if (!s) return;
  const u = uiScale();
  const won = state.outcome === 'finish';
  const entryLayout = state.qualifies ? nameEntryLayout() : null;
  // Treat the result copy as one stack. When the on-screen callsign keyboard is
  // present its real prompt position becomes the lower boundary, so every line
  // moves together instead of the rank line being squeezed into the bonus.
  const defaultStatsY = won ? H * 0.46 : H * 0.44;
  const statsY = entryLayout ? Math.min(defaultStatsY, entryLayout.promptY - 22 * u) : defaultStatsY;
  const bonusY = won && state.finishBonus > 0
    ? (entryLayout ? statsY - 34 * u : H * 0.41)
    : null;
  const scoreY = entryLayout
    ? (bonusY ?? statsY) - 42 * u
    : H * 0.36;
  const subtitleY = entryLayout ? scoreY - 55 * u : H * 0.28;
  const titleY = entryLayout
    ? subtitleY - (won ? 62 : 28) * u
    : H * (won ? 0.2 : 0.24);
  // A darker scrim for a defeat, a warmer one for the victory card.
  ctx.fillStyle = won ? 'rgba(10,26,20,0.66)' : 'rgba(6,19,28,0.72)';
  ctx.fillRect(0, 0, W, H);
  if (won) drawFireworks(ctx);
  ctx.textAlign = 'center';

  // A new board placing gets top billing on the card — the callsign prompt below
  // then banks it. rankOf is 0-based; +1 gives the human "Nth best" position.
  const place = state.qualifies ? rankOf(board, s.score) + 1 : 0;
  if (won) {
    ctx.font = `900 ${72 * u}px 'Trebuchet MS', sans-serif`;
    outlinedText('FINISH!', W / 2, titleY, '#ffd76b', u, 8);
    ctx.font = `800 ${30 * u}px 'Trebuchet MS', sans-serif`;
    if (place > 0) outlinedText(`NEW HIGH SCORE · ${ordinal(place)} BEST!`, W / 2, subtitleY, '#ffd23f', u, 6);
    else outlinedText('YOU REACHED THE GOAL, FREN!', W / 2, subtitleY, '#8fe6c4', u, 6);
  } else {
    ctx.font = `900 ${64 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#ff5d78';
    // The clock is the only way a run ends short (wipeouts cost time, never a life).
    ctx.fillText('OUT OF TIME', W / 2, titleY);
    if (place > 0) {
      ctx.font = `800 ${26 * u}px 'Trebuchet MS', sans-serif`;
      outlinedText(`NEW HIGH SCORE · ${ordinal(place)} BEST!`, W / 2, subtitleY, '#ffd23f', u, 6);
    }
  }

  ctx.font = `800 ${40 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`SCORE  ${s.score.toLocaleString('en-GB')}`, W / 2, scoreY);

  if (bonusY !== null) {
    ctx.font = `700 ${22 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#ffd76b';
    ctx.fillText(
      `TIME BONUS  ${Math.ceil(state.finishTimeLeft)}s × ${TIME_BONUS_PER_SEC}  =  +${state.finishBonus.toLocaleString('en-GB')}`,
      W / 2,
      bonusY,
    );
  }

  ctx.font = `600 ${Math.min(20 * u, W * 0.022)}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = '#8fe6c4';
  const rank = overallGrade(state.stageResults.filter(Boolean));
  const rivalLabel = state.rivalResult ? `RIVAL ${state.rivalResult.won ? 'WIN' : 'LOSS'}   ·   ` : '';
  ctx.fillText(
    `${rivalLabel}RANK ${rank}   ·   ${(s.distanceM / 1000).toFixed(2)} km   ·   ${s.roses} roses   ·   ${s.overtakes} overtakes   ·   ${s.topSpeedKph} km/h top`,
    W / 2,
    statsY,
  );
  // The drift flourish is a secondary line; with the callsign keyboard up the
  // stack is already tight against it, so it only shows when not entering a name.
  if (s.drifts > 0 && !entryLayout) {
    ctx.font = `700 ${Math.min(17 * u, W * 0.019)}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#8fd0ff';
    ctx.fillText(
      `${s.drifts} drift${s.drifts === 1 ? '' : 's'} landed   ·   longest ${s.bestDriftS.toFixed(1)}s sideways`,
      W / 2,
      statsY + 24 * u,
    );
  }

  // gamestr publish status (non-qualifying runs publish immediately; a board
  // run publishes on DONE and the title notice carries the outcome instead).
  if (state.submitStatus && !state.qualifies) {
    ctx.font = `700 ${15 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#9fd0ff';
    ctx.fillText(state.submitStatus, W / 2, won ? H * 0.52 : H * 0.5);
  }

  if (entryLayout) {
    drawNameEntry(ctx, W, uiScale(), state.nameValue, state.time, entryLayout);
  } else {
    const blink = Math.floor(state.time * 2) % 2 === 0;
    if (blink) {
      ctx.font = `800 ${26 * u}px 'Trebuchet MS', sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(isTouch ? 'TAP TO CONTINUE' : 'PRESS ENTER / TAP TO CONTINUE', W / 2, H * 0.64);
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
    showTightCorner: () => {
      const target = track.segments.find(seg => seg.scenery.some(item => item.name.startsWith('prop-chevron-')));
      if (!target) return;
      player.z = Math.max(0, target.index - 24) * ROAD.segmentLength;
      player.speed = player.maxSpeed * 0.72;
    },
    /** Park the bike just before the Nth tunnel / overpass, so it can be reviewed. */
    seekOverhead: (kind: 'tunnel' | 'overpass' = 'tunnel', nth = 0, before = 14) => {
      const found = track.overheads.filter(o => o.kind === kind)[nth];
      if (!found) return false;
      player.z = Math.max(0, found.start - before) * ROAD.segmentLength;
      player.x = 0;
      player.vx = 0;
      return true;
    },
    /** Park the bike out wide at the start of a sustained bend, on the racing line. */
    seekBend: (dir: 1 | -1 = 1, minCurve = 6) => {
      const segs = track.segments;
      for (let i = 0; i < segs.length; i += 1) {
        if (segs[i].curve * dir < minCurve) continue;
        if ((segs[i + 60]?.curve ?? 0) * dir < minCurve) continue;
        player.z = i * ROAD.segmentLength;
        player.x = -0.85 * dir;
        player.vx = 0;
        return true;
      }
      return false;
    },
    showVictory: () => {
      if (state.phase !== 'playing') startRun();
      score.distance = finishDistanceM();
      winRun();
    },
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
    get musicUrl() { return currentMusicUrl(); },
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
  // Buffer the per-region beds before they're needed.
  for (const beds of Object.values(STAGE_MUSIC)) {
    for (const url of Object.values(beds)) preloadMusic(url);
  }
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
