#!/usr/bin/env bash
# install.sh — idempotent installer for the Van Kush Family Discord bot (index.js) as a
# systemd service on ANY Linux server (Azure VM, Google Compute, a plain VPS — the bot is
# standalone, it does not need to be the chain host). Runs ON the box, operator-present
# (this repo never SSHes anywhere). Safe to re-run.
#
# The bot holds NO chain WIF. Secrets are the Discord token + AI keys (set in the env file)
# and, for the /tip command, a shared secret pointing at the chain host's signer endpoint.
#
# Usage (from the checked-out Bot repo root on the server):
#   sudo INSTALL_DIR=/opt/melek-bot/repo \
#        ENV_FILE=/srv/bot/discord.env \
#        LOG_FILE=/var/log/melek-discord.log \
#        NODE_BIN=$(command -v node) \
#        bash deploy/discord/install.sh [--enable]
#
#   --enable   systemctl enable --now the service after installing it
#
# Before --enable, fill ENV_FILE: at minimum DISCORD_TOKEN + GEMINI_API_KEY (copy the values
# from .local/railway-bot.env). Without DISCORD_TOKEN the bot cannot log in and the unit will
# crash-restart (capped) — so set the token first.

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/melek-bot/repo}"
ENV_FILE="${ENV_FILE:-/srv/bot/discord.env}"
LOG_FILE="${LOG_FILE:-/var/log/melek-discord.log}"
NODE_BIN="${NODE_BIN:-$(command -v node || echo /usr/bin/node)}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE="melek-discord.service"

ENABLE=0
for a in "$@"; do
  case "$a" in
    --enable) ENABLE=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[discord] install dir : $INSTALL_DIR"
echo "[discord] env file    : $ENV_FILE"
echo "[discord] log file    : $LOG_FILE"
echo "[discord] node bin    : $NODE_BIN"

[ -x "$NODE_BIN" ] || { echo "[discord] ERROR: node not executable at $NODE_BIN" >&2; exit 1; }
[ -f "$INSTALL_DIR/index.js" ] || { echo "[discord] ERROR: no index.js at $INSTALL_DIR (is INSTALL_DIR the repo root?)" >&2; exit 1; }

# 1) log dir + state dir (the bot writes user-relationships.json + the tip ledger under INSTALL_DIR/data).
mkdir -p "$(dirname "$LOG_FILE")" "$INSTALL_DIR/data"

# 2) env file — install from the example only if absent (never clobber operator edits / a live token).
if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$BUNDLE/discord.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE" || true
  echo "[discord] wrote $ENV_FILE from example. FILL IN DISCORD_TOKEN + GEMINI_API_KEY before --enable."
else
  echo "[discord] $ENV_FILE already exists — left untouched."
fi

# 3) systemd unit — substitute placeholders, install idempotently.
mkdir -p "$SYSTEMD_DIR"
sed -e "s|__INSTALL_DIR__|${INSTALL_DIR}|g" \
    -e "s|__ENV_FILE__|${ENV_FILE}|g" \
    -e "s|__LOG_FILE__|${LOG_FILE}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN}|g" \
    "$BUNDLE/$SERVICE" > "$SYSTEMD_DIR/$SERVICE"
echo "[discord] installed $SYSTEMD_DIR/$SERVICE"
systemctl daemon-reload

# 4) optional enable.
if [ "$ENABLE" = 1 ]; then
  systemctl enable --now "$SERVICE"
  echo "[discord] service enabled:"; systemctl status "$SERVICE" --no-pager || true
else
  echo "[discord] unit installed but NOT enabled. After filling the env file, enable with:"
  echo "          sudo systemctl enable --now $SERVICE"
fi

echo "[discord] done."
