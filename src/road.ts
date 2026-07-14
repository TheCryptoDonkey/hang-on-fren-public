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

/** World units per metre — the odometer's convention (shared with world.ts). */
export const UNITS_PER_M = 100;

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
  /**
   * The span of road overhead here, if any. Stamped onto the segment rather than
   * looked up per frame: the renderer asks this question for every one of the
   * ~260 segments it draws, every frame.
   */
  overhead: Overhead | null;
}

/**
 * Something the road passes UNDER. Everything in the scenery kit stands beside
 * the road; nothing crosses it, and a road you never go under reads as flat
 * however much you decorate its verges.
 *
 * A TUNNEL is walls plus a ceiling — you are enclosed, the sky is gone, and the
 * engine comes back at you off the tiles. An OVERPASS is the same ceiling with no
 * walls and a couple of pillars: a bridge deck flashing overhead in a moment of
 * shadow. They are the same geometry at different lengths, so they are one type.
 */
export type OverheadKind = 'tunnel' | 'overpass';

export interface Overhead {
  kind: OverheadKind;
  /** Inclusive segment span. */
  start: number;
  end: number;
}

export interface Track {
  segments: Segment[];
  length: number; // total world length
  /** Named authored set-pieces, used by tests and the dev visual harness. */
  features: Record<TrackFeatureName, TrackFeature>;
  /** Every tunnel and overpass on the road, in track order. */
  overheads: Overhead[];
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
    overhead: null,
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

  const overheads = addOverheads(s);

  return { segments: s, length: s.length * ROAD.segmentLength, features, overheads };
}

/** A tunnel this many segments long is a proper tunnel; an overpass is a flash. */
const TUNNEL_LEN = 80;
const OVERPASS_LEN = 3;
/** Nothing overhead within this many segments of the loop seam. */
const SEAM_GUARD = 60;

/**
 * Bore the tunnels and throw the bridges across, then stamp every affected
 * segment so the renderer never has to search for them.
 *
 * Placed as fractions of the finished road rather than authored inline, so the
 * track can be re-shaped freely without anyone having to remember to move the
 * tunnels — they land in the same PLACES on the journey regardless of how the
 * corners in between get rewritten.
 */
function addOverheads(segments: Segment[]): Overhead[] {
  const n = segments.length;
  const at = (frac: number, len: number, kind: OverheadKind): Overhead | null => {
    const start = Math.floor(n * frac);
    const end = start + len;
    // Never straddle the seam: the loop point would put a tunnel mouth behind you
    // and its far wall in front, which is exactly as odd as it sounds.
    if (start < SEAM_GUARD || end > n - SEAM_GUARD) return null;
    return { kind, start, end };
  };
  const overheads = [
    at(0.14, OVERPASS_LEN, 'overpass'),
    at(0.21, TUNNEL_LEN, 'tunnel'),
    at(0.36, OVERPASS_LEN, 'overpass'),
    at(0.48, TUNNEL_LEN + 40, 'tunnel'), // the long one
    at(0.6, OVERPASS_LEN, 'overpass'),
    at(0.72, TUNNEL_LEN, 'tunnel'),
    at(0.84, OVERPASS_LEN, 'overpass'),
  ].filter((o): o is Overhead => o !== null);

  for (const overhead of overheads) {
    for (let i = overhead.start; i <= overhead.end && i < n; i += 1) {
      segments[i].overhead = overhead;
    }
  }
  return overheads;
}

/**
 * How enclosed the road is at `z`: 0 out in the open, 1 deep inside a tunnel.
 *
 * Ramped rather than switched. A tunnel that snaps to full darkness the instant
 * its first segment passes under the wheels is a light switch, not a tunnel; the
 * dark closes in over the length of the mouth and opens out again at the far end.
 * An overpass is far too short to ever reach 1, which is the point — it is a
 * flicker of shadow, and it gets one for free from the same ramp.
 */
