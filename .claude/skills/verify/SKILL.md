---
name: verify
description: Build, launch and drive Hang On, Fren to verify a change at its real surface (the canvas game in a browser).
---

# Verifying Hang On, Fren

## Launch

- `npm run dev` — Vite dev server on **http://localhost:5191** (background it).
- The claim API (`npm run dev:api`, port 3191) is optional; without it the
  `/api/claim` request 500s and scores stay local — expected dev noise, not a
  regression. Ditto transient nostr relay websocket warnings.

## Drive

The whole game is one `<canvas id="game">` — there is no DOM to snapshot. In
dev builds `window.__hof` exposes the harness:

- `__hof.startRun()` — start a run from any phase.
- `__hof.setDistance(m)` — jump the run's distance (region/biome/HUD follow
  next frame; checkpoints fire naturally when a boundary is crossed).
- `__hof.freezeSpeed(mul)` — set speed as a fraction of max.
- `__hof.showVictory()` — jump straight to the finish/victory flow.
- `__hof.state`, `__hof.player`, `__hof.world`, `__hof.score`, `__hof.timer`,
  `__hof.musicUrl` — live state for assertions.
- Title/game-over accept synthetic keys:
  `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`
  (Enter=start/confirm, t=tour, arrows=difficulty, Escape then q=quit run).

## Capture

The Playwright MCP page can reset to about:blank between tool calls, losing
run state. Do each scenario as ONE atomic `browser_evaluate` that sets state,
waits inside a Promise/setTimeout, then returns
`document.getElementById('game').toDataURL('image/jpeg', 0.85)` (use the
`filename` option; decode the base64 locally to view). Keyboard-driven flows
work the same way with dispatched KeyboardEvents inside the evaluate.

## Gotchas

- The game keeps running in real time BETWEEN tool calls — a run can cross a
  checkpoint or the finish line while you're decoding a screenshot. Set
  distance again inside the same evaluate as the capture.
- `localStorage.clear()` + reload resets tour selection, difficulty, board.
- Fresh sim state = reload page; each `startRun()` also fully resets the run.
