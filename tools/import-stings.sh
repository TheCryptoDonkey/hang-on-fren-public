#!/usr/bin/env bash
# Import local arcade vocal stings into public/sfx as web-friendly AAC/m4a,
# matching the existing voice clips.
#
# The game (src/main.ts, STING) already references the two headline stings:
#   /sfx/sting-wuh.m4a   — "wuh!"        fired on an overtake streak
#   /sfx/sting-whoo.m4a  — "whoo hooooo" fired on a checkpoint
# so once this has run they light up with no further code changes.
#
# Usage:
#   tools/import-stings.sh /path/to/wavs
#
# Or set STING_SOURCE_DIR to a folder holding the .wav files.

set -euo pipefail

SRC="${1:-${STING_SOURCE_DIR:-}}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/sfx"
mkdir -p "$DEST"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found — brew install ffmpeg" >&2; exit 1; }
[[ -n "$SRC" ]] || { echo "usage: tools/import-stings.sh /path/to/wavs" >&2; exit 1; }

# Headline stings the code already wires up.
declare -a WIRED=(
  "wuh!.wav|sting-wuh.m4a"
  "Whoo hooooo.wav|sting-whoo.m4a"
)
# Optional: cleaner masters for the four pickup one-liners. The game currently
# ships working equivalents (600b-*.m4a / etc.), so these are drop-in refreshes —
# uncomment the wiring in src/main.ts VOICE if you want to switch to them.
declare -a OPTIONAL=(
  "Timelock main.wav|600b-time-lock.m4a"
  "Meme.wav|600b-meme.m4a"
  "Fiatnam.wav|600b-fiat-nam.m4a"
  "All time high.wav|600b-all-time-high.m4a"
)

convert() {
  local src="$SRC/$1" out="$DEST/$2"
  if [[ ! -f "$src" ]]; then echo "  skip (missing): $1" >&2; return; fi
  ffmpeg -y -loglevel error -i "$src" -ac 1 -c:a aac -b:a 128k "$out"
  echo "  ✓ $1  →  public/sfx/$2"
}

echo "Importing headline stings from: $SRC"
for pair in "${WIRED[@]}"; do convert "${pair%%|*}" "${pair##*|}"; done

if [[ "${WITH_OPTIONAL:-0}" == "1" ]]; then
  echo "Importing optional pickup-voice refreshes"
  for pair in "${OPTIONAL[@]}"; do convert "${pair%%|*}" "${pair##*|}"; done
fi

echo "Done. Rebuild/redeploy to ship them."
