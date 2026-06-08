#!/usr/bin/env bash
# install.sh — idempotent installer for the Hathor PUBLIC Telegram bot
# (integrations/soapbox/telegram-public.mjs) as a long-poll systemd daemon.
#
# Runs ON the box, operator-present (this repo never SSHes anywhere). Safe to re-run.
# The bot holds NO chain keys; the only secret is the Telegram bot token (alert/chat cred),
# set by the operator in the private env file — never committed.
#
# DESIGNED TO INSTALL BEFORE THE TOKEN EXISTS: with TELEGRAM_PUBLIC_BOT_TOKEN empty, the
# service runs idle (logs "...public bot idle.", exits 0) and is NOT restarted. Add the
# token to the env file and `systemctl restart` to go live.
#
# Usage (from the checked-out Bot repo root on the box):
#   sudo INSTALL_DIR=/path/to/bot/repo \
#        ENV_FILE=/path/to/private/telegram-public.env \
#        LOG_FILE=/var/log/melek-telegram-public.log \
#        NODE_BIN=/usr/bin/node \
#        bash deploy/telegram-public/install.sh [--enable] [--smoke]
#
#   --enable   systemctl enable --now the service after installing it
#   --smoke    run the bot once in the foreground for ~2s to prove the idle/live path, then stop
#
# (Substitute your real paths. The defaults below are generic placeholders.)

set -euo pipefail

# Generic placeholder defaults — the operator overrides these on the box.
INSTALL_DIR="${INSTALL_DIR:-/srv/bot/repo}"
ENV_FILE="${ENV_FILE:-/srv/bot/telegram-public.env}"
LOG_FILE="${LOG_FILE:-/var/log/melek-telegram-public.log}"
NODE_BIN="${NODE_BIN:-$(command -v node || echo /usr/bin/node)}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE="melek-telegram-public.service"

ENABLE=0; SMOKE=0
for a in "$@"; do
  case "$a" in
    --enable) ENABLE=1 ;;
    --smoke)  SMOKE=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[tg-public] install dir : $INSTALL_DIR"
echo "[tg-public] env file    : $ENV_FILE"
echo "[tg-public] log file    : $LOG_FILE"
echo "[tg-public] node bin    : $NODE_BIN"

[ -x "$NODE_BIN" ] || { echo "[tg-public] ERROR: node not executable at $NODE_BIN" >&2; exit 1; }

# 1) log dir (idempotent).
mkdir -p "$(dirname "$LOG_FILE")"

# 2) env file — install from the example only if absent (never clobber operator edits / a live token).
if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$BUNDLE/telegram-public.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE" || true
  echo "[tg-public] wrote $ENV_FILE from example. It has an EMPTY token (bot will idle)."
  echo "[tg-public] To go live: put the @BotFather token in TELEGRAM_PUBLIC_BOT_TOKEN, then restart."
else
  echo "[tg-public] $ENV_FILE already exists — left untouched."
fi

# 3) systemd unit — substitute placeholders, install idempotently.
mkdir -p "$SYSTEMD_DIR"
sed -e "s|__INSTALL_DIR__|${INSTALL_DIR}|g" \
    -e "s|__ENV_FILE__|${ENV_FILE}|g" \
    -e "s|__LOG_FILE__|${LOG_FILE}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN}|g" \
    "$BUNDLE/$SERVICE" > "$SYSTEMD_DIR/$SERVICE"
echo "[tg-public] installed $SYSTEMD_DIR/$SERVICE"
systemctl daemon-reload

# 4) optional smoke test — start the bot in the foreground briefly to prove the path.
# With no token it prints the idle line and exits 0 immediately; with a token it logs "live: @<bot>".
if [ "$SMOKE" = 1 ]; then
  echo "[tg-public] smoke: starting once in foreground (~2s) ..."
  ( cd "$INSTALL_DIR" && set -a && . "$ENV_FILE" && set +a && timeout 2s "$NODE_BIN" integrations/soapbox/telegram-public.mjs || true )
  echo "[tg-public] smoke done (idle exit-0 with no token is EXPECTED and correct)."
fi

# 5) optional enable — safe to enable even with an empty token (the service idles).
if [ "$ENABLE" = 1 ]; then
  systemctl enable --now "$SERVICE"
  echo "[tg-public] service enabled:"; systemctl status "$SERVICE" --no-pager || true
else
  echo "[tg-public] unit installed but NOT enabled. Enable with:"
  echo "          sudo systemctl enable --now $SERVICE"
fi

echo "[tg-public] done."
