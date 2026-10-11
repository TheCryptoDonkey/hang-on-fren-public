import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { clearPublishedPersonalScore, discardPersonalScore, pendingPersonalScores, retainPersonalScore, type PendingPersonalScore } from './score-recovery.js';
const key = 'hangonfren:pending-personal-scores:v1';
const receipt: PendingPersonalScore = {
  pubkey: 'a'.repeat(64), arcade: true,
  summary: { score: 100, distanceM: 100, fuel: 0, roses: 0, overtakes: 0,
    nearMisses: 0, crashes: 0, bestRoseStreak: 0, topSpeedKph: 80, drifts: 0,
    bestDriftS: 0, durationS: 10, endedBy: 'time' },
  options: { runId: 'saved-run', level: 1, startedAt: 10_000, finishedAt: 20_000, endedBy: 'time' },
};
beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value), removeItem: (key: string) => items.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
it('persists only public run fields and drops unexpected private fields', () => {
  const input = { ...receipt, secret: 'private-fixture-marker', options: { ...receipt.options, secret: 'private-fixture-marker' } };
  expect(retainPersonalScore(input)).toBe(true);
  expect(localStorage.getItem(key)).not.toContain('private-fixture-marker');
  expect(pendingPersonalScores()).toEqual([receipt]);
});
it('does not delete another account’s receipt with the same run ID', () => {
  retainPersonalScore(receipt);
  const other = { ...receipt, pubkey: 'b'.repeat(64) };
  retainPersonalScore(other);
  clearPublishedPersonalScore(receipt.pubkey, receipt.options.runId, receipt);
  expect(pendingPersonalScores()).toEqual([other]);
});
it('rejects malformed or oversized stored receipts', () => {
  localStorage.setItem(key, JSON.stringify([{ ...receipt, summary: { ...receipt.summary, score: -1 } }]));
  expect(pendingPersonalScores()).toEqual([]);
  localStorage.setItem(key, ' '.repeat(128_001));
  expect(pendingPersonalScores()).toEqual([]);
});
it('does not evict existing receipts when the queue is full', () => {
  for (let i = 0; i < 64; i++) expect(retainPersonalScore({ ...receipt, options: { ...receipt.options, runId: `run-${i}` } })).toBe(true);
  const saved = localStorage.getItem(key);
  expect(retainPersonalScore(receipt)).toBe(false);
  expect(localStorage.getItem(key)).toBe(saved);
});

it('does not clear a changed receipt when an earlier claim confirms publication', () => {
  retainPersonalScore(receipt);
  const changed = { ...receipt, summary: { ...receipt.summary, score: 200 } };
  localStorage.setItem(key, JSON.stringify([changed]));
  clearPublishedPersonalScore(receipt.pubkey, receipt.options.runId, receipt);
  expect(pendingPersonalScores()).toEqual([changed]);
});

it('keeps the first receipt immutable when a duplicate changes the run', () => {
  retainPersonalScore(receipt);
  expect(retainPersonalScore({ ...receipt, summary: { ...receipt.summary, score: 200 } })).toBe(false);
  expect(pendingPersonalScores()).toEqual([receipt]);
});
it('preserves malformed storage rather than replacing it with a fresh queue', () => {
  localStorage.setItem(key, 'unreadable receipt history');
  expect(retainPersonalScore(receipt)).toBe(false);
  expect(discardPersonalScore(receipt)).toBe(false);
  expect(localStorage.getItem(key)).toBe('unreadable receipt history');
});
it('removes only the exact selected receipt and preserves other accounts and runs', () => {
  const otherAccount = { ...receipt, pubkey: 'b'.repeat(64) };
  const otherRun = { ...receipt, options: { ...receipt.options, runId: 'another-run' } };
  [receipt, otherAccount, otherRun].forEach(retainPersonalScore);
  expect(discardPersonalScore({ ...receipt, summary: { ...receipt.summary, score: 200 } })).toBe(false);
  expect(discardPersonalScore(receipt)).toBe(true);
  expect(pendingPersonalScores()).toEqual([otherAccount, otherRun]);
});
it('reports a failed removal and preserves the receipt when storage cannot change', () => {
  retainPersonalScore(receipt);
  vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(discardPersonalScore(receipt)).toBe(false);
  expect(pendingPersonalScores()).toEqual([receipt]);
});
