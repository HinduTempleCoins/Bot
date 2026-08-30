# The PRANA Paper

*The technical & consensus specification for PRANA — the community-owned AI-compute chain.*

**Status:** live on PRANA mainnet (EVM chainId `712217` / `0xADE19`). Version 1.0 — 2026-08-30.
**Companion page:** `site/prana-paper/` renders this same spec at `/prana-paper` on the MELEK site.
**Sibling doc:** the *economic* layer (KULA / MWALI / APIS / CDP / gauges) is specified in
`KULA_PAPER.md`. This paper is the *chain* underneath it: consensus, issuance, and the see-saw.
**Tone:** this is a description of mechanism, not a forecast. Nothing here is a price promise, a
yield guarantee, or investment advice. Every figure is a protocol parameter that a hard fork or
on-chain governance can change; some are pinned at genesis and some are stated design intent, and
this paper marks which is which.

---

## 0. One paragraph

PRANA is an Etchash proof-of-work, EVM-compatible blockchain (a [core-geth](https://github.com/etclabscore/core-geth)
fork) that exists to give a community-owned AI — **Hathor** — compute it *owns* rather than
rents from a metered cloud. Its distinguishing design is **"the chain IS the pool": a see-saw.**
A thin **HASH lane** (ordinary proof-of-work, providing security and ordering) and a growing
**TASK lane** (verified, useful AI/compute work) credit shares into **one canonical per-epoch
reward pot** — the `UnifiedSharesLedger` — that pays out pro-rata across a rolling PPLNS window.
Early on, hashing dominates the pot; as real AI-work arrives it catches up, pulling reward toward
useful work with no re-mint and no schedule change. A consensus-level, un-bypassable **2% Hathor
fee** on every block's issuance funds the AI's own upkeep. On top of the base coin sits a full EVM
DeFi economy (KULA, MWALI, APIS, a CDP, veKULA, gauges, a MELEK↔PRANA bridge), specified in the
KULA Paper. PRANA is a **fair launch with no premine**: supply starts at zero and accrues only
from block production.

---

## 1. Thesis & motivation

A community that wants an always-on AI has two choices: rent compute from a metered cloud
(pay-per-token, revocable, owned by someone else) or own the compute outright. PRANA is the
second choice, built as a blockchain so that ownership, payment, and verification of compute are
all on one permissionless ledger. It is the **engine room** beneath the wider MELEK ecosystem:

- **MELEK** — the social/identity layer (a Graphene chain).
- **KULA** — the DeFi economy (specified in the KULA Paper).
- **PRANA** — this chain: the compute-and-security base that the other two settle against.

The design goal is explicitly *not* to be a "mine-anywhere Etchash coin." Proof-of-work here is a
**thin security floor** — enough to anchor block ordering and liveness — while the reward is meant
to flow, over time, to **useful work**: AI inference and other verifiable compute jobs. The
novelty relative to honest peers is the coupling:

- **Bittensor** incentivizes intelligence via a subnet-scored emission market;
- **Akash / io.net** are DePIN marketplaces that rent GPU/compute for fiat-priced leases;
- **classic PoW** (Bitcoin, Ethereum Classic) pays a block reward purely for hashing.

PRANA's contribution is to put **HASH and TASK into one shared reward pot** on a full EVM L1, so a
hashed share and a verified-work share compete for the same pot and the economy can be built on
top with ordinary Solidity. It is one chain that is simultaneously a mining pool, a compute
market, and a DeFi settlement layer.

---

## 2. Consensus & chain parameters

PRANA is a core-geth fork. core-geth is the maintained `go-ethereum` fork that **kept Ethash
proof-of-work** after Ethereum's move to proof-of-stake removed mining from upstream Geth. PRANA
runs its own genesis, so it is a fully independent chain that nonetheless keeps the entire
Ethereum developer ecosystem (Solidity, OpenZeppelin, MetaMask, Hardhat/Foundry, Blockscout).

### 2.1 Pinned genesis parameters

These are read directly from the sealed mainnet genesis and the forked client. They are pinned:
changing any of them is a hard fork.

| Parameter | Value | Source / note |
|---|---|---|
| Chain ID | `712217` (`0xADE19`) | genesis `config.chainId` |
| PoW algorithm | **Etchash** (Ethash + ECIP-1099 "Thanos", `ecip1099FBlock: 0`) | Etchash from block 0 — low-VRAM / laptop-friendly DAG. **No RandomX.** |
| EVM fork level | all forks through **London** active at block 0 | `londonBlock: 0` → **EIP-1559** fee market (base-fee + tip) from genesis |
| Base block reward | **2 PRANA / block** (`ConstantinopleBlockReward = 2e18` wei, `constantinopleBlock: 0`) | inherited core-geth reward constant |
| Initial supply / premine | **0** (empty `alloc`) | fair launch — supply accrues only from block production |
| Hathor protocol fee | **2.00%** (`hathorFee.feeBps: 200`, `activationBlock: 0`) | consensus-level fee on issuance — see §4 |
| Genesis `extraData` | the AI-era launch lineage inscription | verbatim announcements from "Attention Is All You Need" (2017) through DeepSeek-R1 (2025), closing with PRANA's own fair launch |

### 2.2 Block time (design intent, emergent)

PRANA uses Ethash-style **variable difficulty** (core-geth's Byzantium-family difficulty
calculator). Block cadence is therefore **emergent**: the difficulty retarget converges the chain
toward the Ethash target band of roughly **~13–15 seconds** per block, but this is not a hard
constant baked into the header the way a fixed block reward is. Treat "~13s blocks" as the design
target the retarget aims at, not a guaranteed interval.

### 2.3 Emission decay (design intent, not yet pinned)

The **live, pinned** issuance is a flat **2 PRANA per block**. A **~10%/yr geometric decay** of
that block reward is the stated design intent, but at publication it is **not pinned on-chain**:
the client leaves a height-gated `EthashBlockRewardSchedule` as a documented extension. Until such
a schedule is activated (a hard fork), block reward is constant. This paper flags the decay as
*design direction*, not a shipped parameter, so no reader mistakes it for a live guarantee.

### 2.4 Finality & reorg posture

As a Nakamoto/PoW EVM chain, PRANA has **probabilistic finality**: a block's safety grows with
confirmations, and deep reorgs are possible but exponentially unlikely as work accumulates on top.
There is no BFT instant-finality gadget. Applications that settle value (the bridge especially —
§5) should require a confirmation depth appropriate to the value at risk. This is the ordinary
PoW tradeoff, stated plainly: thin early hashrate means shallower practical finality early on
(see §6, limitations).

---

## 3. The see-saw: "the chain IS the pool"

This is PRANA's load-bearing mechanism. Instead of a block reward that pays only whoever sealed
the block, PRANA runs **one canonical mining pool pinned to the chain itself** — the
`UnifiedSharesLedger` (internally "NN1") — and pays a **fixed per-epoch PRANA issuance** pro-rata
to everyone who credited shares into it during a rolling window.

### 3.1 Three lanes, one pot

Shares are credited into the ledger through three lanes, each with its own role-gated creditor so
a coordinator can only credit the lane it is authorized for:

- **HASH lane** — the microhash / Ethash-heartbeat lane. Credited by `HashLaneCreditor` from an
  off-chain pool coordinator that has already validated PoW shares (vardiff-normalized so every
  accepted share is worth the same on-chain). HASH credit is **not** verification-gated: a hash
  share is self-evidently work. Deliberately **thin** — enough to secure ordering and liveness.
- **TASK lane** — the useful AI/compute-work lane. Credited by `TaskLaneCreditor`, but only after
  a completion claim passes the `TaskVerificationGate` (§3.3). This is the half of the "switching
  engine" that lets scientific/AI work earn pool value side-by-side with hashing.
- **BURN lane** — a proof-of-burn perma-stake lane (ties into the APIS forever-lock economy of the
  KULA Paper). Its lane weight is expected to be governed by the DAO.

### 3.2 The pot, the window, and the see-saw

- **Fixed per-epoch pot.** Each epoch, a fixed PRANA issuance is the pot. Epoch boundaries are
  shared by every compute-stack contract through the `EpochManager` library (fixed-width timestamp
  buckets) so boundaries never drift.
- **PPLNS payout.** Shares are paid over a **rolling window** of trailing epochs (a Pay-Per-Last-
  N-Shares scheme), which smooths luck and discourages pool-hopping.
- **Pro-rata across lanes.** Every lane's shares are pooled at a governed weight
  (`HashTaskWeightConfig`, "NN5"). The **default HASH:TASK weight is 1:1** — a hashed share and a
  verified-task share earn identically, which is what makes the "switching engine" seamless. The
  DAO timelock (via `WEIGHT_ADMIN_ROLE`) can retune lane weights; 1:1 is the recommended default,
  not a locked constant.

Because all lanes draw from **one** pot, they **see-saw**: early on, when there is little AI
demand, hash-shares dominate and take most of the pot; as real AI-work arrives, task-shares grow
and **catch up**, pulling reward toward useful work — with no re-minting and no change to the
emission schedule. Hashing is the thin security floor; useful work is the intended long-run
majority.

### 3.3 How TASK work is measured & attested

A forged TASK share would be worth a real HASH share, so the verification boundary is the
make-or-break trust point. It is built from composable modules:

- **`TaskVerificationGate`** — a claim becomes "verified" only once **K distinct staked-active
  attestors** (a K-of-N quorum drawn from a configured set) attest it. Verdicts are **one-shot
  consumed**, so a verified claim can be turned into pooled shares exactly once, and credit is
  bound to the worker the gate recorded — a coordinator cannot redirect it.
- **`AttestationStakeSlash`** — attestors stake a token to be "active"; a `SLASHER_ROLE` can slash
  an attestor who signs off on bad work, sending the slashed stake to a treasury. Economic
  security is *stake-at-risk*, not trust.
- **`CoordinatorRegistry`** — "the chain IS the pool, but **anyone** may run a coordinator." Rather
  than a DAO hand-granting the credit role to a blessed few, any operator can stand up a TASK-lane
  pool coordinator by posting a **slashable bond**; the TASK settlement path requires the
  coordinator to be bonded and active. (HASH-lane coordinators need no bond — a PoW share
  self-verifies, so there is nothing a bond would deter.)

Redundant recompute plus stake-slash is the anti-fabrication design: the cheapest way to earn the
pot is to actually do the work.

### 3.4 Live compute-stack parameters

These are the compute-stack settlement parameters live on mainnet (deployed 2026-08-29). They are
governance-tunable, not consensus constants:

| Parameter | Value | Meaning |
|---|---|---|
| `epochLength` | 3600 s | one settlement epoch = 1 hour |
| `windowEpochs` | 3 | trailing epochs the PPLNS window averages over |
| `epochIssuance` | 1000 · 10¹⁸ | fixed pot minted per epoch, split pro-rata |
| `burnWeight` | 1 · 10¹⁸ | weight of burn-lane shares in the split |
| `coordinatorMinBond` | 1000 · 10¹⁸ | bond a TASK-lane coordinator posts (slashable) |
| `attestorMinStake` | 100 · 10¹⁸ | stake an attester posts (slashable) |
| HASH : TASK weight | 1 : 1 (both 1e18) | default; DAO-settable via `HashTaskWeightConfig` |

---

## 4. The Hathor fee — consensus-level, un-bypassable

A fixed **2.00% (200 bps)** of every block's gross issuance is routed, **by consensus rule**, to
the `HathorFeeTreasury` rather than to whoever sealed the block. This funds the community AI's own
upkeep and is modeled on the Devcoin "receiver" pattern — but made un-bypassable.

**Why it lives in the consensus layer.** An application-layer skim (there is also one, the
`SettlementFeeHook`, taken inline at ledger payout) only bites when value is paid out of the
on-chain ledger; a third party running their own pool and settling off-chain could route around
it. The consensus fee cannot be routed around: it is applied inside `AccumulateRewards`, part of
the canonical state transition. A miner who omits or short-pays it produces a **different state
root** than honest nodes compute for the same block, so every honest validator's re-execution
rejects the block as invalid. The fee is not "requested" — it is a **block-validity rule**. There
is no PRANA in existence that did not already pay the fee at the moment it was minted.

Properties:

- **Launch-pinned.** `feeBps = 200` is a protocol constant; changing it is a hard fork. A future
  `RateTransitions` schedule (like the reward schedule) is left as a documented extension.
- **Governed sink, never a trader.** The fee address is the `HathorFeeTreasury` contract, which
  never trades and only disburses under a DAO timelock. Its address is published on the deployed-
  contracts page (§7) rather than restated here, so this paper cannot drift from the live wiring.
- **Two layers, not double-charged.** The consensus fee is taken once, at issuance. The app-layer
  `SettlementFeeHook` is the same idea expressed inside the ledger's payout path (rules-based,
  countercyclical rate via `CountercyclicalFeeOracle`); together they guarantee the skim whether
  PRANA is distributed through our ledger or through a pool we never wrote.

