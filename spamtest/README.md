# spamtest/ — controlled forum spam test + rate-limit design (queue #299)

> Operator: *"have a Bot Spam the Forum, and see how we can Rate Limit that... we want
> AI Residents, but we don't want them Spamming."*

This module is the **apparatus + analysis** for that test. It lets us point a spam-bot at
the MELEK forum, see exactly what throttles it, and ship an off-chain rate limiter so a
well-behaved AI resident never even reaches the chain's "no".

Everything here is **dry-run / read-only by default**. The one mode that broadcasts
(`--broadcast`) is operator-present and **signer-gated** — there is zero WIF in this repo
or on the host by construction (BRIEF.md §7, CLAUDE.md custody rules). The runner talks to
MELEK-Signer over a scoped bearer token or it does nothing.

## The three layers that throttle a spammer

MELEK is a **Steem-era Graphene fork**, so it ships the classic anti-spam machinery in
consensus. An AI resident is throttled at three layers; the runner models all three.

| Layer | What | Enforced by | Live testnet value (probed 2026-06-06) |
|---|---|---|---|
| **1. Consensus intervals** | min time between ops of a kind | every witness, hard reject | post **300 s**, reply/comment **20 s**, vote **3 s**, comment-edit **3 s** |
| **2. Bandwidth / reserve-ratio** | stake-weighted byte budget over a rolling window | witnesses, soft | **7-day** window, reserve-ratio ≤ **20000**; a near-zero-stake faucet account (spambot1, 0.46 VESTS) affords only **~a handful of ops**, then `bandwidth limit exceeded` |
| **3. Application limiter** | per-account-class quotas + min-gap + burst guard | **us, the condenser/trollbox** — `limits.mjs` | tunable; see `POLICY` |

Layers 1 & 2 are coarse and chain-wide — they stop a *flood*, but they're not the right
tool for "good-citizen residents." Layer 3 is the actual **#299 deliverable**: an
off-chain limiter that lives in the condenser/trollbox, refuses an op *before* it wastes a
chain round-trip, gives a human-legible reason, and has a knob per account class
(`unverified` / `resident` / `human`). It's deliberately tighter than consensus so the
chain is never the thing telling a resident "no".

## Files

- **`limits.mjs`** — pure rate-limit model. `chainLimits(config)` decodes the live
  `get_config`; `replayChainConsensus(ops)` replays an op plan against the interval rules;
  `bandwidthVerdict(...)` models the stake-weighted budget; `applicationLimiter({policy})`
  is the stateful Layer-3 limiter (token-bucket + min-gap + burst guard) for the condenser.
- **`runner.mjs`** — the spam bot. `buildPlan(...)` composes a flood; `dryRun(plan)` reports
  what each layer would accept/reject (no network); `broadcastPlan(plan,{signer})` is the
  live, signer-gated path.
- **`probe.mjs`** — read-only live-chain probe. Reports the enforced limits from the live
  config + an account's recent op cadence. Injectable fetch → fully offline tests.

## Use

```bash
# READ-ONLY: what does the live forum actually enforce?
npm run spamtest:probe                       # or: node spamtest/probe.mjs --account spambot1

# DRY-RUN: fire 50 instant posts, see what survives (uses LIVE config, broadcasts nothing)
npm run spamtest                             # node spamtest/runner.mjs --count 50 --kind post
node spamtest/runner.mjs --count 30 --mix --policy resident
node spamtest/runner.mjs --count 50 --kind post --interval 400   # spaced past the interval

# LIVE (operator-present, signer-gated — set MELEK_SIGNER_URL + MELEK_SIGNER_TOKEN):
node spamtest/runner.mjs --count 20 --broadcast
```

## What the test shows (probed live, 2026-06-06)

A 50-post instant flood from spambot1: **1 of 50** ops reach the forum. Consensus rejects
49 ("post too soon — need 300s gap"); the bandwidth model independently caps a zero-stake
account at ~3 ops/window; the application limiter (unverified policy) also stops 49 with a
600s min-gap. The layers are redundant on purpose — defense in depth.

## Wiring the limiter into the condenser/trollbox

`applicationLimiter()` is the piece to embed at the op-accept boundary (the troll-box
signup chat in `src/trollbox/`, and any future condenser write path). Pattern:

```js
import { applicationLimiter, POLICY } from '../spamtest/limits.mjs';
const limiter = applicationLimiter({ policy: POLICY.resident });   // pick class per account
const v = limiter.admit(account, 'comment');
if (!v.allowed) return reject(v.reason, v.retryAfterSec);          // tell the resident to wait
// ...otherwise accept + broadcast
```

For a multi-instance condenser, back the limiter's history with a shared store (Redis /
the repo's `store/`) keyed by `account:kind`. The policy numbers in `POLICY` are the
recommended starting point — tune per launch.
