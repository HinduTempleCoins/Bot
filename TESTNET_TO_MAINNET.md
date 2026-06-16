# TESTNET → MAINNET rollout

How the MELEK token stack goes from the live testnet to mainnet. The governing
principle: **mainnet is the SAME CODE on new servers with a mainnet config.**
You stand up fresh hosts, set `NET=mainnet`, fill the mainnet addresses, and
deploy. Nothing in the contract/relayer/UI code changes.

The single switch is `NET` (`testnet` | `mainnet`, default `testnet`) in
`engine/config.mjs`. It selects a per-net PRESET (`NET_PRESETS`) that derives
every env-specific value. Each preset value is still individually overridable by
its own env var, so a staging box can mix-and-match — `NET` only sets defaults.

---

## THE wMELEK INVARIANT (why `allowTestnetFreeIssue` exists)

**wMELEK supply MUST always equal MELEK locked in the bridge.** wMELEK is minted
ONLY when MELEK crosses to the wrapped side (a bridge deposit) and burned ONLY
when it crosses back (a withdrawal). **There is NO free issuance on mainnet.**

- Testnet used `tokens.issue WMELEK` as a convenience (free mint). That is gated
  by `config.bridge.allowTestnetFreeIssue` — `true` on testnet, **MUST be `false`
  on mainnet** (the mainnet preset already sets it false).
- Canonical mainnet setup: the wMELEK token's `issuer` IS the bridge account, so
  `tokens.issue WMELEK` is bridge-only by the issuer check. The
  `allowTestnetFreeIssue=false` guard in `tokens.create`/`tokens.issue`
  (`wrappedGuard`) is belt-and-suspenders: even with a mis-set issuer, free
  wMELEK can never be minted on mainnet.
- On mainnet, wMELEK moves ONLY through `bridge.mintWrapped(to, amount,
  depositRef)` and `bridge.burnWrapped(from, amount, withdrawalRef)` — the engine
  mirror of the PRANA `GrapheneDepositBridge`. Both are idempotent per ref
  (one mint per `depositRef`, one burn per `withdrawalRef`) and ACTIVE-auth +
  bridge-account-only.

---

## CONFIG (changes per net) vs CODE (never changes)

### CONFIG — set via `NET=mainnet` + env / preset fill-in

| Value | Testnet | Mainnet | Env override |
|---|---|---|---|
| `NET` | `testnet` | `mainnet` | `NET` / `MELEK_NET` |
| Sidechain id | `mse-testnet-melek` | `mse-mainnet-melek` | `MELEK_ENGINE_ID` |
| L1 chain id | `18dcf0…274e` | **FILL AT ROLLOUT** (64-hex) | `MELEK_CHAIN_ID` |
| Address prefix | `TST` | `MELEK` | `MELEK_ADDRESS_PREFIX` |
| Coin symbol | `TESTS` | `MELEK` | `MELEK_COIN_SYMBOL` |
| Backed symbol | `TBD` | `MBD` | `MELEK_BACKED_SYMBOL` |
| Wrapped symbol | `WMELEK` | `WMELEK` (same) | `MELEK_ENGINE_STAKE_TOKEN` |
| Public RPC | `alpha.melek.salon/rpc` | `melek.salon/rpc` | `MELEK_ENGINE_RPC` |
| Domain base | `soapbox.community` | `soapbox.community` | `DOMAIN_BASE` |
| Alpha infix | `alpha.` | `` (empty) | `MELEK_ALPHA_INFIX` |
| Bridge account | `hathor` | **FILL AT ROLLOUT** (real custody acct) | `MELEK_ENGINE_BRIDGE_ACCOUNT` |
| Free wMELEK issue | `true` | **`false`** (invariant) | `MELEK_ENGINE_ALLOW_TESTNET_ISSUE` |
| Genesis / startBlock | near-head | mainnet genesis block | `MELEK_ENGINE_START_BLOCK` |

PRANA-side / contract addresses are config too (filled at rollout, never guessed):

- `kulaswap/kula-config-addresses.mjs` — KULA, wMELEK (`WrappedEcosystemToken`),
  ALTI, oracle, `GrapheneDepositBridge`, CDP vaults. Overridable at runtime via
  `window.__KULA_ADDR__`.
- `kulaswap/kula-config.mjs` — per-chain routers/factories; the `prana` entry's
  addresses + `verified` flag. Overridable via `window.__KULA__`.
- Bridge relayer env (per attester host): `MELEK_RPC_URL`, `PRANA_RPC_URL`,
  `GRAPHENE_BRIDGE_ADDRESS`, `MELEK_BRIDGE_CUSTODY`, `PRANA_ATTESTER_ADDRESS`,
  `PRANA_ATTESTER_KEY` (per-instance, never committed), `BRIDGE_TOKEN_ID`
  (`keccak256("MELEK")`), `CONFIRMATIONS`.

