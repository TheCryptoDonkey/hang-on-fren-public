import { describe, expect, it } from 'vitest';
import { breakFlow, createFlow, flowLabel, flowMultiplier, gainFlow, tickFlow } from './flow.js';

describe('FREN FLOW', () => {
  it('climbs through visible multiplier tiers and caps at legend', () => {
    const flow = createFlow();
    expect(flowMultiplier(flow)).toBe(1);
    gainFlow(flow, 45);
    expect(flowLabel(flow)).toBe('HOT');
    expect(flowMultiplier(flow)).toBe(1.5);
    gainFlow(flow, 100);
    expect(flow.value).toBe(100);
    expect(flowMultiplier(flow)).toBe(2);
  });

  it('holds, decays, drafts upward, and breaks on a wipeout', () => {
    const flow = createFlow();
    gainFlow(flow, 30, 1);
    tickFlow(flow, 0.5);
    expect(flow.value).toBe(30);
    tickFlow(flow, 1);
    expect(flow.value).toBeLessThan(30);
    const cooled = flow.value;
    tickFlow(flow, 1, 1);
    expect(flow.value).toBeGreaterThan(cooled);
    breakFlow(flow);
    expect(flow.value).toBe(0);
    expect(flow.peak).toBeGreaterThan(0);
  });
});
