// The pseudo-3D road: a segment-projected racing surface in the classic
// Hang-On / OutRun style. Curves accumulate a horizontal offset and hills
// accumulate a vertical one; each segment is projected with
// `scale = cameraDepth / (segmentZ - cameraZ)`.
//
// The track loops seamlessly (its hills return to zero and its ends are
// straight), so driving is effectively infinite — difficulty and roses are
// driven by total distance elsewhere, not by track position.

import { clamp, easeInOut, lerp, wrap, approach, makeRng, pick } from './util.js';

export const ROAD = {
  segmentLength: 200, // world length of one segment
  rumbleSegments: 3, // segments per rumble stripe
  roadWidth: 2200, // half-width of the tarmac at the camera plane
  lanes: 3,
  drawDistance: 260, // segments drawn ahead of the camera
  cameraHeight: 1150,
  fieldOfView: 100, // degrees
  fogDensity: 6,
} as const;

export const CAMERA_DEPTH = 1 / Math.tan(((ROAD.fieldOfView / 2) * Math.PI) / 180);

/** Screen-height fraction where the rider's wheel contact is drawn (render.ts). */
export const RIDER_SCREEN_FRAC = 0.96;
/**
 * How far AHEAD of the camera the rider visually sits, in world units. The
 * camera is at player.z, but the bike sprite is drawn RIDER_SCREEN_FRAC down the
 * screen, which (flat road) projects to z = cameraDepth·cameraHeight/(2·(frac−½))
 * in front of the camera — about five segments. Collision, pickups and scenery
 * strikes are all tested around THIS point, so things interact at the moment
 * they visually touch the bike, not half a second later when they reach the
 * camera plane.
 */
export const RIDER_FWD = (CAMERA_DEPTH * ROAD.cameraHeight) / (2 * (RIDER_SCREEN_FRAC - 0.5));

export type SegmentColor = 'light' | 'dark';

export interface SceneryItem {
  /** Sprite id resolved by the renderer. */
  name: string;
  /** Horizontal offset in road-widths; negative = left, |offset|>1 = off road. */
  offset: number;
  scale: number;
}

interface ProjectedPoint {
  world: { x: number; y: number; z: number };
  screen: { x: number; y: number; w: number; scale: number };
}

export interface Segment {
  index: number;
  p1: ProjectedPoint;
  p2: ProjectedPoint;
  curve: number;
  color: SegmentColor;
  /** Y-clip set each frame so nearer hills occlude farther sprites. */
  clip: number;
  scenery: SceneryItem[];
}

export interface Track {
  segments: Segment[];
  length: number; // total world length
  /** Named authored set-pieces, used by tests and the dev visual harness. */
  features: Record<TrackFeatureName, TrackFeature>;
}

export type TrackFeatureName = 'billion-bend' | 'blind-summit-west' | 'blind-summit-east';

export interface TrackFeature {
  startIndex: number;
  endIndex: number;
}

function lastY(segments: Segment[]): number {
  return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y;
}

function addSegment(segments: Segment[], curve: number, y: number): void {
  const n = segments.length;
  const prevY = lastY(segments);
  segments.push({
    index: n,
    p1: { world: { x: 0, y: prevY, z: n * ROAD.segmentLength }, screen: { x: 0, y: 0, w: 0, scale: 0 } },
    p2: { world: { x: 0, y, z: (n + 1) * ROAD.segmentLength }, screen: { x: 0, y: 0, w: 0, scale: 0 } },
    curve,
    color: Math.floor(n / ROAD.rumbleSegments) % 2 ? 'dark' : 'light',
    clip: 0,
    scenery: [],
  });
}

function addRoad(
  segments: Segment[],
  enter: number,
  hold: number,
  leave: number,
  curve: number,
  height: number,
): void {
  const startY = lastY(segments);
  const endY = startY + height;
  const total = enter + hold + leave;
  for (let i = 0; i < enter; i += 1) {
    addSegment(segments, lerp(0, curve, easeInOut(i / enter)), lerp(startY, endY, easeInOut(i / total)));
  }
  for (let i = 0; i < hold; i += 1) {
    addSegment(segments, curve, lerp(startY, endY, easeInOut((enter + i) / total)));
  }
  for (let i = 0; i < leave; i += 1) {
    addSegment(segments, lerp(curve, 0, easeInOut(i / leave)), lerp(startY, endY, easeInOut((enter + hold + i) / total)));
  }
}

