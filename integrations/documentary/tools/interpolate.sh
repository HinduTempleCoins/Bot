#!/usr/bin/env bash
# interpolate.sh — smooth motion by motion-compensated frame interpolation with ffmpeg's minterpolate (FFmpeg, LGPL).
# Turns a 12/24 fps render into 48/60 fps, or smooths slow camera moves.
#   interpolate.sh in.mp4 out.mp4 [fps=48]
set -euo pipefail
in="$1"; out="$2"; fps="${3:-48}"
t0=$(date +%s.%N)
ffmpeg -y -loglevel error -i "$in" -vf "minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -movflags +faststart "$out"
t1=$(date +%s.%N)
printf '{"ok": true, "seconds": %.2f, "fps": %s}\n' "$(echo "$t1 - $t0" | bc)" "$fps"
