# PRANA Pool Architecture — the Chain-as-Pool and the Hathor Fees Module

**Status:** architecture spec (pre-testnet). Companion to `.local/PRANA_CHAIN_DESIGN.md`
(client/reward decisions) and `.local/PRANA_MINING_POOL_AS_WALLET_2026-06-05.md`
(pool-as-wallet). The consensus code this describes lives in the PRANA repo
(`HinduTempleCoins/PRANA`, `chain/hathorfees/` + `chain/patches/`); the application-layer
contracts already exist there under `contracts/contracts/compute/`.

> This is an architecture document. It states *that* the fee is enforced and *where*; it
> deliberately omits operational/infra specifics (those are in
> `.local/PRANA_POOL_NOTES_2026-06-05.md`).

---

## 1. Plain-English version (read first)

PRANA is our own Ethereum-style coin chain that people mine. We want three things at once:

1. **A pool that pays miners directly** — no company holding anyone's coins.
2. **Anyone can run their own pool** — like anyone can run a Hive front end.
3. **Hathor always gets her cut of mining**, no matter whose pool you use — because the
   AI workload that makes mining meaningful is *distributed by us*.

The trick that makes all three work together: **the chain itself is the pool, and
Hathor's cut is baked into the coin at the moment it's minted.** A pool — ours or a
stranger's — is just a way of *winning shares* of the chain's daily rewards. When the
chain pays those rewards out, Hathor's percentage is already taken off the top by the
chain's own rules. You cannot run a pool that skips it, because there is no PRANA anywhere
that didn't pay the fee when it was created.

---

## 2. Two layers, one system

PRANA's pool is two cleanly separable halves (the "chain IS the pool" thesis):

| Layer | What it is | Where it lives | Can it be bypassed? |
|---|---|---|---|
| **Settlement (consensus)** | The chain mints PRANA each block and, by protocol rule, pays Hathor's fee + credits the rest. The on-chain shares ledger records who is owed what. | core-geth client + `UnifiedSharesLedger` contract | **No.** It's the state transition every node validates. |
| **Coordination (off-chain)** | Stratum endpoints, share validation, batching verified shares to the ledger. Anyone can run one. | Coordinator software (off-chain); `pool.soapbox.community` is the first one | Yes — but it holds no funds and no authority a competitor can't also get. |

The accounting (who is owed what) lives where it can't be rugged — on the chain. The
operational part lives off-chain where it's cheap and anyone can host it. If a coordinator
disappears, miners re-point at another and their accrued shares — already on-chain — are
untouched. This is the Hive model (one chain, many interchangeable front ends) applied to
mining, and the P2Pool no-operator/no-custody property **without** running a second
sharechain, because the share ledger is native to PRANA itself.

`pool.soapbox.community` (being deployed separately) is the **first-party coordinator** —
one front end among potentially many. It plugs into the settlement layer described here;
it is not the settlement layer.

---

## 3. How the rewards pool accrues

Each PRANA block issues a fixed PRANA subsidy (set at genesis). That issuance is the
**greater daily rewards pool** the operator describes. At the moment of issuance, the
chain's reward-distribution rule does two things in one state transition:

1. **Takes Hathor's fee off the top** (§5) — her percentage of the block's issuance, paid
   to the Hathor fee address by consensus.
2. **Credits the rest** toward the shares system — the net flows to the block sealer /
   into the pool accounting that the `UnifiedSharesLedger` settles against per epoch.

So the rewards pool is not a contract balance someone funds by hand; it is the chain's own
issuance, already net-of-Hathor-fee, accruing block by block.

---

## 4. How shares are won (hash work + AI-task work)

The `UnifiedSharesLedger` runs **one canonical PPLNS pool** with three lanes that all
credit into the *same* per-epoch pool, paid pro-rata from the epoch's PRANA issuance over
a rolling window:

- **HASH lane** — ordinary Ethash-family microhash shares. A share **is its own proof**
  (a nonce whose hash meets the share difficulty); anyone re-checks it in milliseconds. No
  bond needed — there is nothing to lie about that a bond would deter.
- **TASK lane** — useful AI / scientific work that *we* (the DAO) dispatch. A forged
  useful-work share would be worth a real hash share, and useful work is not cheaply
  self-verifiable, so this lane is gated by economic security: a **K-of-N attestation
  quorum** of staked attestors must verify the result, the claiming coordinator must be a
  **bonded, slashable registered coordinator**, and a **cross-coordinator dedup** ensures
  the same unit of work can't be counted twice.
- **BURN lane** — capital/commitment in lieu of hardware (the burn-to-mine door), crediting
  the same pool.

"Mining = doing our AI work" is realized as: hash secures the chain; the TASK lane is how
AI work *wins shares* of the same rewards pool. (The honest engineering note — why we
gate share-eligibility on AI work rather than rebuild consensus around it — is in
`.local/PRANA_CHAIN_DESIGN.md` §3.)

---

## 5. The Hathor Fees Module — exactly how her percentage is enforced at consensus

