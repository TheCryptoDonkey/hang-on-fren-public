import { describe, it, expect } from 'vitest';
import { buildTrack, createPlayer, ROAD, RIDER_FWD } from './road.js';
import { createWorld, resetWorld, updateWorld, addPickup, signedForward, draftAt, HIT_NOSE, HIT_REAR } from './world.js';

const ROAD_DRAW = ROAD.drawDistance * ROAD.segmentLength;

describe('world', () => {
  it('signedForward is positive ahead, negative behind, and wraps', () => {
    const len = 1000;
    expect(signedForward(100, 0, len)).toBe(100);
    expect(signedForward(900, 0, len)).toBe(-100); // just behind, via wrap
    expect(signedForward(0, 0, len)).toBe(0);
  });

  it('starts with traffic but no pickups (pickups are clock-scheduled)', () => {
    const track = buildTrack();
    const player = createPlayer();
    const world = createWorld(1);
    resetWorld(world, player, track);
    expect(world.pickups.length).toBe(0);
    expect(world.traffic.length).toBe(7);
    addPickup(world, player, track, 'petrol');
    expect(world.pickups.length).toBe(1);
    expect(signedForward(world.pickups[0].z, player.z, track.length)).toBeGreaterThan(0);
  });

  it('collects a pickup placed directly ahead, then removes it (no respawn)', () => {
    const track = buildTrack();
    const player = createPlayer();
    const world = createWorld(2);
    resetWorld(world, player, track);
    addPickup(world, player, track, 'petrol');
    const pickup = world.pickups[0];
    pickup.z = player.z + RIDER_FWD; // right on the bike's drawn position
    pickup.offset = player.x;
    const events = updateWorld(world, player, track, 1 / 60, false);
    expect(events.some(e => e.type === 'pickup')).toBe(true);
    expect(world.pickups.length).toBe(0); // collected → gone, not recycled
  });

  it('drops the emergency rescue can in the rider lane, reachably close', () => {
    const track = buildTrack();
    const player = createPlayer();
    player.speed = player.maxSpeed;
    player.x = 0.3;
    const world = createWorld(9);
    resetWorld(world, player, track);
    addPickup(world, player, track, 'petrol', true);
    const can = world.pickups[0];
    expect(Math.abs(can.offset - player.x)).toBeLessThan(0.5); // roughly in our lane
    const ahead = signedForward(can.z, player.z, track.length);
    expect(ahead).toBeGreaterThan(0);
    expect(ahead).toBeLessThan(ROAD_DRAW); // within the visible road, i.e. reachable
  });

  it('crashes into an overlapping car ahead unless shielded', () => {
    const track = buildTrack();
    const player = createPlayer();
    player.speed = player.maxSpeed * 0.5; // moving, so we're closing on stopped cars
    const world = createWorld(3);
    resetWorld(world, player, track);
    const car = world.traffic[0];
    car.z = player.z + RIDER_FWD; // its base drawn level with the bike
    car.offset = player.x;
    car.driftAmp = 0;
    car.speed = 0;
    const shielded = updateWorld(world, player, track, 1 / 60, true);
    expect(shielded.some(e => e.type === 'crash')).toBe(false);

    const car2 = world.traffic[1];
    car2.z = player.z + RIDER_FWD;
    car2.offset = player.x;
    car2.driftAmp = 0;
    car2.speed = 0;
    const events = updateWorld(world, player, track, 1 / 60, false);
    expect(events.some(e => e.type === 'crash')).toBe(true);
  });

  it('never gets rear-ended: faster traffic passing from behind never crashes', () => {
    const track = buildTrack();
    const player = createPlayer();
    player.speed = player.maxSpeed * 0.3; // slow — every car is quicker
    const world = createWorld(4);
    resetWorld(world, player, track);
    world.traffic.length = 1; // isolate a single planted car
    // Park one fast car right behind us, dead in our lane, and let it barrel past.
    const car = world.traffic[0];
    car.z = player.z - 60;
    car.offset = player.x;
    car.driftAmp = 0;
    car.speed = player.maxSpeed; // faster than the rider
    car.prevFwd = signedForward(car.z, player.z, track.length);
    car.prevLateral = player.x - car.offset;
    let crashed = false;
    for (let i = 0; i < 30; i += 1) {
      const events = updateWorld(world, player, track, 1 / 60, false);
      if (events.some(e => e.type === 'crash')) crashed = true;
    }
    expect(crashed).toBe(false);
  });

  it('catches a fast pass-through instead of tunnelling (swept crossing)', () => {
    const track = buildTrack();
    const player = createPlayer();
    player.speed = player.maxSpeed;
    const world = createWorld(5);
    resetWorld(world, player, track);
    world.traffic.length = 1; // isolate a single planted car
    const car = world.traffic[0];
    car.offset = player.x; // dead in our lane
    car.driftAmp = 0;
    car.speed = 0;
    // Frame 1: car sits just BEYOND the bike's bumper reach so nothing fires yet.
    car.z = player.z + RIDER_FWD + 170;
    car.prevFwd = RIDER_FWD + 999; // force a clean "first sight"
    car.prevLateral = player.x - car.offset;
    updateWorld(world, player, track, 1 / 60, false);
    // Frame 2: a single big step jumps the bike clean over the car's z.
    player.z += 340;
    const events = updateWorld(world, player, track, 1 / 60, false);
    expect(events.some(e => e.type === 'crash')).toBe(true);
  });

  it('does NOT wipe out on an adjacent-lane car passed with clearance (the "for no reason" bug)', () => {
    // Regression: a car ~0.44 road-units to the side — visibly a lane away — used
    // to clip the rider because the old combined hitbox was 0.42 and traffic
    // drifted into you. It must now read as an overtake/near-miss, never a crash.
    const track = buildTrack();
    const player = createPlayer();
    player.x = 0;
    player.speed = player.maxSpeed;
    const world = createWorld(7);
    resetWorld(world, player, track);
    world.traffic.length = 1;
    const car = world.traffic[0];
    car.offset = 0.44; // clearly in the next lane over
    car.driftAmp = 0;
    car.speed = player.maxSpeed * 0.5;
    car.z = player.z + RIDER_FWD + 170; // just ahead of the drawn bike
    car.prevFwd = signedForward(car.z, player.z, track.length);
    car.prevLateral = player.x - car.offset;
    let crashed = false;
    let overtook = false;
    for (let i = 0; i < 60; i += 1) {
      player.z += player.speed * (1 / 60); // rider advances and overtakes the car
      const events = updateWorld(world, player, track, 1 / 60, false);
      if (events.some(e => e.type === 'crash')) crashed = true;
      if (events.some(e => e.type === 'overtake')) overtook = true;
    }
    expect(crashed).toBe(false);
    expect(overtook).toBe(true);
  });

  it('does NOT insta-clip a car that is still some way ahead when you change lane (the "steer after passing" bug)', () => {
    // Regression: steering into a lane where a car sits ~0.6 segments ahead used
    // to wipe you out instantly (the old hit window reached CAR_LEN_Z*0.5). You
    // must be able to weave; a crash should only come when you actually reach its
    // back bumper.
    const track = buildTrack();
    const player = createPlayer();
    player.x = 0; // aligned with the car's lane
    player.speed = player.maxSpeed * 0.6;
    const world = createWorld(13);
    resetWorld(world, player, track);
    world.traffic.length = 1;
    const car = world.traffic[0];
    car.offset = 0;
    car.driftAmp = 0;
    car.speed = player.maxSpeed * 0.55; // barely slower, so closing is gentle
    car.z = player.z + RIDER_FWD + 120; // ~0.6 segments beyond the bike — outside bumper reach
    car.prevFwd = signedForward(car.z, player.z, track.length);
    car.prevLateral = player.x - car.offset;
    player.z += player.speed * (1 / 60);
    const events = updateWorld(world, player, track, 1 / 60, false);
    expect(events.some(e => e.type === 'crash')).toBe(false);
  });

  it('crashes when you sit half-buried in a car you are level with (not just at the pass instant)', () => {
    // You can drive HALF WAY THROUGH a visible car — drawn level with it, dead
    // in its lane — unless the detector also catches a steady visible overlap,
    // not only the single frame where the bike crosses the car's z.
    const track = buildTrack();
    const player = createPlayer();
    player.speed = player.maxSpeed * 0.6; // we're the faster/overtaking party
    const world = createWorld(21);
    resetWorld(world, player, track);
    world.traffic.length = 1;
    const car = world.traffic[0];
    car.offset = player.x; // dead in our lane
    car.driftAmp = 0;
    car.speed = 0; // stopped car we've drawn level with
    car.z = player.z + RIDER_FWD + 15; // its billboard is right on top of the bike
    car.prevFwd = RIDER_FWD + 10;
    car.prevLateral = player.x - car.offset;
    const events = updateWorld(world, player, track, 1 / 60, false);
    expect(events.some(e => e.type === 'crash')).toBe(true);
  });

  it('crashes when you swerve into the side of a car that is still visible', () => {
    // Pulled alongside a car and drifting into its lane while it is still in the
    // visible hit band: this is a real side-swipe and should wipe out.
    const track = buildTrack();
    const player = createPlayer();
    player.x = 0.1;
    player.speed = player.maxSpeed * 0.5;
    const world = createWorld(23);
    resetWorld(world, player, track);
    world.traffic.length = 1;
    const car = world.traffic[0];
    car.offset = 0;
    car.driftAmp = 0;
    car.speed = 0;
    car.z = player.z + RIDER_FWD + 20;
    car.prevFwd = RIDER_FWD + 60;
    car.prevLateral = 0.5;
    const events = updateWorld(world, player, track, 1 / 60, false);
    expect(events.some(e => e.type === 'crash')).toBe(true);
  });

  it('does NOT crash when you swerve into a car lane after the car has visibly cleared the bike', () => {
    // Once a car's base has dropped past the bike's tail on screen (below
    // HIT_REAR), later lane changes must not cause a "hit a car that wasn't
    // there" wipeout — it has visibly cleared you.
    const track = buildTrack();
    const player = createPlayer();
    player.x = 0.5; // one lane over, clear to start
    player.speed = player.maxSpeed * 0.5;
    const world = createWorld(23);
    resetWorld(world, player, track);
    world.traffic.length = 1;
    const car = world.traffic[0];
    car.offset = 0; // the lane we'll swerve into
    car.driftAmp = 0;
    car.speed = player.maxSpeed * 0.48; // just slower — we're edging past (closing)
    car.z = player.z + HIT_REAR - 5; // just cleared the bike, slipping further behind
    car.prevFwd = HIT_REAR - 5; // already past — never a fresh crossing
    car.prevLateral = 0.5;
    let crashed = false;
    for (let i = 0; i < 25; i += 1) {
      player.z += player.speed * (1 / 60);
      player.x = Math.max(0, player.x - 0.05); // swerve into the car's lane
      const events = updateWorld(world, player, track, 1 / 60, false);
      if (events.some(e => e.type === 'crash')) crashed = true;
    }
    expect(crashed).toBe(false);
  });

  it('does NOT use stale lateral overlap from before the car was actually near', () => {
    // Regression for rogue "not really near it" crashes: last frame we were in
    // the car's lane, but the car was still well ahead of the visible hit band.
    // By the time it reaches the hit band this frame, we have swerved clear.
    const track = buildTrack();
    const player = createPlayer();
    player.x = 0.6;
    player.speed = player.maxSpeed;
    const world = createWorld(24);
    resetWorld(world, player, track);
    world.traffic.length = 1;
    const car = world.traffic[0];
    car.offset = 0;
    car.driftAmp = 0;
    car.speed = 0;
    car.z = player.z + RIDER_FWD - 17; // inside the hit band this frame
    car.prevFwd = RIDER_FWD + 180; // …but still well beyond the bike last frame
    car.prevLateral = 0;
    const events = updateWorld(world, player, track, 1 / 60, false);
    expect(events.some(e => e.type === 'crash')).toBe(false);
  });

  // Park the player so the planted segment's start lands `dFromBike` units from
  // the bike's DRAWN position (player.z + RIDER_FWD) — scenery strikes are
  // tested around the bike, not the camera.
  function parkAtSegment(player: { z: number }, segIdx: number, dFromBike: number): void {
    player.z = segIdx * ROAD.segmentLength + dFromBike - RIDER_FWD;
  }

  it('uses the solid roadside footprint, not the full leafy billboard', () => {
    // Palm art is much wider than its trunk. Brushing the visible canopy/alpha
    // envelope while off-road should not feel like hitting an invisible wall.
    const track = buildTrack();
    const player = createPlayer();
    player.x = 1.23; // off the tarmac, near the palm but outside its solid trunk
    parkAtSegment(player, 5, -30); // trunk right at the bike's drawn position
    const world = createWorld(31);
    resetWorld(world, player, track);
    world.traffic.length = 0;
    track.segments[5].scenery = [{ name: 'prop-palm', offset: 1.4, scale: 1 }];

    const clear = updateWorld(world, player, track, 1 / 60, false);
    expect(clear.some(e => e.type === 'crash')).toBe(false);

    player.x = 1.34; // now actually on the trunk footprint
    const hit = updateWorld(world, player, track, 1 / 60, false);
    expect(hit.some(e => e.type === 'crash' && e.sprite === 'prop-palm')).toBe(true);
  });

  it('does not hit roadside scenery that is still visibly ahead', () => {
    // The side-object check must only fire at the prop, not while it is still
    // visibly up the road in front of the bike.
    const track = buildTrack();
    const player = createPlayer();
    player.x = 1.4;
    parkAtSegment(player, 5, -30);
    const world = createWorld(32);
    resetWorld(world, player, track);
    world.traffic.length = 0;
    track.segments[7].scenery = [{ name: 'prop-sign', offset: 1.4, scale: 1 }]; // ~2 segments beyond the bike

    const events = updateWorld(world, player, track, 1 / 60, false);
    expect(events.some(e => e.type === 'crash')).toBe(false);
  });

  it('does not crash on soft verge dressing', () => {
    const track = buildTrack();
    const player = createPlayer();
    player.x = 1.5;
    parkAtSegment(player, 5, -30);
    const world = createWorld(33);
    resetWorld(world, player, track);
    world.traffic.length = 0;
    track.segments[5].scenery = [{ name: 'prop-flowers', offset: 1.5, scale: 1 }];

    const events = updateWorld(world, player, track, 1 / 60, false);
    expect(events.some(e => e.type === 'crash')).toBe(false);
  });

  it('slipstream draft registers only when tucked close behind a car, in its lane', () => {
    const track = buildTrack();
    const player = createPlayer();
    player.x = 0;
    const world = createWorld(61);
    resetWorld(world, player, track);
    world.traffic.length = 1;
    const car = world.traffic[0];
    car.offset = 0;
    car.driftAmp = 0;

    // Right on its bumper (just beyond crash reach): strong draft.
    car.z = player.z + HIT_NOSE + 60;
    const close = draftAt(world, player, track);
    expect(close).toBeGreaterThan(0.7);

    // Further up the wake: weaker.
    car.z = player.z + HIT_NOSE + ROAD.segmentLength * 2;
    const far = draftAt(world, player, track);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(close);

    // A lane over: no draft at all.
    car.z = player.z + HIT_NOSE + 60;
    player.x = 0.6;
    expect(draftAt(world, player, track)).toBe(0);

    // Inside crash reach: the wake never overlaps the hit band.
    player.x = 0;
    car.z = player.z + HIT_NOSE - 10;
    expect(draftAt(world, player, track)).toBe(0);
  });

  it('traffic thickens with distance and scales with the mode density', () => {
    const track = buildTrack();
    const player = createPlayer();
    player.speed = player.maxSpeed;
    const world = createWorld(55);
    resetWorld(world, player, track);
    const startCount = world.traffic.length;
    world.odometerM = 9000; // fully ramped
    for (let i = 0; i < 600; i += 1) updateWorld(world, player, track, 1 / 60, true);
    expect(world.traffic.length).toBeGreaterThan(startCount);

    const cruise = createWorld(56, { density: 0.65, speed: 0.9 });
    resetWorld(cruise, player, track);
    expect(cruise.traffic.length).toBeLessThan(startCount);
  });

  it('is deterministic for a fixed seed', () => {
    const track = buildTrack();
    const a = createWorld(42);
    const b = createWorld(42);
    const pa = createPlayer();
    const pb = createPlayer();
    resetWorld(a, pa, track);
    resetWorld(b, pb, track);
    expect(a.pickups.map(p => p.z)).toEqual(b.pickups.map(p => p.z));
    expect(a.traffic.map(c => c.z)).toEqual(b.traffic.map(c => c.z));
  });
});
