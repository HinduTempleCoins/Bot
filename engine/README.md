# MELEK-Engine

A Hive-Engine-style **layer-2 token sidechain** for the MELEK (Graphene) chain.
Token creation + offerings, **no DEX** — but DEX-ready: the future PRANA DEX
plugs in via two gated seams the way TribalDEX sits beside Hive-Engine.

- **Live testnet UI:** https://engine.alpha.melek.salon
- **Security posture:** [`SECURITY.md`](./SECURITY.md) (read with
  `.local/MELEK_ENGINE_SECURITY_STUDY_2026-06-05.md`)

## How it works

A read-only node streams blocks from the MELEK L1 RPC, filters `custom_json`
ops with id `mse-testnet-melek`, executes the built-in `tokens` contract
deterministically, and maintains state (tokens, balances, issuance log) in a
single JSON file. Same L1 history → same state → same SHA-256 state hash
(published at `/status`). The node **holds no key and never broadcasts**.

```
MELEK L1 ──custom_json(id=mse-…)──▶ streamer ──▶ Engine (deterministic) ──▶ State (+hash)
                                                                              │
                                                              read-only API + UI (no keys)
```

## Genesis tokens (the BEE/WORKERBEE equivalents)

| Symbol  | Role (HE analogue) | Supply | Cap |
|---------|--------------------|--------|-----|
| **APIS**  | fee/utility token (BEE) — burned to create tokens & pay resource fees; powers the engine's APIs | soft, lottery-emitted | ceiling = `MAX_SAFE_INTEGER` |
| **DRONE** | miner/governance token (WORKERBEE) — staked for mining odds + witness weight | 1,000,000 | **immutable** |

Naming: MELEK's mythos is angelic/temple, so the tokens are the temple-economy
bees — *Apis* (the sacred bee; also "APIs") and *Drone* (continuity/governance).

## Contracts & actions

- `tokens.create` — register a token (burns APIS; symbol 1–10 uppercase A–Z, precision 0–8, optional **immutable** supply cap)
- `tokens.issue` — mint to an account (**issuer-only**, respects cap, logged)
- `tokens.transfer` — send tokens
- `tokens.stake` / `tokens.unstake` — governance/mining stake bucket
- `rewards.setReward` / `rewards.disableReward` — **Scotbot equivalent**: an issuer configures a token's social-reward pool as a **config object** (emission/window, author/curator split, reward curve), never user JS (**issuer-only**)
- `rewards.vote` — record a **token-stake-weighted** vote on a post (the streamer turns each L1 `vote` into one); lazy-registers the post + reward window
- `rewards.payout` — deterministic crank: emit `emissionPerWindow` for every matured post, split author/curator pro-rata, **cap-respecting**, idempotent
- `gateway.deposit` / `gateway.withdraw` — **DEX seam 1** (pegged assets), gated off
- `dexSettlement.settle` — **DEX seam 2** (signed-fill settlement), gated off

## The platform offering (make-your-own token tribe)

Two pieces turn a created token into a full **tribe**, mirroring Hive-Engine:

- **`contracts/rewards.mjs` (Scotbot equivalent)** — config-driven social-reward
  emission. Posts on the MELEK L1 accrue stake-weighted votes; on a fixed block
  window the reward pool emits the issuer's token, split author/curator by a
  reward curve (`linear` / `quadratic` / `sqrt`). All BigInt, deterministic,
  replayable, cap-respecting. **No user JS** — the behaviour is a reward-rule
  object, so the sandbox-escape class is avoided by construction.
- **`nitrous/render.mjs` (Nitrous equivalent)** — a per-token front-end
  **generator**. `renderTokenSite(state, SYMBOL, theme)` returns a branded,
  read-only page (supply/holders/posts/rewards/leaderboard) for any token;
  `makeNitrousHandler(state, themeFor)` serves `/` (index) + `/:SYMBOL`. A
  factory, not one hardcoded page; reuses the engine read API; `esc()` on all
  interpolation.

**PRANA hooks (noted, not built):** see the TODO block in `contracts/seams.mjs`
— reward emission can route a slice to a PRANA liquidity pool, and nitrous gains
a Trade tab, once `dexSettlement` / `gateway` flip on with `PRANA_RPC_URL`.

## API (Hive-Engine-shaped)

| Endpoint | Returns |
|---|---|
| `GET /status` | sidechain id, last block, **state hash**, token count, seam flags |
| `GET /contracts/tokens[?symbol=APIS]` | token(s) |
| `GET /contracts/balances?account=x[&symbol=APIS]` | balances |
| `GET /contracts/holders?symbol=APIS` | holders |
| `GET /contracts/issuance?symbol=APIS` | append-only issuance log |
| `GET /contracts/history?account=x` | processed ops |
| `POST /rpc/contracts` | JSON-RPC `find` (`{params:{contract,table,query}}`) |

## Run

```bash
npm run engine            # stream L1 + serve API/UI
npm run engine:once       # one catch-up pass, no loop
npm run engine:serve      # API/UI only
npm test                  # includes engine/test/*.test.mjs
```

Config via env (see `config.mjs`): `MELEK_ENGINE_RPC`, `MELEK_ENGINE_ID`,
`MELEK_CHAIN_ID`, `MELEK_ENGINE_ISSUER`, `MELEK_ENGINE_PORT`, `MELEK_ENGINE_STATE`.

## Build / broadcast a token (keys stay in your browser)

The UI's "create / issue / transfer" page assembles the exact `custom_json` and
signs+broadcasts it **client-side** via dhive — the private key never reaches
the server. Or copy the JSON into your own wallet.
