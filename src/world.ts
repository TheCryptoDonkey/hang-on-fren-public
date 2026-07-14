// Dynamic entities on the endless road: pickups to collect and traffic to
// dodge. Most pickups are red 600.wtf petrol cans (they top up the clock);
// roses are rare and special (a nitro boost). Pickups are spawned CLEAR of
// traffic so steering to grab one never drives you into a hidden car.
//
// Entities live at looping track-z positions, reasoned about via a *signed*
// forward distance in (-length/2, length/2]: positive ahead, negative behind.

import { ROAD, RIDER_FWD } from './road.js';
import type { Player, Track } from './road.js';
import { resolveScenerySprite, rosterAt, sceneryKitAt } from './stages.js';
import { sceneryHitHalfWidth, spriteWorldWidth } from './geometry.js';
import { clamp, makeRng, randRange, pick, wrap } from './util.js';
import { createRivalProgress, rivalGapM, updateRival, type RivalProgress } from './rival.js';

// Pickups are no longer a random spatial pool — main.ts schedules them on the
// CLOCK (a can every 21s, a rose every 42s, an emergency can just before time
// runs out) via addPickup(). That keeps them sparse and predictable.

// Lateral gaps in road-offset units (tarmac spans -1..1; each of the 3 lanes is
// ~0.67 wide). Collision boxes are deliberately a touch TIGHTER than the drawn
// sprites: an arcade racer must be generous to the player, so a pass that looks
// like it cleared never registers as a wipeout. Previously a single fat
// COLLIDE_GAP (0.42) plus wandering traffic clipped you from an adjacent lane —
// the "wiped out for no reason" bug.
// Trimmed a touch (was 0.12): an arcade racer should forgive a glancing clip, so
// a pass that looks like it had a sliver of room reads as a near-miss, not a
// wipeout. Still comfortably positive, so an in-lane hit always registers.
const PLAYER_HALF = 0.09;
// The bike's hit half-width vs a car is DERIVED from the width the renderer draws
// that car (geometry.ts) — a touch tighter, because an arcade racer forgives a
// glancing clip. Deriving it (rather than a second hand-tuned table) is what makes
// "the hitbox matches what you see" true by construction: change a sprite's drawn
// width and its hitbox follows. The two tables silently drifting apart was the old
// "hit something I didn't see / drove through something I did" bug.
const HIT_GENEROSITY = 0.02; // road-offset units shaved off each side vs the drawing
export function carHitHalfWidth(sprite: string): number {
  return Math.max(0.04, spriteWorldWidth(sprite) / 2 - HIT_GENEROSITY);
}
function collideGap(sprite: string): number {
  return carHitHalfWidth(sprite) + PLAYER_HALF;
}
/** Extra lateral band beyond a crash that still counts as a rewarding near-miss. */
const NEAR_BAND = 0.26;
const PICKUP_GAP = 0.5;
// You must be well off the tarmac AND nearly dead-on a trunk to hit it, so the
// grass verge and rumble strip are safe (just slow) — only a real tree/sign
// strike crashes you.
const OFFROAD_HIT_X = 1.2;

// Longitudinal hit band, in world units of d = how far the car is ahead of the
// CAMERA. The bike itself is DRAWN ~RIDER_FWD ahead of the camera (road.ts), so
// the band brackets that point: the nose edge is the car's rear bumper just as
// its base meets the bike's front wheel on screen, and the rear edge trails a
// little over a segment behind the bike — once a car's base has visibly dropped
// past that, it has cleared you and can never wipe you out.
//
// (The old band was [0, ~64] — anchored to the CAMERA PLANE, which the bike
// sprite is a full five segments in front of. Crashes registered ~half a second
// of travel AFTER the sprites visually overlapped, and swerves inside that lag
// read as "drove straight through it" / "hit by nothing". That reference-frame
// mismatch was the flakiness that survived every geometry rework.)
const CAR_LEN_Z = ROAD.segmentLength * 1.4;
export const HIT_NOSE = RIDER_FWD + ROAD.segmentLength * 0.32;
export const HIT_REAR = RIDER_FWD - ROAD.segmentLength * 1.2;
const PICKUP_Z = ROAD.segmentLength * 1.3;
const RECYCLE_BEHIND = ROAD.segmentLength * 8;
const CLEAR_Z = CAR_LEN_Z * 3; // keep pickups this clear of traffic at spawn
const SCENERY_HIT_AHEAD = ROAD.segmentLength * 0.28;
const SCENERY_HIT_BEHIND = ROAD.segmentLength * 0.25;

