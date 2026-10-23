#!/usr/bin/env bash
# generate-entrainment.sh — produce MELEK/Hathor ORIGINAL brainwave-entrainment audio.
# Pure sine tones synthesized with ffmpeg → uncopyrightable, ours by construction (CC0).
# Deploy the output to ENTRAINMENT_BASE (the SoapBox data host); the reader
# integrations/soapbox/entrainment.mjs references these by URL (bytes are NOT committed to git,
# matching how music-catalog.mjs references freepd.com / archive.org).
#
#   binaural   = stereo, L=carrier / R=carrier+beat  (perceived beat → REQUIRES HEADPHONES)
#   isochronic = single carrier amplitude-pulsed (tremolo) at the target Hz (works on speakers)
#
# Usage:  bash generate-entrainment.sh [OUTDIR]     (DUR=seconds env, default 120)
set -euo pipefail
OUT="${1:-./entrainment}"; DUR="${DUR:-120}"; mkdir -p "$OUT"
VOL_B=0.28   # gentle level per binaural tone
VOL_I=0.40   # isochronic single tone

binaural(){ # id carrier beatHz title
  local r; r=$(awk "BEGIN{print $2+$3}")
  ffmpeg -y -f lavfi -i "sine=frequency=$2:duration=${DUR}" \
         -f lavfi -i "sine=frequency=${r}:duration=${DUR}" \
    -filter_complex "[0:a]volume=${VOL_B}[l];[1:a]volume=${VOL_B}[rr];[l][rr]join=inputs=2:channel_layout=stereo" \
    -c:a libopus -b:a 48k -application audio \
    -metadata artist="Hathor" -metadata album="MELEK Entrainment" -metadata title="$4" \
    -metadata comment="Original binaural beat, carrier $2Hz, beat $3Hz. Not medical treatment. Use headphones. Do not use while driving." \
    "$OUT/$1.opus" -loglevel error
}
isochronic(){ # id carrier pulseHz title
  ffmpeg -y -f lavfi -i "sine=frequency=$2:duration=${DUR}" \
    -af "tremolo=f=$3:d=0.95,volume=${VOL_I}" \
    -c:a libopus -b:a 40k -application audio \
    -metadata artist="Hathor" -metadata album="MELEK Entrainment" -metadata title="$4" \
    -metadata comment="Original isochronic tone, carrier $2Hz, pulse $3Hz. Not medical treatment. Do not use while driving. Caution if epilepsy/seizure history." \
    "$OUT/$1.opus" -loglevel error
}
isochronic gamma-40hz-focus        220   40   "Focus — 40 Hz Gamma (isochronic)"
isochronic beta-18hz-energy        200   18   "Energy — 18 Hz Beta (isochronic)"
binaural   alpha-10hz-calm         200   10   "Calm — 10 Hz Alpha (binaural)"
binaural   theta-6hz-meditate      200   6    "Meditate — 6 Hz Theta (binaural)"
isochronic delta-2_5hz-sleep       150   2.5  "Sleep — 2.5 Hz Delta (isochronic)"
binaural   schumann-7_83hz-ground  136.1 7.83 "Ground — 7.83 Hz Schumann (binaural)"
echo "wrote 6 tracks -> $OUT"