### Domain pattern (no hard-coded `alpha.`)

Hostnames come from `domain(sub)` in `engine/config.mjs`:

- Testnet: `domain('engine')` → `engine.alpha.soapbox.community`
- Mainnet: `domain('engine')` → `engine.soapbox.community`

Derived from `DOMAIN_BASE` + the optional `alpha.` infix. Surfaces that still
hard-code `*.alpha.*` strings should read from `domain()` (or their own
`DOMAIN_BASE`/infix env) before mainnet; until migrated, set the matching env on
the mainnet host so the rendered links drop `alpha.`.

### CODE — identical on both nets (do NOT edit for mainnet)

- `engine/contracts/*.mjs` (tokens, bridge, workerbee, rewards, seams)
- `engine/lib/*.mjs` (engine, state, genesis, streamer, decimal)
- `integrations/bridge-relayer.mjs` + `bridge-relayer-runner.mjs` (pure
  derivation/loop; secrets are env)
- The PRANA Solidity (`GrapheneDepositBridge`, `WrappedEcosystemToken`) — already
  bridge-only mint/burn; only its deployed ADDRESS is config.

---

## Deploy to new servers — per service

Stand up FRESH mainnet hosts (do not reuse testnet state). For each:

1. **Engine** (`engine/node.mjs`)
   - Set `NET=mainnet`, `MELEK_CHAIN_ID`, `MELEK_ENGINE_BRIDGE_ACCOUNT`,
     `MELEK_ENGINE_ALLOW_TESTNET_ISSUE=false`, `MELEK_ENGINE_STATE` (fresh path).
   - Boot: it bootstraps APIS/DRONE genesis, verifies the pinned mainnet chain id
     (a placeholder chain id REFUSES to anchor — that's intentional), replays
     from `startBlock`.
   - Confirm `config.net === 'mainnet'` and `config.bridge.allowTestnetFreeIssue
     === false` before opening to traffic.

2. **Bridge relayers** (`integrations/bridge-relayer-runner.mjs`)
   - Run K instances (one per attester key, K-of-N). Set `MELEK_RPC_URL`,
     `PRANA_RPC_URL`, `GRAPHENE_BRIDGE_ADDRESS` (mainnet deploy),
     `MELEK_BRIDGE_CUSTODY` (= the bridge account), `BRIDGE_TOKEN_ID`,
     `CONFIRMATIONS` (raise for mainnet finality), each instance's
     `PRANA_ATTESTER_KEY`.
   - The relayer signs/broadcasts NOTHING in-repo; the per-instance key lives in
     the host env (vault-JIT) only.

3. **Faucet** — disable or gate on mainnet (no free testnet funding). No
   free-mint path to wMELEK exists once `allowTestnetFreeIssue=false`.

4. **Tokens portal** (`site/tokens/`, `tokens.alpha.…` → `tokens.…`)
   - Point at the mainnet engine API + RPC; set `DOMAIN_BASE` / drop the `alpha.`
     infix so rendered links are `tokens.soapbox.community`.

5. **Akasha** (engine read/index surface) — point at the mainnet engine RPC/API.

6. **PRANAScan** (explorer) — point at the mainnet PRANA RPC + the mainnet
   `GrapheneDepositBridge`/`WrappedEcosystemToken` addresses.

7. **Pool** (`pool/www/`) — point browser-mining/wallet at mainnet endpoints;
   drop the `alpha.` infix; (testnet ran Monero/Zephyr stagenet twins — mainnet
   uses the real networks).

8. **KulaSwap** — fill `kula-config-addresses.mjs` + the `prana` entry in
   `kula-config.mjs` with mainnet deploys; keep `verified:false` until a human
   confirms each router/factory, then flip it.

---

## Pre-flight checklist

- [ ] `NET=mainnet` on every host.
- [ ] `config.bridge.allowTestnetFreeIssue === false` (verify, do not assume).
- [ ] wMELEK `issuer === config.bridge.account` on the mainnet engine state.
- [ ] Mainnet L1 chain id filled (engine refuses to anchor on the placeholder).
- [ ] Bridge account = real L1 custody account, funded, keys in vault (not repo).
- [ ] Relayer K-of-N quorum live; `CONFIRMATIONS` raised for mainnet finality.
- [ ] All public surfaces resolve to `X.soapbox.community` (no `alpha.`).
- [ ] KulaSwap addresses filled and `verified:true` only after human review.
- [ ] Smoke test: a real MELEK deposit mints exactly its wMELEK; a withdrawal
      burns it; a replayed `depositRef`/`withdrawalRef` is a no-op (no double).
