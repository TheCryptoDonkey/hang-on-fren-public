import { describe, it, expect } from 'vitest';
import { buildTrack, buildStoneTrack, decorateTrack, findSegment, createPlayer, updatePlayer, resetDrift, enclosureAt, ROAD, DEFAULT_TUNING, TIGHT_CURVE_THRESHOLD } from './road.js';
import type { DriveInput, Player, Segment, Track } from './road.js';

describe('road', () => {
  it('builds a seamless loop whose ends are flat', () => {
    const t = buildTrack();
    expect(t.segments.length).toBeGreaterThan(5000);
    expect(t.length).toBe(t.segments.length * ROAD.segmentLength);
    // The seam must be flat so wrapping player.z is invisible.
    expect(Math.abs(t.segments[t.segments.length - 1].p2.world.y)).toBeLessThan(1);
    expect(t.segments[0].curve).toBe(0);
  });

  it('authors the long left-to-hard-transition-to-long-right Billion Bend', () => {
    const t = buildTrack();
    const feature = t.features['billion-bend'];
    const bend = t.segments.slice(feature.startIndex, feature.endIndex + 1);
    expect(bend.length).toBeGreaterThan(1000); // more than 2 km of continuous road
    expect(bend.filter(s => s.curve < -2).length).toBeGreaterThan(450);
    expect(bend.filter(s => s.curve > 2).length).toBeGreaterThan(400);
    expect(Math.min(...bend.map(s => s.curve))).toBeLessThanOrEqual(-10.9);
    expect(Math.max(...bend.map(s => s.curve))).toBeGreaterThanOrEqual(6.4);
  });

  it('puts hard hidden turns immediately beyond two self-contained summits', () => {
    const t = buildTrack();
    for (const name of ['blind-summit-west', 'blind-summit-east'] as const) {
      const feature = t.features[name];
      const summit = t.segments.slice(feature.startIndex, feature.endIndex + 1);
      const startY = summit[0].p1.world.y;
      const peakOffset = summit.reduce((best, s, i, all) => s.p2.world.y > all[best].p2.world.y ? i : best, 0);
      expect(summit[peakOffset].p2.world.y - startY).toBeGreaterThan(6000);
      expect(summit.slice(peakOffset + 1, peakOffset + 35).some(s => Math.abs(s.curve) >= 6.5)).toBe(true);
      expect(Math.abs(summit[summit.length - 1].p2.world.y - startY)).toBeLessThan(1);
    }
  });

  it('gives each meme billboard a clear sight-line', () => {
    const t = buildTrack();
    decorateTrack(t, ['sign-0'], ['billboard-test'], 42);
    const billboardIndices = t.segments
      .filter(s => s.scenery.some(item => item.name === 'billboard-test'))
      .map(s => s.index);
    expect(billboardIndices.length).toBeGreaterThan(10);
    for (const index of billboardIndices) {
      expect(t.segments[index].scenery).toHaveLength(1);
      for (let d = -20; d <= 20; d += 1) {
        if (d === 0) continue;
        const nearby = t.segments[(index + d + t.segments.length) % t.segments.length];
        expect(nearby.scenery).toHaveLength(0);
      }
    }
  });

  it('lines tight corners with correctly oriented outside chevrons', () => {
    const t = buildTrack();
    decorateTrack(t, []);
    const marked = t.segments.filter(s => s.scenery.some(item => item.name.startsWith('prop-chevron-')));
    expect(marked.length).toBeGreaterThan(40);
    for (const seg of marked) {
      expect(Math.abs(seg.curve)).toBeGreaterThanOrEqual(TIGHT_CURVE_THRESHOLD);
      const chevron = seg.scenery.find(item => item.name.startsWith('prop-chevron-'))!;
      if (seg.curve > 0) {
        expect(chevron.name).toBe('prop-chevron-right');
        expect(chevron.offset).toBeLessThan(-1);
      } else {
        expect(chevron.name).toBe('prop-chevron-left');
        expect(chevron.offset).toBeGreaterThan(1);
      }
    }
  });

  it('finds the segment for a z and wraps out-of-range z', () => {
    const t = buildTrack();
    expect(findSegment(t, 0).index).toBe(0);
    expect(findSegment(t, ROAD.segmentLength * 1.5).index).toBe(1);
    expect(findSegment(t, t.length + ROAD.segmentLength * 2).index).toBe(2); // wrapped
  });

  it('advances the player under throttle and wraps around the loop', () => {
    const t = buildTrack();
    const p = createPlayer();
    const input = { left: false, right: false, throttle: true, brake: false };
    for (let i = 0; i < 600; i += 1) updatePlayer(p, t, input, 1 / 60, DEFAULT_TUNING);
    expect(p.speed).toBeGreaterThan(0);
    expect(p.z).toBeGreaterThanOrEqual(0);
    expect(p.z).toBeLessThan(t.length);
  });

  it('caps speed at maxSpeed and keeps x within the off-road bound', () => {
    const t = buildTrack();
    const p = createPlayer();
    const input = { left: true, right: false, throttle: true, brake: false };
    for (let i = 0; i < 2000; i += 1) updatePlayer(p, t, input, 1 / 60, DEFAULT_TUNING);
    expect(p.speed).toBeLessThanOrEqual(p.maxSpeed + 1e-6);
    expect(p.x).toBeGreaterThanOrEqual(-2.4001);
    expect(p.offRoad).toBe(true);
  });
});

