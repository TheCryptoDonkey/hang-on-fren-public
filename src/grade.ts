// Per-region arcade judgement. The result combines pace, clean riding, peak
// FREN FLOW and (for the opening tour) the checkpoint split against the rival.

import { clamp } from './util.js';

export type StageGrade = 'S' | 'A' | 'B' | 'C';

export interface StagePerformance {
  elapsedS: number;
  crashes: number;
  peakFlow: number;
  /** Positive = Fren ahead; negative = player ahead. Null after rival tour. */
  rivalGapM: number | null;
}

export interface StageResult extends StagePerformance {
  grade: StageGrade;
  rating: number;
}

export function gradeStage(performance: StagePerformance): StageResult {
  const pace = 25 + clamp((90 - performance.elapsedS) / 45, 0, 1) * 55;
  const clean = Math.max(0, 15 - Math.max(0, performance.crashes) * 8);
  const flow = clamp(performance.peakFlow / 100, 0, 1) * 20;
  const rival = performance.rivalGapM === null
    ? 5
    : clamp((80 - performance.rivalGapM) / 160, 0, 1) * 10;
  const rating = Math.round(clamp(pace + clean + flow + rival, 0, 100));
  const grade: StageGrade = rating >= 92 ? 'S' : rating >= 78 ? 'A' : rating >= 62 ? 'B' : 'C';
  return { ...performance, grade, rating };
}

export function overallGrade(results: readonly StageResult[]): StageGrade {
  if (results.length === 0) return 'C';
  const value: Record<StageGrade, number> = { S: 4, A: 3, B: 2, C: 1 };
  const average = results.reduce((sum, result) => sum + value[result.grade], 0) / results.length;
  return average >= 3.5 ? 'S' : average >= 2.5 ? 'A' : average >= 1.5 ? 'B' : 'C';
}
