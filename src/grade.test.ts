import { describe, expect, it } from 'vitest';
import { gradeStage, overallGrade } from './grade.js';

describe('stage grades', () => {
  it('awards an S to a fast, clean, high-flow rival win', () => {
    const result = gradeStage({ elapsedS: 52, crashes: 0, peakFlow: 95, rivalGapM: -60 });
    expect(result.grade).toBe('S');
    expect(result.rating).toBeGreaterThanOrEqual(92);
  });

  it('punishes slow, crash-heavy riding without going below C', () => {
    const result = gradeStage({ elapsedS: 100, crashes: 3, peakFlow: 5, rivalGapM: 200 });
    expect(result.grade).toBe('C');
    expect(result.rating).toBeGreaterThanOrEqual(0);
  });

  it('reduces stage results to an overall arcade grade', () => {
    const result = (grade: 'S' | 'A' | 'B' | 'C') => ({
      grade, rating: 0, elapsedS: 0, crashes: 0, peakFlow: 0, rivalGapM: null,
    });
    expect(overallGrade([result('S'), result('A'), result('S')])).toBe('S');
    expect(overallGrade([result('A'), result('B'), result('A')])).toBe('A');
    expect(overallGrade([result('C'), result('B')])).toBe('B');
  });
});
