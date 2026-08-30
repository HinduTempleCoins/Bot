# The KULA Paper

*The public economic spec for the PRANA / KULA economy.*

**Status:** live on PRANA mainnet (EVM chainId `712217`). Version 1.0 — 2026-08-30.
**Companion page:** `site/kula-paper/` renders this same spec at `/kula-paper` on the MELEK site.
**Tone:** this is a description of mechanism, not a forecast. Nothing here is a price
promise, a yield guarantee, or investment advice. Emissions decay, sinks compete for
the same tokens, and every number below is a protocol parameter that governance can change.

---

## 0. One paragraph

PRANA is a proof-of-useful-work compute chain. Its security budget is split across a
**see-saw** of two lanes — a thin hash lane and a growing AI-work (TASK) lane — that draw
pro-rata from **one fixed per-epoch pot**. On top of that base coin sits **KULA**, an
emission-only reward token (cap 11M) that pays miners, liquidity providers, a no-loss
lottery, and stakers. Liquidity that backs KULA earns **MWALI**, a proof-of-liquidity
token minted only by the KULA/WPRANA gauge. **APIS** is the MELEK-Engine fee token, mined
by forever-locking wrapped MELEK. Around these sit the ordinary DeFi primitives — a CDP,
a veKULA boost, gauges, a burn-mine, a bridge, and a non-cashable arcade. Every mint has a
paired sink; no token is freely mintable by any human; admin sits behind a 2-day DAO
timelock the deployer has renounced.

---

## 1. The see-saw compute model (PRANA base coin)

PRANA is an Ethash/Etchash-style EVM chain (core-geth fork), fair-launch, **no premine**.
Its native coin is emitted by block reward and a sealed-at-genesis protocol fee
(`hathorFee`, 2.00%), and — the part that matters here — by a **useful-work settlement pot**.

**Two lanes, one pot.** Each epoch the protocol fixes a single issuance pot and splits it
**pro-rata across all verified work-shares**, regardless of which lane produced them:

- **HASH lane** — ordinary proof-of-work hashing. It is deliberately *thin*: enough to
  anchor the chain's ordering and liveness, not the whole reward. Credited by
  `HashLaneCreditor`.
- **TASK / AI-work lane** — verified, redundantly-recomputed AI and compute jobs
  (`hathor-inference` and friends). A job is only credited after passing a verification
  gate (`TaskVerificationGate`) that guards against fabricated work. Credited by
  `TaskLaneCreditor`.

Both lanes write their shares into one ledger (`UnifiedSharesLedger`), which pays the pot
pro-rata. Because the two lanes share **one** pot, they *see-saw*: early on, when there is
little AI demand, hash-shares dominate and take most of the pot; as real AI-work arrives,
task-shares grow and **catch up**, pulling reward toward useful work without anyone
re-minting or changing the emission schedule. Hashing is the thin security floor; useful
work is the intended long-run majority.

**Live parameters** (mainnet compute stack, deployed 2026-08-29):

| Parameter | Value | Meaning |
|---|---|---|
| `epochLength` | 3600 s | one settlement epoch = 1 hour |
| `windowEpochs` | 3 | rolling window the pot averages over |
| `epochIssuance` | 1000 · 10¹⁸ | fixed pot minted per epoch, split pro-rata |
| `burnWeight` | 1 · 10¹⁸ | weight of burn-credited shares in the split |
| `coordinatorMinBond` | 1000 · 10¹⁸ | bond a job coordinator must post |
| `attestorMinStake` | 100 · 10¹⁸ | stake an attester must post (slashable) |

Attesters who sign off on bad work are slashed (`AttestationStakeSlash`); coordinators post
a bond. The point of the redundant recompute + stake-slash design is that the cheapest way
to earn the pot is to actually do the work.

---

## 2. KULA — the reward / DeFi token

**KULA** (`0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631`) is the token the whole DeFi economy
revolves around — the MasterChef/ve pattern, honestly parameterised.