const LANE_OFFSETS = [-0.6, 0, 0.6];

export type PickupKind =
  | 'petrol'
  | 'rose'
  | 'cake'
  | 'wholecake'
  | 'meme'
  | 'ath'
  | 'timelock'
  | 'fiatnam'
  | 'fourtwenty'
  | 'shield'
  | 'beer'
  | 'shroom';

export interface Pickup {
  z: number;
  offset: number;
  bob: number;
  taken: boolean;
  kind: PickupKind;
}

export interface Car {
  /**
   * Stable identity for the lifetime of this car on the road. The audio engine
   * keeps a small pool of engine voices and keys them on this: without it a voice
   * would hop between cars whenever the sort order changed, and every reshuffle
   * would be an audible pitch jump from a machine that is supposedly one car.
   */
  id: number;
  z: number;
  offset: number;
  driftPhase: number;
  driftAmp: number;
  speed: number;
  sprite: string;
  prevFwd: number;
  /** Signed lateral separation last frame, used to test only the visible z-overlap window. */
  prevLateral: number;
  role: 'traffic' | 'rival';
  /** Present only on the persistent opening-tour rival. */
  rival?: RivalProgress;
  /** Stable top speed and track origin — never inherit the player's turbo. */
  rivalMaxSpeedMps?: number;
  rivalOriginZ?: number;
}

/**
 * A road-spanning arch you drive THROUGH — the checkpoint gate at each level
 * boundary and the checkered finish gate at the end. Purely visual (never
 * collides); the checkpoint/finish logic lives on the clock/distance in main.ts.
 */
export interface Marker {
  z: number;
  sprite: string;
  kind: 'gate' | 'finish';
}

/** Difficulty-mode multipliers applied to the traffic ramp (difficulty.ts). */
export interface WorldMods {
  /** Traffic pool multiplier. */
  density: number;
  /** Traffic speed multiplier. */
  speed: number;
}

export interface World {
  pickups: Pickup[];
  traffic: Car[];
  markers: Marker[];
  rng: () => number;
  odometerM: number;
  mods: WorldMods;
  /** Hands out Car.id. Monotonic, so a recycled car is a NEW car to the audio. */
  nextCarId: number;
}

export type WorldEvent =
  | { type: 'pickup'; kind: PickupKind; offset: number }
  /**
   * `side` is where the car went by relative to the bike (negative = down your
   * left), and `closing` is how much faster you took it, 0..1. Both exist so the
   * pass-by can be HEARD going past on the correct side at the right speed
   * (audio.ts `playPassBy`) rather than as a placeless blip.
   */
  | { type: 'overtake'; side: number; closing: number }
  | { type: 'nearMiss'; side: number }
  | { type: 'rivalPass' }
  | { type: 'crash'; sprite: string };

/** Signed forward distance from player to `z` in (-len/2, len/2]. */
export function signedForward(z: number, playerZ: number, length: number): number {
  let d = wrap(z - playerZ, length);
  if (d > length / 2) d -= length;
  return d;
}

interface Ramp {
  pickupSpacing: number;
  trafficGap: number;
  vergeBias: number;
  carSpeedMul: number;
  /** How many cars share the road at this distance (before density mods). */
  carCount: number;
}

function difficulty(odometerM: number): Ramp {
  const t = clamp(odometerM / 9000, 0, 1); // fully ramped ~9 km
  return {
    pickupSpacing: 3200 + t * 2600,
    trafficGap: 7000 - t * 3400,
    vergeBias: 0.12 + t * 0.5,
    carSpeedMul: 0.62 + t * 0.16,
    carCount: 7 + Math.round(t * 6), // the road genuinely thickens on the long run
  };
}

