# How to run a MELEK witness

[← Back to index](./index.md)

This is the operator's playbook: what a MELEK witness has to do, and how. It is adapted from
**Someguy123's `hive-witness-essentials`** (the de-facto Hive witness toolkit) and from this project's
own `witness/` code. MELEK is a **Steem HF23 fork with 3-second blocks**, so the mechanics are the same
as Hive/Steem; only the symbols differ (testnet **TESTS/TBD**, prefix **TST**; mainnet **MELEK/MBD**).

> **Key-safety note (important).** A witness needs a **signing key** loaded in its block-producing
> node, and uses its **active key** to publish ops like `feed_publish` and `witness_update`. This
> project's own deployment keeps the active key **out of the repo and off disk** (fetched only at the
> moment of use) and broadcasts through a separate signer boundary — but that is a project choice, not
> a chain rule. The chain only cares that valid signatures arrive. **Never** put your owner key on a
> witness server, and **never** commit any key. See [Keys explained](./keys-explained.md).

## The four jobs

A running witness does four things. The first is automatic once your node is configured; the other
three are ops you (or your tooling) broadcast.

### 1. Block production

Block production happens **inside the chain node** (`hived`), not in this repo. You:

1. Run a synced full node.
2. Tell it which witness account you are and give it the **signing key** so it can sign blocks.
3. Enable the witness/block-producer plugin.

When it is your turn in the [schedule](./what-is-a-witness.md), the node signs and broadcasts a block.
That's it — there's no per-block action for you. Your job is to keep the node **synced, current, and
up**. A node that is behind, crashed, or running an old version **misses blocks**, and missed blocks
are public and cost you votes.

> This project does **not** run the node binary from this repo — it lives on its own host. This repo's
> `witness/` modules are the *off-node* helpers: the feed publisher, the monitor, and bring-up checks.

### 2. The price feed (`feed_publish`)

A witness publishes a price feed so the chain (and the community) know it is alive and paying
attention. On Hive this sets the HIVE→HBD peg; **on MELEK it is informational** because MELEK is
single-token.

Good practice (from `hivefeed-js` and this repo's `witness/feed-publisher.mjs`):

- Compute a **robust median** of several price sources, not a single one, so one bad source can't move
  your feed.
- Publish on a timer (hourly is typical) **but only when the price has drifted** past a threshold or
  the last feed has gone **stale** — don't spam an unchanged feed.
- Make the whole thing **fail-safe**: if you can't get a price, publish nothing rather than a wrong
  number. This repo's publisher defaults to a dry run and can only broadcast if a signer is explicitly
  wired in — it cannot sign by itself.

### 3. `witness_update` — declaring yourself

`witness_update` is how you register/maintain your witness on-chain. It carries:

- your **block-signing public key** (rotate this if a signing host is ever compromised),
- your **witness URL** (a page describing who you are and your node — your pitch to voters),
- and your **proposed chain properties**: the **account-creation fee** and **maximum block size**
  (the chain uses the **median** of active witnesses' proposals, so you're voting on policy, not
  setting it).

> **Fork gotcha worth knowing:** on this Steem-fork codebase, some client libraries mis-serialize
> `witness_update`. The reliable path used during bring-up was the chain's own `cli_wallet`. If your
> `witness_update` is rejected with a serialization error, that's the likely cause — use a tool known
> to serialize correctly for this fork rather than assuming the op is wrong.

### 4. Monitoring & failover

You can't watch your node by hand 24/7, so witnesses run a **monitor** (this repo's
`witness/monitor.mjs`; upstream analogues are `witness-notify`, `monitorwitness`, `witness-monitor`):

- Watch your **missed-block counter** and alert the moment it ticks up.
- Watch that your node is **synced** (head block keeps advancing) and on the **right version**.
- Have a **backup signing node** ready and a way to switch the signing key to it if the primary fails
  (the pattern in `SteemWitnessAutoSwitch` / `BlurtWitnessAutoSwitch`). Only **one** node should hold
  the live signing key at a time, or you risk double-signing.

## A sane bring-up order

1. Sync a full node; confirm it reaches the head block.
2. Create/secure your witness account and its keys (owner offline; signing/active handled carefully).
3. Broadcast `witness_update` with your signing key, URL, and proposed properties.
4. Load the signing key into the node and enable block production.
5. Stand up the **feed publisher** and the **monitor** on timers.
6. Verify on a block explorer that you're producing and that your missed count stays flat.

## What this repo gives you

- `witness/feed-publisher.mjs` — keyless, drift-driven price-feed builder (signs only through an
  injected signer).
- `witness/monitor.mjs` — missed-block / sync / version monitor with alert sinks.
- `witness/bringup-check.mjs` — preflight checks for a witness bring-up.

---

**Adapted from:** Someguy123 `hive-witness-essentials` & `hivefeed-js`; `mahdiyari/witness-notify`;
`DoctorLai/SteemWitnessAutoSwitch`; `ericet/BlurtWitnessAutoSwitch`; `xeroc/witness-monitor`; and
this repo's `witness/`. Full pointers in the
[docs reference](../../knowledge/ecosystem/steem-hive-blurt-docs.md).