/** Carry curvature continuously from one authored section into the next. Unlike
 *  addRoad (which always eases back to straight), this is what lets us build a
 *  kilometre-long tightening sweeper that snaps directly across into the
 *  opposite bend without an artificial straight between them. */
function addTransition(
  segments: Segment[],
  length: number,
  fromCurve: number,
  toCurve: number,
  height: number,
): void {
  const startY = lastY(segments);
  const endY = startY + height;
  for (let i = 0; i < length; i += 1) {
    const t = (i + 1) / length;
    const eased = easeInOut(t);
    addSegment(segments, lerp(fromCurve, toCurve, eased), lerp(startY, endY, eased));
  }
}

const LEN = { short: 25, medium: 50, long: 100, epic: 180, ultra: 260 };
const CURVE = { easy: 2, medium: 4, hard: 6.5, evil: 8.5, hairpin: 11 };
const HILL = { low: 1100, medium: 3000, high: 6200, huge: 9500 };
/** Curvature at which roadside chevrons start warning the rider. */
export const TIGHT_CURVE_THRESHOLD = 8;

/**
 * Build a long, varied, seamless-looping Riviera track with real menace: big
 * climbs and crests, plunging descents, fast sweepers — and the nasty stuff:
 * a SNAKE of S-bends with no recovery straights, a deceptive double-apex TRAP
 * that eases mid-corner then bites again, a downhill CORKSCREW of alternating
 * hairpins and a flat-out CHICANE on the run home. All hills return to zero
 * and both ends are straight so wrapping `player.z` past the end is invisible.
 */