/** The traffic pool size the world should hold right now. */
function targetCars(world: World): number {
  return Math.max(2, Math.round(difficulty(world.odometerM).carCount * world.mods.density));
}

function regularCarCount(world: World): number {
  return world.traffic.reduce((count, car) => count + (car.role === 'traffic' ? 1 : 0), 0);
}

function carNear(world: World, z: number, offset: number, track: Track): boolean {
  for (const car of world.traffic) {
    if (Math.abs(signedForward(car.z, z, track.length)) < CLEAR_Z && Math.abs(car.offset - offset) < 0.6) {
      return true;
    }
  }
  return false;
}

/**
 * Place a pickup of `kind` ahead of the player. `near` (used for the emergency
 * rescue can) drops it a short, definitely-reachable distance ahead in roughly
 * the rider's current lane so it can actually be grabbed before time runs out;
 * otherwise it lands further out and clear of traffic.
 */
function spawnPickupAhead(world: World, player: Player, track: Track, kind: PickupKind, near = false): Pickup {
  const ramp = difficulty(world.odometerM);
  let z = 0;
  let offset = 0;
  if (near) {
    // ~1.3s of travel ahead so it arrives with time to spare, in the rider's lane.
    const ahead = clamp(player.speed * 1.3, ROAD.segmentLength * 12, ROAD.drawDistance * ROAD.segmentLength * 0.5);
    z = wrap(player.z + ahead, track.length);
    offset = clamp(player.x, -0.7, 0.7);
  } else {
    // Try a few placements and keep the first that isn't sitting on traffic.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const ahead = randRange(world.rng, ROAD.drawDistance * ROAD.segmentLength * 0.45, ROAD.drawDistance * ROAD.segmentLength * 0.8);
      z = wrap(player.z + ahead, track.length);
      const toVerge = world.rng() < ramp.vergeBias;
      offset = toVerge
        ? (world.rng() < 0.5 ? -1 : 1) * randRange(world.rng, 0.55, 0.92)
        : randRange(world.rng, -0.5, 0.5);
      if (!carNear(world, z, offset, track)) break;
    }
  }
  return { z, offset, bob: world.rng() * Math.PI * 2, taken: false, kind };
}

/** Schedule a pickup onto the road (called by main on its clock cadence). */
export function addPickup(world: World, player: Player, track: Track, kind: PickupKind, near = false): void {
  world.pickups.push(spawnPickupAhead(world, player, track, kind, near));
}

/**
 * Drop a road-spanning marker (checkpoint gate / finish gate) `aheadM` metres in
 * front of the rider so it scrolls in and they drive through it as the boundary
 * is crossed. 100 world units ≈ 1 metre (see the odometer).
 */
export function addMarker(world: World, player: Player, track: Track, sprite: string, aheadM: number, kind: Marker['kind']): void {
  world.markers.push({ z: wrap(player.z + aheadM * 100, track.length), sprite, kind });
}

function spawnCarAhead(world: World, player: Player, track: Track): Car {
  const ramp = difficulty(world.odometerM);
  const ahead = randRange(world.rng, ROAD.drawDistance * ROAD.segmentLength * 0.4, ROAD.drawDistance * ROAD.segmentLength * 0.95);
  const jitter = randRange(world.rng, -0.35, 0.35) * ramp.trafficGap;
  const z = wrap(player.z + ahead + jitter, track.length);
  const lane = pick(world.rng, LANE_OFFSETS);
  return {
    // A recycled car is a NEW car — fresh id, so its engine voice starts over
    // rather than sliding continuously from the machine it replaced.
    id: world.nextCarId++,
    z,
    offset: lane,
    driftPhase: world.rng() * Math.PI * 2,
    // Gentle, mostly lane-holding weave — a slow lane-change feel, not a swerve
    // into you. Most cars barely drift; a few wander a little.
    driftAmp: randRange(world.rng, 0, 0.14),
    speed: player.maxSpeed * ramp.carSpeedMul * world.mods.speed * randRange(world.rng, 0.85, 1.05),
    sprite: pick(world.rng, rosterAt(world.odometerM)),
    prevFwd: signedForward(z, player.z, track.length),
    prevLateral: Infinity,
    role: 'traffic',
  };
}

