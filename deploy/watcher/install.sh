#!/usr/bin/env bash
# install.sh — idempotent installer for the Hathor sensitive-op watcher (watcher/index.js).
#
# Runs ON the box, operator-present (this repo never SSHes anywhere). Safe to re-run.
# READ-ONLY watcher: it never signs, never broadcasts, holds no chain keys. The only
# creds it may carry (Telegram bot token / Resend key) are ALERT-DELIVERY creds, set
# by the operator in the private env file — never committed.
#
# Usage (from the checked-out Bot repo root on the box):
#   sudo INSTALL_DIR=/path/to/bot/repo \
#        ENV_FILE=/path/to/private/watcher.env \
#        DATA_DIR=/path/to/watcher-data \
#        LOG_FILE=/var/log/melek-watcher.log \
#        NODE_BIN=/usr/bin/node \
#        bash deploy/watcher/install.sh [--enable] [--smoke]
#
#   --enable   systemctl enable --now the .timer after installing it
#   --smoke    run ONE read-only --once tick immediately and print the summary
#
# (Substitute your real paths. The defaults below are generic placeholders.)

set -euo pipefail

# Generic placeholder defaults — the operator overrides these on the box.
INSTALL_DIR="${INSTALL_DIR:-/srv/bot/repo}"
ENV_FILE="${ENV_FILE:-/srv/bot/watcher.env}"
DATA_DIR="${DATA_DIR:-/srv/bot/watcher-data}"
LOG_FILE="${LOG_FILE:-/var/log/melek-watcher.log}"
NODE_BIN="${NODE_BIN:-$(command -v node || echo /usr/bin/node)}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE="melek-watcher.service"
TIMER="melek-watcher.timer"

ENABLE=0; SMOKE=0
for a in "$@"; do
  case "$a" in
    --enable) ENABLE=1 ;;
    --smoke)  SMOKE=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[watcher] install dir : $INSTALL_DIR"
echo "[watcher] env file    : $ENV_FILE"
echo "[watcher] data dir    : $DATA_DIR"
echo "[watcher] log file    : $LOG_FILE"
echo "[watcher] node bin    : $NODE_BIN"

[ -x "$NODE_BIN" ] || { echo "[watcher] ERROR: node not executable at $NODE_BIN" >&2; exit 1; }

# 1) write dirs (idempotent) — the state file + alerts.jsonl live here; the log too.
mkdir -p "$DATA_DIR" "$(dirname "$LOG_FILE")"

# 2) env file — install from the example only if absent (never clobber operator edits).
if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  sed -e "s|__DATA_DIR__|${DATA_DIR}|g" \
      "$BUNDLE/watcher.env.example" > "$ENV_FILE"
  echo "[watcher] wrote $ENV_FILE from example. REVIEW IT (set RPC, enable sinks) before --enable."
else
  echo "[watcher] $ENV_FILE already exists — left untouched."
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
  echo "[watcher] installed $SYSTEMD_DIR/$UNIT"
done
systemctl daemon-reload

# 4) optional smoke test — one read-only --once tick, prints the startup + summary lines.
# First run bootstraps (snapshots head, does NOT alert on backfill) — that's expected.
if [ "$SMOKE" = 1 ]; then
  echo "[watcher] smoke: one read-only --once tick ..."
  ( cd "$INSTALL_DIR" && set -a && . "$ENV_FILE" && set +a && "$NODE_BIN" watcher/index.js --once )
fi

# 5) optional enable — note we enable the TIMER (it pulls the service).
if [ "$ENABLE" = 1 ]; then
  systemctl enable --now "$TIMER"
  echo "[watcher] timer enabled:"; systemctl status "$TIMER" --no-pager || true
  echo "[watcher] next runs:"; systemctl list-timers "$TIMER" --no-pager || true
else
  echo "[watcher] units installed but NOT enabled. Enable with:"
  echo "          sudo systemctl enable --now $TIMER"
fi

echo "[watcher] done."
