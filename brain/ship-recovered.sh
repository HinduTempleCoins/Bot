#!/usr/bin/env bash
# ship-recovered.sh — wash the RECOVERED corpus and hand it to the brain, the same way
# ship-transcripts.sh ships this Codespace's live transcripts.
#
# The recovered material lives ONLY in this ephemeral env and is lost on the next wipe:
#   • archive/recovered-sessions/*.api.json  — raw recovered sessions (untracked, huge)
#   • .local/incoming/recovered/DIGEST_*.md  — the synthesised digests (.local/ is gitignored)
# This ships a WASHED copy into the durable, never-wiped brain compartments before that happens, so the
# Soapy wake (integrations/soapy-conference.mjs) reads it and the reconcile→mom→brief pipeline mines it.
#
# Nothing leaves this box unwashed: brain/sync-recovered.mjs reuses wash-transcript.mjs's redaction
# (key blocks, WIF/Graphene/EVM keys, high-entropy tokens, every non-loopback IPv4) before rsync sees a
# byte. Idempotent — safe to run on a timer (deploy/soapy-sync/*). No keys, no Modal calls: this only
# moves files to the box and kicks its existing timers, so it cannot affect the $30/mo Modal budget.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SESS="${RECOVERED_SESSIONS_DIR:-archive/recovered-sessions}"
DIG="${RECOVERED_DIGESTS_DIR:-.local/incoming/recovered}"
STAGE="${RECOVERED_OUT_DIR:-.local/brain-out/recovered}"
# All box-specific destinations come from the environment (the operator's .local/ EnvironmentFile) so
# no hostname or absolute box path lives in this public file. See deploy/soapy-sync/README.md.
REMOTE="${BRAIN_HOST:?set BRAIN_HOST (ssh alias of the brain box)}"
DEST_T="${BRAIN_TRANSCRIPTS_DIR:?set BRAIN_TRANSCRIPTS_DIR}"   # reconcile mines these → append-only asks
DEST_A="${BRAIN_ANNALS_DIR:?set BRAIN_ANNALS_DIR}"             # annal-harvester mines; the Soapy wake reads

# The big sessions (one is ~138 MB) need headroom to JSON.parse; give node a larger heap.
RECOVERED_SESSIONS_DIR="$SESS" RECOVERED_DIGESTS_DIR="$DIG" RECOVERED_OUT_DIR="$STAGE" \
  node --max-old-space-size=4096 brain/sync-recovered.mjs

shopt -s nullglob
tn=("$STAGE"/transcripts/*.jsonl); an=("$STAGE"/annals/*.md)
if [ "${#tn[@]}" -eq 0 ] && [ "${#an[@]}" -eq 0 ]; then
  echo "[ship-recovered] nothing staged (no sessions or digests found) — exiting"; exit 0
fi

SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"
[ "${#tn[@]}" -gt 0 ] && rsync -az --timeout=60 -e "$SSH" "$STAGE"/transcripts/ "$REMOTE:$DEST_T/"
[ "${#an[@]}" -gt 0 ] && rsync -az --timeout=60 -e "$SSH" "$STAGE"/annals/       "$REMOTE:$DEST_A/"

# Drive the pipeline now so the recovered material lands in the NEXT brief/annal pass rather than the
# one after — timed by deploy/soapy-sync/* to run before each 12-and-12 wake. Oneshots; --no-block so
# this script never hangs on them.
$SSH "$REMOTE" \
  'systemctl start --no-block melek-reconcile.service melek-mom.service melek-brief.service melek-harvest.service' || true

echo "[ship-recovered] ${#tn[@]} session(s) → brain:$DEST_T, ${#an[@]} annal(s) → brain:$DEST_A; reconcile/mom/brief/harvest kicked"