function spawnRival(world: World, player: Player, track: Track): Car {
  const maxSpeedMps = player.maxSpeed / 100;
  const progress = createRivalProgress(maxSpeedMps);
  const z = wrap(player.z + progress.distanceM * 100, track.length);
  return {
    id: world.nextCarId++,
    z,
    offset: 0.34,
    driftPhase: 0,
    driftAmp: 0,
    speed: progress.speedMps * 100,
    sprite: 'scooter-rival',
    prevFwd: signedForward(z, player.z, track.length),
    prevLateral: Infinity,
    role: 'rival',
    rival: progress,
    rivalMaxSpeedMps: maxSpeedMps,
    rivalOriginZ: player.z,
  };
}

export function getRival(world: World): Car | null {
  return world.traffic.find(car => car.role === 'rival' && car.rival) ?? null;
}

export function getRivalGapM(world: World, playerDistanceM = world.odometerM): number | null {
  const car = getRival(world);
  return car?.rival ? rivalGapM(car.rival, playerDistanceM) : null;
}

/** Remove the physical opponent once the 12.6 km showdown has resolved. */
export function retireRival(world: World): void {
  world.traffic = world.traffic.filter(car => car.role !== 'rival');
}

function hitWindowT(prevFwd: number, fwd: number): [number, number] | null {
  const dz = fwd - prevFwd;
  if (Math.abs(dz) < 0.001) {
    return prevFwd >= HIT_REAR && prevFwd <= HIT_NOSE ? [0, 1] : null;
  }
  const tRear = (HIT_REAR - prevFwd) / dz;
  const tNose = (HIT_NOSE - prevFwd) / dz;
  const lo = Math.max(0, Math.min(tRear, tNose));
  const hi = Math.min(1, Math.max(tRear, tNose));
  return lo <= hi ? [lo, hi] : null;
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Effective lateral hit half-gap at a car-distance `d`. Full width while the
 * car's base is still at/ahead of the bike's (a rear-end is always a crash),
 * NARROWING as the car slides down past the bike toward the band's tail — once
 * you are genuinely side-by-side, only a deep overlap counts, so a sliver of
 * lean toward a car you are passing reads as a heart-in-mouth near-miss rather
 * than a side-swipe death. Classic arcade fairness, geometrically encoded.
 */
function effectiveGap(d: number, hitGap: number): number {
  if (d >= RIDER_FWD) return hitGap;
  const t = clamp((RIDER_FWD - d) / (RIDER_FWD - HIT_REAR), 0, 1);
  return hitGap * (1 - 0.45 * t);
}

function sweptLateralGap(prevLateral: number, lateral: number, t0: number, t1: number): number {
  const a = lerpNumber(prevLateral, lateral, t0);
  const b = lerpNumber(prevLateral, lateral, t1);
  if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) return 0;
  return Math.min(Math.abs(a), Math.abs(b));
}

// The slipstream wake: it starts just beyond crash reach ahead of the bike and
// extends this far up the road. Tucking in builds a slingshot (main.ts).
const DRAFT_RANGE = ROAD.segmentLength * 2.6;

/**
 * How strongly the rider is tucked in a car's slipstream right now: 0 (not
 * drafting) up to 1 (right on its bumper). Laterally the wake is the car's own
 * width, so you must genuinely line up behind it; longitudinally it spans
 * (HIT_NOSE, HIT_NOSE + DRAFT_RANGE] — close enough to feel brave, never close
 * enough to be a crash yet.
 */
export function draftAt(world: World, player: Player, track: Track): number {
  let best = 0;
  for (const car of world.traffic) {
    const d = signedForward(car.z, player.z, track.length);
    const beyond = d - HIT_NOSE;
    if (beyond <= 0 || beyond > DRAFT_RANGE) continue;
    const drift = Math.sin(car.driftPhase + world.odometerM * 0.02) * car.driftAmp;
    const laneOffset = clamp(car.offset + drift, -0.85, 0.85);
    if (Math.abs(player.x - laneOffset) > carHitHalfWidth(car.sprite) + 0.05) continue;
    best = Math.max(best, 1 - beyond / DRAFT_RANGE);
  }
  return best;
}

