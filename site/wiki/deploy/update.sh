#!/usr/bin/env bash
# update.sh — pull the latest Library of Ashurbanipal code + articles onto the host and restart
# just that service. Touches ONLY the wiki's own paths and the four figure generators it imports,
# so the other services running off this repo are never affected. Idempotent; safe to re-run.
#
#   sudo bash site/wiki/deploy/update.sh [branch]      # default branch: main
#
# Run ON the host, from the repo checkout that melek-wiki.service uses as its WorkingDirectory.
# The service reads articles from THREE sources, first match wins per slug:
#   $ARTICLES_DIR (the bot's generated articles)  →  site/wiki/articles  →  site/wiki/seed-articles
# so this script only ever adds to what is served; it never removes a generated article.

set -euo pipefail
REPO="${REPO:-/opt/melek-bot/repo}"
BRANCH="${1:-main}"
cd "$REPO"

echo "→ fetching $BRANCH"
git fetch origin "$BRANCH"

before=$(ls site/wiki/seed-articles/*.wiki site/wiki/articles/*.wiki 2>/dev/null | wc -l)
echo "→ before: $before article files in the repo"

echo "→ updating the wiki paths and the figure generators it imports"
# KEEP IN SYNC with what site/wiki/*.mjs imports from ../../integrations. If a new wiki figure
# imports a new integration module and it is not listed here, the service will start, fail with
# ERR_MODULE_NOT_FOUND and be left dead — which is exactly what happened on 2026-10-20 when
# herb-atlas.mjs / herb-charts.mjs landed. To re-derive the list:
#   grep -rhoE "from '\.\./\.\./[^']+'" site/wiki/*.mjs | sed "s/from '//;s/'//" | sort -u
git checkout "origin/$BRANCH" -- \
  site/wiki \
  integrations/plant-deficiency-chart.mjs \
  integrations/aroma-wheel.mjs \
  integrations/chain-compare.mjs \
  integrations/token-specs.mjs \
  integrations/herb-atlas.mjs \
  integrations/herb-charts.mjs \
  integrations/soapbox/crawlers.mjs

after=$(ls site/wiki/seed-articles/*.wiki site/wiki/articles/*.wiki 2>/dev/null | wc -l)
echo "→ after:  $after article files in the repo"
if [ "$after" -lt "$before" ]; then
  echo "✗ REFUSING: the article count went DOWN ($before → $after). Nothing is removed from the live" >&2
  echo "  library. Investigate before restarting; the service is still running the old code." >&2
  exit 1
fi

echo "→ syntax-checking"
for f in site/wiki/server.mjs site/wiki/render.mjs site/wiki/figures.mjs \
         site/wiki/categories.mjs site/wiki/safety-notices.mjs site/wiki/geo.mjs; do
  node --check "$f"
done

echo "→ restarting melek-wiki.service"
systemctl restart melek-wiki.service
sleep 2

echo "→ health check"
PORT="$(systemctl show melek-wiki.service -p Environment --value | tr ' ' '\n' | sed -n 's/^PORT=//p')"
PORT="${PORT:-8091}"
if ! curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
  echo "✗ the wiki is NOT serving on :${PORT} after the restart. Last 20 log lines:" >&2
  journalctl -u melek-wiki.service -n 20 --no-pager >&2 || true
  echo "  A common cause is a NEW integrations/ module imported by site/wiki/figures.mjs that is" >&2
  echo "  not in the git-checkout list above (ERR_MODULE_NOT_FOUND). Add it and re-run." >&2
  exit 1
fi
echo "  ✓ wiki healthy on :${PORT}"
n=$(curl -fsS "http://127.0.0.1:${PORT}/" | grep -o '[0-9]\+ articles' | head -1)
echo "  live index reports: ${n:-unknown}"
echo "done."
