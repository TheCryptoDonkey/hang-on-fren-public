// Selectable difficulty modes, chosen on the title screen and persisted. Pure
// data — world.ts consumes density/speed as traffic mods, scoring.ts applies
// the score multiplier — so the modes stay trivially testable.

export interface DifficultyMode {
  id: 'cruise' | 'classic' | 'degen';
  label: string;
  tagline: string;
  /** Traffic pool multiplier. */
  density: number;
  /** Traffic speed multiplier. */
  speed: number;
  /** Points multiplier — braver roads pay better, so the board stays fair. */
  scoreMul: number;
}

export const MODES: readonly DifficultyMode[] = [
  { id: 'cruise', label: 'CRUISE', tagline: 'gentle traffic — enjoy the view', density: 0.65, speed: 0.9, scoreMul: 0.75 },
  { id: 'classic', label: 'CLASSIC', tagline: 'the intended ride', density: 1, speed: 1, scoreMul: 1 },
  { id: 'degen', label: 'DEGEN', tagline: 'packed roads, fearless drivers', density: 1.45, speed: 1.08, scoreMul: 1.5 },
];

const STORAGE_KEY = 'hangonfren:difficulty:v1';

export function loadModeIndex(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 1; // nothing saved yet → CLASSIC (Number(null) is 0!)
    const i = Number(raw);
    return Number.isInteger(i) && i >= 0 && i < MODES.length ? i : 1;
  } catch {
    return 1; // CLASSIC
  }
}

export function saveModeIndex(index: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(index));
  } catch {
    /* private mode — selection just won't persist */
  }
}