export function createWorld(seed = 0x1a2b3c, mods: WorldMods = { density: 1, speed: 1 }): World {
  return { pickups: [], traffic: [], markers: [], rng: makeRng(seed), odometerM: 0, mods: { ...mods }, nextCarId: 1 };
}

// ---- what you can HEAR of the traffic ---------------------------------------

/** How far up the road a car's engine carries. */
const HEAR_AHEAD = ROAD.segmentLength * 24;
/** …and how far behind it stays audible once it has dropped back. */
const HEAR_BEHIND = ROAD.segmentLength * 5;
/**
 * Distance at which a car's stereo position is half what it would be alongside
 * you. Stereo placement is ANGULAR — how far off your centre-line the car sits is
 * its lateral offset over its distance — so this is just the depth at which that
 * angle has halved.
 */
const PAN_REF = ROAD.segmentLength * 4;

/** One car, as the audio engine needs to hear it. */
export interface TrafficSound {
  id: number;
  /** 0 at the edge of earshot … 1 right on top of you. Drives level. */
  proximity: number;
  /** -1..1 stereo position. Deliberately WIDENS as the car closes (see below). */
  pan: number;
  /** The car's own revs, 0..1 — a van lugging along should not sound like a Ferrari. */
  rpm: number;
  /** How hard you are closing on it, 0..1. Drives the Doppler pitch-up. */
  closing: number;
}

/**
 * The `limit` nearest cars within earshot, loudest first.
 *
 * Note the pan. It is ANGULAR — lateral offset over DISTANCE — not just lateral
 * offset. A car three hundred metres up the road sits near the middle of your
 * view whichever lane it is in, and only swings out to the side as it comes back
 * to you. Panning on lane offset alone would slam that distant car hard left in
 * your headphones: the sort of thing that sounds convincingly three-dimensional
 * held still, and is completely wrong the moment anything moves.
 */
export function audibleTraffic(world: World, player: Player, track: Track, limit = 4): TrafficSound[] {
  const heard: TrafficSound[] = [];
  for (const car of world.traffic) {
    const d = signedForward(car.z, player.z, track.length);
    if (d > HEAR_AHEAD || d < -HEAR_BEHIND) continue;
    // Falls away with distance rather than linearly — a car at half the range is
    // much quieter than half as loud, which is how engines actually behave.
    const t = clamp((d + HEAR_BEHIND) / (HEAR_AHEAD + HEAR_BEHIND), 0, 1);
    const proximity = Math.pow(1 - t, 1.8);
    const drift = Math.sin(car.driftPhase + world.odometerM * 0.02) * car.driftAmp;
    const laneOffset = clamp(car.offset + drift, -0.85, 0.85);
    const lateral = laneOffset - player.x;
    const angular = lateral / (1 + Math.max(0, d) / PAN_REF);
    heard.push({
      id: car.id,
      proximity,
      pan: clamp(angular * 0.85, -1, 1),
      rpm: clamp(car.speed / Math.max(1, player.maxSpeed), 0, 1),
      closing: clamp((player.speed - car.speed) / Math.max(1, player.maxSpeed), 0, 1),
    });
  }
  heard.sort((a, b) => b.proximity - a.proximity);
  return heard.slice(0, limit);
}

/** (Re)populate the world ahead of the player for a fresh run. The opening
 *  Fren rival only rides the grand tour — the 600B world tour is a victory
 *  lap, so `rival: false` skips spawning them. */
export function resetWorld(world: World, player: Player, track: Track, opts: { rival?: boolean } = {}): void {
  world.odometerM = 0;
  world.traffic = [];
  world.pickups = []; // pickups are added on the clock by main.ts, not pre-populated
  world.markers = []; // gates/finish are added by main.ts as boundaries approach
  const target = targetCars(world);
  for (let i = 0; i < target; i += 1) world.traffic.push(spawnCarAhead(world, player, track));
  if (opts.rival !== false) world.traffic.push(spawnRival(world, player, track));
}