describe('the stone track (600 BILLION BC drift valley)', () => {
  it('builds a seamless ~10 km loop whose ends are flat and straight', () => {
    const t = buildStoneTrack();
    // Roughly half the trip per lap: the 21 km run rides the loop about twice,
    // so every monster corner is learned on lap one and ridden on lap two.
    expect(t.segments.length).toBeGreaterThan(4800);
    expect(t.segments.length).toBeLessThan(6000);
    expect(t.length).toBe(t.segments.length * ROAD.segmentLength);
    expect(Math.abs(t.segments[t.segments.length - 1].p2.world.y)).toBeLessThan(1);
    expect(t.segments[0].curve).toBe(0);
    expect(t.segments[t.segments.length - 1].curve).toBe(0);
  });

  it('authors the Eternity Left — nearly 2 km of one tightening left-hander', () => {
    const t = buildStoneTrack();
    const feature = t.features['eternity-left'];
    const bend = t.segments.slice(feature.startIndex, feature.endIndex + 1);
    expect(bend.length).toBeGreaterThan(900); // ~1.9 km of continuous corner
    // One-directional the whole way: never a single segment of right-hander.
    expect(bend.every(s => s.curve <= 0)).toBe(true);
    // Sustained, committed curvature — most of it is a real slide's worth…
    expect(bend.filter(s => s.curve <= -3.5).length).toBeGreaterThan(500);
    // …peaking at hard, far longer than one drift can survive (chain them).
    expect(Math.min(...bend.map(s => s.curve))).toBeLessThanOrEqual(-6.4);
  });

  it('hands the Serpent esses directly into each other with no recovery straights', () => {
    const t = buildStoneTrack();
    const feature = t.features['serpent'];
    const esses = t.segments.slice(feature.startIndex, feature.endIndex + 1);
    expect(esses.length).toBeGreaterThan(800);
    // Long committed sweepers BOTH ways…
    expect(esses.filter(s => s.curve > 2).length).toBeGreaterThan(300);
    expect(esses.filter(s => s.curve < -2).length).toBeGreaterThan(300);
    // …and almost nowhere flat: the only near-straight road is the moment the
    // curvature SNAPS through zero from one bend into the next.
    expect(esses.filter(s => Math.abs(s.curve) < 1).length).toBeLessThan(120);
  });

  it('turns the Carousel as a dead-flat constant-radius bowl with a hairpin bite', () => {
    const t = buildStoneTrack();
    const feature = t.features['carousel'];
    const bowl = t.segments.slice(feature.startIndex, feature.endIndex + 1);
    // The long constant-radius hold you can live in sideways…
    expect(bowl.filter(s => s.curve >= 6).length).toBeGreaterThanOrEqual(420);
    // …the exit bite at hairpin strength…
    expect(Math.max(...bowl.map(s => s.curve))).toBeGreaterThanOrEqual(10.9);
    // …and genuinely FLAT, so speed (which a drift needs) is never taxed by a climb.
    const ys = bowl.map(s => s.p2.world.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
  });

  it('mirrors the monster with the Long Right Home, building slow and releasing late', () => {
    const t = buildStoneTrack();
    const feature = t.features['long-right-home'];
    const bend = t.segments.slice(feature.startIndex, feature.endIndex + 1);
    expect(bend.length).toBeGreaterThan(800);
    expect(bend.every(s => s.curve >= 0)).toBe(true);
    expect(bend.filter(s => s.curve >= 3.5).length).toBeGreaterThan(380);
    expect(Math.max(...bend.map(s => s.curve))).toBeGreaterThanOrEqual(6.4);
  });

  it('bores the candle caves clear of the loop seam', () => {
    const t = buildStoneTrack();
    const tunnels = t.overheads.filter(o => o.kind === 'tunnel');
    expect(tunnels.length).toBeGreaterThanOrEqual(2); // the Serpent cave + the long one
    for (const o of t.overheads) {
      expect(o.start).toBeGreaterThanOrEqual(60);
      expect(o.end).toBeLessThanOrEqual(t.segments.length - 60);
    }
  });

  it('drives and wraps like any other track (and takes chevrons on its hairpins)', () => {
    const t = buildStoneTrack();
    decorateTrack(t, []);
    const marked = t.segments.filter(s => s.scenery.some(item => item.name.startsWith('prop-chevron-')));
    expect(marked.length).toBeGreaterThan(10); // the hairpin pair + carousel bite
    const p = createPlayer();
    const input = { left: false, right: false, throttle: true, brake: false };
    for (let i = 0; i < 600; i += 1) updatePlayer(p, t, input, 1 / 60, DEFAULT_TUNING);
    expect(p.speed).toBeGreaterThan(0);
    expect(p.z).toBeLessThan(t.length);
  });
});

// ---------------------------------------------------------------------------
// The powerslide — the OutRun handling model.
// ---------------------------------------------------------------------------

const DT = 1 / 240;

function drive(player: Player, track: Track, input: DriveInput, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) updatePlayer(player, track, input, DT, DEFAULT_TUNING);
}

