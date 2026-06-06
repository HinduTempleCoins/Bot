#!/usr/bin/env bash
# smoke-test.sh — verify a self-hosted n8n deploy is alive and correctly fronted (queue #109).
#
# Run ON THE BOX after `docker compose up -d`. Read-only; makes no changes.
#   ./smoke-test.sh                 # checks local container health + loopback liveness
#   ./smoke-test.sh n8n.example.tld # also checks the public Caddy front door over TLS
#
# Exit 0 = all checks passed. Non-zero = a check failed (message printed).

set -uo pipefail

CONTAINER="${N8N_CONTAINER:-melek-n8n}"
LOCAL_URL="http://127.0.0.1:5678/healthz"
DOMAIN="${1:-}"
fail=0

say()  { printf '%s\n' "$*"; }
ok()   { printf '  OK   %s\n' "$*"; }
bad()  { printf '  FAIL %s\n' "$*"; fail=1; }

say "== n8n smoke test =="

# 1) Container is running.
if command -v docker >/dev/null 2>&1; then
	state=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "absent")
	if [ "$state" = "running" ]; then ok "container '$CONTAINER' is running"; else bad "container '$CONTAINER' state: $state"; fi

	# 2) Compose healthcheck (if reported).
	health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo "none")
	case "$health" in
		healthy) ok "healthcheck: healthy" ;;
		none)    say "  --   healthcheck: not reported yet (give it ~30s start_period)" ;;
		*)       bad "healthcheck: $health" ;;
	esac
else
	say "  --   docker CLI not found; skipping container checks"
fi

# 3) Loopback liveness — the canonical post-deploy curl.
code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 "$LOCAL_URL" 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then ok "loopback $LOCAL_URL -> 200"; else bad "loopback $LOCAL_URL -> $code (expected 200)"; fi

# 4) Public front door (TLS via Caddy), only if a domain was given.
if [ -n "$DOMAIN" ]; then
	# /healthz is unauthenticated; the editor (/) is behind basic auth -> 401 is the healthy answer.
	pub=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/healthz" 2>/dev/null || echo "000")
	if [ "$pub" = "200" ]; then ok "public https://$DOMAIN/healthz -> 200 (TLS + proxy good)"; else bad "public https://$DOMAIN/healthz -> $pub"; fi

	auth=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/" 2>/dev/null || echo "000")
	if [ "$auth" = "401" ]; then ok "editor https://$DOMAIN/ -> 401 (basic auth gate active)"; else say "  --   editor https://$DOMAIN/ -> $auth (expect 401 if basic auth is on, 200 after login cookie)"; fi
else
	say "  --   no domain arg; skipping public TLS check (pass it as \$1 to enable)"
fi

say "===================="
if [ "$fail" -eq 0 ]; then say "RESULT: PASS"; else say "RESULT: FAIL"; fi
exit "$fail"