/**
 * Advance all entities and detect interactions. `invuln` suppresses crashes
 * (during a spin-out/respawn/boost). Returns the events that fired this frame.
 */
export function updateWorld(
  world: World,
  player: Player,
  track: Track,
  dt: number,
  invuln: boolean,
): WorldEvent[] {
  const events: WorldEvent[] = [];
  world.odometerM += (player.speed * dt) / 100; // 100 world units ≈ 1 metre

  // --- pickups (collected once, then removed; no auto-respawn) ---
  for (let i = world.pickups.length - 1; i >= 0; i -= 1) {
    const pickup = world.pickups[i];
    pickup.bob += dt;
    const d = signedForward(pickup.z, player.z, track.length);
    // Collected as the sprite reaches the BIKE (RIDER_FWD), not the camera plane.
    if (!pickup.taken && Math.abs(d - RIDER_FWD) < PICKUP_Z && Math.abs(player.x - pickup.offset) < PICKUP_GAP) {
      pickup.taken = true;
      events.push({ type: 'pickup', kind: pickup.kind, offset: pickup.offset });
    }
    if (pickup.taken || d < -RECYCLE_BEHIND) world.pickups.splice(i, 1);
  }

  // --- traffic ---
  // The pool tracks the difficulty ramp (and mode density): it grows by one car
  // per step when under target, and shrinks at the recycle point (never mid-
  // screen) when over — so the road thickens over the journey without pops.
  const carTarget = targetCars(world);
  if (regularCarCount(world) < carTarget) world.traffic.push(spawnCarAhead(world, player, track));
  for (let ci = world.traffic.length - 1; ci >= 0; ci -= 1) {
    const car = world.traffic[ci];
    if (car.role === 'rival' && car.rival && car.rivalMaxSpeedMps && car.rivalOriginZ !== undefined) {
      updateRival(car.rival, {
        dt,
        playerDistanceM: world.odometerM,
        maxSpeedMps: car.rivalMaxSpeedMps,
        difficultySpeedMul: world.mods.speed,
      });
      car.speed = car.rival.speedMps * 100;
      car.z = wrap(car.rivalOriginZ + car.rival.distanceM * 100, track.length);
      // A readable, deterministic lane rhythm. At the finish the Fren pulls to
      // the outside instead of parking squarely on the racing line.
      car.offset = car.rival.finishTimeS === null
        ? Math.sin(car.rival.distanceM * 0.0017 + 0.7) * 0.5
        : 0.72;
    } else {
      car.z = wrap(car.z + car.speed * dt, track.length);
    }
    const drift = Math.sin(car.driftPhase + world.odometerM * 0.02) * car.driftAmp;
    const laneOffset = clamp(car.offset + drift, -0.85, 0.85);
    const d = signedForward(car.z, player.z, track.length);
    const lateral = player.x - laneOffset;

    // You can only crash into a car you're OVERTAKING — never be rear-ended by
    // traffic. A crash needs the rider CLOSING on it (at least as fast); a car
    // pulling away can't hit you. This is a FAIRNESS rule, kept separate from the
    // geometry: "I swerved into a car I'm passing" (my fault → crash) vs "a faster
    // car came up behind and clipped me" (forgiven).
    const closing = player.speed >= car.speed;
    const hitGap = collideGap(car.sprite);

    // ONE swept box-overlap: the car's distance swept from prevFwd (last frame)
    // to d (now); a crash fires if that sweep crosses the visible hit band
    // [HIT_REAR, HIT_NOSE] around the bike's drawn position. Testing the swept
    // segment (not just where d lands this frame) stops fast pass-through
    // tunnelling. Laterally, only test the fraction of the frame where the car
    // was actually in that z-band; otherwise a lane position from when the car
    // was still far ahead can cause a bogus crash after you have already swerved
    // clear.
    const zLo = Math.min(car.prevFwd, d);
    const zHi = Math.max(car.prevFwd, d);
    // Guard the wrap seam: a real frame's sweep is at most a couple of segments,
    // so a span near half the track means prevFwd and d straddled ±len/2 (the
    // loop point) — not a genuine pass. (Traffic never actually reaches the seam,
    // but this keeps the swept interval honest regardless.)
    const genuineStep = zHi - zLo < track.length / 2;
    const hitWindow = genuineStep ? hitWindowT(car.prevFwd, d) : null;
    const passGap = hitWindow
      ? sweptLateralGap(car.prevLateral, lateral, hitWindow[0], hitWindow[1])
      : Infinity;
    // Evaluate the taper at the sweep's midpoint through the band.
    const dMid = hitWindow ? lerpNumber(car.prevFwd, d, (hitWindow[0] + hitWindow[1]) / 2) : d;
    const effGap = effectiveGap(dMid, hitGap);

    if (!invuln && closing && hitWindow && passGap < effGap) {
      events.push({ type: 'crash', sprite: car.sprite });
      if (car.role === 'traffic') Object.assign(car, spawnCarAhead(world, player, track));
      else {
        car.prevFwd = d;
        car.prevLateral = lateral;
      }
      continue;
    }

    // Cleared it: the car's base drops past the bike's visible tail this frame →
    // an overtake (a near-miss if the closest approach only just cleared the
    // hitbox). `side` is the car's position relative to the BIKE, so a car you
    // went by on the left reports negative — the sign the stereo pass-by needs.
    if (genuineStep && car.prevFwd > HIT_REAR && d <= HIT_REAR) {
      const side = clamp(laneOffset - player.x, -1, 1);
      if (passGap < hitGap + NEAR_BAND && passGap >= effGap) events.push({ type: 'nearMiss', side });
      const closing = clamp((player.speed - car.speed) / Math.max(1, player.maxSpeed), 0, 1);
      events.push({ type: 'overtake', side, closing });
      if (car.role === 'rival') events.push({ type: 'rivalPass' });
    }
    car.prevFwd = d;
    car.prevLateral = lateral;

    if (car.role === 'traffic' && d < -RECYCLE_BEHIND) {
      if (regularCarCount(world) > carTarget) world.traffic.splice(ci, 1);
      else Object.assign(car, spawnCarAhead(world, player, track));
    }
  }

  // --- markers (gate / finish arches): static, non-colliding, cull once passed.
  for (let i = world.markers.length - 1; i >= 0; i -= 1) {
    if (signedForward(world.markers[i].z, player.z, track.length) < -RECYCLE_BEHIND) world.markers.splice(i, 1);
  }

  // Roadside objects: once well off the tarmac, hitting a solid trunk/post/rock
  // wipes you out. The crash footprint is a logical mask, not the full visual
  // billboard, so leafy canopies and transparent sprite edges are forgiving.
  // Tested around the bike's DRAWN position (player.z + RIDER_FWD), so the strike
  // lands as the trunk visually reaches the front wheel.
  if (!invuln && Math.abs(player.x) > OFFROAD_HIT_X) {
    const riderZ = wrap(player.z + RIDER_FWD, track.length);
    const baseIdx = Math.floor(riderZ / ROAD.segmentLength) % track.segments.length;
    const sceneryKit = sceneryKitAt(world.odometerM);
    const stepZ = Math.max(0, player.speed * dt);
    for (let k = -1; k < 2; k += 1) {
      const seg = track.segments[(baseIdx + k + track.segments.length) % track.segments.length];
      const d = signedForward(seg.p1.world.z, riderZ, track.length);
      if (d > SCENERY_HIT_AHEAD || d < -(SCENERY_HIT_BEHIND + stepZ)) continue;
      for (const item of seg.scenery) {
        const sprite = resolveScenerySprite(item.name, sceneryKit, seg.index + (item.offset > 0 ? 0.5 : 0));
        const hitHalf = sceneryHitHalfWidth(sprite);
        if (hitHalf === null) continue;
        if (Math.abs(player.x - item.offset) < hitHalf + PLAYER_HALF) {
          events.push({ type: 'crash', sprite });
          return events;
        }
      }
    }
  }

  return events;
}
