#!/usr/bin/env bash
# daily-media.sh — the daily animation batches: test animations steered by viewer votes, character scenes (our
# characters and objects composited into scenes) and the imagined scenes whose assets exist. Media sync publishes them.
GEN="${MELEK_GEN_HOME:-/opt/melek-gen}"; REPO="${DOC_REPO:-$GEN/repo}"
cd "$GEN"
curl -s --max-time 60 "${VSTUDIO_BASE:-https://hathor.soapbox.community}/animations/feedback.json" -o anims_feedback.json || true
face-venv/bin/python hathor_animate.py make --out "$GEN/anims" --n "${ANIM_DAILY:-20}" --feedback anims_feedback.json
face-venv/bin/python "$REPO/integrations/character_scenes.py" --root "$GEN" --out "$GEN/anims" --n "${SCENES_DAILY:-40}" --imagined
