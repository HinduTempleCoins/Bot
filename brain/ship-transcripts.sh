#!/usr/bin/env bash
# ship-transcripts.sh — wash this Codespace's Claude Code transcripts and hand them to the brain.
#
# The Briefs/Annals pipeline on Server 4 (reconcile -> operator-asks -> mom-synth -> brief-builder)
# has always read from /var/melek-bot/brain/transcripts/. Nothing ever wrote to it, so every brief
# since has been assembled over a stale asks file. This is the missing feeder.
#
# Nothing leaves this box unwashed: wash-transcript.mjs drops all tool traffic and redacts key
# material and server IPs before rsync sees the file. Idempotent — safe to run on a timer.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SRC="${CLAUDE_TRANSCRIPT_DIR:-$HOME/.claude/projects/-workspaces-Bot}"
STAGE=".local/brain-out"
REMOTE="${BRAIN_HOST:-melek-4}"
DEST="/var/melek-bot/brain/transcripts"

mkdir -p "$STAGE"
shopt -s nullglob
n=0
for f in "$SRC"/*.jsonl; do
  node brain/wash-transcript.mjs "$f" "$STAGE/$(basename "$f")"
  n=$((n + 1))
done
[ "$n" -gt 0 ] || { echo "[ship] no transcripts in $SRC"; exit 0; }

rsync -az --timeout=60 -e "ssh -o BatchMode=yes -o ConnectTimeout=10" "$STAGE"/ "$REMOTE:$DEST/"

# Drive the pipeline now rather than waiting out the timers, so an ask lands in the next brief
# instead of the one after it. Each is a oneshot; --no-block keeps this script from hanging on them.
ssh -o BatchMode=yes "$REMOTE" \
  'systemctl start --no-block melek-reconcile.service melek-mom.service melek-brief.service' || true

echo "[ship] $n transcript(s) washed -> brain:$DEST; reconcile/mom/brief kicked"
