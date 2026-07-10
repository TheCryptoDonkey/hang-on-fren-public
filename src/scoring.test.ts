import { describe, it, expect } from 'vitest';
import { createScore, addDistance, addRose, addFuel, addOvertake, addNearMiss, registerCrash, summarise, buildScoreEvent } from './scoring.js';

describe('scoring', () => {
  it('banks distance and tracks top speed', () => {
    const s = createScore();
    addDistance(s, 50, 120);
    addDistance(s, 30, 90);
    expect(s.distance).toBe(80);
    expect(s.score).toBe(80);
    expect(s.topSpeed).toBe(120);
  });

  it('rewards pickup streaks with a rising multiplier', () => {
    const s = createScore();
    addFuel(s); // 120 * 1.0
    addFuel(s); // 120 * 1.1
    expect(s.fuel).toBe(2);
    expect(s.roseStreak).toBe(2);
    expect(s.bestRoseStreak).toBe(2);
    expect(s.score).toBe(120 + 132);
  });

  it('rare roses score big and share the pickup streak', () => {
    const s = createScore();
    addFuel(s); // streak 1
    addRose(s); // streak 2 -> 400 * 1.1
    expect(s.roses).toBe(1);
    expect(s.roseStreak).toBe(2);
    expect(s.score).toBe(120 + 440);
  });

  it('resets the streak on a crash but keeps the best', () => {
    const s = createScore();
    addFuel(s);
    addFuel(s);
    registerCrash(s);
    expect(s.roseStreak).toBe(0);
    expect(s.bestRoseStreak).toBe(2);
    expect(s.crashes).toBe(1);
  });

  it('summarises a run and shapes the (future) Nostr event', () => {
    const s = createScore();
    addDistance(s, 1234, 200);
    addRose(s);
    addOvertake(s);
    addNearMiss(s);
    const sum = summarise(s, 42.7, 'time');
    expect(sum.distanceM).toBe(1234);
    expect(sum.durationS).toBe(43);
    expect(sum.endedBy).toBe('time');
    const ev = buildScoreEvent(sum, 'npubxyz');
    expect(ev.kind).toBe(30762);
    expect(ev.tags).toContainEqual(['game', 'hangonfren']);
    expect(ev.tags).toContainEqual(['score', String(sum.score)]);
    expect(ev.tags).toContainEqual(['ended_by', 'time']);
  });

  it('carries the gamestr identity/discovery tags when options are given', () => {
    const s = createScore();
    addDistance(s, 500, 150);
    const sum = summarise(s, 30, 'time');
    const ev = buildScoreEvent(sum, 'abc123', {
      runId: 'run-1',
      playerName: 'DNI',
      playerMode: 'guest',
      level: 3,
    });
    expect(ev.tags).toContainEqual(['d', 'hangonfren:abc123:run-1']);
    expect(ev.tags).toContainEqual(['p', 'abc123']);
    expect(ev.tags).toContainEqual(['playerName', 'DNI']);
    expect(ev.tags).toContainEqual(['playerMode', 'guest']);
    expect(ev.tags).toContainEqual(['level', '3']);
    const content = JSON.parse(ev.content) as Record<string, unknown>;
    expect(content.game).toBe('hangonfren');
    expect(content.run_id).toBe('run-1');
  });
});
