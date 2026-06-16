# APIS WorkerBee — virtual mining: lock wMELEK → mint APIS

**The reason to lock wMELEK.** Lock wMELEK as a virtual "WorkerBee" miner and passively mint
APIS over time, pro-rata to your share of the hive. A re-mapping of Hive-Engine's
**WORKERBEE / BeeSwarm** mechanic onto the MELEK/KULA ecosystem.

This is **not a loan.** Unlike the CDP (`kula-cdp.mjs`, "lock KULA → borrow wMELEK"), nothing is
borrowed and nothing is owed. You lock wMELEK, APIS accrues, you claim it, and — after any lock
period — you unlock your wMELEK unchanged. **No debt, no liquidation, no cycle/loop risk.**

## The mapping

| Hive-Engine | MELEK/KULA here | Role |
|---|---|---|
| WORKERBEE (staked) | **locked wMELEK** | the staked virtual miner |
| BEE (minted) | **APIS** | the mined token (live MELEK-Engine token, issuer `initminer`/`hathor`) |
| BeeSwarm per-tick lottery | `lotteryDraw()` | stake-weighted, one winner takes the tick |
| expected BEE / tick | `apisRate()` / `expectedMine()` | the deterministic drip = emission × share |

Note the symmetry with the existing engine genesis (`engine/config.mjs`): there **DRONE = WORKERBEE**
and **APIS = BEE**, and DRONE-staking already "earns APIS via the issuance lottery." This module adds a
second, KULA-facing miner whose *stake token is wMELEK* instead of DRONE — same APIS sink-faucet,
different lock asset, giving wMELEK a yield reason to exist.

## The mechanic

BeeSwarm pays, each tick, a stake-weighted lottery: P(you win the whole tick) = `yourStake / totalStake`.
Over many ticks your average converges to the **expected-value drip**:

```
APIS/day   = emissionPerDay × (yourStake / totalStake)          # apisRate
APIS(days) = Σ piecewise over halving periods                    # apisAccrued
E[tick]    = emissionPerTick × (yourStake / totalStake)          # expectedMine
tick       = emissionPerTick if rng < share else 0               # lotteryDraw (rng injected)
```

The module implements **both**: the smooth expected-value drip (what the UI shows and what an
accumulator contract pays), and the optional per-tick lottery with **injected rng** (for variance / a
"jackpot" feel and for deterministic tests — no `Math.random` in the module). Fairness is verified: over
300k seeded draws the lottery average is within 2% of the fair share (`apis-workerbee.test.mjs`).

## Worked example

Lock **1000 wMELEK** of a **10000** total hive at **1000 APIS/day** emission:

- hive share = 1000 / 10000 = **10%**
- **APIS/day = 100**
- **30-day total = 3000 APIS** (linear, no halving)
- with a 10-day halving: 10d@100 + 10d@50 + 10d@25 = **1750 APIS** over 30 days

Your rate falls as the hive grows (more locked wMELEK → smaller slice of the same emission) — the
self-balancing yield BeeSwarm relies on.

## Params

| Param | Meaning | Default |
|---|---|---|
| `emissionPerDay` | total APIS minted/day across the whole hive (split by stake share) | 1000 |
| `lockDays` / `lockUntil` | minimum lock before unlock; `lockUntil: Infinity` = "lock forever" (accrual continues regardless) | 0 (unlock anytime) |
| `halvingDays` | optional: emission halves every N days (BEE-style decay) | 0 (off) |

Accrual is checkpoint-based (`checkpoint()` crystallizes accrued APIS and resets the clock on every
stake/unstake/claim, MasterChef `_harvest` semantics) so changing stake never re-rates the past. The
lock period gates **only the principal withdrawal**, never accrual — a locked miner keeps mining.

## Layer decision — where APIS actually gets minted

Two viable layers. They must agree with this module's math (it is the shared spec).

### Option A — engine-side staking (RECOMMENDED)