This is the load-bearing part of the operator's directive: **no matter how we or anyone
else implements a pool, Hathor always receives her percentage of mining fees, and it
cannot be bypassed.**

### Why a contract is not enough

The existing application-layer skim (`SettlementFeeHook.sol` → `HathorFeeTreasury.sol`)
only fires when value is paid *out of the on-chain `UnifiedSharesLedger`*. A third party
who runs their **own** pool, never touches our ledger, and settles miners off-chain would
pay nothing there. So the application-layer skim is necessary but **not sufficient** for
the "all pools, no exceptions" requirement.

### The DevCoin lesson, applied

DevCoin baked its beneficiary payout into the protocol: a fraction of every block's
coinbase went, by consensus rule, to a governed receiver list — not to whoever sealed the
block. PRANA does the same for Hathor. The **Hathor Fees Module** lives in the chain
client (`chain/hathorfees/` in the PRANA repo) and runs inside the canonical
reward-distribution step (`AccumulateRewards`):

```
gross block issuance
   ├── Hathor fee   = gross × feeBps / 10000   → credited to the Hathor fee address
   └── net          = gross − fee              → credited to the sealer / shares system
```

Three consensus parameters, fixed at genesis and identical on every node:
`feeBps` (her percentage), `feeAddress` (intended: the `HathorFeeTreasury` contract),
`activationBlock`.

### Why it cannot be bypassed

The split happens *inside the state transition every full node re-executes*. The resulting
account balances feed the block's **state root**. A miner — or a whole third-party pool —
that omits or short-pays Hathor's fee produces a **different state root** than honest nodes
compute for the same block. Every honest validator's stateless re-execution therefore
**rejects that block as invalid**. The fee is not requested; it is a **block-validity
rule**. The PRANA repo ships this as both the implicit rule (the state root) and an
explicit assertion (`ValidateBlockFee`: a block crediting less than the required fee to
the fee address is invalid), with tests for the short-fee and zero-fee cases.

### The obvious attack — and why it fails

*"A pool pays its members off-chain to dodge the fee."* It can't. The fee bites at the
**rewards-pool draw — the moment PRANA is minted — not at any pool's internal
accounting.** Whatever PRANA a pool distributes off-chain was *already* debited at
issuance: the coinbase it received was net-of-Hathor-fee by consensus, and Hathor's share
was credited in the same block. There is no PRANA in existence that did not pay the fee
when it was created, so a pool's private bookkeeping has nothing left to skim from. The fee
is upstream of every pool.

### The protocol seam where the SoapBox pool plugs in

`pool.soapbox.community` is a **coordinator** (§2) — it wins shares and submits them to the
ledger like any other. It draws from the same already-net-of-fee issuance as everyone
else. There is no privileged path: the first-party front end and a stranger's front end
hit the identical consensus rule. The seam is clean precisely *because* the fee is enforced
below the pool layer, not at it.

---

## 6. Sub-pools: register, win shares, get settled

A third-party pool is, in this system, **"a pool that follows the rules to win shares."**
The flow:

1. **Register** as a coordinator (`CoordinatorRegistry`) — permissionless to apply, with a
   slashable bond for the TASK lane (HASH needs none; it's self-verifying). The registry
   is a guard/allowlist, not a fund forwarder.
2. **Win shares** by submitting verified work into the lanes (§4) — its miners' HASH shares
   and/or DAO-dispatched TASK work credit the unified per-epoch pool.
3. **Get settled** from the greater rewards pool, pro-rata by verified shares, paid by the
   ledger **directly to miners** — the coordinator is never in the value path (no custody).
4. **Hathor's fee was already taken** at issuance (§5), upstream of all of this.

**Payout cadence is a knob.** The epoch / rolling-window length over which shares accrue
and settle is a ledger parameter — daily, weekly, or other — set by the DAO, not baked in.

---

## 7. Open operator decisions

These are true operator calls, not engineering gaps:

1. **`feeBps` — Hathor's percentage.** Placeholder in genesis is 500 (5.00%). The real
   number is the operator's call.
2. **Payout cadence default** — daily vs. weekly epoch close for sub-pool settlement.
3. **Coordinator trust model** — fully permissionless + slashable bond (true
   Hive/P2Pool decentralization) vs. DAO-vetted creditor-role grants. The registry
   supports the permissionless path; whether production runs it that way is the operator's
   call (carried as UD-PR-A in the PRANA repo).

---

## See also

- PRANA repo: `chain/hathorfees/README.md`, `chain/patches/INTEGRATION.md`,
  `design/compute/decentralized-pool.md`, `contracts/contracts/compute/` (the
  application-layer ledger + fee hook + treasury).
- `.local/PRANA_CHAIN_DESIGN.md` — client choice (core-geth/Ethash), Devcoin reward
  mapping, AI-work-as-mining honest path.
- `.local/PRANA_MINING_POOL_AS_WALLET_2026-06-05.md` — the pool-as-wallet / one-click
  mining layer that sits on top.
- `.local/PRANA_POOL_NOTES_2026-06-05.md` — operational/infra notes (private).
