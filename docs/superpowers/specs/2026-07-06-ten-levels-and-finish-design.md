# Ten Levels, Longer Legs, Better Transitions & a Finish Line

**Date:** 2026-07-06
**Status:** Approved (autonomous — /goal directive)

## Goal

Grow *Hang On, Fren* from a 3-region endless loop into a **finite 10-level
OutRun-style journey** that you can actually *complete*:

1. **10 distinct levels** (regions), each with its own backdrop, verge colour,
   scenery kit and traffic.
2. **Each level lasts longer** — more road per leg.
3. **Better transitions** between levels — a drive-through checkpoint gate plus
   the existing colour/horizon morph and a bolder title card.
4. **A finish line** — cross it after the 10th level and the game is *won*, with
   an OutRun-style celebration/ending, a time bonus and the high-score entry.
5. **Tyre-screech SFX** when you push hard left/right through a corner.

Reference for the ending feel: OutRun's goal/finish + celebration screens
(vgmuseum.com/end/arcade/c/out.htm).

## The ten regions

Linear journey (no wrap during a run):

| # | Region | Verge | Horizon | Landmark | Feel |
|---|--------|-------|---------|----------|------|
| 1 | AMALFI COAST | green | riviera | villa | bright Riviera (existing) |
| 2 | TROPICO BAY | sand | beach | beach hut | turquoise lagoon (existing) |
| 3 | ALPINE PASS | snow | alpine | chalet | cold mountain (existing) |
| 4 | DESERT MESA | dust | desert | adobe | red-rock canyon, saguaro |
| 5 | NEON CITY | asphalt | city | skyscraper | neon night city |
| 6 | CHERRY VALLEY | green | valley | pagoda | pink blossom valley |
| 7 | AUTUMN FOREST | gold-leaf | autumn | barn | rust & gold woods |
| 8 | SALT LAKE | pale lilac | lake | lighthouse | pink-salt mirror flats |
| 9 | VOLCANO ROAD | charred | volcano | lava rock | ash sky, ember rumble |
| 10 | GOLDEN COAST | lush green | finale | villa | triumphant golden-hour coast |

Biomes 4–9 use fresh gpt-image props; 10 reuses Amalfi props with a special
golden finale horizon. Traffic re-uses the 8 existing car sprites, themed per
region. **No procedural art** — every horizon/prop is gpt-image (code fallbacks
are the safety net only).

## Engine changes (`stages.ts`)

- `LEVELS = 10`; the KEYFRAMES / STAGES / SCENERY_KITS / BIOME_NAMES arrays all
  grow to length 10.
- `STAGE_M` 1200 → **1600** (each level ~⅓ longer).
- `FINISH_M = LEVELS * STAGE_M` (16 000 m) — exported; the finish line lives here.
- `CHECKPOINT_BONUS` 12 → **15 s**.
- `stageIndexAt` clamps to `[0, LEVELS-1]` — the finale leg never advances past
  itself, so no phantom 11th checkpoint fires.
- `legAt` holds the **final leg** (`f = 0`, next index clamped) so the finale
  doesn't morph back toward Amalfi on the run into the finish.
- `marketPhaseAt` remaps the kept BEAR→BULL→MOON→NEW DAWN lore across the 10
  levels as a mood arc (BEAR 1–3, BULL 4–5, MOON 6–8, NEW DAWN 9–10) so it still
  rides as a checkpoint subtitle and lands on NEW DAWN at the finish.

## Timer (`timer.ts`)

- `startTime` 42 → **45**, `maxTime` 60 → **75**. Cans (+21 s every 21 s) stay
  break-even; 9 checkpoints × 15 s + roses give the headroom to reach 16 km if
  you keep collecting. The 2.1 s emergency rescue can still guarantees a way out.

## Transitions & finish (world/render/main)

- **Markers**: a lightweight `world.markers` list (non-colliding). Each stores a
  wrapped `z` and a sprite. Spawned ~300 m before a boundary at
  `z = player.z + (targetDist − distance)·100`, scrolled/scaled through the
  entity pipeline, culled once passed.
  - **Checkpoint gate** (`prop-gate`) at every level boundary (2–10).
  - **Finish gate** (`prop-finish`, checkered) at `FINISH_M`.
- **Title card**: the checkpoint popup gains a bold `LEVEL n / 10` line above the
  region name + market-phase subtitle.
- **Finish / victory** (`main.ts`): crossing `FINISH_M` while playing ends the run
  with `outcome:'finish'` — freeze the clock, add a `timeLeft × 100` time bonus,
  fire a confetti burst + fanfare, and show a celebratory game-over card
  ("YOU REACHED THE GOAL, FREN!") before the normal high-score flow. Running out
  of time still ends with "OUT OF TIME".
- **HUD**: a small `LV n/10 · REGION` label by the distance pill for constant
  progress feedback.

## Tyre screech (`audio.ts`)

- A persistent `screech` chain (looping noise → bandpass ~2.4 kHz → gain), like
  `updateRumble`: `updateScreech({active, load, speed})`.
- Driven every frame from `main.ts`. Cornering **load** = how far lateral
  velocity `|player.vx|` is past ~45 % of `maxSteerVel`, gated by speed — so it
  bites when you're railing a bend hard, silent when cruising straight.

## Tests

`stages.test.ts` rewritten for the finite 10-level model: region names in order,
`stageIndexAt` clamp, `FINISH_M`, rosters/kits for sampled regions, hold-then-
transition on an early leg, the final leg holding (no morph to Amalfi), horizon
ids, and the market-phase arc landing on NEW DAWN at the finale.

## Art (`gen-art.mjs`)

Adds 7 horizons (desert, city, valley, autumn, lake, volcano, finale) and 13
sprites (cactus, adobe, neon, skyscraper, pagoda, maple, barn, reed, lighthouse,
deadtree, lavarock, gate, finish). Horizons → JPEG @1280w; sprites → 512 px PNG,
same pipeline as before. Every new sprite gets a code-drawn fallback in
`sprites.ts`.
