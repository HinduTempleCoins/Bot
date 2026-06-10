# What is a Witness?

[← Back to index](./index.md)

A **witness** is a trusted account that the community elects to **produce blocks** and help run the
chain. MELEK uses **Delegated Proof of Stake (DPoS)**, the same consensus model as Steem, Hive, and
BLURT — so if you understand witnesses there, you already understand them here.

## The short version

- Instead of everyone mining, the community **votes** for a small set of block producers.
- Votes are **stake-weighted**: the more MELEK Power you hold, the heavier your vote counts.
- The top witnesses by vote take turns, every **3 seconds**, signing the next block.
- A witness that does its job earns the right to keep producing; one that misses blocks or runs old
  software loses votes and falls out of the active set.

This is the chain's accountability loop: block production is a job, and the electorate can fire you.

## What a witness actually does

1. **Produces blocks.** When it is your turn in the schedule, your node bundles the pending
   transactions into a block, signs it with your **signing key**, and broadcasts it. Miss your turn
   and the block is empty and counts as a **missed block** against your record.
2. **Publishes a price feed.** Witnesses publish what the token is worth (a `feed_publish`
   operation). On Hive this sets the HIVE→HBD conversion rate. **On MELEK the feed is informational
   only** — MELEK is single-token, so there is no conversion to compute, but publishing it keeps
   parity with the ecosystem and signals that the witness is alive and attentive.
3. **Sets chain parameters.** Through `witness_update` a witness declares its node version, signing
   key, URL, and proposed values for things like the **account-creation fee** and **maximum block
   size**. The chain takes the **median** of the active witnesses' proposals, so no single witness
   sets policy alone.
4. **Stays current.** Witnesses are expected to run the latest node software so hardforks activate
   cleanly. Running an old version is visible on-chain and costs votes.

## The witness schedule (the 21 slots)

On Hive/Steem the active schedule is **21 witnesses per round**: the **top 20 by stake-weighted vote**
plus **one rotating "backup"** slot drawn from the runners-up, so smaller witnesses still occasionally
produce and prove their nodes work. MELEK follows the same Graphene schedule model.

Within a round the order is shuffled, and each witness gets one block. A witness near the top of the
vote list is **never** guaranteed every block — it gets one slot per round like everyone else; the
vote ranking determines whether you are *in* the active set at all.

## Hathor's special case (and its limits)

The MELEK AI witness, **`hathor`**, has a **one-year slot protection**: for the chain's first year its
active slot is guaranteed at the **chain-code** level, so it produces from genesis without first
winning an election. This is **scoped to `hathor` alone** and **time-limited** — after one year Hathor
reverts to ordinary stake-weighted election like every other witness. The protection lives in the
chain code, not in any witness's own software. Apart from that bounded slot, Hathor behaves as a
normal witness account.

## Why it matters to you

- **As a member:** the witnesses you vote for decide who secures the chain and what the
  account-creation fee and block size are. Your vote is real governance — see
  [How to vote for witnesses](./how-to-vote-for-witnesses.md).
- **As a would-be witness:** running a witness is a public service with a public scorecard (your
  missed-block count and version are on-chain forever). See
  [How to run a MELEK witness](./how-to-run-a-witness.md).

---

**Adapted from:** Hive/Steem DPoS design (`developers.hive.io`, the Steem/Hive whitepapers) and the
witness-operator practices documented by **Someguy123** in `hive-witness-essentials`. See the
[docs reference](../../knowledge/ecosystem/steem-hive-blurt-docs.md).