/** A player already up to `pct` of top speed, at the start of the track. */
function atSpeed(_track: Track, pct: number): Player {
  const p = createPlayer();
  p.speed = p.maxSpeed * pct;
  return p;
}

/**
 * A synthetic constant-radius right-hander: every segment bends the same way,
 * for as long as the slide needs.
 *
 * The powerslide tests deliberately do NOT run on the real track. The authored
 * road is all esses and transitions — its longest genuinely UNBROKEN right-hand
 * stretch is about 129 segments, under three seconds at racing speed, and a
 * naive "still turning right 120 segments later" scan happily lands in the
 * middle of an S-bend that reverses hard in between. A drift tested there stops
 * measuring the handling model and starts measuring the corner flipping under
 * it — and it would silently break again the next time anyone re-authors the
 * track. What is under test here is the PHYSICS, so the physics gets a test bed
 * that holds still. (It also loops seamlessly: every segment is identical, so
 * wrapping `player.z` is invisible.)
 */
function constantBend(curve: number, count = 2000): Track {
  const segments: Segment[] = [];
  for (let i = 0; i < count; i += 1) {
    segments.push({
      index: i,
      p1: { world: { x: 0, y: 0, z: i * ROAD.segmentLength }, screen: { x: 0, y: 0, w: 0, scale: 0 } },
      p2: { world: { x: 0, y: 0, z: (i + 1) * ROAD.segmentLength }, screen: { x: 0, y: 0, w: 0, scale: 0 } },
      curve,
      color: i % 2 ? 'dark' : 'light',
      clip: 0,
      scenery: [],
      overhead: null,
    });
  }
  return {
    segments,
    length: count * ROAD.segmentLength,
    features: {} as Track['features'],
    overheads: [],
  };
}

/** A hard right-hander, matching the sharpest sustained bends on the real road. */
function rightHander(): Track {
  return constantBend(6.5);
}

/**
 * A player at `pct` of top speed, committed to the bend and set up on the racing
 * line: out wide on the LEFT, with the whole road to turn into. Both sides of a
 * cornering comparison have to start here — start them mid-road and they simply
 * run out of tarmac, and the test ends up measuring the off-road speed penalty
 * rather than which one turns harder.
 */
function inRightHander(track: Track, pct: number): Player {
  const p = atSpeed(track, pct);
  p.x = -0.85;
  return p;
}

