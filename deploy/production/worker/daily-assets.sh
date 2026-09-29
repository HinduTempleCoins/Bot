#!/usr/bin/env bash
# daily-assets.sh — grow the parts library from what the films report missing (low priority on the image worker).
GEN="${MELEK_GEN_HOME:-/opt/melek-gen}"; REPO="${DOC_REPO:-$GEN/repo}"
cd "$GEN" && face-venv/bin/python "$REPO/integrations/asset_growth.py" --root "$GEN" --n "${ASSETS_DAILY:-10}"
