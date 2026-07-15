#!/usr/bin/env bash
# Regenerate the shipped game assets from the full-resolution originals.
#
#   art-originals/   full-res source, kept in-repo (music WAVs are committed;
#                    art PNGs are gitignored local retention — regenerable here)
#   public/          the compressed sprites / backdrops / music that ship
#
# Sprites -> WebP (alpha preserved), backdrops -> WebP, music -> 112k AAC from
# the lossless WAVs. Deterministic and safe to re-run.
#
# Requires: cwebp, ffmpeg. Run from the repo root:  bash tools/optimise-assets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ART_SRC=art-originals/art
PICK_SRC=art-originals/pickups/600b
WAV_SRC=art-originals/music
ART_OUT=public/art
PICK_OUT=public/pickups/600b
MUSIC_OUT=public/music

mkdir -p "$ART_OUT" "$PICK_OUT" "$MUSIC_OUT"

# webp <srcImg> <outWebp> <longEdge> <quality>
webp() { cwebp -quiet -q "$4" -resize "$3" 0 "$1" -o "$2"; }

# 1. Square sprites (1024) -> 512px WebP. Cars, hero, scooter, props, pickups.
#    Skip the orphan sources the game never loads (title-art.png is superseded by
#    title-art-orig; prop-finish.png by prop-finish-decorated).
for f in "$ART_SRC"/car-*.png "$ART_SRC"/hero-*.png "$ART_SRC"/scooter-*.png \
         "$ART_SRC"/prop-*.png "$ART_SRC"/pickup-petrol.png "$ART_SRC"/pickup-shield.png \
         "$ART_SRC"/caveman-*.png "$ART_SRC"/dino-*.png "$ART_SRC"/mammoth.png \
         "$ART_SRC"/hazard-*.png "$ART_SRC"/pickup-joint.png "$ART_SRC"/pickup-pill.png \
         "$ART_SRC"/pickup-crystal.png "$ART_SRC"/victory-*.png \
         "$ART_SRC"/ufo.png "$ART_SRC"/billboard-rose.png; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .png)
  [ "$name" = "prop-finish" ] && continue          # orphan source
  case "$name" in
    prop-gate|prop-finish-decorated) webp "$f" "$ART_OUT/$name.webp" 820 88 ;;
    victory-cavemen)                 webp "$f" "$ART_OUT/$name.webp" 820 88 ;;
    finish-line-girls)               webp "$f" "$ART_OUT/$name.webp" 1100 90 ;;
    *)                               webp "$f" "$ART_OUT/$name.webp" 512 86 ;;
  esac
done
# Finish-line casts (girls + the secret level's cave women) stay big — they're
# the full-screen victory tableau.
for f in "$ART_SRC"/finish-line-*.png; do
  [ -f "$f" ] || continue
  webp "$f" "$ART_OUT/$(basename "$f" .png).webp" 1100 90
done

# 1b. Ground textures (gen-textures.mjs): trim the border, pixel-downscale,
#     quantise back to a small palette, then 2x2 MIRROR-BAKE so the final tile
#     is seamless by construction (the model's edges never wrap perfectly).
#     Requires python3 + Pillow.
for f in "$ART_SRC"/texture-*.png; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .png)
  tmp=$(mktemp -t "$name").png
  python3 - "$f" "$tmp" <<'PY'
import sys
from PIL import Image, ImageOps, ImageStat
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
w, h = im.size
b = round(w * 0.03)
im = im.crop((b, b, w - b, h - b))          # trim border artefacts
im = im.resize((128, 128), Image.BOX)       # pixel-downscale
im = ImageOps.autocontrast(im, cutoff=1)    # the downscale averages fine grain flat — stretch it back
# ...then compress the stretch around the tile's mean: full-range value swings
# tint into near-black chunks in-game (sand read as dirt, tarmac as static).
mean = tuple(int(v) for v in ImageStat.Stat(im).mean)
im = Image.blend(Image.new('RGB', im.size, mean), im, 0.55)
im = im.quantize(colors=24).convert('RGB')  # re-crisp to a small palette
tile = Image.new('RGB', (256, 256))
tile.paste(im, (0, 0))
tile.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (128, 0))
tile.paste(im.transpose(Image.FLIP_TOP_BOTTOM), (0, 128))
tile.paste(im.transpose(Image.ROTATE_180), (128, 128))
tile.save(out)
PY
  cwebp -quiet -q 90 "$tmp" -o "$ART_OUT/$name.webp"
  rm -f "$tmp"
done

# 2. Pickup tokens (600b set), excluding the unused cake-piece-4.
for f in "$PICK_SRC"/*.png; do
  name=$(basename "$f" .png)
  [ "$name" = "cake-piece-4" ] && continue
  webp "$f" "$PICK_OUT/$name.webp" 512 88
done

# 3. Opaque backdrops -> WebP. Horizons stay wide; the title art is full-screen.
for f in "$ART_SRC"/horizon-*.jpg; do
  [ -f "$f" ] || continue
  webp "$f" "$ART_OUT/$(basename "$f" .jpg).webp" 1280 80
done
[ -f "$ART_SRC/title-art-orig.png" ] && webp "$ART_SRC/title-art-orig.png" "$ART_OUT/title-art-orig.webp" 1440 82

# 4. Music -> 112 kbps AAC, straight from the lossless WAV masters (single
#    generation). Filenames differ from the WAVs, so map them explicitly.
#    the-descent has no WAV master and keeps its existing shipped m4a.
declare -a MUSIC_MAP=(
  "Amalfi Coast — Coastal Velocity.wav|amalfi-coast-coastal-velocity.m4a"
  "Old Mallorca — Tramuntana Motion.wav|old-mallorca-tramuntana-motion.m4a"
  "Old Manchester — Loose Gears.wav|old-manchester-loose-gears.m4a"
  "Old Prague — Allegretto Circuit.wav|old-prague-allegretto.m4a"
  "Taj Mahal — Roses at Dawn.wav|taj-mahal-roses-at-dawn.m4a"
  "Two Cavemen, One Broken Timeline.wav|two-cavemen-one-broken-timeline.m4a"
  # 600B YEARS BC per-stage beds + the goal-screen victory sting.
  "Dawn of everything.wav|dawn-of-everything.m4a"
  "Dusk of the dinosaurs.wav|dusk-of-the-dinosaurs.m4a"
  "The longest night.wav|the-longest-night.m4a"
  "The Crooked Time Machine.wav|the-crooked-time-machine.m4a"
  "timeline restored!.wav|timeline-restored.m4a"
)
for pair in "${MUSIC_MAP[@]}"; do
  wav="$WAV_SRC/${pair%%|*}"; out="$MUSIC_OUT/${pair##*|}"
  [ -f "$wav" ] || { echo "warn: missing WAV $wav"; continue; }
  ffmpeg -y -loglevel error -i "$wav" -c:a aac -b:a 112k -movflags +faststart "$out"
done

echo "optimise-assets: done — public/art $(du -sh "$ART_OUT" | cut -f1), music $(du -sh "$MUSIC_OUT" | cut -f1)"
