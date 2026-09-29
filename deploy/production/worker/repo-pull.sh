#!/usr/bin/env bash
# repo-pull.sh — keep the worker's sparse checkout of this repository current (fast-forward only).
REPO="${DOC_REPO:-/opt/melek-gen/repo}"
git -C "$REPO" pull --ff-only -q || echo "repo pull failed (kept the current checkout)"
