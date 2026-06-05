# autovote — chain-agnostic Hive.Vote clone

Auto-voting / curation platform served at **https://auto.alpha.melek.salon**.
Same feature set as Hive.Vote, but **chain-agnostic** and **keyless-by-signer**:

- **Multi-chain** — MELEK testnet (default) plus HIVE / STEEM / BLURT (public RPCs).
  A user picks their chain at login; rules / trails / fanbases / history are scoped
  per `(chain, account)`.
- **Signer front-ends (keyless)** — on chains where they work:
  - **HiveSigner** (Hive) — OAuth2 with the `vote` scope returns a **revocable bearer
    token** the server uses to vote, even while the user is offline. Best for scheduled votes.
  - **WhaleVault** (Hive/Steem/Blurt) — browser-extension signing. Signs **only while the
    user's tab is open**, so WhaleVault users get **in-browser mode** (we never hold a key,
    never silently fall back to asking for one).
- **Posting-key login** — least-preferred, clearly marked. Stores a WIF server-side;
  **throwaway/testnet only**. MELEK's default until MELEK-Signer ships.
- **Teaching layer** — `/teach` guides: install WhaleVault, authorize HiveSigner,
  create/import an account, connect, then build bots/trails/fanbases — so users never need
  the real hive.vote and never trust us with keys.
- **Awareness page** — `/about`: the other Graphene forums (Steem/Hive/Blurt) exist; ours is
  MELEK; MELEK-Signer is coming.

## Features

- **Curation trails** — follow another account's upvotes at a weight %, with delay + daily cap.
- **Fanbase** — auto-vote specific authors' new top-level posts (weight, delay, max/day).
- **Scheduled votes** — vote a specific `@author/permlink` at a chosen time.
- **Vote history** — per-(chain,user) log with tx ids / errors.
- **Pause/resume + delete** — per rule.

## Run locally

```bash
npm run autovote          # serves on 127.0.0.1:8120
node --test autovote/*.test.js   # rule matching + engine + chain config + migration (chains mocked)
```

## Architecture

| File | Role |
|---|---|
| `chains.js` | **Chain registry** — per-chain RPC list, chain id, prefix, auth methods. `melek-testnet` is the only testnet. |
| `config.js` | HTTP + storage + engine cadence + default chain + `blockMainnetBroadcast` safety flag. |
| `store.js` | JSON persistence, scoped per chain. Additive migration from the single-chain schema. |
| `rules.js` | **Pure** rule-matching + scheduling (unit-tested). |
| `chain.js` | Per-chain dhive wrapper: stream blocks, validate keys, broadcast votes (RPC failover). |
| `hivesigner.js` | HiveSigner OAuth2 helper (login URL, code→token, broadcast, revoke). Behind config. |
| `vote-engine.js` | Worker loop: per-chain streaming → match → dedupe → rate-limit → cap → broadcast, routed per auth method. |
| `server.js` | HTTP: login (chain + auth method), OAuth callback, dashboard, teaching/awareness pages, rule CRUD. |
| `views.js` | Server-rendered login + dashboard + teaching + awareness HTML. |

## Safety — mainnet

Voting on HIVE/STEEM/BLURT broadcasts **real mainnet ops**. By default
`config.blockMainnetBroadcast` is **ON**: the engine **refuses** to broadcast any vote on a
mainnet chain (votes are recorded as failures, never sent). Multi-chain logic is exercised
against the MELEK testnet + mocks. Mainnet ships **present-but-unverified-live (beta)**. Flip
`AUTOVOTE_ALLOW_MAINNET=1` only with operator sign-off. We never touch operator mainnet keys.

## Signer seam (MELEK-Signer)

`VoteEngine.signAndBroadcast()` in `vote-engine.js` is the single place a credential becomes a
chain op. It routes per auth method (`postingkey` → local WIF, `hivesigner` → bearer token,
`whalevault` → in-browser only). For MELEK, the `postingkey` branch is replaced by a call to
**MELEK-Signer** with a scoped revocable token later — same keyless model as HiveSigner.
See `../MELEK_SIGNER.md`.

## HiveSigner app registration (operator-gated)

HiveSigner needs an app registered on hivesigner.com before the OAuth flow works. Until then,
the UI shows a "pending app registration" state instead of a broken button. Steps + env vars
are in `.local/AUTOVOTE_SIGNERS_SETUP.md`.

## Deploy

Runs as `melek-autovote.service` (systemd, `node autovote/server.js`, `PORT=8120`) behind Caddy,
which reverse-proxies `auto.alpha.melek.salon`. The JSON store is kept outside the repo (via the
`AUTOVOTE_DB` env var) so git updates don't clobber it; the store auto-migrates on first load of
the new schema. Unit file + host paths in `.local/autovote-deploy/`.
