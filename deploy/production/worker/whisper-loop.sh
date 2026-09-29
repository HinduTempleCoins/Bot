#!/usr/bin/env bash
# whisper-loop.sh — Pentecaust transcripts: once a day rebuild the queue of cleared films with no subtitles (repo's
# pentecaust/transcripts/seek.mjs), then transcribe everything queued (shortest first; finished ones are skipped).
GEN="${MELEK_GEN_HOME:-/opt/melek-gen}"; REPO="${DOC_REPO:-$GEN/repo}"; NODE="${DOC_NODE:-node}"
cd "$GEN/pentecaust"
while true; do
  "$NODE" "$REPO/pentecaust/transcripts/seek.mjs" queue --out queue.new.json >> whisper.log 2>&1 && mv queue.new.json queue.json
  "$GEN/face-venv/bin/python" "$REPO/pentecaust/transcripts/whisper_worker.py" queue.json --out work --max 100000 --threads 4 >> whisper.log 2>&1
  sleep 86400
done