- **Emission-only.** There is **no premine and no treasury allocation**. KULA can be minted
  *only* by the `EmissionScheduler` (it alone holds `MINTER_ROLE`). The deployer holds no
  minter role. Admin over KULA is the **DAO Timelock**
  (`0x574DeEaa82BcA4ACF6C5669D8dbe084C28EE0da4`, 2-day delay); the deployer **renounced**
  its admin.
- **Supply.** ~1,000,000 KULA emitted in year one, decaying **−10% per year**. That geometric
  series sums to roughly **10M** lifetime, and the token contract enforces a **hard cap of
  11M** as a ceiling the schedule never reaches. Emission is a faucet with a decay, not a tap
  someone can open wider.
- **The split.** Each emission is divided **45% miners / 35% LPs / 10% lottery / 10% stakers**.
  An hourly keeper (`kula-emission-keeper`) computes what is due, applies the decay, and
  routes each slice to its sink; if all sinks are empty it *defers* rather than dumping.

Where the four slices go:

1. **Miners (45%)** — pays the useful-work providers of §1. This is the biggest slice on
   purpose: hardware and AI-work capacity is the thing the chain must attract and keep.
2. **LPs (35%)** — streamed by the `LiquidityGauge` to KULA/WPRANA liquidity providers.
3. **Lottery (10%)** — seeds the `NoLossLotto` prize pot (see §7).
4. **Stakers (10%)** — real-yield to KULA stakers via `DividendDistributor`.

KULA is also the collateral of the CDP (§6) and the asset locked for veKULA boost + votes
(§5). The off-chain economic model that tunes all of these parameters before they are pinned
on-chain lives in `kulaswap/kula-farm.mjs` (with its test suite).

---

## 3. MWALI — the proof-of-liquidity token

**MWALI** (`0x36C6921e2CECe9DEc7a5AAC42bC6738011F2a1c9`) is the **liquidity** token — KULA is
not. MWALI exists to reward and measure the liquidity that backs KULA.

- **Minted only by the gauge.** MWALI's sole `MINTER_ROLE` holder is the
  `LiquidityGauge_KULA_WPRANA` (`0x46d92Ae6F5D55Eb5f12F222e44F0CDAC74E38e45`). It mints MWALI
  to liquidity providers of the KULA/WPRANA pair — the **Kula-Ring** pairing that ties MWALI's
  issuance to real, on-chain liquidity depth.
- **Emission-only, no human minter.** The deployer holds **no** `MINTER_ROLE`; admin is the
  DAO Timelock; the deployer renounced its admin. MWALI cannot be printed by a person.
