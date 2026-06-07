#!/usr/bin/env bash
# install.sh — idempotent installer for the diag-to-tasks self-fix-queue builder
# (integrations/diag-to-tasks.mjs). Carryover #176.
#
# Runs ON the box, operator-present (this repo never SSHes anywhere). Safe to re-run.
# READ-ONLY w.r.t. the chain: it never signs, never broadcasts, holds no chain keys. It
# folds the alpha-e2e diagnostics into a deduplicated self-fix queue (JSON + markdown).
#
# Usage (from the checked-out Bot repo root on the box):
#   sudo INSTALL_DIR=/path/to/bot/repo \
#        ENV_FILE=/path/to/private/diag-to-tasks.env \
#        DATA_DIR=/path/to/brain/shared \
#        LOG_FILE=/var/log/melek-diag-to-tasks.log \
#        NODE_BIN=/usr/bin/node \
#        bash deploy/diag-to-tasks/install.sh [--enable] [--smoke]
#
#   --enable   systemctl enable --now the .timer after installing it
#   --smoke    run ONE `once` pass immediately and print the summary
#
# (Substitute your real paths. The defaults below are generic placeholders.)

set -euo pipefail

# Generic placeholder defaults — the operator overrides these on the box.
INSTALL_DIR="${INSTALL_DIR:-/srv/bot/repo}"
ENV_FILE="${ENV_FILE:-/srv/bot/diag-to-tasks.env}"
DATA_DIR="${DATA_DIR:-/srv/bot/brain/shared}"
LOG_FILE="${LOG_FILE:-/var/log/melek-diag-to-tasks.log}"
NODE_BIN="${NODE_BIN:-$(command -v node || echo /usr/bin/node)}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE="melek-diag-to-tasks.service"
TIMER="melek-diag-to-tasks.timer"

ENABLE=0; SMOKE=0
for a in "$@"; do
  case "$a" in
    --enable) ENABLE=1 ;;
    --smoke)  SMOKE=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[diag-to-tasks] install dir : $INSTALL_DIR"
echo "[diag-to-tasks] env file    : $ENV_FILE"
echo "[diag-to-tasks] data dir    : $DATA_DIR"
echo "[diag-to-tasks] log file    : $LOG_FILE"
echo "[diag-to-tasks] node bin    : $NODE_BIN"

[ -x "$NODE_BIN" ] || { echo "[diag-to-tasks] ERROR: node not executable at $NODE_BIN" >&2; exit 1; }

# 1) write dirs (idempotent) — the queue JSON/MD live here; the log too.
mkdir -p "$DATA_DIR" "$(dirname "$LOG_FILE")"

# 2) env file — install from the example only if absent (never clobber operator edits).
if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  sed -e "s|__DATA_DIR__|${DATA_DIR}|g" \
      "$BUNDLE/diag-to-tasks.env.example" > "$ENV_FILE"
  echo "[diag-to-tasks] wrote $ENV_FILE from example. REVIEW IT (set the probe URLs) before --enable."
else
  echo "[diag-to-tasks] $ENV_FILE already exists — left untouched."
fi

# 3) systemd units — substitute placeholders, install idempotently.
mkdir -p "$SYSTEMD_DIR"
for UNIT in "$SERVICE" "$TIMER"; do
  sed -e "s|__INSTALL_DIR__|${INSTALL_DIR}|g" \
      -e "s|__ENV_FILE__|${ENV_FILE}|g" \
      -e "s|__DATA_DIR__|${DATA_DIR}|g" \
      -e "s|__LOG_FILE__|${LOG_FILE}|g" \
      -e "s|__NODE_BIN__|${NODE_BIN}|g" \
      "$BUNDLE/$UNIT" > "$SYSTEMD_DIR/$UNIT"
  echo "[diag-to-tasks] installed $SYSTEMD_DIR/$UNIT"
done
systemctl daemon-reload

# 4) optional smoke test — one `once` pass; prints the open/tracked summary line.
if [ "$SMOKE" = 1 ]; then
  echo "[diag-to-tasks] smoke: one 'once' pass ..."
  ( cd "$INSTALL_DIR" && set -a && . "$ENV_FILE" && set +a && "$NODE_BIN" integrations/diag-to-tasks.mjs once )
  echo "[diag-to-tasks] queue written. Inspect: cat $DATA_DIR/self-fix-queue.md"
fi

# 5) optional enable — note we enable the TIMER (it pulls the service).
if [ "$ENABLE" = 1 ]; then
  systemctl enable --now "$TIMER"
  echo "[diag-to-tasks] timer enabled:"; systemctl status "$TIMER" --no-pager || true
  echo "[diag-to-tasks] next runs:"; systemctl list-timers "$TIMER" --no-pager || true
else
  echo "[diag-to-tasks] units installed but NOT enabled. Enable with:"
  echo "          sudo systemctl enable --now $TIMER"
fi

echo "[diag-to-tasks] done."