export function buildTrack(): Track {
  const s: Segment[] = [];
  const features = {} as Record<TrackFeatureName, TrackFeature>;
  const markFeature = (name: TrackFeatureName, build: () => void): void => {
    const startIndex = s.length;
    build();
    features[name] = { startIndex, endIndex: s.length - 1 };
  };

  addRoad(s, LEN.short, LEN.medium, LEN.short, 0, 0); // flat start straight
  // gentle warm-up bends
  addRoad(s, LEN.medium, LEN.medium, LEN.medium, CURVE.medium, HILL.low);
  addRoad(s, LEN.medium, LEN.short, LEN.medium, -CURVE.hard, -HILL.low);

  // THE BILLION BEND — more than two kilometres of one continuous set-piece.
  // A long left starts lazy, keeps tightening until the rider is fully loaded,
  // hits a hairpin-strength compression, then snaps across into a long right
  // that only gradually releases. There is no fake recovery straight anywhere.
  markFeature('billion-bend', () => {
    addTransition(s, LEN.medium, 0, -CURVE.easy, HILL.low);
    addTransition(s, LEN.ultra, -CURVE.easy, -CURVE.medium, HILL.medium);
    addTransition(s, LEN.epic, -CURVE.medium, -CURVE.hard, HILL.low);
    addTransition(s, LEN.short, -CURVE.hard, -CURVE.hairpin, 0);
    addTransition(s, LEN.short, -CURVE.hairpin, CURVE.hard, -HILL.low);
    addTransition(s, LEN.epic, CURVE.hard, CURVE.medium, -HILL.medium);
    addTransition(s, LEN.ultra, CURVE.medium, CURVE.easy, -HILL.low);
    addTransition(s, LEN.medium, CURVE.easy, 0, 0);
  });

  // big climb into a long right-hander cresting a huge hill
  addRoad(s, LEN.medium, LEN.long, LEN.medium, CURVE.medium, HILL.huge);
  // long left sweeper plunging back down the far side
  addRoad(s, LEN.medium, LEN.long, LEN.long, -CURVE.hard, -HILL.high);
  addRoad(s, LEN.short, LEN.medium, LEN.short, 0, -HILL.medium); // steep drop-away

  // BLIND SUMMIT WEST — the climb shows only sky. The tight left and most of
  // the plunge are deliberately over the crown, hidden until the front wheel
  // gets light at the top.
  markFeature('blind-summit-west', () => {
    addRoad(s, LEN.medium, LEN.long, LEN.short, 0, HILL.huge);
    addTransition(s, LEN.short, 0, -CURVE.hairpin, -HILL.low);
    addTransition(s, LEN.long, -CURVE.hairpin, -CURVE.hard, -(HILL.huge - HILL.low));
    addTransition(s, LEN.medium, -CURVE.hard, 0, 0);
  });

  // THE SNAKE — hard esses flicking left-right-left with NO recovery straights:
  // each bend hands straight into the next, so the bike is always loaded up.
  addRoad(s, LEN.medium, LEN.short, LEN.short, CURVE.hard, HILL.low);
  addRoad(s, LEN.short, LEN.short, LEN.short, -CURVE.hard, HILL.low);
  addRoad(s, LEN.short, LEN.short, LEN.short, CURVE.hard, -HILL.low);
  addRoad(s, LEN.short, LEN.short, LEN.medium, -CURVE.hard, -HILL.low);
  // FIRST HAIRPIN — tight right, then immediately back left, over a rise
  addRoad(s, LEN.short, LEN.short, LEN.short, CURVE.hairpin, HILL.medium);
  addRoad(s, LEN.short, LEN.short, LEN.short, -CURVE.hairpin, -HILL.low);
  // climb to a second crest, then a long downhill right sweeper
  addRoad(s, LEN.medium, LEN.long, LEN.medium, -CURVE.medium, HILL.high);
  addRoad(s, LEN.medium, LEN.long, LEN.long, CURVE.hard, -HILL.high);

  // BLIND SUMMIT EAST — a second skyline trap with the opposite turn direction,
  // so learning the first crest does not make every summit predictable.
  markFeature('blind-summit-east', () => {
    addRoad(s, LEN.medium, LEN.long, LEN.medium, CURVE.easy, HILL.high);
    addTransition(s, LEN.short, 0, CURVE.hairpin, -HILL.low);
    addTransition(s, LEN.long, CURVE.hairpin, CURVE.medium, -(HILL.high - HILL.low));
    addTransition(s, LEN.medium, CURVE.medium, 0, 0);
  });

  // THE TRAP — a deceptive double-apex right: it eases mid-corner just long
  // enough to tempt you back onto the throttle, then tightens again.
  addRoad(s, LEN.medium, LEN.short, LEN.short, CURVE.evil, HILL.low);
  addRoad(s, LEN.short, LEN.short, LEN.short, CURVE.easy, 0); // the false exit…
  addRoad(s, LEN.short, LEN.short, LEN.medium, CURVE.evil, -HILL.low); // …and the second bite
  // SECOND HAIRPIN the other way, cresting a rise
  addRoad(s, LEN.short, LEN.short, LEN.short, -CURVE.hairpin, HILL.medium);
  addRoad(s, LEN.short, LEN.medium, LEN.short, CURVE.hard, -HILL.medium);
  // THE CORKSCREW — three alternating hairpins tumbling down a hillside
  addRoad(s, LEN.short, LEN.short, LEN.short, CURVE.hairpin, -HILL.low);
  addRoad(s, LEN.short, LEN.short, LEN.short, -CURVE.hairpin, -HILL.low);
  addRoad(s, LEN.short, LEN.short, LEN.short, CURVE.hairpin, -HILL.low);
  // flat-out CHICANE — fast left-right-left flicks with the throttle pinned
  addRoad(s, LEN.short, LEN.short, LEN.short, -CURVE.hard, 0);
  addRoad(s, LEN.short, LEN.short, LEN.short, CURVE.hard, 0);
  addRoad(s, LEN.short, LEN.short, LEN.short, -CURVE.hard, HILL.low);
  // sweeping esses back toward the start height
  addRoad(s, LEN.medium, LEN.medium, LEN.medium, -CURVE.medium, HILL.low);
  addRoad(s, LEN.medium, LEN.medium, LEN.medium, CURVE.easy, -HILL.low);
  addRoad(s, LEN.long, LEN.medium, LEN.long, 0, 0); // flat finishing straight

  // Force the seam flat: null any residual height so the loop point is clean.
  const residual = lastY(s);
  if (Math.abs(residual) > 0.5) addRoad(s, LEN.medium, LEN.short, LEN.medium, 0, -residual);

  return { segments: s, length: s.length * ROAD.segmentLength, features };
}