- **Why a separate token.** Proof-of-Liquidity (Berachain's idea, adapted) separates *the
  reward for providing liquidity* (MWALI) from *the reward token itself* (KULA), so liquidity
  is a first-class, measurable, governance-relevant position rather than a side effect. MWALI
  can be paired back to KULA, wired into gauges, or used as governance weight without diluting
  KULA's own emission.

---

## 4. APIS — the MELEK-Engine fee token

**APIS** is the fee/utility token of **MELEK-Engine**, the Hive-Engine-style side-token layer
for the MELEK Graphene chain (the "BEE" analogue). It is burned to create tokens and to pay
engine resource fees.

The way you *get* APIS is the WorkerBee mechanic, re-mapped:

1. **Forever-lock wMELEK.** Wrapped MELEK, once bridged onto PRANA, can be **forever-locked**
   (there is no unstake) into the mine.
2. **Soulbound APIS-Hash.** A forever-lock mints **APIS-Hash**, a non-transferable
   (soulbound) mining-power unit — the staked-WORKERBEE equivalent.
3. **Mine APIS.** APIS-Hash drips **APIS** forever, at your stake-weighted share of the
   emission. It is *not* a loan: no debt, no liquidation, no cycle risk. You lock, you accrue,
   you claim.

The canonical off-chain mechanics (rate math, accrual checkpoints, the stake-weighted lottery
with injected RNG for determinism) live in `kulaswap/apis-workerbee.mjs`; the engine layer is
documented in `engine/README.md`. The soulbound, forever-locked design means APIS mining power
is earned and permanent, not rented and dumped.

---

## 5. veKULA — lock for boost + governance

Locking KULA into the **VoteEscrow** (`0x2a9da080BB38C9cfc4B9c8D7cFd4699fF57a5438`, max lock
**4 years** / 126,144,000 s) mints **veKULA**, the Curve-style vote-escrow position. veKULA
grants three things:

- a **yield boost** (up to ~2.5×) on your farm positions;
- **vote weight** to steer gauge emissions (which pools get KULA) via the `GaugeController`
  (`0x3858Bcd8CEE92FBDB0ECBC3946C67C112416A63C`);
- **dividend eligibility** for the staker real-yield slice.

veKULA is what makes KULA the *heart* of the farm rather than just a reward: long-term lockers
direct where new emission flows and are boosted for doing so. It decays toward zero as the lock
ages, so voting power reflects ongoing commitment.

---

## 6. CDP — lock KULA, borrow mMELEK

The `CDPVault` (`0x9cdAe72de19F93947cE3B4d5329FA81A5ef53ba2`) lets a KULA holder **lock KULA as
collateral and borrow** a synthetic **MelekBorrowNote** ("mMELEK",
`0x8c4B882D7379D35413E2a9202f63B53f893D1A9D`) at a **50% loan-to-value** ratio, priced by a
`SimplePriceOracle` (`0x905B3505037E49771B35F9f3944D8EC2B9eF3AFD`).

Two deliberate safety choices:

- **mMELEK is not the bridge wMELEK.** The CDP mints its own synthetic note, kept strictly
  separate from the bridge-backed wMELEK, so the bridge invariant *(wMELEK supply == MELEK
  locked in the bridge)* is never touched by borrowing. Borrow demand cannot inflate the
  bridge.
- **Minted only by the vault.** MelekBorrowNote's sole minter is the CDP vault; admin is the
  DAO Timelock; the deployer renounced admin.

---

## 7. Sinks — lottery, burn-mine, dividends

Every emission is paired with a sink so the faucet can run indefinitely without unbounded
inflation:

- **No-loss lottery** (`NoLossLotto`, `0xfE5CC3c2919c893a33690bf6b36d58Ae5A989dB3`) — the
  PoolTogether model: principal stays safe, the yield (plus the 10% KULA lottery slice and a
  cut of fees) funds prizes. Users get upside without risking capital.
- **BurnMine** — burn proof-of-liquidity into KULA at a fixed ratio (`burnPolForKula`), and a
  burn-to-enter raffle variant. A curated **BurnMineHub** hosts many burn contracts under one
  roof, each minting a curated output; the hub itself never mints.
- **Dividends** (`DividendDistributor`, stakers + miners instances) — stake KULA, receive a
  pro-rata share of real fee yield.

The design rule (`MintSinkGuard` in the contract set) is explicit: *every emission has a paired
sink*. That is what keeps a reward token from becoming a pure inflation machine.

---

## 8. The bridge

MELEK (Graphene L1) connects to PRANA (EVM) through the `GrapheneDepositBridge`
(`0xf8245a4c9A8af47760C45D8393A74Ea8EEF1E505`). MELEK locked on the Graphene side mints wrapped
MELEK (wMELEK) on PRANA; burning wMELEK releases MELEK. A **federated validator set**
(`FederatedBridgeValidatorSet`, 5 validators, **3-of-5 threshold**) authorises mints. The core
invariant is **wMELEK supply == MELEK locked** — which is exactly why the CDP (§6) mints a
separate synthetic instead of more wMELEK. The same wrapper pattern extends to wVKBT and wCURE
for the other ecosystem tokens.

---

## 9. The arcade — non-cashable PLAY

The KULA Arcade runs on a **non-cashable PLAY token**. This is a hard compliance line, not a
marketing choice: arcade play is a free, provably-fair, **non-cashable** play-token surface —
never a wager, never a cash-out, geofenced, and behind an education layer. Real-money mechanics
are out of scope and stay behind counsel. Gambling education (house edge, RTP, −EV, and
responsible-gambling help on every page) is separate and lives at the Gambling Education Center.

---

## 10. Governance & custody posture

- **No human minter.** KULA, MWALI, and MelekBorrowNote are all emission-only; their minter
  roles belong to contracts (EmissionScheduler, the gauge, the CDP vault), never to a person.
- **DAO Timelock.** Admin over the token set is the DAO Timelock
  (`0x574DeEaa82BcA4ACF6C5669D8dbe084C28EE0da4`) with a **2-day delay**; the deployer has
  **renounced** its admin rights on each token.
- **Keys.** The emission keeper fetches its signing key just-in-time and never writes it to
  disk. No private key material appears in this repo or on any public surface.
- **Source, verifiable.** The mainnet contracts are being verified on the PRANA block explorer
  (Blockscout, `pranascan.soapbox.community`) so any third party can read the exact source
  behind every address below.

---

## 11. Canonical mainnet addresses (PRANA, chainId 712217)

| Contract | Address | Role |
|---|---|---|
| KULA | `0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631` | reward/DeFi token (emission-only, cap 11M) |
| MWALI | `0x36C6921e2CECe9DEc7a5AAC42bC6738011F2a1c9` | proof-of-liquidity token |
| WPRANA | `0xCAbCaAeBBF7a7312b91A92Faa635d7a32Af42a34` | wrapped native PRANA |
| Router | `0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5` | KulaSwap (Uniswap-V2) router |
| Factory | `0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6` | KulaSwap pair factory |
| Pair KULA/WPRANA | `0x3fC307dEa06667f5a7a640Ec0aBb950EacC4B8C2` | the Kula-Ring liquidity pair |
| VoteEscrow (veKULA) | `0x2a9da080BB38C9cfc4B9c8D7cFd4699fF57a5438` | lock KULA → boost + votes |
| GaugeController | `0x3858Bcd8CEE92FBDB0ECBC3946C67C112416A63C` | directs KULA emission across pools |
| LiquidityGauge (KULA/WPRANA) | `0x46d92Ae6F5D55Eb5f12F222e44F0CDAC74E38e45` | mints MWALI to LPs |
| DividendDistributor (stakers) | `0xd9B52f758Aaab68BdEde7F84bE9bF6b2353E479A` | staker real-yield |
| DividendDistributor (miners) | `0x52a32920d4635AE0ab7F77b54679e9359D6Fa778` | miner dividend |
| NoLossLotto | `0xfE5CC3c2919c893a33690bf6b36d58Ae5A989dB3` | no-loss prize pot |
| SimplePriceOracle | `0x905B3505037E49771B35F9f3944D8EC2B9eF3AFD` | CDP collateral price |
| MelekBorrowNote (mMELEK) | `0x8c4B882D7379D35413E2a9202f63B53f893D1A9D` | CDP borrow synthetic |
| CDPVault | `0x9cdAe72de19F93947cE3B4d5329FA81A5ef53ba2` | lock KULA → borrow |
| DAO Timelock | `0x574DeEaa82BcA4ACF6C5669D8dbe084C28EE0da4` | 2-day admin timelock |
| GrapheneDepositBridge | `0xf8245a4c9A8af47760C45D8393A74Ea8EEF1E505` | MELEK ↔ PRANA bridge |
| EmissionScheduler | `0x611Ad02Ebe7F3FfE2050449Def20d6775E875323` | sole KULA minter |
| PRANA (compute) | `0xE92E94C4929ea9D6EF7BFB8B3e192D66951Ab661` | compute-stack settlement token |

---

## 12. Sources in the repo

This paper is grounded in the working code and records, not marketing copy:

- `kulaswap/kula-farm.mjs` — the KULA emission-split / APR / ve-boost / lottery-pot model.
- `kulaswap/apis-workerbee.mjs` — the APIS forever-lock mining mechanics.
- `kulaswap/kula-cdp.mjs`, `kulaswap/kula-gauge.mjs`, `kulaswap/kula-econ.mjs` — the CDP,
  gauge, and economics helpers.
- `engine/README.md` — MELEK-Engine (APIS/DRONE) side-token layer.
- The mainnet deploy record on the PRANA contracts box
  (`deployments.json` → `kula{}`, with the constructor arguments in the forge broadcast).

*Parameters here are the ones live at publication. Governance can change any of them; always
read the current on-chain values and the verified source before acting.*
