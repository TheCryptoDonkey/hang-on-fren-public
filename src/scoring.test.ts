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

  it('applies FREN FLOW only to authored action score', () => {
    const s = createScore();
    addDistance(s, 100, 120);
    addOvertake(s, 1.5);
    expect(s.score).toBe(100 + 375);
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
    // Spec d format: game-id:player-pubkey:level — the addressable unit is the
    // player's score AT a level, so improvements replace and runs stay stable.
    expect(ev.tags).toContainEqual(['d', 'hangonfren:abc123:3']);
    expect(ev.tags).toContainEqual(['p', 'abc123']);
    expect(ev.tags).toContainEqual(['state', 'active']);
    expect(ev.tags).toContainEqual(['run_id', 'run-1']);
    expect(ev.tags).toContainEqual(['playerName', 'DNI']);
    expect(ev.tags).toContainEqual(['playerMode', 'guest']);
    expect(ev.tags).toContainEqual(['level', '3']);
    // Content is the human-readable message gamestr displays — data lives in tags.
    expect(ev.content).toContain('DNI');
    expect(ev.content).toContain(String(sum.score));
  });

  it('defaults the d tag to level 1 and mentions the finish on a full tour', () => {
    const s = createScore();
    addDistance(s, 42_000, 220);
    const sum = summarise(s, 600, 'finish');
    const ev = buildScoreEvent(sum, 'abc123');
    expect(ev.tags).toContainEqual(['d', 'hangonfren:abc123:1']);
    expect(ev.content).toContain('finished the grand tour');
    expect(ev.tags).toContainEqual(['ended_by', 'finish']);
  });

  it('namespaces and tags the secret stone tour so it never mixes with road scores', () => {
    const s = createScore();
    addDistance(s, 4200, 200);
    const sum = summarise(s, 120, 'finish');
    const ev = buildScoreEvent(sum, 'abc123', { runId: 'run-1', level: 1, tour: 'stone' });
    // Its own addressable namespace: a stone run can never REPLACE (or be
    // replaced by) the player's road-tour level-1 score.
    expect(ev.tags).toContainEqual(['d', 'hangonfren:abc123:stone-1']);
    expect(ev.tags).toContainEqual(['tour', 'stone']);
    expect(ev.tags).toContainEqual(['t', 'secret']);
    expect(ev.content).toContain('600 BILLION BC');
    expect(ev.content).toContain('SECRET LEVEL');
    // Road tours keep the plain level key (and existing events' addresses).
    const road = buildScoreEvent(sum, 'abc123', { runId: 'run-1', level: 1, tour: 'grand' });
    expect(road.tags).toContainEqual(['d', 'hangonfren:abc123:1']);
    expect(road.tags).toContainEqual(['tour', 'grand']);
    expect(road.tags.some(t => t[0] === 't' && t[1] === 'secret')).toBe(false);
  });

  it('stamps the bitcoin chain snapshot onto the event when provided', () => {
    const s = createScore();
    addDistance(s, 500, 150);
    const sum = summarise(s, 30, 'time');
    const ev = buildScoreEvent(sum, 'abc123', {
      runId: 'run-1',
      btcBlock: 905_432,
      btcUsdCents: 10_425_000,
    });
    expect(ev.tags).toContainEqual(['btc_block', '905432']);
    expect(ev.tags).toContainEqual(['btc_usd_cents', '10425000']);
    // absent snapshot → no empty tags
    const bare = buildScoreEvent(sum, 'abc123', { runId: 'run-1' });
    expect(bare.tags.some(t => t[0] === 'btc_block' || t[0] === 'btc_usd_cents')).toBe(false);
  });
});
