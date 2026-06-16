# PRANA = DAO — governance layer for the MELEK/PRANA ecosystem

PRANA is the **governance coin** of the PRANA compute chain. It is *mined* via the pool (block-reward
emission), and the DAO it backs governs that very emission and the treasury it funds. This document is
the design of the off-chain governance layer (`prana-dao.mjs`) and the on-chain wiring that activates it.

The principle: **mine PRANA → delegate it → it becomes a vote.** The thing you can vote on is, recursively,
how the pool's PRANA emission is split. The DAO governs its own faucet.

---

## What the DAO controls

The DAO does not invent new mechanics — it takes **ownership of the admin keys** of contracts already
shipped in `/workspaces/PRANA/contracts/contracts/`. Everything below is governed by the `DAOTimelock`,
which has **no standing admin** (only self-administration via a passed proposal):

| Lever | Contract | Governed call | Effect |
|---|---|---|---|
| **Pool emission split** (the keystone) | `DAOFundEmissionSplit.sol` | `setDaoBps(uint16)` | Sets the bps slice of every pool block-reward inflow skimmed to the DAO fund; the rest forwards to the main rewards distributor. **Hard-capped on-chain at 2000 bps (20%)** so a captured DAO can never starve miners. |
| DAO fund destination | `DAOFundEmissionSplit.sol` | `setDaoFund(address)` | Where the skimmed slice lands (the treasury). |
| Main distributor destination | `DAOFundEmissionSplit.sol` | `setMainDistributor(address)` | Where the miner/contributor remainder forwards. |
| **Treasury** | `DAOTimelock.sol` | any `target.call{value}(data)` queued by the Governor | The timelock *is* the treasury owner; spending is a normal proposal. |
| **Contributor payouts** | `RewardsDistributorMerkleEpoch.sol` | `postEpoch(uint256,bytes32,uint256)` | Posts the weekly immutable Merkle root + funded amount for the contributor-slice epoch payout (Curve/Hop style). |

### The pool-emission split, concretely

The consensus reward skim → `FeeAddress` → `RewardRouter`/treasury path (`.local/PRANA_EVM_OPTIONS`)
lands PRANA into `DAOFundEmissionSplit`. Anyone calls `distribute(token)`; it sends `daoBps` of the
held balance to `daoFund` and the remainder to `mainDistributor`. The DAO's single most important power
is retuning `daoBps` — i.e. **how much of the block reward the community keeps vs. pays straight to
contributors.** `emissionSplitPreview()` models a richer multi-bucket breakdown (treasury / contributors
/ burn / …) off-chain and derives the equivalent on-chain `daoBps` (= everything not routed to the main
distributor).

---

## The proposal lifecycle (as wired)

Standard OpenZeppelin 5.x governance stack — `GovernorDAO` + `DAOTimelock` + `GovernanceToken` (PRANA):

```
 delegate()         propose()        castVote()         queue()            (minDelay)        execute()
   PRANA   ───────►  PENDING ──────►  ACTIVE  ──────►  SUCCEEDED ──────►   QUEUED   ──────►  EXECUTED
 activate vote      (votingDelay)   (votingPeriod)    quorum + For>Against  timelock delay   anyone executes
                                       └──► DEFEATED (no quorum, or Against ≥ For)
```

1. **Delegate** — PRANA is `ERC20Votes`; a holder must `delegate(self)` (or to a delegate) to activate
   voting weight. `buildDelegateTx`.
2. **Propose** — `GovernorDAO.propose(targets[], values[], calldatas[], description)`. `proposalThreshold`
   is 0 on the dev/test deployment (anyone with any votes may propose). `buildProposeTx` with one or more
   `{target,value,calldata}` actions (e.g. `buildEmissionSplitAction`). The proposal id is derived from
   `keccak256(description)` + the action arrays.
3. **Vote** — after `votingDelay` (1 block) the proposal is `ACTIVE` for `votingPeriod` (50 blocks on
   testnet). `castVote(proposalId, support)` — 0 Against / 1 For / 2 Abstain (`GovernorCountingSimple`).
   `buildVoteTx`; with a reason → `castVoteWithReason`.
4. **Quorum + tally** — quorum is 4% of checkpointed PRANA supply (`GovernorVotesQuorumFraction(4)`);
   For + Abstain count toward quorum, For must exceed Against → `SUCCEEDED`, else `DEFEATED`.
5. **Queue** — `queue(targets[], values[], calldatas[], descriptionHash)` schedules the call into the
   `DAOTimelock`, starting its `minDelay` clock. `buildQueueTx`.
6. **Execute** — once `minDelay` elapses, `execute(...)` runs the call. The timelock's executor is the
   OZ open-executor sentinel (`address(0)`), so **anyone** can execute a ripe proposal — no keeper
   dependency. `buildExecuteTx`.

`proposalState()` mirrors this lifecycle off-chain for the UI; on-chain `GovernorDAO.state()` is
authoritative.

---

## Akasha is the voting wallet

DAO actions are **unsigned tx descriptors** — `{ to, data, value, chainId: 108369 }` — exactly the shape
`kula-cdp.mjs` produces. The user signs them with their **Akasha** wallet (ethers v6 / EIP-1193), the same
wallet that already fronts the pool + chain. This module **never signs and never broadcasts** — it only
*describes* the call and hands the descriptor to the connected wallet:

```js
import { buildVoteTx } from './prana-dao.mjs';
const tx = buildVoteTx({ governor: ADDR.governor, proposalId, support: 1 });
await akashaSigner.sendTransaction(tx);   // Akasha signs + broadcasts to rpc.prana.melek.salon
```

The `descriptionHash` needed for `queue`/`execute` is `keccak256(utf8(description))`; Akasha/ethers
computes it (this module stays dependency-free — no ethers import). The DAO tab fragment
(`renderDaoFragment`) wires Vote / Queue / Execute buttons to global handler fns the host page defines
to perform exactly that sign-and-send.

---

## The module — `prana-dao.mjs`

Pure, offline, soft-fail-never-throw. ESM. Selectors are the **real keccak256 4-byte selectors** of the
OZ Governor / target ABIs; the dynamic ABI encoding (`address[]`, `bytes[]`, `string`) is hand-rolled
and verified **byte-for-byte against ethers AbiCoder** in the test suite.

- `votingPower({pranaBalance, pranaStaked, lockBoost, maxBoost})` — gov weight = held + staked·(1+boost).
  Plain held PRANA gets no boost; locked/staked PRANA earns up to `maxBoost` (veCRV-style, mirrors
  `VoteEscrow.balanceOf`).
- `proposalState(proposal, {now, quorum, votesFor, votesAgainst, votesAbstain})` →
  `{state, quorumReached, succeeded}`; states pending/active/succeeded/defeated/queued/executed/canceled.
- `buildProposeTx / buildVoteTx / buildQueueTx / buildExecuteTx / buildDelegateTx` — unsigned descriptors.
- `buildEmissionSplitAction / buildSetDaoFundAction / buildSetMainDistributorAction / buildPostEpochAction`
  — the governed `{target,value,calldata}` actions to drop into a proposal.
- `emissionSplitPreview({totalEmission, splits, mainBucket})` — previews a multi-bucket split, enforces
  sum = 10000 bps, derives the on-chain `daoBps`.
- `renderDaoFragment({voter, proposals, now, handlers})` — esc()'d HTML for the Akasha "DAO" tab.

**Selectors used** (verified via ethers): `propose 0x7d5e81e2`, `castVote 0x56781388`,
`castVoteWithReason 0x7b3c71d3`, `queue 0x160cbed7`, `execute 0x2656227d`, `delegate 0x5c19a95c`,
`setDaoBps 0xe7739e7d`, `setDaoFund 0x2c559d27`, `setMainDistributor 0xd50ce69f`, `postEpoch 0x41822f2b`.

---

## On-chain activation steps

The contracts exist; activation is **deploy + parameterize + transfer ownership** (no new Solidity):

1. **Deploy `GovernanceToken`** as PRANA's `ERC20Votes` vote token (or wrap/point at the existing PRANA
   token if it already exposes `ERC20Votes`). Holders must `delegate` to activate weight.
2. **Deploy `DAOTimelock(minDelay, governor)`** — pick `minDelay` (e.g. 48h mainnet; short on testnet).
   The wrapper bakes in the role layout: Governor = sole proposer/canceller, open executor, no admin.
   *(Deploy order: Governor needs the timelock address and the timelock needs the governor address —
   deploy with CREATE2 / a two-step where the Governor is deployed first and passed in, per the wrapper's
   `(minDelay, governor_)` signature.)*
3. **Deploy `GovernorDAO(pranaVotesToken, timelock)`** — tune `votingDelay` / `votingPeriod` /
   `proposalThreshold` / quorum fraction for mainnet (the testnet defaults are 1 / 50 / 0 / 4%).
4. **Transfer the emission-split admin to the timelock** — call
   `DAOFundEmissionSplit.grantRole(DEFAULT_ADMIN_ROLE, timelock)` then renounce the deployer's admin, so
   `setDaoBps/setDaoFund/setMainDistributor` are governable ONLY through a passed proposal.
5. **Transfer `RewardsDistributorMerkleEpoch` ownership to the timelock** (`transferOwnership(timelock)`)
   so contributor-epoch roots are posted by governance.
6. **Wire the pool reward skim** → `FeeAddress` → `RewardRouter` → `DAOFundEmissionSplit` (the consensus
   reward skim path in `.local/PRANA_EVM_OPTIONS_2026-06-10.md`), with `mainDistributor` =
   `RewardsDistributorMerkleEpoch` and `daoFund` = the treasury (the timelock or a treasury contract it owns).
7. **Fill addresses** into `kula-config-addresses.mjs` (governor / timelock / pranaVotes / emissionSplit /
   rewardsDistributor) once deployed — PUBLIC addresses only, overridable via `window.__KULA_ADDR__`.
8. **Surface the DAO tab** in Akasha via `renderDaoFragment` + handler fns that sign with the Akasha signer.

After step 4–5 the DAO governs the DAO's own plumbing: the only way to change the emission split, the
treasury, or the contributor payouts is **propose → vote → queue → wait the timelock → execute**, signed
by PRANA holders through Akasha.