---

## 5. How PRANA connects to the ecosystem

PRANA is the base coin; the economy on top is specified fully in `KULA_PAPER.md`. In brief:

- **The bridge (MELEK ↔ PRANA).** MELEK (a Graphene L1) locks value on its side to mint **wMELEK**
  on PRANA via the `GrapheneDepositBridge`; burning wMELEK releases MELEK. A federated validator
  set (5 validators, **3-of-5** threshold) authorizes mints. The core invariant is **wMELEK supply
  == MELEK locked**. The same wrapper pattern extends to wVKBT and wCURE.
- **KULA / MWALI / APIS on top.** KULA is the emission-only reward/DeFi token (cap 11M); MWALI is
  the proof-of-liquidity token minted only by the KULA/WPRANA gauge; APIS is the MELEK-Engine fee
  token. The **miner slice (45%)** of KULA emission pays exactly the useful-work providers of §3 —
  the DeFi economy's biggest reward slice is pointed at the see-saw on purpose.
- **The Yield Farm & gauges.** veKULA (lock KULA up to 4 years) boosts farm yield and directs,
  via the `GaugeController`, which pools new KULA emission flows to.
- **Forever-lock → APIS-Hash compute-mining tie-in.** Wrapped MELEK bridged to PRANA can be
  **forever-locked** to mint soulbound **APIS-Hash**, a non-transferable mining-power unit that
  drips APIS forever — the BURN lane's economic hook into the pool. No debt, no liquidation.

