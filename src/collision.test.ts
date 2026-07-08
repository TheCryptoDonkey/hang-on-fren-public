// Collision correctness spec. These encode what a player SEES: an in-lane pass
// must always crash (you cannot drive through a car) and must fire while you are
// still on it; a car you have already passed (culled behind the camera) must never
// wipe you out; and the hitbox width is derived from the drawn sprite width.
import { describe, it, expect } from 'vitest';
import { buildTrack, createPlayer, updatePlayer, ROAD, RIDER_FWD, type DriveInput } from './road.js';
import { createWorld, resetWorld, updateWorld, signedForward, carHitHalfWidth, HIT_NOSE, HIT_REAR } from './world.js';
import { spriteWorldWidth } from './geometry.js';

const DT = 1 / 60;
const NONE: DriveInput = { left: false, right: false, throttle: false, brake: false };

/** Plant a single car `aheadOfBike` units in front of the bike's DRAWN position. */
function plant(seed: number, lane: number, speedFrac: number, aheadOfBike: number) {
  const track = buildTrack();
  const player = createPlayer();
  const world = createWorld(seed);
  resetWorld(world, player, track);
  world.traffic.length = 1;
  const car = world.traffic[0];
  car.offset = lane;
  car.driftAmp = 0;
  car.speed = player.maxSpeed * speedFrac;
  car.z = player.z + RIDER_FWD + aheadOfBike;
  car.prevFwd = signedForward(car.z, player.z, track.length);
  car.prevLateral = player.x - car.offset;
  return { track, player, world, car };
}

describe('collision catches every in-lane pass (no draw-through, fires on time)', () => {
  // Drive dead in a car's lane and pass it across a range of speeds. EVERY such
  // pass must crash (the billboards fully overlap — you cannot drive through a
  // car), and the crash must fire AT the bike's drawn position — where the
  // sprites visually meet — not half a second later at the camera plane.
  for (const playerFrac of [0.45, 0.6, 0.8, 1.0]) {
    it(`in-lane pass at ${Math.round(playerFrac * 100)}% speed always crashes, on time`, () => {
      const { track, player, world, car } = plant(510 + Math.round(playerFrac * 100), 0, 0.35, 700);
      player.x = 0; // dead in the car's lane
      player.speed = player.maxSpeed * playerFrac;
      let crashed = false;
      let crashD = 0;
      let overtookFirst = false;
      for (let i = 0; i < 400; i += 1) {
        updatePlayer(player, track, { ...NONE, throttle: true }, DT); // straight, hold lane
        player.speed = Math.min(player.speed, player.maxSpeed * playerFrac);
        const dBefore = signedForward(car.z, player.z, track.length);
        const ev = updateWorld(world, player, track, DT, false);
        if (ev.some(e => e.type === 'overtake') && !crashed) overtookFirst = true;
        if (ev.some(e => e.type === 'crash')) { crashed = true; crashD = dBefore; break; }
      }
      expect(crashed).toBe(true);
      expect(overtookFirst).toBe(false); // never resolves to a clean pass first
      // fires while the car is visually AT the bike (inside the drawn hit band,
      // give or take one frame of travel), never a car-length past it
      expect(crashD).toBeGreaterThan(HIT_REAR - ROAD.segmentLength);
      expect(crashD).toBeLessThan(HIT_NOSE + ROAD.segmentLength);
    });
  }
});

describe('collision never crashes you into a car that has visibly cleared the bike', () => {
  // Two flavours of the same reported bug — "crashing when nothing is around, I
  // just passed something and moved over":
  //   -90  → the car is behind the camera entirely (renderer culled it).
  //   HIT_REAR - 60 → the car is still ON SCREEN below the bike, but its base has
  //          visibly dropped past the bike's tail — it has cleared you.
  // Swerving into its old lane must NOT wipe you out in either case.
  for (const behind of [-90, HIT_REAR - 60]) {
    it(`no phantom crash swerving onto a car at d=${Math.round(behind)} (already passed)`, () => {
      const track = buildTrack();
      const player = createPlayer();
      const world = createWorld(601);
      resetWorld(world, player, track);
      world.traffic.length = 1;
      const car = world.traffic[0];
      car.offset = 0; // the lane we will swerve back into
      car.driftAmp = 0;
      car.speed = player.maxSpeed * 0.5;
      player.x = 0.6; // one lane over, having overtaken it
      player.speed = player.maxSpeed * 0.55; // barely quicker → it keeps slipping back
      car.z = player.z + behind;
      car.prevFwd = signedForward(car.z, player.z, track.length);
      car.prevLateral = player.x - car.offset;
      let phantomCrash = false;
      let stayedBehind = true;
      for (let i = 0; i < 40; i += 1) {
        player.z += player.speed * DT; // keep riding forward (we're quicker than it)
        player.x = Math.max(0, player.x - 0.05); // drift across into its old lane
        const ev = updateWorld(world, player, track, DT, false);
        const d = signedForward(car.z, player.z, track.length);
        if (d > HIT_REAR) stayedBehind = false; // sanity: it never re-enters the hit band
        if (ev.some(e => e.type === 'crash')) phantomCrash = true;
      }
      expect(stayedBehind).toBe(true);
      expect(phantomCrash).toBe(false);
    });
  }
});

describe('collision geometry is derived from the drawn sprite', () => {
  it('the hit half-width tracks each car sprite drawn width (single source of truth)', () => {
    for (const sprite of ['car-classic', 'car-van', 'car-lambo', 'car-ferrari', 'car-porsche', 'car-bentley', 'car-banger', 'scooter-rival']) {
      const drawnHalf = spriteWorldWidth(sprite) / 2;
      const hit = carHitHalfWidth(sprite);
      // hitbox is a touch tighter than the drawing (arcade generosity), never wider
      expect(hit).toBeLessThanOrEqual(drawnHalf);
      expect(hit).toBeGreaterThan(drawnHalf - 0.06);
    }
  });
});