describe('powerslide', () => {
  it('breaks traction when you brake INTO a turn at speed', () => {
    const t = buildTrack();
    const p = atSpeed(t, 0.9);
    drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
    expect(p.drifting).toBe(true);
    expect(p.driftDir).toBe(1);
    expect(p.yaw).toBeGreaterThan(0); // nose swung right, into the corner
  });

  it('will not break traction below the entry speed, or from steering alone', () => {
    const t = buildTrack();
    const slow = atSpeed(t, DEFAULT_TUNING.driftEntrySpeed - 0.1);
    drive(slow, t, { left: false, right: true, throttle: false, brake: true }, 0.3);
    expect(slow.drifting).toBe(false);

    // Hard steering at full pelt must NOT spontaneously let go — a drift you did
    // not ask for reads as a bug, not a thrill.
    const fast = atSpeed(t, 1);
    drive(fast, t, { left: false, right: true, throttle: true, brake: false }, 2);
    expect(fast.drifting).toBe(false);
    expect(fast.slip).toBe(0);
  });

  it('is holdable: staying on the bars settles the slide at an angle you can live in', () => {
    const t = rightHander();
    const p = inRightHander(t, 0.9);
    drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
    drive(p, t, { left: false, right: true, throttle: true, brake: false }, 0.5);
    expect(p.drifting).toBe(true);
    expect(p.spinOut).toBe(false);
    // Settled around the held angle rather than winding up without bound.
    expect(p.yaw).toBeGreaterThan(DEFAULT_TUNING.driftHoldYaw * 0.9);
    expect(p.yaw).toBeLessThan(DEFAULT_TUNING.maxYaw);
  });

  it('can be RIDDEN: feathering the bars balances a long slide on the road', () => {
    const t = rightHander();
    const p = inRightHander(t, 0.95);
    drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
    // Drive it like a player would: stay on it while there is road to use, and
    // tighten it up when the bike runs toward the edge. If a correction ended the
    // slide, this loop could not exist — and neither could the skill.
    for (let i = 0; i < 240 * 1.5; i += 1) {
      const tighten = p.x > 0.2; // running out of road → pull it in
      updatePlayer(p, t, { left: tighten, right: !tighten, throttle: true, brake: false }, DT, DEFAULT_TUNING);
      if (!p.drifting || p.spinOut) break;
    }
    expect(p.drifting).toBe(true); // a second and a half sideways, still going
    expect(p.spinOut).toBe(false);
    expect(Math.abs(p.x)).toBeLessThan(1); // and still on the tarmac
    expect(p.driftTime).toBeGreaterThan(1.4);
  });

  it('gets round a bend that grip alone washes wide of — the whole point of it', () => {
    const t = rightHander();
    const gripped = inRightHander(t, 0.9);
    const drifted = inRightHander(t, 0.9);
    // Same bend, same second, same held steering. One carves on the tyres and
    // spends most of its grip just resisting being flung wide; the other is
    // thrown sideways first and steers on the slip angle instead. THIS is the
    // comparison the drift exists to win — on a straight the two are close,
    // because there is no centrifugal force for the slide to be cheating.
    drive(gripped, t, { left: false, right: true, throttle: true, brake: false }, 0.7);
    drive(drifted, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
    drive(drifted, t, { left: false, right: true, throttle: true, brake: false }, 0.6);
    expect(drifted.drifting).toBe(true);
    // Comfortably further round the inside — a real gap, not a rounding win.
    expect(drifted.x).toBeGreaterThan(gripped.x + 0.3);
    // …and it did it while still on the road. A "drift" that turns harder only by
    // flinging you into the verge has won nothing.
    expect(Math.abs(drifted.x)).toBeLessThan(1);
  });

  it('does not turn the bike into a teleporter — a slide is bounded, not free', () => {
    const t = rightHander();
    const p = inRightHander(t, 0.95);
    p.x = 0; // mid-road, the worst case: half a road-width of margin each side
    drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
    drive(p, t, { left: false, right: true, throttle: true, brake: false }, 0.4);
    // Half a second of held slide, from dead centre, must not have thrown the bike
    // into the scenery (world.ts stops forgiving you past 1.2). The first cut of
    // this model was well past 2.0 by here — full steering authority AND near-zero
    // damping AND a raised cap, all stacked.
    expect(Math.abs(p.x)).toBeLessThan(1.2);
  });

  it('counter-steer tightens the slide rather than ending it', () => {
    const t = rightHander();
    const p = inRightHander(t, 0.9);
    drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
    drive(p, t, { left: false, right: true, throttle: true, brake: false }, 0.5);
    const wide = p.yaw;
    drive(p, t, { left: true, right: false, throttle: true, brake: false }, 0.35);
    expect(p.yaw).toBeLessThan(wide); // pulled in…
    expect(p.yaw).toBeGreaterThan(DEFAULT_TUNING.driftExitYaw); // …but still sideways
    expect(p.drifting).toBe(true);
  });

  it('letting go of the bars is what stands it back up', () => {
    const t = rightHander();
    const p = inRightHander(t, 0.9);
    drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
    drive(p, t, { left: false, right: true, throttle: true, brake: false }, 0.4);
    expect(p.drifting).toBe(true);
    drive(p, t, { left: false, right: false, throttle: true, brake: false }, 0.5);
    expect(p.drifting).toBe(false); // caught it
    expect(p.spinOut).toBe(false);
    expect(p.slip).toBe(0);
  });

  it('bills you for greed: a long slide creeps past full lock and spins', () => {
    const t = rightHander();
    const p = inRightHander(t, 0.95);
    drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
    // Ride it properly — feather it to stay on the road — for as long as it will
    // let you. The held angle creeps with TOTAL time sideways, so even a slide you
    // are balancing well eventually asks for more lock than the bike has, and
    // simply staying on it is what throws you. Skill buys time, not immunity.
    let spun = false;
    for (let i = 0; i < 240 * 12; i += 1) {
      const tighten = p.x > 0.35; // greedy: holds it wide, pulls it in late
      updatePlayer(p, t, { left: tighten, right: !tighten, throttle: true, brake: false }, DT, DEFAULT_TUNING);
      if (p.spinOut) { spun = true; break; }
      if (!p.drifting) break; // ran off the road or lost it — not what we're testing
    }
    expect(spun).toBe(true);
    expect(Math.abs(p.yaw)).toBeGreaterThan(DEFAULT_TUNING.maxYaw);
    // The bill arrives, but not instantly — a drift is free for a good while.
    expect(p.driftTime).toBeGreaterThan(2);
  });

  it('a slide has exactly two ways to end badly, and no way to hold it forever', () => {
    const t = rightHander();
    /** Ride the slide with a given "how wide do I let it run before I pull it in" line. */
    const ride = (threshold: number): { spun: boolean; ranOff: boolean; heldFor: number } => {
      const p = inRightHander(t, 0.95);
      drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
      for (let i = 0; i < 240 * 15; i += 1) {
        const tighten = p.x > threshold;
        updatePlayer(p, t, { left: tighten, right: !tighten, throttle: true, brake: false }, DT, DEFAULT_TUNING);
        if (p.spinOut) return { spun: true, ranOff: false, heldFor: p.driftTime };
        if (!p.drifting) return { spun: false, ranOff: Math.abs(p.x) > 1, heldFor: p.driftTime };
      }
      throw new Error('the slide was held for fifteen seconds — the creep is not biting');
    };

    // DISCIPLINED — pull it straight before it runs wide. You get a long, useful
    // drift… and then the creep catches up with you and spins it anyway.
    for (const line of [0.2, 0.35]) {
      const r = ride(line);
      expect(r.spun).toBe(true);
      expect(r.heldFor).toBeGreaterThan(2);
    }

    // GREEDY — let it run. The slide's own turning force carries you off the
    // inside of the bend inside a second. This is the other failure mode, and it
    // is the one that punishes you fastest.
    for (const line of [0.5, 0.65]) {
      const r = ride(line);
      expect(r.ranOff).toBe(true);
      expect(r.heldFor).toBeLessThan(1.5);
    }

    // Deliberately NOT claimed: that the tighter line survives longest. It does
    // not, reliably — holding it tight pushes the bike to the INSIDE of the bend,
    // so it spends more time steering back into the slide, which winds the angle
    // on faster. Which line lasts longest depends on the corner. What holds
    // regardless is the property above: every line ends, and none lasts forever.
  });

  it('is a tarmac move: it will not start off-road, and ends the moment you leave', () => {
    const t = buildTrack();
    // Won't start in a field, however hard you brake and steer.
    const inGrass = atSpeed(t, 0.95);
    inGrass.x = 1.6;
    drive(inGrass, t, { left: false, right: true, throttle: false, brake: true }, 0.3);
    expect(inGrass.drifting).toBe(false);

    // And a slide that runs wide ENDS at the verge rather than carrying on
    // through the meadow banking score — which is what it used to do.
    const p = inRightHander(rightHander(), 0.95);
    p.x = 0.8;
    drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.1);
    expect(p.drifting).toBe(true);
    drive(p, t, { left: false, right: true, throttle: true, brake: false }, 0.8);
    expect(Math.abs(p.x)).toBeGreaterThan(1); // it ran off, as you'd expect
    expect(p.drifting).toBe(false); // …and the drift died with the tarmac
    expect(p.slip).toBe(0);
  });

  it('resetDrift puts the bike back on its tyres', () => {
    const t = buildTrack();
    const p = atSpeed(t, 0.9);
    drive(p, t, { left: false, right: true, throttle: false, brake: true }, 0.2);
    expect(p.drifting).toBe(true);
    resetDrift(p);
    expect(p.drifting).toBe(false);
    expect(p.yaw).toBe(0);
    expect(p.slip).toBe(0);
    expect(p.driftDir).toBe(0);
  });
});