The point of the coupling: the DeFi layer's rewards, liquidity incentives, and burn-mine all feed
back into the same compute pool that secures and powers the chain.

---

## 6. Roadmap, open questions & honest limitations

- **Thin early liquidity & hashrate.** A fair-launch chain starts with little market depth and low
  hashrate. Low hashrate means cheaper theoretical reorgs and shallower practical finality early —
  value settlement (especially bridge withdrawals) should use conservative confirmation depths
  until hashrate matures. This is the standard small-PoW-chain tradeoff, not a solved problem.
- **PoW security tradeoff by design.** Keeping HASH "thin" is deliberate, but thin security is
  still security that must be paid for. The see-saw assumes enough hashing to anchor ordering; if
  TASK reward grows while hashing thins too far, lane weights (governed) are the lever to rebalance.
- **TASK-lane attestation maturity.** The K-of-N staked-attestor verification gate is the trust
  boundary for useful work. Its economic security depends on honest, well-staked attestor sets and
  on redundant recompute actually catching fabrication. This is the youngest, highest-risk part of
  the stack and the one most in need of adversarial testing and audit.
- **Emission decay & fee-transition schedules** are documented extensions, not shipped
  parameters (§2.3, §4). They require a hard fork to activate.
- **Governance decentralization.** Admin over the compute stack and fee treasury sits behind a DAO
  timelock; the maturity of that DAO — how distributed the keys and votes actually are — is an
  ongoing process, not a finished state.