Add a `workerbee` action set to the MELEK-Engine alongside `tokens.mjs` / `rewards.mjs`:

- the **stake token is wMELEK** *as represented inside the engine* (a wMELEK engine-token balance, or
  the engine reading a wMELEK lock), staked via the existing `tokens.stake` bucket;
- a per-block accumulator (mirror `DelegationMint`'s `accRewardPerShare`, but in BigInt base units like
  `rewards.mjs`) computes each staker's APIS share of `emissionPerDay` (converted to per-block);
- **payout mints APIS via the existing `tokens.issue` path** (`mint()` in `rewards.mjs`), so APIS's
  supply accounting, issuance log, and (soft) cap are honoured by construction;
- the issuer auth comes from `token.issuer` (= `hathor`/`initminer`), exactly as `rewards.mjs` already
  mints APIS today.

**Why recommended:** APIS is *already* a live engine token whose issuance/lottery framing exists in
`engine/config.mjs`. This reuses the audited `tokens.issue` mint boundary, the BigInt-deterministic
replay model, and the same soft-fail-never-throw contract. No new trust surface; no new minter role on
a fresh contract. The only new piece is the staking accumulator — small, and `DelegationMint.sol` is the
exact template.

### Option B — PRANA contract (APIS-on-PRANA wrapper)

Run it as Solidity on PRANA:

- a `WorkerBeeMine` contract = essentially `DelegationMint.sol` with `stakeToken = wMELEK` (the PRANA
  wrapper) and `rewardToken = APIS-on-PRANA` (a new bridged/wrapped ERC-20 mirror of the engine APIS);
- block-paced `emissionPerBlock`, MasterChef accumulator, pull-based `claim()`, immediate-undelegate
  weight drop — all already implemented in `DelegationMint.sol`;
- add `lockUntil` to gate `undelegate` (the only delta from `DelegationMint`);
- the contract must hold the **minter role** on the APIS-on-PRANA token.

**Cost:** needs an APIS-on-PRANA wrapper + a bridge to reconcile it with the canonical engine APIS
supply — two new trust/inventory surfaces (wrapper mint authority, bridge accounting) for no functional
gain, since the yield asset (APIS) natively lives on the engine.

**Recommendation: Option A (engine-side), with Option B reserved for when wMELEK liquidity and the
DEX/CDP usage all live on PRANA and an APIS-on-PRANA mirror is wanted anyway for KulaSwap trading.**

## On-chain wiring (Option A)

- **Stake/lock contract:** the engine `tokens` contract's stake bucket holds the locked wMELEK (new
  `workerbee.lock` / `workerbee.unlock` actions enforce `lockUntil`). No new custody.
- **Mint contract:** the engine `tokens.issue` path (invoked by the new `workerbee.claim`/`payout`
  action via the `rewards.mjs`-style `mint()` helper) — mints **APIS** to the staker.
- **Roles:** APIS issuer = `hathor` (`engine/config.mjs` `genesis.issuer`); the workerbee action mints as
  that issuer, identical to how `rewards.mjs` emits today. wMELEK lock is self-custodial (staker's own
  balance bucket). No owner/active key touches this repo — engine ops are signed at the engine boundary.
- **Determinism:** emission keys off L1 `blockNum`; the per-tick lottery, if enabled on-chain, must draw
  rng from a **deterministic on-chain source** (e.g. blockId hash), never wall-clock or off-chain random
  — the drip (expected-value) path needs no rng and is the safe default for on-chain payout.

## Files

- `apis-workerbee.mjs` — pure mechanics: `apisRate`, `apisAccrued`, `expectedMine`, `lotteryDraw`,
  `claimable`, `canUnstake`, `checkpoint`, `renderMineFragment`, `DEFAULT_WORKERBEE`.
- `apis-workerbee.test.mjs` — 24 offline tests (rate, accrual, halving, two-staker split, lottery
  fairness, lock enforcement, soft-fail shapes, UI escaping).
