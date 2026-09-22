# outside-tokens — multi-chain launch package (Base + Polygon)

**Status: TESTNET / LOCAL. Nothing here has been deployed. No broadcast, no mainnet, no keys used.**
This is a buildable, offline-tested code package implementing the operator's outside-token /
zero-USDC-liquidity strategy from `.local/incoming/OUTSIDE_TOKEN_WHERE_TO_START.md`. It is ready for
the operator to review before any deploy. Contracts mirror the existing PRANA/KULASwap patterns
(Solidity 0.8.24, OpenZeppelin 5.0.2, UniV2 interfaces).

The plan in one line: mint a themed native token, **airdrop it widely** so it is held, and pair it
against **wPRANA** (backed by mined PRANA, published proof-of-reserve) — the airdrop float + wPRANA
seed replace the ~$10k USDC that normally seeds a pool. wPRANA is the universal quote base on every
chain, so both legs funnel back to PRANA/KULA where revenue lives (Charter §1: outside tokens are
*acquisition + liquidity bootstrap*, not the revenue).

---

## What's built (maps to the 7 deliverables)

| # | Deliverable | File(s) |
|---|---|---|
| 1 | New "environmental" ERC-20 (placeholder `GileadBalm`/`BALM`, operator renames) — OZ capped/burnable/permit, one-way `renounceMinting` to freeze supply | `contracts/EnvironmentalToken.sol` |
| 2 | Airdrop tool: Merkle-distributor **contract** + off-chain tree builder from CSV + cheap L2 **batch-disperse** | `contracts/MerkleDistributor.sol`, `contracts/BatchDisperse.sol`, `scripts/build-merkle.mjs`, `scripts/lib/merkle.mjs`, `scripts/lib/keccak.mjs` |
| 3 | wPRANA representation: custodied-mint + **proof-of-reserve** wrapper with an on-chain **anti-orphan invariant** (`totalSupply <= attestedReserve`) | `contracts/WrappedReserveToken.sol` |
| 4 | UniV2 add-liquidity script — sets opening price by ratio, reuses UniV2 router/factory ABIs | `scripts/add-liquidity.mjs`, `scripts/lib/univ2.mjs`, `scripts/lib/router-abi.mjs` |
| 5 | Per-chain config (Base flagship; Polygon VKBT/CURE), addresses = env placeholders | `config/chains.mjs` |
| 6 | Tests — offline (`node --test`, zero deps) **and** hardhat (in-memory EVM, no network) | `offline/*.test.mjs`, `test/*.test.js` |
| 7 | This README | `README.md` |

### The anti-orphan wrapper (deliverable 3, the load-bearing safety point)
The plan calls out the **fake-`wMELEK`-in-pair orphan hazard** (§3.1 / Part 7): a wrap with no real
backing is a rug surface. `WrappedReserveToken` makes backing **enforced on-chain**:
- The custodian must `attestReserve(amount, proofURI)` — a public, event-logged claim of how much
  native PRANA (or Hive-Engine VKBT/CURE) is locked on the home chain, **with a mandatory proof link.**
- `mint()` **reverts** if it would push `totalSupply()` above `attestedReserve`. You *cannot* mint
  unbacked supply. To mint more, attest more (with fresh proof) first.
- `reserveLocator` + `proofURI` + `ReserveAttested` events let anyone compare on-chain supply against
  the real home-chain balance. `collateralizationBps()` surfaces backing health for a dashboard.
