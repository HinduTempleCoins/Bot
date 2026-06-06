---
name: pool-deploy
description: Deploy or verify the MELEK mining-pool frontend (pool/www → the pool box). Use when changing pool browser-mining / wallet / My Coins files or pushing them live, or verifying the live pool. The rsync REQUIRES explicit operator approval; the box hostname stays in .local/.
---

# Pool deploy + verify

`pool/www/` is the canonical source for the pool frontend. The live box serves a copy under `/opt/melek-pool/www`.

## Hard rules
- **The rsync needs explicit operator approval each time.** Do not deploy on your own initiative — propose it and wait for a host-named "yes".
- **The box hostname/IP lives in `.local/` only.** Never write it into a committed file, a commit message, or this skill. Read the target from the `.local/` deploy note (e.g. `pool/deploy/` runbook + `.local/`).
- User wallet private keys are generated client-side in the browser and never touch the server. Don't add server-side key handling.

## Deploy (after approval)
1. Confirm tests green: `node --test pool/www/`.
2. rsync `pool/www/` → the box's `/opt/melek-pool/www` (target host from `.local/`). Use `--delete` only if intentionally pruning.

## Live-verify (safe, no approval needed)
- `curl -fsS https://<pool-domain>/` and the changed files (e.g. `/wizard.mjs`, `/browser-mine.mjs`) — confirm served bytes match the new code.
- Probe the WSS bridge: connect to the `/ws` endpoint and confirm it accepts.
- Stagenet-twin check: the RandomX/Monero side runs Monero **stagenet**. `poolLoginAddress()` (`pool/www/wizard.mjs`) converts a user's mainnet address to its stagenet twin at the pool boundary. After any wizard/login change, verify a known mainnet XMR address (`4…`) maps to the expected stagenet twin (`5…`/`7…`) and that a real stagenet address passes through unchanged.
