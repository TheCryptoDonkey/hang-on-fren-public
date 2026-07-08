# Hang On, Fren — Design

**Title:** Hang On, Fren
**Descriptor:** An endless Riviera Vespa road-tribute starring DNI.
**One line:** Grab roses for time, don't run out of time, don't wipe out.

A Hang-On/OutRun-style pseudo-3D arcade racer built "the same sort of way" as
neon-sentinel (Vite + TypeScript, Canvas2D, a code-drawn-and-cached sprite
approach, the same audio-engine architecture, and its reused rose art +
"Want rose, fren?" voice clip). The rider is DNI on a mint Vespa; the road is
an endless sunny Italian Riviera coast.

## Decisions (from brainstorming)

- **Render engine:** authentic segment-based pseudo-3D on a single Canvas2D —
  the true 1985 cabinet feel. (Not Three.js; the genre wants the flat projected
  road.)
- **Scope:** standalone arcade first — title → play → game over → restart, with
  a LOCAL high-score board. A clean seam (`scoring.buildScoreEvent`) is left for
  the neon-sentinel-style Nostr score/leaderboard layer later. No server.
- **Failure model:** two independent deaths — an always-ticking **clock** (0 =
  game over) and **3 lives** lost to crashes (each crash = a wipeout spin-out).
- **Roses** add **+4 s** each (clamped to a 60 s ceiling) and play the reused
  "Want rose, fren?" voice; placed on the racing line or tucked by the verge for
  a route-risk decision.
- **Setting:** sunny Mediterranean Riviera — blue sea, palms, cypress, pastel
  villas, roses in the verges.
- **Art:** generated with gpt-image (`gpt-image-1.5` for transparent sprites,
  `gpt-image-2` for the opaque title art). The original title art is used on the
  front screen; source reference material stays out of git. Every sprite has a
  code-drawn fallback.

## Architecture (small, single-purpose modules)

| Module | Responsibility |
|--------|----------------|
| `road.ts` | segment model, seamless-looping track, projection, player physics, scenery decoration |
| `world.ts` | dynamic entities (roses, traffic), difficulty ramp, collision/overtake detection — seeded RNG |
| `render.ts` | sky/sea/hills parallax, road + fog, scenery/entities with hill-clipping, rider, speed streaks |
| `rider.ts` | DNI+Vespa draw: lean frames (mirrored for left), height-normalised, subtle wheel-motion blur |
| `sprites.ts` | sprite registry: load + alpha-floor + trim generated art; code-drawn fallbacks; sign-text variants |
| `timer.ts` | clock + rose time economy (pure) |
| `scoring.ts` | score accrual, run summary, Nostr `kind 30762` event seam (pure) |
| `highscore.ts` | local top-5 board + qualification (pure) |
| `hud.ts` | in-play HUD: time, score/hi, lives, speed, distance, popups |
| `audio.ts` | ported audio engine: buses, settings, engine tone, SFX, voice clips |
| `music.ts` | streams `the-descent.m4a` through the music bus (ducked by SFX) |
| `main.ts` | bootstrap, states (loading/title/playing/gameover), loop, input, sizing |

Pure logic (`road`, `world`, `timer`, `scoring`, `highscore`) is unit-tested
with vitest (20 tests). Rendering is thin over tested state.

## Controls

- **Desktop:** ←/→ or A/D steer, auto-accelerate, ↓/S/Space brake, M mute,
  Enter start/restart.
- **Mobile (portrait + landscape):** thumb-reachable left/right/slow buttons
  sit in the lower corners, with duplicate slow buttons so either thumb can
  brake while steering. The old canvas halves remain as a fallback,
  auto-accelerate stays on, and the controls are only interactive during play
  so the game-over name keyboard remains tappable. Diagonal-based UI scale
  keeps text and controls legible in both orientations.

## Reused from neon-sentinel

- `public/pickups/600b/rose.png` (rose pickup)
- `public/sfx/want-rose-fren.m4a` (voice on pickup)
- `public/music/the-descent.m4a` (music bed)
- Audio-engine architecture and sprite-caching approach.

## Art pipeline

`tools/gen-art.mjs` regenerates all assets from prompts (reproducible; the game
runs without them via fallbacks). Signs carry DNI-lore in-jokes: `600.wtf`,
`4.20 AM`, `GM`, `WE ARE NOT A CULT`.

## Deliberately out of scope (seam left)

Nostr score events, online leaderboard, Lightning value-for-value, signing
server, multiplayer.

## Deploy target

Static build published by GitHub Pages through `.github/workflows/pages.yml`.
Host-specific origin config stays outside the public repo.