- It is honestly **custodial** (there is no on-chain proof of the remote lock — same trust model as
  PRANA's `PeggedBridgeVault`). Start here (cheap), then graduate to a two-way lock-mint bridge; the
  contract is `ERC20Burnable` + mint/burn-shaped so a future bridge vault drives it without redeploy.

---

## How to test locally

**Tier 1 — offline, zero dependencies, runs right now** (house style — `node --test`, no network, no
keys, no toolchain). This is the primary proof:

```bash
cd chains/outside-tokens
node --test offline/*.test.mjs      # or: npm run test:offline
```
Proves: pure-JS keccak256 matches Ethereum vectors; the Merkle leaf scheme reproduces
`MerkleDistributor.sol`'s `abi.encode` + double-hash byte-for-byte; every generated proof verifies and
tampered proofs are rejected; CSV→manifest is deterministic; the UniV2 opening-price/first-mint-LP
math. **15/15 passing** (verified this session).

**Tier 2 — on-chain contract proof** (hardhat in-memory EVM; needs a one-time `npm install`, which is
the only network step and pulls only the dev toolchain):

```bash
cd chains/outside-tokens
npm install
npx hardhat compile                 # 32 files compile (evm target: paris)
npx hardhat test                    # or: npm run test:hardhat
REPORT_GAS=true npx hardhat test    # with the gas table below
```
Proves: token mint/cap/renounce/burn; **an off-chain Merkle proof from `merkle.mjs` verifies in the
on-chain `claim()`** (the critical cross-check); double-claim blocked; batch-disperse; the wrapper's
mint-against-attested-reserve invariant, proof requirement, role separation, and redemption burn.
**22/22 passing** (verified this session).

### Build the airdrop manifest / plan liquidity (both read-only, no broadcast)
```bash
node scripts/build-merkle.mjs offline/sample-recipients.csv --decimals 18 > claims.json
node scripts/add-liquidity.mjs --chain base --token <NEW> --quote <wPRANA> \
     --amount-token 1000000 --amount-quote 5000        # prints opening price + router call params
```

---

## Real gas measured (hardhat, optimizer 200 runs, 0.8.24) — for the operator's cost model

Deployments (one-time, per chain):

| Contract | Deploy gas |
|---|---|
| EnvironmentalToken | 1,173,156 |
| WrappedReserveToken (wPRANA / wVKBT / wCURE) | 1,695,511 |
| MerkleDistributor | 626,831 |
| BatchDisperse | 446,751 |

Per-operation:

| Op | Gas |
|---|---|
| Merkle `claim` (paid by claimer) | ~77k–83k |
| `BatchDisperse.disperse` (3 recipients) | ~122,797 (≈ base + ~25k/extra recipient) |
| EnvironmentalToken `mint` | ~71,058 |
| Wrapper `attestReserve` | ~87,028 |
| Wrapper `mint` | ~65,231 |

Translate to USD with the plan's Part-1 table at live gas: on **Base/Polygon** a full deploy set is
low single-digit dollars; a Merkle claim is ~$0.005 (Base) / ~$0.001 (Polygon); a 10k-recipient
batch-disperse is ~$5–50 (Base) / ~$1–10 (Polygon). **Do NOT use Ethereum L1** (plan Part 1: a wide
L1 airdrop is ~$21k of gas). Confirm live gas/ETH price before any action — the plan's figures are
[TRAIN] Jan-2026 estimates.

---

## Operator-gated steps that remain before any real deploy

Nothing below has been done. Each money-moving action is a **separate, manual, reviewed** step — the
code deliberately does not chain them. Deployer key is supplied via `OT_DEPLOYER_KEY` at run time and
is **never committed** (it lives outside this repo, per the key-custody rules).

**Recommended order (plan Part 6: Polygon leg first — cheapest ground to prove the whole rail):**

1. **Fund a fresh deployer EOA** on the target chain (small native balance for gas). Prefer a
   multisig/treasury as the `owner`/admin.
2. **Dry run on a testnet first** — `--network baseSepolia` / `--network polygonAmoy` — before mainnet.
3. **Deploy contracts** (operator-gated; broadcasts):
   ```bash
   OT_DEPLOYER_KEY=0x... OT_LEG=polygon OT_OWNER=<treasury> \
     npx hardhat run scripts/deploy.js --network polygon
   ```
   Order enforced by the script: **wPRANA first** (both legs need it), then the leg's tokens + airdrop
   tools. On Base leg it also deploys `EnvironmentalToken` (rename via `OT_TOKEN_NAME`/`OT_TOKEN_SYMBOL`).
4. **Lock the real reserve on the home chain**, then **`attestReserve(amountLocked, proofURI)`** on each
   wrapper — publish the reserve address + snapshot (IPFS) so backing is auditable. **Mint reverts
   until this is done** (the invariant). This is the step that keeps the wrap from being an orphan.
5. **Mint allocations** (airdrop float / pool seed / treasury) from `EnvironmentalToken`; for the
   wrappers, `mint` up to the attested reserve.
6. **Run the airdrop** — build the tree from the real recipient CSV (`build-merkle.mjs`), publish the
   CSV + `claims.json`, then either deploy `MerkleDistributor` with the root + fund it, or approve +
   call `BatchDisperse` for smaller lists. Recipients: curated MELEK on-chain participants + a themed
   outside audience (plan Part 3b) — not random wallets.
7. **Seed the pool** — create the pair on the DEX, then `addLiquidity(NEW, wPRANA, ...)` using the
   params from `add-liquidity.mjs` (the ratio sets the opening price; for a fresh pair min == desired).
8. **Verify** each contract on the block explorer (`npx hardhat verify`), then confirm the **definition
   of done** (plan Part 6): a real reserve link, a published airdrop whose on-chain state matches the
   list, a real executed swap, and one funnel conversion (an airdrop holder who reached KULA/MELEK).
   Do not call anything "live/liquid" without that evidence (Charter §3).

**Fill `config/chains.mjs`** (via env) with the deployed addresses + the DEX router/factory as you go;
a zero address reads as "not live" so nothing builds a tx against an un-deployed piece.

---

## Notes / boundaries respected
- Self-contained in this dir. Does not touch existing contracts (`kulaswap/`, `PRANA/`, `KULASwap/`).
- No secrets; every address is a placeholder; everything labeled testnet/local.
- `add-liquidity.mjs --broadcast` is a deliberate **no-op** — this repo holds no signer/key/broadcast
  path. Hand the printed params to the operator-gated runner.
- `node_modules/`, `artifacts/`, `cache/`, `claims.json`, `.env*` are gitignored.
- The offline tests (Tier 1) are the ones wired for CI-style running with zero deps; the Bot repo's
  root `npm test` glob does not include this dir (kept self-contained on purpose). Run them with the
  explicit `node --test offline/*.test.mjs` command above.
