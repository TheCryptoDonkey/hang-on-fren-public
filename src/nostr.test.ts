import { describe, expect, it } from 'vitest';
import { clockOffsetMs } from './nostr.js';

describe('clockOffsetMs', () => {
  it('measures how far the local clock sits behind the server', () => {
    const local = Date.parse('2026-07-14T11:50:00Z');
    expect(clockOffsetMs('Tue, 14 Jul 2026 12:00:00 GMT', local)).toBe(10 * 60 * 1000);
  });

  it('measures a fast local clock as a negative offset', () => {
    const local = Date.parse('2026-07-14T12:00:30Z');
    expect(clockOffsetMs('Tue, 14 Jul 2026 12:00:00 GMT', local)).toBe(-30_000);
  });

  it('falls back to zero without a usable Date header', () => {
    expect(clockOffsetMs(null, Date.parse('2026-07-14T12:00:00Z'))).toBe(0);
    expect(clockOffsetMs('not a date', Date.parse('2026-07-14T12:00:00Z'))).toBe(0);
  });
});
