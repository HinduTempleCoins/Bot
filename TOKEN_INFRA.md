# TOKEN_INFRA.md — MELEK token infrastructure & the PRANA connection

**Status:** design + staging (carryover #290). Public-safe (no hosts/IPs/keys).
**Read with:** `engine/README.md`, `engine/config.mjs`, `integrations/smt-info.mjs`,
`integrations/akasha-connect.mjs`. **Governed by:** `CLAUDE.md` and `BRIEF.md` §1, §6, §7.

This document maps the **three token layers** in the MELEK ecosystem, says **when to use
which**, gives the **engine-token → SMT migration path**, defines what **"PRANA connect"**
means concretely, and states plainly **what is NOT being built**.

> **One hard rule frames everything below:** no custom chain ops for AI features. The MELEK
> chain stays **standard Graphene + the standard SMT op set** of this Steem fork. Nothing in
> this design adds a new consensus operation. (`CLAUDE.md` "No custom chain ops for AI.")

---

## 1. The three layers at a glance

| | (a) Native SMT | (b) MELEK-Engine side-token | (c) PRANA-as-its-own-chain |
|---|---|---|---|
| **Where it lives** | MELEK L1 consensus | L2 deterministic sidechain over MELEK L1 | A separate L1 (EVM) |
| **Token primitive** | NAI-backed Smart Media Token | JSON record in engine state | ERC-20-style / native PRANA unit |
| **How it's created** | standard `smt_create`/`smt_setup` ops, signed off-repo | `custom_json` (id `mse-…`) burning APIS | deploy on PRANA (off-repo) |
| **Who validates** | every MELEK witness (L1 consensus) | any engine node, deterministically | PRANA validators |
| **Security** | full chain consensus | L1-anchored replay of `custom_json` | PRANA's own consensus |
| **Cost / weight** | heaviest (consensus state) | light (off-consensus, fee-metered) | separate chain |
| **Bot's role** | **read-only** (`integrations/smt-info.mjs`) | **read-only** (engine API/UI hold no key) | **read-only** descriptors (`akasha-connect.mjs`) |
| **Status** | compiled + HF23-active on testnet; NAI pool live | **SHIPPED** on testnet (`engine/`) | dormant until `PRANA_RPC_URL` is set |

All three are **read-only from this repo**. The Bot never signs a token op anywhere — token
creation/issuance is signed by the operator/MELEK-Signer (separate, per `BRIEF.md` §7), and
the engine node and the PRANA descriptors hold no key by construction.

---

## 2. When to use which

Pick the **lightest layer that meets the need**:

- **MELEK-Engine side-token (b)** — the default for *most* community tokens. Cheap to mint
  (burn APIS), no consensus weight, instant via `custom_json`, and the engine is **already
  live on the testnet**. Use for: reward points, community/vertical tokens, experiment tokens,
  anything that does not need to be a first-class chain asset or to interoperate with native
  wallet/witness tooling. This is where the BEE/WORKERBEE analogues (`APIS`/`DRONE`) already
  run.

- **Native SMT (a)** — reserve for a token that genuinely needs **L1 consensus guarantees**:
  full-node-enforced supply, native-wallet visibility, emission/inflation rules enforced by
  every witness, or use as fee/market infrastructure that other on-chain tooling must trust
  without trusting an engine node. Heavier and slower to set up; use only when (b) is
  insufficient. The NAI pool being live (validated by `integrations/smt-info.mjs`) is what
  makes this available.

- **PRANA chain (c)** — for **value/compute that belongs on its own chain**: the PRANA unit
  itself, EVM-contract logic, and the mining economy. PRANA is *one* chain that **all hardware
  hashes**, and the AI **draws only the units it needs** from it (the chain lineup). It is not
  a place to mint social/community tokens; those stay on (a)/(b) and *bridge* to PRANA when
  they need EVM-side liquidity (see §4).

Rule of thumb: **community token → engine. Consensus-critical asset → SMT. Value/compute/mining
unit → PRANA.**

---

## 3. Migration path: engine-token → SMT

An engine token can "graduate" to a native SMT without changing the chain. The engine was built
DEX-ready with exactly this kind of seam (`engine/README.md`). The path is a **mint-against-burn
migration**, all with standard ops:

1. **Freeze** the engine token (issuer stops `tokens.issue`; publish the final engine state
   hash from `/status` as the canonical snapshot — same L1 history → same balances).
2. **Create the SMT** on L1 with a standard `smt_create`/`smt_setup` (signed off-repo). The new
   NAI is drawn from the live NAI pool (`integrations/smt-info.mjs` confirms the pool exists).
3. **Distribute** the SMT to holders 1:1 from the frozen snapshot, via standard SMT issuance
   ops (off-repo signing). The engine's append-only issuance log + holders endpoint
   (`/contracts/holders`) is the audit source for the distribution list.
4. **Retire** the engine token (mark migrated in engine UI; engine balances become historical).

Nothing here is a custom op: `custom_json` on the way in, `smt_create`/`smt_setup`/SMT issuance
on the way out. The Bot's only involvement is **reading** — surfacing the snapshot
(`engine/` API) and confirming the destination NAI/token exists (`smt-info.mjs`). It signs
nothing.

The reverse is intentionally *not* a migration: a native SMT does not "downgrade" to an engine
token.

---

## 4. What "PRANA connect" means, concretely

PRANA is **its own chain** — not an SMT, not an engine token. "Connecting" it means three
specific, already-scaffolded linkages, none of which add a chain op to MELEK:

1. **Pool pays PRANA units.** The mining pool (`pool/`) menu is *RandomX coins + Monero +
   PRANA-as-its-own-coin* (the chain lineup). When PRANA is live, miners hashing the pool's
   PRANA target are **paid out in PRANA units on the PRANA chain** — a normal pool payout to a
   PRANA address, governed by the pool linkage descriptor (`akasha-connect.mjs::poolLinkage`,
   the stagenet-twin payout-boundary rule for the Monero side; PRANA payouts go to the EVM
   address directly). The Bot only *names* this boundary; it never holds a payout key.

2. **Bridge / issuance model.** Tokens move between MELEK-side assets and PRANA over a
   **lock-mint bridge the wallet only *initiates*** — it signs the one source-chain tx and the
   relayer/attester federation finalizes (`akasha-connect.mjs::bridgeLinkage`). Two routes:
   - **EVM↔EVM** (`CanonicalLockMintBridge`) — PRANA to/from other EVM chains.
   - **EVM↔Graphene** (`GrapheneDepositBridge`) — PRANA to/from MELEK; a MELEK-side asset
     (engine token or SMT) is *represented* on PRANA by mint-against-lock, and redeemed by
     burn-against-unlock. **No new MELEK chain op** — the MELEK side is a native send the
     federation watches.
   The Bot/wallet **never** assembles validator signatures or calls `mint`/`attestDeposit`
   (watch-only; `akasha-connect.mjs` `walletNeverSigns`).

3. **The two engine DEX seams** (`engine/config.mjs` `seams`, gated **OFF**). The future PRANA
   DEX/peg-gateway plugs into the engine exactly where Hive-Engine's TribalDEX sits beside it:
   `gateway.deposit/withdraw` (pegged-asset bookkeeping) and `dexSettlement.settle` (signed-fill
   settlement). These are **declared and inert** until PRANA exists; turning them on is config,
   not a chain change.

"Draws only the units needed": the AI/operator does **not** pre-mint a PRANA balance into this
repo. PRANA units are produced by mining and drawn on demand; this repo only *reads* PRANA
state once `PRANA_RPC_URL` is set (`akasha-connect.mjs::isLive` returns false until then).

---

## 5. What is NOT being built

- **No custom chain ops.** MELEK stays standard Graphene + the standard SMT op set. No
  AI-specific operation, no consensus change, ever. (`CLAUDE.md`.)
- **No signing in this repo.** No WIF/seed/active-key here or on the Bot host. SMT create/setup,
  SMT issuance, engine issuance, bridge finalization, and pool payouts are all signed **off-repo**
  (operator / MELEK-Signer / pool / attester federation). `BRIEF.md` §7; "Zero WIF in Bot repo."
- **No DEX on the engine side.** The engine has **no order book** — the two seams are registered
  capability hooks for the *future* PRANA DEX, gated off. (`engine/README.md`.)
- **No PRANA balance pre-mint.** The repo holds no PRANA value; it reads PRANA only when the RPC
  env is set, and degrades clean (soft-fail) until then.
- **No hathor.network DAG anything.** "PRANA"/"MELEK" tokens are this ecosystem's; do not pull in
  unrelated token libraries. (`CLAUDE.md`.)
- **Not a downgrade path.** SMT → engine-token is deliberately not supported (§3).

---

## 6. Code surfaces today

| Surface | Layer | Repo path | Holds key? |
|---|---|---|---|
| SMT/NAI reader | (a) native SMT | `integrations/smt-info.mjs` | no — read-only |
| **Token-tools page (NEW)** | (a)+(b) unified | `engine/lib/token-tools.mjs` (mounted at `/tools`) | no — builds ops, never signs |
| **Token op-builder (NEW)** | (a)+(b) | `engine/lib/op-builder.mjs` | no — pure builder, no key |
| Engine node + API/UI | (b) side-token | `engine/` | no — streams L1, never broadcasts |
| Engine DEX seams (inert) | (b)→(c) | `engine/config.mjs` `seams` | no |
| Chain/pool/bridge descriptors | (c) PRANA | `integrations/akasha-connect.mjs` | no — descriptors only |
| Chain legibility reader | L1 | `integrations/melek-chain.mjs` | no — read-only |

`integrations/smt-info.mjs` is the repo's **first SMT-aware module**: it reads the NAI pool and
created-token list off the MELEK RPC (testnet today), validating the live HF23/SMT claim. It is
read-only, env-gated (`MELEK_RPC_URL`), network-labeled (`[TestNet not MELEK]`), injectable-fetch,
and soft-fails to a shaped empty result — never throws, never fabricates, holds no key.

### 6a. The token-tools surface (carryover #290 — built)

`engine/lib/token-tools.mjs` is the **user-facing token tools** page, mounted by the engine API
server at **`/tools`** (so it ships at `engine.alpha.melek.salon/tools`). It unifies both layers:

- **List (read).** Two tables — engine side-tokens (from the live engine `State`) and native
  SMT/NAI (from `integrations/smt-info.mjs`). `GET /tools` (HTML) / `GET /tools/api/tokens` (JSON).
- **Token detail (read).** `GET /tools/token/:SYMBOL` — supply, max, precision, immutable-cap flag,
  metadata, and the holder list (liquid + stake) for an engine token.
- **Create / issue / transfer / stake builder.** A form that POSTs to `GET/POST /tools/api/build`,
  which calls `engine/lib/op-builder.mjs` to **build + validate** the operation and return its
  exact shape. It does **not** broadcast.

`engine/lib/op-builder.mjs` is the single source of truth for op shapes:

- `buildEngineOp(action, params, account)` → a Graphene `custom_json` op
  (`required_auths:[account]`, `id` = sidechain id, `json` = `{contractName:'tokens',
  contractAction, contractPayload}`) for `create | issue | transfer | stake | unstake`. Validates
  symbol (1-10 A-Z), precision (0-8), maxSupply (≤ ceiling), quantity, and account names.
- `buildSmtCreateOp(params)` / `buildSmtSetupOp(params)` → the **standard** Steem-fork
  `smt_create` / `smt_setup` ops (no custom chain op), with `symbol:{nai,decimals}`, the NAI drawn
  from the live pool, and `smt_creation_fee` / `max_supply` left for the host to finalise.

**Custody:** the page and the builder **never sign and never broadcast** — no WIF/seed is read,
accepted, logged, or stored (BRIEF.md §7). Engine ops are signed client-side in the browser (the
existing `engine/ui/render.mjs` dhive path) or by the host signer; SMT ops are signed off-repo by
the operator / MELEK-Signer. Everything is offline-tested (`engine/test/op-builder.test.mjs`,
`engine/test/token-tools.test.mjs`) with injected data, soft-fail-never-throw.

**What the host must wire for real broadcast** (none of it lives here):
- **Engine RPC for reads** — `MELEK_ENGINE_RPC` (L1 failover list) so the engine `State` is live;
  `MELEK_RPC_URL` + `MELEK_NETWORK` so the SMT half of the list/`/status` reads real data.
- **Engine ops broadcast** — browser-side dhive (already in `engine/ui/render.mjs`) broadcasts the
  `custom_json` the builder emits; the engine node then reflects it within ~3s. No server key.
- **SMT ops broadcast** — the `smt_create` / `smt_setup` ops the builder emits are signed by the
  control account **off-repo** (operator / MELEK-Signer with a scoped active-auth JIT key — never on
  the Bot host). The host fills `smt_creation_fee` from the live chain fee and applies precision to
  `max_supply` before broadcast.