describe('tunnels and overpasses', () => {
  const track = buildTrack();

  it('bores tunnels and throws bridges across the road', () => {
    const kinds = track.overheads.map(o => o.kind);
    expect(kinds).toContain('tunnel');
    expect(kinds).toContain('overpass');
    // Tunnels are places; overpasses are moments. If they came out the same
    // length, one of them is not doing its job.
    const tunnel = track.overheads.find(o => o.kind === 'tunnel')!;
    const overpass = track.overheads.find(o => o.kind === 'overpass')!;
    expect(tunnel.end - tunnel.start).toBeGreaterThan(40);
    expect(overpass.end - overpass.start).toBeLessThan(8);
  });

  it('stamps every covered segment, and leaves the rest of the road open', () => {
    for (const overhead of track.overheads) {
      expect(track.segments[overhead.start].overhead).toBe(overhead);
      expect(track.segments[overhead.end].overhead).toBe(overhead);
      // The segment just before the mouth is still open sky.
      expect(track.segments[overhead.start - 1].overhead).toBeNull();
    }
    const covered = track.segments.filter(s => s.overhead !== null).length;
    expect(covered).toBeGreaterThan(0);
    expect(covered).toBeLessThan(track.segments.length * 0.2); // most of the road is open
  });

  it('never straddles the loop seam', () => {
    // A tunnel across the wrap point would put its mouth behind you and its far
    // wall in front of you at the same time.
    for (const o of track.overheads) {
      expect(o.start).toBeGreaterThan(0);
      expect(o.end).toBeLessThan(track.segments.length - 1);
      expect(o.start).toBeLessThan(o.end);
    }
  });

  it('the dark closes in over the mouth rather than snapping on', () => {
    const tunnel = track.overheads.find(o => o.kind === 'tunnel')!;
    const z = (i: number): number => i * ROAD.segmentLength + ROAD.segmentLength / 2;
    expect(enclosureAt(track, z(tunnel.start - 2))).toBe(0); // still outside
    const mouth = enclosureAt(track, z(tunnel.start));
    const inside = enclosureAt(track, z(tunnel.start + 3));
    const deep = enclosureAt(track, z(tunnel.start + 30));
    expect(mouth).toBeLessThan(inside); // it ramps…
    expect(inside).toBeLessThan(deep);
    expect(deep).toBe(1); // …to fully enclosed
    // …and opens out again at the far end.
    expect(enclosureAt(track, z(tunnel.end))).toBeLessThan(deep);
    expect(enclosureAt(track, z(tunnel.end + 2))).toBe(0);
  });

  it('an overpass is a flicker of shadow, never full darkness', () => {
    const overpass = track.overheads.find(o => o.kind === 'overpass')!;
    let peak = 0;
    for (let i = overpass.start; i <= overpass.end; i += 1) {
      peak = Math.max(peak, enclosureAt(track, i * ROAD.segmentLength + ROAD.segmentLength / 2));
    }
    expect(peak).toBeGreaterThan(0); // you DO pass under something…
    expect(peak).toBeLessThan(0.5); // …but it is over before the lights go out
  });
});
