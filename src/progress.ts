// Tour selection persistence: the grand tour and the 600B WORLD TOUR (the
// conference circuit — historical Manchester, Prague, Mallorca and a
// rose-drenched Taj Mahal) are both always available from the title screen;
// the rider's last pick persists in localStorage, same thin-wrapper style as
// difficulty.ts / highscore.ts.

import type { TourId } from './stages.js';

const TOUR_KEY = 'hangonfren:tour:v1';

export function loadSelectedTour(): TourId {
  try {
    return localStorage.getItem(TOUR_KEY) === 'world' ? 'world' : 'grand';
  } catch {
    return 'grand';
  }
}

export function saveSelectedTour(tour: TourId): void {
  try {
    localStorage.setItem(TOUR_KEY, tour);
  } catch {
    /* private mode — selection just won't persist */
  }
}
