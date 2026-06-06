#!/usr/bin/env bash
# install.sh — idempotent installer for the MELEK decades-brain brief/annal pipeline.
#
# Runs ON Server A, operator-present (this repo never SSHes anywhere). Safe to re-run.
# 1-core-box-safe: by default it does NO npm install (the pipeline's word-bag path is
# pure-JS, zero deps). Pass --with-embedder to install the optional MiniLM stack.
#
# Usage (from the checked-out Bot repo root on Server A):
#   sudo INSTALL_DIR=/path/to/bot/repo \
#        ENV_FILE=/path/to/private/decades.env \
#        DATA_DIR=/path/to/data \
#        LOG_DIR=/var/log \
#        bash deploy/decades/install.sh [--with-embedder] [--enable] [--smoke]
#
# (Substitute your real Server A paths. The defaults below are generic placeholders.)
#
#   --with-embedder  npm-install @huggingface/transformers + natural (8GB box; NOT the 1-core box)
#   --enable         systemctl enable --now the timer after installing units
#   --smoke          run one pipeline pass immediately and print the summary
#
# Classical-only (default, 1-core Server A): omit --with-embedder. The pipeline routes via
# Naive Bayes / TF-IDF and dedups via word-bag cosine — no npm, no GPU, no model download.

set -euo pipefail

# Generic placeholder defaults — the operator overrides all three on Server A.
INSTALL_DIR="${INSTALL_DIR:-/srv/bot/repo}"
ENV_FILE="${ENV_FILE:-/srv/bot/decades.env}"
DATA_DIR="${DATA_DIR:-/srv/bot/data}"
LOG_DIR="${LOG_DIR:-/var/log}"
LOG_FILE="${LOG_FILE:-${LOG_DIR}/melek-decades-pipeline.log}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

WITH_EMBEDDER=0; ENABLE=0; SMOKE=0
for a in "$@"; do
  case "$a" in
    --with-embedder) WITH_EMBEDDER=1 ;;
    --enable)        ENABLE=1 ;;
    --smoke)         SMOKE=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[decades] install dir   : $INSTALL_DIR"
echo "[decades] env file      : $ENV_FILE"
echo "[decades] data dir      : $DATA_DIR"
echo "[decades] log file      : $LOG_FILE"
echo "[decades] embedder      : $([ "$WITH_EMBEDDER" = 1 ] && echo 'MiniLM (npm)' || echo 'classical word-bag (no npm)')"

command -v node >/dev/null 2>&1 || { echo "[decades] ERROR: node not found in PATH" >&2; exit 1; }

# 0) deps — classical-only by default (no-op). --with-embedder installs the dense stack.
if [ "$WITH_EMBEDDER" = 1 ]; then
  echo "[decades] installing embedder deps (@huggingface/transformers natural) in $INSTALL_DIR ..."
  ( cd "$INSTALL_DIR" && npm install --no-audit --no-fund @huggingface/transformers natural )
else
  echo "[decades] classical-only mode: skipping npm (zero-dependency word-bag path)."
fi

# 1) data dirs (idempotent)
mkdir -p "$DATA_DIR/brief-queue" "$DATA_DIR/decades/results"
[ -f "$DATA_DIR/decades/store.json" ]  || echo '[]' > "$DATA_DIR/decades/store.json"
[ -f "$DATA_DIR/decades/routes.json" ] || echo '[]' > "$DATA_DIR/decades/routes.json"

# 2) env file — install from the example only if absent (never clobber operator edits)
if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  sed -e "s|__DATA_DIR__|${DATA_DIR}|g" "$BUNDLE/decades.env.example" > "$ENV_FILE"
  echo "[decades] wrote $ENV_FILE from example (substituted DATA_DIR). REVIEW IT before --enable."
else
  echo "[decades] $ENV_FILE already exists — left untouched."
fi

# 3) systemd unit + timer — substitute placeholders, install idempotently
install_unit() {
  local name="$1"
  sed -e "s|__INSTALL_DIR__|${INSTALL_DIR}|g" \
      -e "s|__ENV_FILE__|${ENV_FILE}|g" \
      -e "s|__DATA_DIR__|${DATA_DIR}|g" \
      -e "s|__LOG_DIR__|${LOG_DIR}|g" \
      -e "s|__LOG_FILE__|${LOG_FILE}|g" \
      "$BUNDLE/$name" > "$SYSTEMD_DIR/$name"
  echo "[decades] installed $SYSTEMD_DIR/$name"
}
install_unit melek-decades-pipeline.service
install_unit melek-decades-pipeline.timer
systemctl daemon-reload

# 4) optional smoke test — one pass, prints the summary line
if [ "$SMOKE" = 1 ]; then
  echo "[decades] smoke: running one pipeline pass ..."
  ( cd "$INSTALL_DIR" && set -a && . "$ENV_FILE" && set +a && node deploy/decades/run-pipeline.mjs )
fi

# 5) optional enable
if [ "$ENABLE" = 1 ]; then
  systemctl enable --now melek-decades-pipeline.timer
  echo "[decades] timer enabled:"; systemctl list-timers melek-decades-pipeline.timer --no-pager || true
else
  echo "[decades] units installed but NOT enabled. Enable with:"
  echo "          sudo systemctl enable --now melek-decades-pipeline.timer"
fi

echo "[decades] done."
