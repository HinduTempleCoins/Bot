# autovote — MELEK testnet Hive.Vote clone

Auto-voting / curation platform for the MELEK testnet, served at
**https://auto.alpha.melek.salon**. Same feature set as Hive.Vote:

- **Curation trails** — follow another account's upvotes at a weight %, with delay + daily cap.
- **Fanbase** — auto-vote specific authors' new top-level posts (weight, delay, max/day).
- **Scheduled votes** — vote a specific `@author/permlink` at a chosen time.
- **Vote history** — per-user log with tx ids / errors.
- **Pause/resume + delete** — per rule.

## Run locally

```bash
npm run autovote          # serves on 127.0.0.1:8120 against alpha.melek.salon/rpc
npm test                  # includes autovote/*.test.js (rule matching + engine, chain mocked)
```

Open the page, log in with a **throwaway testnet** username + posting WIF. The key
is validated against the account on-chain, then stored server-side so the engine
can vote on your rules. **Testnet only — never a mainnet key.**

## Architecture

| File | Role |
|---|---|
| `config.js` | Chain + HTTP config (testnet defaults: chain id `18dcf0…`, prefix `TST`). |
| `store.js` | JSON-file persistence (users, trails, fanbases, schedules, vote log). |
| `rules.js` | **Pure** rule-matching + scheduling logic (unit-tested). |
| `chain.js` | dhive wrapper: stream blocks, validate keys, broadcast votes. |
| `vote-engine.js` | Worker loop: stream → match → dedupe → rate-limit → cap → broadcast. |
| `server.js` | HTTP: login, dashboard, rule CRUD, history API. |
| `views.js` | Server-rendered login + dashboard HTML. |

The engine respects a per-account ~3.3s vote interval, dedupes against the vote
log (never votes the same post twice), and enforces per-rule daily caps.

## OAuth / MELEK-Signer seam (deferred — production)

The **only** place a key is used to broadcast is `VoteEngine.signAndBroadcast()`
in `vote-engine.js`. Today it reads the user's stored WIF and signs locally
(testnet shortcut). In production, that method becomes a call to MELEK-Signer with
a scoped, revocable vote-only bearer token obtained via OAuth — replacing the
username+WIF login in `server.js`. Everything else (matching, dedupe, rate-limit,
caps, scheduling, history) is unchanged. See `../MELEK_SIGNER.md`.

## Deploy

Runs as a systemd unit (`node autovote/server.js`, `PORT=8120`) behind Caddy,
which reverse-proxies `auto.alpha.melek.salon` to the local port. The JSON store
is kept outside the repo (via `AUTOVOTE_DB`) so git pulls don't clobber it. Unit
file + deploy steps live in `.local/autovote-deploy/` (private).
