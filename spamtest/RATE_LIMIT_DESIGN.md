# Forum rate-limit design — what the chain enforces & how our throttle mirrors it (#299)

> Operator: *"have a Bot Spam the Forum, and see how we can Rate Limit that... we want AI
> Residents, but we don't want them Spamming."*

This note documents the anti-spam limits the MELEK testnet (a **Steem HF23 fork**) enforces,
and the design rule for the condenser-side throttle we put **in front** of those limits so a
well-behaved AI resident never even reaches the chain's "no". The model lives in
[`limits.mjs`](./limits.mjs); the harness that proves it is `simulateSpam(...)` (same file)
and `runner.mjs`.

## The limits we rely on (all chain-side, every witness enforces)

### 1. Consensus intervals — minimum time between two ops of a kind

| Op | Min interval | Constant |
|---|---|---|
| Root post | **300 s** (5 min) | `STEEM_MIN_ROOT_COMMENT_INTERVAL` |
| Reply / comment | **3 s** post-HF20 (was 20 s) | `STEEM_MIN_REPLY_INTERVAL_HF20` |
| Comment edit | **3 s** | `STEEM_MIN_COMMENT_EDIT_INTERVAL` |
| Vote | **3 s** | `STEEM_MIN_VOTE_INTERVAL_SEC` |

A transaction that violates one of these is **rejected at broadcast** — there is no buying
past it. `chainLimits(config)` decodes whatever the live `get_config` carries (so the model
never goes stale); `CHAIN_DEFAULTS` holds the values decoded from the live testnet, and the
HF20 reply floor is exported as `MIN_REPLY_INTERVAL_HF20_SEC`.

### 2. Resource Credits (RC) — a depleting/recovering posting budget

Post-HF20, every authoring op also costs **Resource Credits** from a per-account mana pool:

- The pool size is **proportional to the account's staked/delegated VESTS (POWER)**.
- **A 0-VESTS account has a ~0 RC pool and literally cannot post** until it receives a
  delegation. (This is exactly why `witness/welcomer.mjs` delegates POWER to every new
  account *before* anything else.)
- Each op spends RC — **comments/posts are the expensive ops** (state growth); votes are
  cheap. A funded account can burst up to its pool, then must wait.
- The pool **regenerates linearly back to full over 5 days** (`STEEM_RC_REGEN_TIME`).

`rcMeter({ max, ... })` models this exactly: it spends per op, blocks when the pool can't
cover the next op (with a `retryAfterSec`), and regenerates over time. `RC_COST` and
`RC_REGEN_SEC` are the tunable knobs. (The pre-HF20 bandwidth/reserve-ratio model is kept
as `bandwidthVerdict(...)` for completeness.)

### The combined chain verdict — `simulateSpam({ ops, intervalMs, rcBudget })`

This is the headline harness. It replays a burst of `ops` ops, fired every `intervalMs`,
against **both** the consensus interval **and** the RC budget, on a virtual clock (no
network, no waiting), and returns each op's accept/reject + reason:

- **Burst faster than the interval** → spaced out: only the first op of a 0-spacing flood
  clears the 3 s comment gap; the rest are `consensus-interval` rejections.
- **0-RC account** → every op blocked (`rc-zero`), regardless of spacing.
- **Spaced past the interval but RC runs out** → first N ops land, then `rc-depleted`.
- **RC regenerates mid-burst** → a later op that was unaffordable becomes affordable again.

## How our condenser-side throttle must mirror these

The chain limits are coarse and chain-wide — they stop a *flood*, but they are the wrong
tool for "good-citizen residents," and a chain rejection wastes a round-trip. So the
condenser/trollbox runs an **application limiter** (`applicationLimiter({ policy })`) at the
op-accept boundary, **deliberately tighter than consensus**, so the chain is never the thing
telling a resident "no". Design rules:

1. **Min-gap ≥ the chain interval, per kind.** Never let an op through that the chain would
   interval-reject. Our `POLICY` gaps sit at or above the consensus floor (e.g. comment
   `minGapSec` ≥ 3 s; post ≥ the 300 s root interval where practical).
2. **Treat RC as a real, finite budget — don't try to post from a 0-stake account.** Before
   accepting an op, the resident's account must have POWER (the welcomer guarantees this for
   new accounts). The limiter's per-hour quotas are sized so a resident stays comfortably
   inside its RC regen rate, never draining the pool.
3. **Per-account-class knobs.** `POLICY.unverified` (tight, for brand-new/unknown or
   buggy residents), `POLICY.resident` (generous but bounded, for blessed bots like Hathor
   and Cheetah), `POLICY.human` (loosest). A runaway resident is contained by its class.
4. **Burst guard across all kinds.** A short-window (10 s) cap on total ops catches a bug
   that fires a mixed flood faster than any single-kind gap would notice.
5. **Human-legible refusals.** Every deny returns a `reason` + `retryAfterSec` so the
   resident (or the UI) can back off correctly instead of hammering.

### Wiring it in

```js
import { applicationLimiter, POLICY } from '../spamtest/limits.mjs';
const limiter = applicationLimiter({ policy: POLICY.resident }); // pick class per account
const v = limiter.admit(account, 'comment');
if (!v.allowed) return reject(v.reason, v.retryAfterSec); // tell the resident to wait
// ...otherwise accept + broadcast
```

For a multi-instance condenser, back the limiter's history with a shared store (Redis / the
repo's `store/`) keyed by `account:kind`. The `POLICY` numbers are the recommended starting
point — tune per launch against live `get_account` RC data.

## Verifying against the live testnet (the other half of #299)

The model above is what we *expect*. To confirm the testnet actually enforces it:

1. `node spamtest/probe.mjs --account spambot1` — read-only: report the enforced intervals
   from the live `get_config` and the account's recent op cadence.
2. `node spamtest/runner.mjs --count 50 --kind comment` — dry-run the flood against the
   live config (broadcasts nothing) and confirm the predicted accept/reject counts.
3. `node spamtest/runner.mjs --count 20 --broadcast` — operator-present, **MELEK-Signer-gated**
   (zero WIF in this repo by construction): actually fire the flood and watch the chain
   reject it (`too soon` / insufficient RC). This is the live verification step.
