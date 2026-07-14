import { describe, it, expect } from 'vitest';
import { buildTrack, createPlayer, ROAD } from './road.js';
import { createWorld, audibleTraffic, type World } from './world.js';
import type { Car } from './world.js';

function car(id: number, aheadSegments: number, offset: number, speed: number): Car {
  return {
    id,
    z: aheadSegments * ROAD.segmentLength,
    offset,
    driftPhase: 0,
    driftAmp: 0,
    speed,
    sprite: 'car-van',
    prevFwd: 0,
    prevLateral: Infinity,
    role: 'traffic',
  };
}

function worldWith(...cars: Car[]): World {
  const w = createWorld();
  w.traffic = cars;
  return w;
}

describe('audible traffic', () => {
  const track = buildTrack();

  it('hears cars ahead, and drops the ones beyond earshot', () => {
    const p = createPlayer();
    p.speed = p.maxSpeed * 0.9;
    const w = worldWith(car(1, 4, 0, 5000), car(2, 500, 0, 5000)); // near, and miles away
    const heard = audibleTraffic(w, p, track);
    expect(heard.map(h => h.id)).toEqual([1]);
    expect(heard[0].proximity).toBeGreaterThan(0.5);
  });

  it('a nearer car is louder, and the list comes back loudest-first', () => {
    const p = createPlayer();
    p.speed = p.maxSpeed * 0.9;
    const w = worldWith(car(1, 18, 0, 5000), car(2, 3, 0, 5000));
    const heard = audibleTraffic(w, p, track);
    expect(heard.map(h => h.id)).toEqual([2, 1]);
    expect(heard[0].proximity).toBeGreaterThan(heard[1].proximity);
  });

  it('pans a car to the side it is actually on', () => {
    const p = createPlayer();
    p.speed = p.maxSpeed * 0.9;
    p.x = 0.6; // rider out to the right
    const w = worldWith(car(1, 3, -0.6, 5000)); // car over on the left
    const [left] = audibleTraffic(w, p, track);
    expect(left.pan).toBeLessThan(0); // …so you hear it on your left
  });

  it('a distant car stays near the centre of the image, however wide its lane', () => {
    // A car three hundred metres up the road sits near the middle of your VIEW no
    // matter which lane it is in. Panning purely on lane offset would slam it hard
    // left in your headphones — the sort of thing that sounds convincingly "3D"
    // held still and is completely wrong the moment anything moves.
    const p = createPlayer();
    p.speed = p.maxSpeed * 0.9;
    p.x = 0.85;
    const near = audibleTraffic(worldWith(car(1, 2, -0.85, 5000)), p, track)[0];
    const far = audibleTraffic(worldWith(car(1, 21, -0.85, 5000)), p, track)[0];
    expect(Math.abs(far.pan)).toBeLessThan(Math.abs(near.pan) * 0.6);
  });

  it('reports how hard you are closing — that is what pitches the engine up', () => {
    const p = createPlayer();
    p.speed = p.maxSpeed;
    const crawling = audibleTraffic(worldWith(car(1, 5, 0, p.maxSpeed * 0.3)), p, track)[0];
    const keepingUp = audibleTraffic(worldWith(car(1, 5, 0, p.maxSpeed)), p, track)[0];
    expect(crawling.closing).toBeGreaterThan(0.6);
    expect(keepingUp.closing).toBeCloseTo(0, 1);
    // …and its own revs are its own, not yours: a van lugging along is a low note.
    expect(crawling.rpm).toBeLessThan(keepingUp.rpm);
  });

  it('never returns more cars than the mixer has voices for', () => {
    const p = createPlayer();
    p.speed = p.maxSpeed * 0.9;
    const many = Array.from({ length: 12 }, (_, i) => car(i + 1, 2 + i, 0, 5000));
    expect(audibleTraffic(worldWith(...many), p, track, 4)).toHaveLength(4);
  });
});