Open questions the design intentionally leaves to governance: the final HASH:TASK weight ratio,
the emission-decay curve, the per-task-type share weights, and the countercyclical fee schedule.

---

## 7. Contract & chain reference

| Item | Value |
|---|---|
| Chain ID | `712217` (`0xADE19`) |
| Public RPC | `https://rpc.prana.melek.salon` |
| Block explorer (Blockscout) | `https://pranascan.soapbox.community` |
| Native PRANA (compute-stack settlement token) | `0xE92E94C4929ea9D6EF7BFB8B3e192D66951Ab661` |
| Deployed contracts + ABIs | `https://witness.melek.salon/dev/contracts` |
| Economic layer spec | `KULA_PAPER.md` (KULA / MWALI / APIS / CDP / gauges / bridge) |

The **deployed compute-stack addresses** (`UnifiedSharesLedger`, `HashLaneCreditor`,
`TaskLaneCreditor`, `TaskVerificationGate`, `AttestationStakeSlash`, `CoordinatorRegistry`,
`HashTaskWeightConfig`, `HathorFeeTreasury`, `SettlementFeeHook`, and the bridge/KULA set) live on
the deployed-contracts page and on Blockscout, so this paper points to the live registry rather
than restating addresses that could drift.

---

## 8. Sources in the repo & chain

This paper is grounded in working code and the sealed genesis, not marketing copy:

- **Consensus:** the PRANA client (`chain/hathorfees/hathorfees.go` — the un-bypassable fee;
  `chain/core-geth` Ethash reward constants; the sealed `chain/genesis/prana-mainnet.genesis.json`
  — chainId 712217, `feeBps` 200, `ecip1099FBlock` 0, `londonBlock` 0, empty `alloc`).
- **See-saw compute stack:** the PRANA contracts repo — `compute/UnifiedSharesLedger.sol`,
  `compute/EpochManager.sol`, `compute/HashTaskWeightConfig.sol`, `compute/TaskVerificationGate.sol`,
  `compute/HashLaneCreditor.sol`, `compute/TaskLaneCreditor.sol`, `compute/CoordinatorRegistry.sol`,
  `compute/SettlementFeeHook.sol`, `AttestationStakeSlash.sol`.
- **Economy on top:** `KULA_PAPER.md` and `kulaswap/` (the off-chain economic models).
- **Chain config:** `kulaswap/kula-config.mjs` (`prana-mainnet`: chainId 712217, RPC, explorer).

**Grounded vs. design-intent (stated honestly):** *Grounded and pinned* — Etchash PoW, chainId
712217, EIP-1559, 2 PRANA/block base reward, no premine, the 2% consensus Hathor fee, and the
three-lane `UnifiedSharesLedger` see-saw with its verification/attestation modules. *Design intent,
not yet pinned* — the ~13–15s block cadence (emergent from difficulty retarget), the ~10%/yr
emission decay (a documented `EthashBlockRewardSchedule` extension), and the final governed lane
weights and fee-transition schedule.

*Parameters here are the ones live at publication. Governance and hard forks can change them;
always read the current on-chain values and the verified source before acting.*
