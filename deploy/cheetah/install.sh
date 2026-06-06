#!/usr/bin/env bash
# install.sh — idempotent installer for the CheetahAdvanced read-only testnet watcher.
#
# Runs ON the box, operator-present (this repo never SSHes anywhere). Safe to re-run.
# No npm install needed: the watcher's detection/discovery path is pure-JS (the repo's
# existing deps cover it). READ-ONLY: it never signs, never broadcasts, holds no keys.
#
# Usage (from the checked-out Bot repo root on the box):
#   sudo INSTALL_DIR=/path/to/bot/repo \
#        ENV_FILE=/path/to/private/cheetah.env \
#        DATA_DIR=/path/to/store-data \
#        REPORT_DIR=/var/www/alpha-melek-salon/cheetah \
#        NODE_BIN=/usr/bin/node \
#        bash deploy/cheetah/install.sh [--enable] [--smoke]
#
#   --enable   systemctl enable --now the service after installing it
#   --smoke    run ONE read-only poll pass immediately and print the summary
#
# (Substitute your real paths. The defaults below are generic placeholders.)

set -euo pipefail

# Generic placeholder defaults — the operator overrides these on the box.
INSTALL_DIR="${INSTALL_DIR:-/srv/bot/repo}"
ENV_FILE="${ENV_FILE:-/srv/bot/cheetah.env}"
DATA_DIR="${DATA_DIR:-/srv/bot/store-data}"
REPORT_DIR="${REPORT_DIR:-/var/www/alpha-melek-salon/cheetah}"
NODE_BIN="${NODE_BIN:-$(command -v node || echo /usr/bin/node)}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
UNIT="melek-cheetah-watch.service"

ENABLE=0; SMOKE=0
for a in "$@"; do
  case "$a" in
    --enable) ENABLE=1 ;;
    --smoke)  SMOKE=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[cheetah] install dir : $INSTALL_DIR"
echo "[cheetah] env file    : $ENV_FILE"
echo "[cheetah] data dir    : $DATA_DIR"
echo "[cheetah] report dir  : $REPORT_DIR"
echo "[cheetah] node bin    : $NODE_BIN"

[ -x "$NODE_BIN" ] || { echo "[cheetah] ERROR: node not executable at $NODE_BIN" >&2; exit 1; }

# 1) write dirs (idempotent) — the only two paths the watcher writes to.
mkdir -p "$DATA_DIR" "$REPORT_DIR"

# 2) env file — install from the example only if absent (never clobber operator edits).
if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  sed -e "s|__DATA_DIR__|${DATA_DIR}|g" \
      -e "s|__REPORT_DIR__|${REPORT_DIR}|g" \
      "$BUNDLE/cheetah.env.example" > "$ENV_FILE"
  echo "[cheetah] wrote $ENV_FILE from example. REVIEW IT before --enable."
else
  echo "[cheetah] $ENV_FILE already exists — left untouched."
fi

# 3) systemd unit — substitute placeholders, install idempotently.
mkdir -p "$SYSTEMD_DIR"
sed -e "s|__INSTALL_DIR__|${INSTALL_DIR}|g" \
    -e "s|__ENV_FILE__|${ENV_FILE}|g" \
    -e "s|__DATA_DIR__|${DATA_DIR}|g" \
    -e "s|__REPORT_DIR__|${REPORT_DIR}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN}|g" \
    "$BUNDLE/$UNIT" > "$SYSTEMD_DIR/$UNIT"
echo "[cheetah] installed $SYSTEMD_DIR/$UNIT"
systemctl daemon-reload

# 4) optional smoke test — one read-only poll pass, prints the summary line.
if [ "$SMOKE" = 1 ]; then
  echo "[cheetah] smoke: one read-only poll pass ..."
  ( cd "$INSTALL_DIR" && set -a && . "$ENV_FILE" && set +a && "$NODE_BIN" cheetah/watch.mjs --once )
fi

# 5) optional enable.
if [ "$ENABLE" = 1 ]; then
  systemctl enable --now "$UNIT"
  echo "[cheetah] service enabled:"; systemctl status "$UNIT" --no-pager || true
else
  echo "[cheetah] unit installed but NOT enabled. Enable with:"
  echo "          sudo systemctl enable --now $UNIT"
fi

echo "[cheetah] done."