/**
 * Scatter roadside scenery (trees, villas, in-joke signs, meme billboards)
 * across the track. Baked once; loops with the track. `signNames` /
 * `billboardNames` are the variants built from the sprite store at load time.
 */
export function decorateTrack(track: Track, signNames: readonly string[], billboardNames: readonly string[] = [], seed = 0x5ce7e): void {
  const rng = makeRng(seed);
  // Scenery is placed as SLOTS (tree / landmark / accent); the renderer resolves
  // each slot to the current stage's kit (stages.ts) so every leg looks distinct.
  for (let i = 0; i < track.segments.length; i += 1) {
    const seg = track.segments[i];
    seg.scenery = [];
    if (i % 6 === 0) seg.scenery.push({ name: 'slot:tree', offset: -(1.4 + rng() * 0.9), scale: 1 });
    if (i % 6 === 3) seg.scenery.push({ name: 'slot:tree', offset: 1.4 + rng() * 0.9, scale: 1 });
    if (i % 31 === 0) seg.scenery.push({ name: 'slot:landmark', offset: -(2.9 + rng() * 1.3), scale: 1 });
    if (i % 17 === 8) seg.scenery.push({ name: 'slot:accent', offset: (rng() < 0.5 ? -1 : 1) * (1.5 + rng() * 0.55), scale: 1 });
    if (i % 47 === 11 && signNames.length) seg.scenery.push({ name: pick(rng, signNames), offset: 1.7 + rng() * 0.25, scale: 1 });
  }

  // Tight-corner warning rows. These follow the OUTSIDE of evil bends and
  // hairpins, with arrows pointing into the turn: positive curvature is a
  // right-hander (the bike is pushed left), negative is a left-hander. Reset
  // the cadence at every direction change so the first board always appears
  // near the corner entry instead of at an arbitrary global segment modulus.
  let tightRun = 0;
  let lastDirection = 0;
  for (let i = 0; i < track.segments.length; i += 1) {
    const seg = track.segments[i];
    const direction = Math.sign(seg.curve);
    if (Math.abs(seg.curve) < TIGHT_CURVE_THRESHOLD || direction === 0) {
      tightRun = 0;
      lastDirection = 0;
      continue;
    }
    if (direction !== lastDirection) tightRun = 0;
    tightRun += 1;
    lastDirection = direction;
    // Start four segments into the warning-strength bend, then repeat densely
    // enough to read as a continuous arcade chevron wall at full speed.
    if (tightRun < 4 || (tightRun - 4) % 9 !== 0) continue;
    seg.scenery.push({
      name: direction > 0 ? 'prop-chevron-right' : 'prop-chevron-left',
      offset: direction > 0 ? -1.3 : 1.3,
      scale: 1,
    });
  }

  // The big 600B meme hoardings get a short clear sight-line on both sides.
  // Without this second pass, nearer trees/signs frequently covered the punchline
  // during the one second the rider was close enough to read it.
  if (billboardNames.length) {
    for (let i = 97; i < track.segments.length; i += 211) {
      for (let d = -20; d <= 20; d += 1) {
        const clearIndex = (i + d + track.segments.length) % track.segments.length;
        track.segments[clearIndex].scenery = [];
      }
      track.segments[i].scenery.push({
        name: pick(rng, billboardNames),
        offset: (rng() < 0.5 ? -1 : 1) * (2.1 + rng() * 0.4),
        scale: 1,
      });
    }
  }
}

export function findSegment(track: Track, z: number): Segment {
  const index = Math.floor(wrap(z, track.length) / ROAD.segmentLength) % track.segments.length;
  return track.segments[index];
}

/** Project a world point to screen, mutating its `screen` fields. */
export function project(
  point: ProjectedPoint,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  width: number,
  height: number,
  roadWidth: number,
): void {
  const camX = point.world.x - cameraX;
  const camY = point.world.y - cameraY;
  const camZ = point.world.z - cameraZ;
  const scale = CAMERA_DEPTH / (camZ < 1 ? 1 : camZ);
  point.screen.scale = scale;
  // No rounding — sub-pixel positions keep the road and roadside sprites from
  // shimmering as segments advance.
  point.screen.x = width / 2 + (scale * camX * width) / 2;
  point.screen.y = height / 2 - (scale * camY * height) / 2;
  point.screen.w = (scale * roadWidth * width) / 2;
}

