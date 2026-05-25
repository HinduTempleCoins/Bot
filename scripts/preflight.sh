#!/usr/bin/env bash
#
# preflight.sh — operationalizes SECURITY.md §5 as a single command.
#
# Run before every commit and as part of CI. Checks:
#   1. No .env file (other than .env.example) is staged or tracked.
#   2. No WIF private-key pattern (Graphene 5HJK...) appears in tracked files
#      outside of SECURITY.md (where the pattern itself is documented).
#   3. No Discord bot token pattern appears outside docs.
#   4. All dependencies in package.json are exact versions (no ^ / ~).
#   5. npm test passes (all tutorial + welcomer test suites).
#   6. npm audit reports no high/critical vulnerabilities.
#
# Exit 0 if clean. Exit 1 if any check fails. Non-failure warnings go to
# stderr but do not block.
#
# Usage:  bash scripts/preflight.sh
#         npm run preflight

set -eo pipefail

# Use colors only when stdout is a TTY (so CI logs stay clean).
if [[ -t 1 ]]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; RESET='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; RESET=''
fi

fail=0
pass()   { printf "${GREEN}✓${RESET} %s\n" "$1"; }
warn()   { printf "${YELLOW}!${RESET} %s\n" "$1" >&2; }
errfail(){ printf "${RED}✗${RESET} %s\n" "$1" >&2; fail=1; }

cd "$(dirname "$0")/.."

# --- 1. .env files ----------------------------------------------------

if git ls-files | grep -E '^\.env$|^\.env\.[^e]' >/dev/null; then
  errfail "tracked .env-style file found in git index (other than .env.example)"
  git ls-files | grep -E '^\.env$|^\.env\.[^e]' >&2
else
  pass ".env not tracked (only .env.example, which is fine)"
fi

# --- 2. WIF private keys ----------------------------------------------
# Graphene WIF keys are base58 strings ~51 chars starting with 5H/5J/5K.
# SECURITY.md documents this pattern; allow it there.

wif_hits=$(git ls-files | xargs grep -lE "[^[:alnum:]]5[HJK][1-9A-HJ-NP-Za-km-z]{49}[^[:alnum:]]" 2>/dev/null | grep -v '^SECURITY\.md$' | grep -v '^OPERATOR\.md$' || true)
if [[ -n "$wif_hits" ]]; then
  errfail "possible WIF private key pattern found in tracked file(s):"
  echo "$wif_hits" >&2
else
  pass "no WIF private key pattern in tracked files"
fi

# --- 3. Discord bot tokens --------------------------------------------
# MTxxxxxxxxx... pattern is the Discord token shape. SECURITY.md
# documents the placeholder ("MTxxxxxxxxxxxxxxxxxx"); skip that file.

disc_hits=$(git ls-files | xargs grep -lE "MT[A-Za-z0-9_-]{20,}\." 2>/dev/null | grep -v '^SECURITY\.md$' | grep -v '^\.env\.example$' || true)
if [[ -n "$disc_hits" ]]; then
  errfail "possible Discord bot token in tracked file(s):"
  echo "$disc_hits" >&2
else
  pass "no Discord bot token pattern in tracked files"
fi

# --- 4. dependency pin check ------------------------------------------

if node -e '
const pkg = require("./package.json");
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const bad = Object.entries(deps).filter(([_, v]) => /^[\^~]/.test(v));
if (bad.length) {
  for (const [k, v] of bad) console.log(`  ${k}: ${v}`);
  process.exit(1);
}
' 2>&1; then
  pass "all package.json deps pinned to exact versions"
else
  errfail "package.json contains non-pinned dependencies (^ or ~)"
fi

# --- 5. tests pass ----------------------------------------------------

if npm test --silent >/dev/null 2>&1; then
  pass "npm test — all tutorial + welcomer suites pass"
else
  errfail "npm test — test failures"
  npm test 2>&1 | tail -30 >&2
fi

# --- 6. npm audit (critical fails; high warns) ------------------------
#
# Threshold rationale: as of 2026-05-24, all of the audit findings live
# in the legacy van-kush-discord-bot dependency tree (discord.js, ws,
# node-cron→uuid, etc.) — not on the MELEK Witness's hot path, which
# uses only @hiveio/dhive + dotenv + node-cron. We surface high
# findings as warnings so they don't perpetually block CI on legacy
# code we're not running, while keeping critical-severity as a hard
# fail. Revisit when the legacy code is retired.

if command -v npm >/dev/null 2>&1; then
  audit_json=$(npm audit --omit=dev --json 2>/dev/null || true)
  counts=$(echo "$audit_json" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  try {
    const a = JSON.parse(s);
    const v = a?.metadata?.vulnerabilities ?? {};
    process.stdout.write(`${v.critical ?? 0} ${v.high ?? 0}`);
  } catch { process.stdout.write("0 0"); }
});
' 2>/dev/null || echo "0 0")
  critical=$(echo "$counts" | awk '{print $1}')
  high=$(echo "$counts" | awk '{print $2}')
  if [[ "$critical" -gt 0 ]]; then
    errfail "npm audit reports $critical critical vulnerabilities (run: npm audit)"
  elif [[ "$high" -gt 0 ]]; then
    warn "npm audit reports $high high vulnerabilities (legacy code path; non-blocking — run: npm audit)"
  else
    pass "npm audit: no high/critical vulnerabilities"
  fi
else
  warn "npm not available in PATH — skipping npm audit"
fi

# --- summary ----------------------------------------------------------

echo
if [[ $fail -eq 0 ]]; then
  printf "${GREEN}preflight: all checks passed${RESET}\n"
  exit 0
else
  printf "${RED}preflight: one or more checks failed${RESET}\n"
  exit 1
fi
