// TEMP integration harness — drives the REAL player physics (updatePlayer, with
// genuine steering inertia + speed build-up) together with updateWorld, to prove
// the collision fix under real gameplay rather than hand-set fields.
import { describe, it, expect } from 'vitest';
import { buildTrack, createPlayer, updatePlayer, RIDER_FWD, type DriveInput } from './road.js';
import { createWorld, resetWorld, updateWorld, signedForward } from './world.js';

const DT = 1 / 60;
const NONE: DriveInput = { left: false, right: false, throttle: false, brake: false };

/** Plant a single car `aheadOfBike` units in front of the bike's drawn position,
 *  in a chosen lane, moving at `speedFrac` of max. */
function planted(seed: number, laneOffset: number, speedFrac: number, aheadOfBike: number) {
  const track = buildTrack();
  const player = createPlayer();
  const world = createWorld(seed);
  resetWorld(world, player, track);
  world.traffic.length = 1;
  const car = world.traffic[0];
  car.offset = laneOffset;
  car.driftAmp = 0;
  car.speed = player.maxSpeed * speedFrac;
  car.z = player.z + RIDER_FWD + aheadOfBike;
  car.prevFwd = signedForward(car.z, player.z, track.length);
  car.prevLateral = player.x - car.offset;
  return { track, player, world, car };
}

describe('collision (real-physics integration)', () => {
  it('rear-ends a slower car dead ahead in-lane at full throttle', () => {
    const { track, player, world } = planted(101, 0, 0.4, 900);
    let crashed = false;
    for (let i = 0; i < 240 && !crashed; i += 1) {
      updatePlayer(player, track, { ...NONE, throttle: true }, DT); // straight, flat out
      const ev = updateWorld(world, player, track, DT, false);
      if (ev.some(e => e.type === 'crash')) crashed = true;
    }
    expect(crashed).toBe(true);
  });

  it('crashes if you bury half-way into a car then swerve out', () => {
    // Close on a slower in-lane car, then once we are drawn on top of it, yank
    // the bars away. The footprint must have already caught us.
    const { track, player, world, car } = planted(102, 0, 0.5, 700);
    let crashed = false;
    for (let i = 0; i < 400 && !crashed; i += 1) {
      const d = signedForward(car.z, player.z, track.length);
      // Bury in first (throttle straight); the instant we're level-ish, swerve hard.
      const overlapping = Math.abs(d - RIDER_FWD) < 120;
      const input: DriveInput = overlapping
        ? { ...NONE, throttle: true, right: true } // swerve out of the lane
        : { ...NONE, throttle: true };
      updatePlayer(player, track, input, DT);
      const ev = updateWorld(world, player, track, DT, false);
      if (ev.some(e => e.type === 'crash')) crashed = true;
    }
    expect(crashed).toBe(true);
  });

  it('forgives a paced pass that only grazes a sliver of clearance', () => {
    // An arcade racer forgives a glancing pass. A car nearly as quick as us, one
    // lane over — we draw alongside and lean toward it as we edge past, holding a
    // sliver of daylight (a real player aiming close, not steering INTO the car).
    // The old fat hitbox clipped that as a wipeout "for no reason"; it must read
    // as a clean overtake. A pass that actually buries into the car's body still
    // crashes — see world.test.ts "swerve into the side of a car you are passing"
    // (scripted to a genuine gap→0 overlap).
    const { track, player, world, car } = planted(103, 0, 0.82, 260);
    player.x = 0.55; // right lane, clear
    player.speed = player.maxSpeed; // already at cruising pace (as when overtaking)
    let crashed = false;
    let overtook = false;
    let nearMissed = false;
    for (let i = 0; i < 500; i += 1) {
      const d = signedForward(car.z, player.z, track.length);
      // As we come up alongside the bike's drawn position, lean toward its lane —
      // but like a real rider, stop feeding steering once we're skimming it.
      const nearlyLevel = d - RIDER_FWD < 320 && d - RIDER_FWD > -260;
      const skimming = Math.abs(player.x - car.offset) < 0.3;
      const input: DriveInput = nearlyLevel && !skimming
        ? { ...NONE, throttle: true, left: true }
        : { ...NONE, throttle: true };
      updatePlayer(player, track, input, DT);
      const ev = updateWorld(world, player, track, DT, false);
      if (ev.some(e => e.type === 'crash')) crashed = true;
      if (ev.some(e => e.type === 'overtake')) overtook = true;
      if (ev.some(e => e.type === 'nearMiss')) nearMissed = true;
    }
    expect(crashed).toBe(false);
    expect(overtook).toBe(true);
    expect(nearMissed).toBe(true); // the graze is rewarded, not punished
  });

  it('does NOT crash on a clean pass one lane over (fairness)', () => {
    // Stay in the right lane, flat out, overtake a car sitting in the middle lane.
    const { track, player, world } = planted(104, 0, 0.5, 500);
    player.x = 0.6;
    let crashed = false;
    let overtook = false;
    for (let i = 0; i < 300; i += 1) {
      updatePlayer(player, track, { ...NONE, throttle: true }, DT); // hold the lane
      // gentle self-centering would drift us; nudge back toward 0.6 lane if needed
      const ev = updateWorld(world, player, track, DT, false);
      if (ev.some(e => e.type === 'crash')) crashed = true;
      if (ev.some(e => e.type === 'overtake')) overtook = true;
    }
    expect(crashed).toBe(false);
    expect(overtook).toBe(true);
  });
});
