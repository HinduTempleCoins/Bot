#!/usr/bin/env bash
# smoke.sh — run every video tool once on a sample still and print its JSON timing line. Run from GEN_HOME:
#   bash tools/smoke.sh path/to/scene_768x512.png path/to/character.png
set -uo pipefail
SRC="$1"; CH="${2:-$1}"; T=$(mktemp -d)
echo "cutout:        $(nice -n 10 tools-venv/bin/python tools/cutout.py "$CH" "$T/cut.png" 2>/dev/null | tail -1)"
echo "depthParallax: $(nice -n 10 face-venv/bin/python tools/depth_parallax.py "$SRC" "$T/par.mp4" --seconds 6 2>/dev/null | grep '^{')"
echo "upscale:       $(nice -n 10 tools-venv/bin/python tools/upscale.py "$SRC" "$T/up.png" --fit 1920x1280 2>/dev/null | grep '^{')"
ffmpeg -loglevel error -y -i "$T/par.mp4" -r 12 "$T/par12.mp4" && echo "interpolate:   $(nice -n 10 bash tools/interpolate.sh "$T/par12.mp4" "$T/par48.mp4" 48 | tail -1)"
face-venv/bin/python -c "import diffusers, torch, cv2; print('image stack: ok')"
rm -rf "$T"
