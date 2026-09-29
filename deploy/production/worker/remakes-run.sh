#!/usr/bin/env bash
# remakes-run.sh — the remake batch: the mythology scenes first, then everything (remake_batch.py skips finished outputs,
# so re-running is safe and cheap). Exits when all are done; the daily timer re-runs it for new remake_extra/*.jsonl.
set -e
cd "${MELEK_GEN_HOME:-/opt/melek-gen}"
PY=face-venv/bin/python
KEYS=$(cat remake_extra/myth_*.jsonl 2>/dev/null | $PY -c 'import sys,json; print(" ".join(json.loads(l)["key"] for l in sys.stdin if l.strip()))')
[ -n "$KEYS" ] && $PY remake_batch.py $KEYS
$PY remake_batch.py
