import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSelectedTour, saveSelectedTour } from './progress.js';

// A minimal localStorage stand-in (the vitest environment is plain node).
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string): string | null => store.get(k) ?? null,
  setItem: (k: string, v: string): void => void store.set(k, v),
};

describe('progress: tour selection persistence', () => {
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('defaults to the grand tour', () => {
    expect(loadSelectedTour()).toBe('grand');
  });

  it('persists the tour selection', () => {
    saveSelectedTour('world');
    expect(loadSelectedTour()).toBe('world');
    saveSelectedTour('grand');
    expect(loadSelectedTour()).toBe('grand');
  });

  it('ignores garbage stored values', () => {
    store.set('hangonfren:tour:v1', 'moon-tour');
    expect(loadSelectedTour()).toBe('grand');
  });

  it('falls back safely with no storage at all (private mode)', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadSelectedTour()).toBe('grand');
    expect(() => saveSelectedTour('world')).not.toThrow();
  });
});
