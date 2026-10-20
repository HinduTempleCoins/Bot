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

echo "→ updating the wiki paths"
git checkout "origin/$BRANCH" -- site/wiki

# The wiki's figure generators live in integrations/ and are imported by site/wiki/*.mjs. A hand-kept
# list of them went stale twice — herb-atlas.mjs / herb-charts.mjs on 2026-10-20, and mlk-wheel.mjs
# right behind it — and each time the service started, failed ERR_MODULE_NOT_FOUND and was left dead.
# So the list is no longer kept by hand: it is read out of the import statements themselves, from the
# branch being deployed, and anything a wiki module imports comes with it.
echo "→ deriving the integration modules the wiki imports"
mapfile -t IMPORTS < <(
  git grep -hoE "from '\.\./\.\./[A-Za-z0-9_./-]+'" "origin/$BRANCH" -- 'site/wiki/*.mjs' \
    | sed "s|from '\.\./\.\./||;s|'$||" | sort -u
)
if [ "${#IMPORTS[@]}" -eq 0 ]; then
  echo "✗ REFUSING: derived no integration imports at all — the grep is wrong, not the repo." >&2
  echo "  The service is untouched and still running the old code." >&2
  exit 1
fi
printf '   %s\n' "${IMPORTS[@]}"
git checkout "origin/$BRANCH" -- "${IMPORTS[@]}"

# and fail loudly here rather than at service start if one of them still will not resolve
for m in "${IMPORTS[@]}"; do
  [ -f "$m" ] || { echo "✗ REFUSING: $m is imported by the wiki but missing after checkout" >&2; exit 1; }
done

# Data some of those modules READ at runtime rather than import. herb-charts.mjs loads the atlas
# JSON with existsSync + a null fallback, so a missing directory does not kill the service — it just
# serves empty charts, silently, which is worse. Imports cannot be derived from a readFileSync path,
# so these stay listed by hand; keep them in step with the DATA constants in integrations/.
echo "→ updating the datasets those modules read at runtime"
git checkout "origin/$BRANCH" -- knowledge/herb-atlas

after=$(ls site/wiki/seed-articles/*.wiki site/wiki/articles/*.wiki 2>/dev/null | wc -l)
echo "→ after:  $after article files in the repo"
if [ "$after" -lt "$before" ]; then
  echo "✗ REFUSING: the article count went DOWN ($before → $after). Nothing is removed from the live" >&2
  echo "  library. Investigate before restarting; the service is still running the old code." >&2
  exit 1
fi

echo "→ syntax-checking"
for f in site/wiki/server.mjs site/wiki/render.mjs site/wiki/figures.mjs \
         site/wiki/categories.mjs site/wiki/safety-notices.mjs site/wiki/geo.mjs \
         "${IMPORTS[@]}"; do
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