export function enclosureAt(track: Track, z: number): number {
  const seg = findSegment(track, z);
  const overhead = seg.overhead;
  if (!overhead) return 0;
  const ramp = 6; // segments to fade fully in / out
  const fromStart = seg.index - overhead.start;
  const toEnd = overhead.end - seg.index;
  return clamp(Math.min(fromStart, toEnd) / ramp, 0, 1);
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

/**
 * Nudge a finish distance so the tape lands at the END of a STRAIGHT.
 *
 * The road loops, but total distance and track position are locked together
 * (`z_total = distanceM · 100`), so a given finish distance always falls on the
 * same stretch of tarmac — and the nominal one lands mid-corner, where you crest
 * into the flag with no warning. This finds the nearest run of straight road
 * whose exit sits near the nominal finish and returns the distance that lands the
 * tape there instead, so the finish arch stands at the end of a straight you can
 * see all the way down. The shift is at most `maxShiftM`; if no straight is near
 * (it always is), it returns the nominal unchanged.
 */
export function alignFinishToStraight(
  track: Track,
  nominalM: number,
  runInM = 260,
  maxShiftM = 900,
): number {
  const segs = track.segments;
  const n = segs.length;
  const STRAIGHT_EPS = 0.7; // |curve| below this reads as straight at speed
  const runIn = Math.round((runInM * UNITS_PER_M) / ROAD.segmentLength); // segs of run-in
  const maxShift = Math.round((maxShiftM * UNITS_PER_M) / ROAD.segmentLength); // segs

  const finishZ = wrap(nominalM * UNITS_PER_M, track.length);
  const finishSeg = Math.floor(finishZ / ROAD.segmentLength) % n;

  const straightExit = (end: number): boolean => {
    for (let k = 0; k <= runIn; k += 1) {
      const idx = ((end - k) % n + n) % n;
      if (Math.abs(segs[idx].curve) > STRAIGHT_EPS) return false;
    }
    return true;
  };

  // Search outward from the nominal exit for the nearest straight exit.
  for (let d = 0; d <= maxShift; d += 1) {
    for (const end of d === 0 ? [finishSeg] : [finishSeg + d, finishSeg - d]) {
      const idx = ((end % n) + n) % n;
      if (straightExit(idx)) {
        return nominalM + ((end - finishSeg) * ROAD.segmentLength) / UNITS_PER_M;
      }
    }
  }
  return nominalM;
}

/**
 * Screen-space horizontal shift produced by yawing the camera `yaw` radians.
 *
 * A camera yaw rotates the whole view about the vertical axis. To first order —
 * and every point we draw is far enough down the road for that to hold — it
 * shifts EVERY point by the same number of pixels, whatever its depth: rotating
 * camera-space by a small yaw gives camX' ≈ camX − camZ·yaw, and since
 * scale·camZ is exactly CAMERA_DEPTH, the resulting screen shift
 * (scale·camX'·w/2) loses its depth term entirely. So a yaw is a pure pan: the
 * road, the scenery, the horizon and the bike all swing together, which is
 * precisely the "camera looks into the corner" move.
 */
export function yawPan(yaw: number, width: number): number {
  return -yaw * CAMERA_DEPTH * (width / 2);
}

/** Projection scale at the point the rider is drawn — used to place the bike. */
export const RIDER_SCALE = CAMERA_DEPTH / RIDER_FWD;

/**
 * Where the bike is DRAWN horizontally, given a yawed camera that trails the
 * bike by `camLag` road-offset units. The renderer needs this to place the
 * sprite; the game loop needs the same answer to pour tyre smoke out from under
 * it. It lives here, once, so those two can never disagree — the same reason
 * sprite widths live in geometry.ts.
 */
export function riderScreenX(width: number, camYaw: number, camLag: number): number {
  return width / 2 + yawPan(camYaw, width) + RIDER_SCALE * camLag * ROAD.roadWidth * (width / 2);
}

/**
 * Project a world point to screen, mutating its `screen` fields. `xPan` is the
 * camera-yaw pan from `yawPan()`, applied identically at every depth.
 */
export function project(
  point: ProjectedPoint,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  width: number,
  height: number,
  roadWidth: number,
  xPan = 0,
): void {
  const camX = point.world.x - cameraX;
  const camY = point.world.y - cameraY;
  const camZ = point.world.z - cameraZ;
  const scale = CAMERA_DEPTH / (camZ < 1 ? 1 : camZ);
  point.screen.scale = scale;
  // No rounding — sub-pixel positions keep the road and roadside sprites from
  // shimmering as segments advance.
  point.screen.x = width / 2 + (scale * camX * width) / 2 + xPan;
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
  // ---- powerslide (the OutRun drift) ----
  /**
   * Heading offset from the road's direction, in radians (+ = nose pointing
   * right). In a grip corner this is a token turn-in angle; in a slide it is the
   * slip angle, and it is what actually turns the bike (see `driftTurn`).
   */
  yaw: number;
  /** |yaw| normalised against the spin-out limit: 0 = tracking true, 1 = gone. */
  slip: number;
  /** True while the tyres have let go and the bike is in a committed slide. */
  drifting: boolean;
  /** Which way the slide is pointing: -1 left, +1 right, 0 when gripping. */
  driftDir: number;
  /** Seconds held in the current slide — feeds the drift score. */
  driftTime: number;
  /** Set for one step when the slide over-rotates: the caller turns it into a wipeout. */
  spinOut: boolean;
}

export interface DriveInput {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
  /**
   * A completed FLICK this step (-1 left / +1 right), from flick.ts — the
   * counter-steer gesture (hold one way, stab the other, pin it back) that
   * breaks the tyres loose. A second way into a slide alongside brake-into-turn;
   * 0/absent on every ordinary step. See `updateDrift`.
   */
  flick?: number;
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
  // ---- powerslide ----
  driftEntrySpeed: number; // speedPct below which the tyres won't break away
  driftHoldYaw: number; // the slip angle a held slide settles at
  driftCreep: number; // rad/s the held angle widens the longer you stay in it
  driftYawRate: number; // how fast the slip angle chases its held target (per sec)
  driftCounterYaw: number; // fraction of the held angle counter-steer tightens to
  driftCounterRate: number; // how fast counter-steer pulls the angle in (per sec)
  driftRecover: number; // rad/s the slide settles with no steering input
  driftTurn: number; // how strongly slip angle converts into a turning force
  driftDrag: number; // speed scrubbed per radian of slip, per second
  driftGrip: number; // fraction of tyre grip left once sliding (self-centring)
  driftSteerMul: number; // how much the BARS still do once the tyres have let go
  driftSteerCap: number; // lateral-velocity cap multiplier while sliding
  maxYaw: number; // slip angle beyond which the bike spins out
  driftExitYaw: number; // slip below this and the slide is over
  driftMinSpeed: number; // speedPct below which a slide can no longer be held
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
  driftEntrySpeed: 0.5,
  driftHoldYaw: 0.45, // ~26° — a big, readable slide you can live in
  // The slide goes HOT at ~2.1s: past that, the angle it wants to sit at is more
  // lock than the bike has, so holding it wide will spin you and the only way to
  // stay in it is to keep it tight. (The number matters: the yaw only ever chases
  // this target asymptotically, so if the target merely APPROACHED full lock the
  // bike could never actually cross it, the spin-out would be unreachable, and
  // every word above about risk would be decoration.)
  driftCreep: 0.13,
  // The tail has to SNAP out, not ooze out. A corner lasts about a second; the
  // sliding tyre's lateral velocity has a ~0.5s time constant, so a slide that
  // merely starts building on entry is still ramping up as the corner ends — and
  // grip, which reaches full effect in a quarter of a second, quietly beats it.
  // A drift that only comes good after the bend is over is not a mechanic, it is
  // a liability. Hence a fast yaw build and a real kick at the moment it lets go.
  driftYawRate: 5,
  // Counter-steer TIGHTENS the slide; it does not kill it. This is the single
  // change that turns the drift from a stunt into a skill. Scrubbing the angle
  // straight back to zero (as this first did) meant any correction to keep the
  // bike on the road instantly ended the drift — and since a held slide crosses
  // the whole road in about half a second, a correction is always needed. The
  // slide was therefore unbalanceable by construction: you could start one and
  // you could end one, but you could never RIDE one.
  //
  // Now the bars pick the angle — wide (hold) or tight (counter) — while the bike
  // stays sideways throughout, and you steer your line by feathering between the
  // two. Letting go of the bars is what stands it back up.
  driftCounterYaw: 0.35,
  driftCounterRate: 4.5,
  driftRecover: 2.0,
  // The four below are ONE budget and have to be read together. A slide is not
  // "grip, but more of everything" — it is a TRADE: the bars go light
  // (driftSteerMul), and the slip angle takes over the job of turning the bike
  // (driftTurn). Tuning them independently is how the first cut flung the bike
  // clean off the tarmac in half a second — full steering AND almost no damping
  // AND a raised cap, all stacked, so the slide simply teleported sideways.
  //
  // Where it has to land: ~1.5× grip's lateral rate on a straight, and ~1.8× in
  // a fast bend, because a bend is spending grip's authority on not being flung
  // wide while the slide is spending almost none. That gap IS the drift — it is
  // why you would ever risk one — and it only shows up in corners, which is
  // exactly where it should.
  driftSteerMul: 0.5,
  driftTurn: 10,
  driftGrip: 0.45, // a sliding tyre still drags — it is not ice
  driftSteerCap: 1.5,
  driftDrag: 2400,
  maxYaw: 0.72, // ~41° — past this you have thrown it away
  driftExitYaw: 0.07,
  driftMinSpeed: 0.3,
};

/** The slip angle stamped on at the moment the tyres let go — the initial flick. */
const DRIFT_SEED_YAW = 0.3;
/**
 * The lateral shove the bike gets as the tail lets go, scaled by speed. This is
 * the physical event — the rear stepping out — and without it the slide has to
 * accelerate sideways from a standstill through a heavily damped system, which
 * takes most of the corner (see `driftYawRate`).
 */
const DRIFT_KICK = 1.5;
/** A slide can't end on the step it started (the seed would trip the exit test). */
const DRIFT_MIN_HOLD = 0.05;

export function createPlayer(maxSpeed = ROAD.segmentLength / (1 / 60) / 1.35): Player {
  return {
    z: 0,
    x: 0,
    vx: 0,
    speed: 0,
    maxSpeed,
    lean: 0,
    offRoad: false,
    yaw: 0,
    slip: 0,
    drifting: false,
    driftDir: 0,
    driftTime: 0,
    spinOut: false,
  };
}

/** Slam the bike back to gripping and pointing straight (respawn / new run). */
export function resetDrift(player: Player): void {
  player.yaw = 0;
  player.slip = 0;
  player.drifting = false;
  player.driftDir = 0;
  player.driftTime = 0;
  player.spinOut = false;
}

/**
 * The powerslide state machine — the heart of the OutRun handling model.
 *
 * ENTRY is a learnable move, two ways in above `driftEntrySpeed`: brake INTO a
 * turn, OR flick the bars — stab the opposite way then pin it back (the gesture
 * lives in flick.ts and arrives here as `input.flick`). Either breaks the tyres
 * loose in the direction you are turning. (It never breaks away on its own; a
 * drift you didn't ask for reads as a bug, not a thrill.)
 *
 * HELD — keep the bars turned INTO the slide and it settles at an equilibrium
 * angle rather than winding up without bound, so a drift is somewhere you can
 * live for the length of a corner. But that equilibrium CREEPS wider the longer
 * you stay in it, and once it creeps past `maxYaw` the bike is gone. So a drift
 * is free for a second or two, then it starts asking for the bill: greed has to
 * be paid for with a catch.
 *
 * CATCH / EXIT — counter-steer scrubs the angle straight back off. Under
 * `driftExitYaw` (or below `driftMinSpeed`) the tyres bite again and you're back
 * on grip. Get greedy instead and it spins.
 *
 * A drift is a TARMAC move: it neither starts nor survives off the road. Without
 * that rule the bike will happily sit sideways in a field racking up drift score
 * for as long as it can keep its speed up, which is both an exploit and a lie —
 * ploughing through a meadow is not a powerslide.
 */
function updateDrift(player: Player, input: DriveInput, steerInput: number, speedPct: number, onRoad: boolean, dt: number, tuning: DriveTuning): void {
  player.spinOut = false;

  if (!player.drifting) {
    // A flick lets go in the direction you are cornering (its own sign, since it
    // fires on the step you pin the bars BACK into the turn); a brake-drift lets
    // go in the direction you are steering. Either needs a committed corner.
    const flick = input.flick ?? 0;
    const brakeEntry = input.brake && steerInput !== 0;
    const entryDir = flick !== 0 ? flick : steerInput;
    if (onRoad && (flick !== 0 || brakeEntry) && speedPct >= tuning.driftEntrySpeed) {
      player.drifting = true;
      player.driftDir = entryDir;
      player.driftTime = 0;
      player.yaw = entryDir * DRIFT_SEED_YAW;
      player.vx += entryDir * DRIFT_KICK * speedPct; // the tail lets go, NOW
    } else {
      // Gripping: the nose points a little into the corner, proportional to how
      // hard the bike is actually cornering. Cosmetic heading, no slide.
      const target = clamp(player.vx / tuning.maxSteerVel, -1, 1) * 0.16;
      player.yaw = approach(player.yaw, target, 8, dt);
      player.slip = 0;
      return;
    }
  }

  player.driftTime += dt;
  // The WIDE angle — where the slide sits if you stay on the bars — creeps out
  // with total time sideways. This is the whole risk curve: a long drift is
  // quietly running up a bill, and past ~2s the angle it wants is more lock than
  // the bike has, so simply staying on it is what spins you.
  const hold = tuning.driftHoldYaw + player.driftTime * tuning.driftCreep;
  if (steerInput === player.driftDir) {
    player.yaw = approach(player.yaw, player.driftDir * hold, tuning.driftYawRate, dt);
  } else if (steerInput === -player.driftDir) {
    // Tighten, don't kill: the bike stays sideways at a shallower angle, which
    // swings it back the other way across the road. This is the correction — and
    // it is deliberately measured against the ORIGINAL held angle, NOT the crept
    // one, so counter-steer is always a way out. Letting it creep too made a long
    // slide impossible to pull back in: the "tight" line drifted out with the
    // wide one until it was still turning hard enough to run you off the road,
    // and the drift ended in a hedge instead of a spin. If the risk is going to
    // be that you over-rotate, then the pull-back has to stay honest.
    player.yaw = approach(player.yaw, player.driftDir * tuning.driftHoldYaw * tuning.driftCounterYaw, tuning.driftCounterRate, dt);
  } else {
    // Hands off the bars: it stands back up. This is how you END a slide.
    const decay = tuning.driftRecover * dt;
    player.yaw = Math.abs(player.yaw) <= decay ? 0 : player.yaw - Math.sign(player.yaw) * decay;
  }

  player.slip = clamp(Math.abs(player.yaw) / tuning.maxYaw, 0, 1);

  // Wound it past the limit — the bike is gone.
  if (Math.abs(player.yaw) > tuning.maxYaw) {
    player.spinOut = true;
    return;
  }
  // Caught it, ran out of the speed needed to sustain it, or slid off the tarmac
  // — on grass you are no longer drifting, you are just leaving.
  if (player.driftTime > DRIFT_MIN_HOLD
    && (Math.abs(player.yaw) < tuning.driftExitYaw || speedPct < tuning.driftMinSpeed || !onRoad)) {
    player.drifting = false;
    player.driftDir = 0;
    player.slip = 0;
  }
}

/**
 * Advance the player one step. Two handling regimes share one lateral model:
 *
 *  GRIP — input builds lateral speed, tyre grip damps it back toward centre, and
 *  a bend runs the bike wide (needs counter-steer).
 *
 *  SLIDE — the tyres have let go, so grip barely self-centres any more, and the
 *  bike is instead turned by its SLIP ANGLE: `sin(yaw)` is fed straight into the
 *  lateral force. That is the arcade bargain OutRun is built on — a slide points
 *  the bike round a bend that grip alone would run you wide of, and costs you
 *  only a little speed (far less than braking), in exchange for having to
 *  balance the angle on the bars or throw it away.
 *
 * Mutates `player`.
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
  // Where the bike is standing as this step BEGINS. (`player.offRoad` is only
  // refreshed further down, from the position this step is about to produce.)
  const onRoad = Math.abs(player.x) <= 1;

  updateDrift(player, input, steerInput, speedPct, onRoad, dt, tuning);

  // Steering acceleration scales with speed — no steering at a standstill. Once
  // the tyres have let go the bars go LIGHT: you are no longer steering with
  // grip you do not have. The slide is doing the steering now.
  const steerAuthority = tuning.steerAccel * (player.drifting ? tuning.driftSteerMul : 1);
  player.vx += steerInput * steerAuthority * speedPct * dt;
  // A bend flings the bike toward the outside.
  player.vx -= seg.curve * speedPct * speedPct * tuning.centrifugal * dt;
  // The slide turns the bike by pointing its nose: slip angle becomes real
  // lateral force. This is what a drift BUYS you, and it is what replaces the
  // steering authority the slide just took away.
  if (player.drifting) {
    player.vx += Math.sin(player.yaw) * speedPct * tuning.driftTurn * dt;
  }
  // Tyre grip pulls lateral velocity back toward zero (self-centring) — mostly
  // gone once the tyres have let go, which is why a slide keeps sliding.
  const damp = tuning.steerDamp * (player.drifting ? tuning.driftGrip : 1);
  player.vx *= Math.exp(-damp * dt);
  const cap = tuning.maxSteerVel * (player.drifting ? tuning.driftSteerCap : 1);
  player.vx = clamp(player.vx, -cap, cap);
  player.x += player.vx * dt;

  if (input.brake) player.speed += tuning.brake * dt;
  else if (input.throttle) player.speed += tuning.accel * dt;
  else player.speed += tuning.decel * dt;
  // Sliding sideways scrubs speed with the angle — but gently enough that a
  // shallow, well-held drift still gains on the throttle. Wind it up to full
  // lock and it bleeds away: the angle is the price.
  if (player.drifting) player.speed -= Math.abs(player.yaw) * tuning.driftDrag * dt;

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

  // Lean. Gripping, it blends what the RIDER is asking (steer input) with what
  // the BIKE is doing (lateral velocity) — an analogue weight-shift rather than
  // a three-position switch. Sliding, the rider commits hard into the corner the
  // slide is pointing at, whatever the bars are doing (that's the whole look of a
  // powerslide: bike sideways, rider hanging off the inside).
  const leanTarget = player.drifting
    ? clamp(player.driftDir * 0.85 + steerInput * 0.15, -1, 1)
    : clamp(steerInput * 0.55 + (player.vx / tuning.maxSteerVel) * 0.65, -1, 1);
  player.lean = approach(player.lean, leanTarget, 10, dt);

  return seg;
}

/** Convert internal speed units into a readable arcade km/h for the HUD. */
export function speedKph(player: Player): number {
  return (player.speed / player.maxSpeed) * 260;
}
