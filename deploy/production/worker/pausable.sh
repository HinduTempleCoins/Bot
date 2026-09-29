#!/usr/bin/env bash
# pausable.sh CMD… — run a batch command; while the production pause flag exists, freeze it (SIGSTOP) and resume it
# (SIGCONT) when the flag is removed. Waits (does not start) while paused. Used by the worker's batch services.
PAUSE="${PRODUCTION_PAUSE_FILE:?set PRODUCTION_PAUSE_FILE in the production env file}"
while [ -e "$PAUSE" ]; do sleep 60; done
setsid "$@" &
child=$!
stopped=0
trap 'kill -TERM -- -$child 2>/dev/null; wait $child; exit 143' TERM INT
while kill -0 "$child" 2>/dev/null; do
  if [ -e "$PAUSE" ] && [ $stopped -eq 0 ]; then kill -STOP -- -$child 2>/dev/null; stopped=1; echo "paused"; fi
  if [ ! -e "$PAUSE" ] && [ $stopped -eq 1 ]; then kill -CONT -- -$child 2>/dev/null; stopped=0; echo "resumed"; fi
  sleep 30
done
wait "$child"
