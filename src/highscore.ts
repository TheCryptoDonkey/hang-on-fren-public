// Local arcade high-score board. Pure logic (insertion/ordering) is testable;
// persistence is a thin localStorage wrapper. This is also the seam where an
// online Nostr leaderboard would later plug in (see scoring.buildScoreEvent).

export interface HighScore {
  name: string;
  score: number;
  distanceM: number;
  roses: number;
}

// v2: v1 boards were seeded with (and filled up by) the old "DNI" default name,
// so bumping the key flushes those and reseeds a varied placeholder board.
const STORAGE_KEY = 'hangonfren:highscores:v2';
const MAX_ENTRIES = 5;

export const DEFAULT_BOARD: HighScore[] = [
  { name: 'ACE', score: 12000, distanceM: 4200, roses: 24 },
  { name: 'FOX', score: 8600, distanceM: 3100, roses: 17 },
  { name: 'SOL', score: 5400, distanceM: 2000, roses: 11 },
  { name: 'KIT', score: 3200, distanceM: 1200, roses: 7 },
  { name: 'GM', score: 1500, distanceM: 600, roses: 3 },
];

/** Insert a candidate and return the trimmed, ordered board (pure). */
export function insertScore(board: HighScore[], entry: HighScore): HighScore[] {
  const next = [...board, entry].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  return next;
}

/** True if `score` would place on the board. */
export function qualifies(board: HighScore[], score: number): boolean {
  if (board.length < MAX_ENTRIES) return true;
  return score > board[board.length - 1].score;
}

export function rankOf(board: HighScore[], score: number): number {
  const sorted = [...board].sort((a, b) => b.score - a.score);
  let rank = 0;
  while (rank < sorted.length && sorted[rank].score > score) rank += 1;
  return rank; // 0-based
}

export function loadBoard(): HighScore[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_BOARD];
    const parsed = JSON.parse(raw) as HighScore[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_BOARD];
    return parsed
      .filter(e => typeof e.score === 'number' && typeof e.name === 'string')
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [...DEFAULT_BOARD];
  }
}

export function saveBoard(board: HighScore[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch {
    /* private mode — board is session-only */
  }
}

export function topScore(board: HighScore[]): number {
  return board.reduce((m, e) => Math.max(m, e.score), 0);
}
