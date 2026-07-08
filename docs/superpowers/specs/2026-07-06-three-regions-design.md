# Hang On, Fren — Three Regions (levels)

**Goal:** the endless drive should pass through three visually distinct regions,
not just one Amalfi coast at different times of day. Requested: a seaside level
with **sand instead of grass** and **coconut trees**, plus two more.

## Decisions (approved)

- **Structure:** continuous OutRun-style drive — the world morphs into a new
  region at each checkpoint and cycles endlessly (no level-select menu).
- **The three regions** (one per 1200 m leg, then repeat):
  1. **Amalfi Coast** — the existing look (green verges, palm/cypress, villas).
  2. **Tropico Bay** — golden **sand** verges, **coconut palms**, café parasols,
     a beach hut, a turquoise-lagoon horizon.
  3. **Alpine Pass** — **snow** verges, snow firs + pines, a timber chalet, a
     cold snowy-peaks horizon.

## Approach — repurpose the time-of-day blend engine as a *biome* engine

`stages.ts` already blends between keyframe palettes across each leg and
crossfades a matching gpt-image horizon. The *place* never changed. We swap the
**data**, keeping every exported function name/signature:

- `KEYFRAMES`: 4 time-of-day palettes → **3 biome palettes** (RIVIERA/BEACH/ALPINE).
- horizon ids: `day/sunset/night/dawn` → **`riviera/beach/alpine`**.
- `SCENERY_KITS`: 4 → **3 biome kits**.
- `STAGES` (name + roster): 4 crypto-market legs → **3 region names + themed rosters**.

`render.ts`, `world.ts`, `main.ts` need only tiny edits (new sprite widths,
default horizon id, comments). Grass→sand→snow is just the `grassLight/Dark`
palette values — those verges are flat colour slabs the pseudo-3D engine draws,
**not illustrative art**, so this honours the "gpt-image only for art" rule.

### Hold-then-transition curve

Today the blend morphs continuously across a whole leg (great for day→dusk, bad
for distinct levels — you'd be permanently half-grass-half-sand). New curve:
**hold each biome for the first ~78 % of its leg, then morph into the next over
the final ~22 % into the checkpoint.** One shared curve drives both the palette
and the horizon crossfade, and it reaches the next biome exactly at the
checkpoint where the scenery props hard-swap — so ground, sky and props all turn
over together.

## New gpt-image art (via `tools/gen-art.mjs`)

| Asset | Model | Notes |
|-------|-------|-------|
| `horizon-beach` | gpt-image-2 | turquoise lagoon / white-sand bay panorama |
| `horizon-alpine` | gpt-image-2 | snowy peaks + pine valley, cold sky |
| `prop-coconut` | gpt-image-1.5 | tall coconut palm, hanging coconuts |
| `prop-beachhut` | gpt-image-1.5 | thatched tiki beach bar (beach landmark) |
| `prop-fir` | gpt-image-1.5 | snow-dusted alpine conifer |
| `prop-chalet` | gpt-image-1.5 | timber alpine chalet (alpine landmark) |

Amalfi reuses its existing art; `horizon-riviera` aliases the existing
`horizon-day.jpg`. Beach reuses `prop-parasol`; Alpine reuses `prop-lamp` +
`prop-pine`. Every new sprite gets a code-drawn fallback to match the existing
pattern (real art is the shipped deliverable).

## Traffic & lore

Each region gets a themed roster from existing car sprites (Amalfi = Fiat/Ape/
banger; Bay = Porsche/Ferrari/scooter; Alpine = Bentley/Lambo/classic). The
`world.ts` difficulty ramp is untouched, so it still hardens each lap. The
crypto-market checkpoint names (BEAR/BULL/MOON) are retired in favour of the
region names on the banner.

## Testing

New `stages.test.ts` locks: the 3-region cycle, themed rosters, biome scenery
kits, the hold-then-transition curve (held mid-leg, arrived by the checkpoint),
and horizon-id selection. Existing `world`/`road`/`collision` tests untouched.

## Deploy

Same static build as today, published by GitHub Pages for the public repo.
Host-specific origin config stays outside the public tree.