// ---- Player physics --------------------------------------------------------

export interface Player {
  z: number; // position along the track (world units)
  x: number; // -1..1 across the road; |x|>1 is off the tarmac
  vx: number; // lateral velocity (road-offset units/sec) — gives bike inertia
  speed: number; // world units / second
  maxSpeed: number;
  lean: number; // -1..1 smoothed visual lean
  offRoad: boolean;
}

export interface DriveInput {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
}

export interface DriveTuning {
  accel: number;
  brake: number;
  decel: number;
  offRoadDecel: number;
  offRoadLimit: number;
  steerAccel: number; // how hard input pushes lateral velocity
  steerDamp: number; // tyre grip — self-centres the bike (per second)
  maxSteerVel: number; // cap on lateral velocity
  centrifugal: number; // how much a bend runs the bike wide
}

export const DEFAULT_TUNING: DriveTuning = {
  accel: 2600, // builds speed like a bike rather than snapping to top
  brake: -13000,
  decel: -2600,
  offRoadDecel: -6200,
  offRoadLimit: 4600,
  steerAccel: 13, // responsive turn-in
  steerDamp: 4.2, // settles quickly back to centre when you let off
  maxSteerVel: 3,
  centrifugal: 0.45,
};

export function createPlayer(maxSpeed = ROAD.segmentLength / (1 / 60) / 1.35): Player {
  return { z: 0, x: 0, vx: 0, speed: 0, maxSpeed, lean: 0, offRoad: false };
}

/**
 * Advance the player one step with a lateral-velocity model so it feels like a
 * motorbike: input builds lateral speed, tyre grip damps it back toward centre,
 * and a bend runs the bike wide (needs counter-steer). Mutates `player`.
 */
export function updatePlayer(
  player: Player,
  track: Track,
  input: DriveInput,
  dt: number,
  tuning: DriveTuning = DEFAULT_TUNING,
): Segment {
  const seg = findSegment(track, player.z);
  const speedPct = player.speed / player.maxSpeed;
  const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  // Steering acceleration scales with speed — no steering at a standstill.
  player.vx += steerInput * tuning.steerAccel * speedPct * dt;
  // A bend flings the bike toward the outside.
  player.vx -= seg.curve * speedPct * speedPct * tuning.centrifugal * dt;
  // Tyre grip pulls lateral velocity back toward zero (self-centring).
  player.vx *= Math.exp(-tuning.steerDamp * dt);
  player.vx = clamp(player.vx, -tuning.maxSteerVel, tuning.maxSteerVel);
  player.x += player.vx * dt;

  if (input.brake) player.speed += tuning.brake * dt;
  else if (input.throttle) player.speed += tuning.accel * dt;
  else player.speed += tuning.decel * dt;

  player.offRoad = player.x < -1 || player.x > 1;
  if (player.offRoad && player.speed > tuning.offRoadLimit) {
    player.speed += tuning.offRoadDecel * dt;
  }

  player.speed = clamp(player.speed, 0, player.maxSpeed);
  // At the lateral bound, drop any outward velocity: otherwise steering back
  // first has to unwind a saturated vx, which reads as the bike being stuck
  // against the edge for a beat before it responds.
  if (player.x < -2.4) {
    player.x = -2.4;
    if (player.vx < 0) player.vx = 0;
  } else if (player.x > 2.4) {
    player.x = 2.4;
    if (player.vx > 0) player.vx = 0;
  }
  player.z = wrap(player.z + dt * player.speed, track.length);

  // Lean blends what the RIDER is asking (steer input) with what the BIKE is
  // actually doing (lateral velocity): a hard carve holds visible lean while the
  // bike is still moving sideways, then eases upright as grip settles it — an
  // analogue weight-shift rather than a three-position switch. Input keeps the
  // larger share so lean still reads as intent, not drift.
  const leanTarget = clamp(steerInput * 0.55 + (player.vx / tuning.maxSteerVel) * 0.65, -1, 1);
  player.lean = approach(player.lean, leanTarget, 10, dt);

  return seg;
}

/** Convert internal speed units into a readable arcade km/h for the HUD. */
export function speedKph(player: Player): number {
  return (player.speed / player.maxSpeed) * 260;
}
