// spamtest/limits.mjs — the rate-limit MODEL (pure, no network, no keys).
//
// Old-queue #299: "have a Bot Spam the Forum, and see how we can Rate Limit that...
// we want AI Residents, but we don't want them Spamming."
//
// There are TWO layers that throttle a spamming account on MELEK, and an AI Resident
// must respect BOTH. This module encodes both as pure functions so the runner can
// pre-flight a spam plan offline (dry-run) and the condenser/trollbox can throttle a
// resident BEFORE it ever reaches the chain.
//
//   LAYER 1 — CHAIN CONSENSUS (hard, every node rejects identically)
//   ----------------------------------------------------------------
//   MELEK is a Steem-era Graphene fork, so it ships the classic anti-spam rules
//   baked into consensus. These are NOT configurable per-app — every witness enforces
//   them, and a transaction that violates one is rejected at broadcast. Values below
//   are DEFAULTS decoded from the live testnet get_config (2026-06-06); the live values
//   override them when probe.mjs feeds a real config in (so this file never goes stale).
//
//     • Root-post interval   STEEM_MIN_ROOT_COMMENT_INTERVAL  300_000_000 µs → 300 s (5 min)
//     • Reply interval        STEEM_MIN_REPLY_INTERVAL          20_000_000 µs →  20 s
//     • Comment-edit interval STEEM_MIN_COMMENT_EDIT_INTERVAL    3_000_000 µs →   3 s
//     • Vote interval         STEEM_MIN_VOTE_INTERVAL_SEC                3 s
//     • Voting mana           target_votes_per_period / vote_power_reserve_rate over
//                             STEEM_VOTING_MANA_REGENERATION_SECONDS (votes deplete a
//                             5-day-regenerating pool; over-voting just costs ~nothing
//                             per vote but power decays → diminishing weight).
//
//   LAYER 2 — BANDWIDTH / RESERVE-RATIO (soft, stake-weighted)
//   ----------------------------------------------------------------
//   Each account has a rolling bandwidth average over a 7-day window
//   (STEEM_BANDWIDTH_AVERAGE_WINDOW_SECONDS = 604800). The transaction size an account
//   may consume is proportional to its share of total vesting stake (VESTS), scaled by
//   the network reserve_ratio (which the chain raises when blocks are empty and drops
//   when they're full, up to STEEM_MAX_RESERVE_RATIO). A zero-stake account (a fresh
//   faucet account like spambot1, 0.45 VESTS) gets a tiny allowance — it can post a few
//   times then hits "bandwidth limit exceeded" until either time passes or it's
//   delegated more VESTS. THIS is the real throttle on a spamming AI resident: it can't
//   buy its way past consensus intervals, and it can't out-post its stake.
//
//   LAYER 3 — APPLICATION (ours, the condenser / trollbox)
//   ----------------------------------------------------------------
//   The two chain layers are coarse and chain-wide. The thing WE control — and the
//   actual deliverable of #299 — is an off-chain rate limiter at the condenser/trollbox
//   boundary that (a) refuses an AI resident's op before it wastes a chain round-trip,
//   (b) is tunable per-account-class (human / verified resident / unverified), and
//   (c) gives a human-legible reason. `applicationLimiter()` below is that limiter.
//
// All times in this module are SECONDS unless a name ends in _US (microseconds, the
// chain's native unit). Pure + deterministic — inject `now` for tests.

// ── chain consensus defaults (decoded from live testnet get_config 2026-06-06) ──────
export const CHAIN_DEFAULTS = Object.freeze({
  rootCommentIntervalUs: 300_000_000, // 5 min between top-level posts
  replyIntervalUs: 20_000_000,        // 20 s between replies/comments
  commentEditIntervalUs: 3_000_000,   // 3 s between edits of the same comment
  voteIntervalSec: 3,                 // 3 s between votes
  bandwidthWindowSec: 604_800,        // 7-day rolling bandwidth average
  maxReserveRatio: 20_000,            // reserve-ratio ceiling
  maxTransactionSize: 65_536,         // bytes
  blockIntervalSec: 4,
  votingManaRegenSec: 432_000,        // 5-day voting-power regeneration
  votePowerReserveRate: 50,           // votes/period before power drops materially
});

const US_PER_SEC = 1_000_000;

/**
 * Build a chain-limit checker from a chain config object. Pass the raw get_config
 * result (probe.mjs supplies it from the live node); missing keys fall back to
 * CHAIN_DEFAULTS so this never throws on a partial config.
 *
 * @param {object} [config] raw get_config (STEEM_* keys) or {} for defaults
 */
export function chainLimits(config = {}) {
  const n = (key, dflt) => {
    const v = config[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  };
  const L = {
    rootCommentIntervalSec: n('STEEM_MIN_ROOT_COMMENT_INTERVAL', CHAIN_DEFAULTS.rootCommentIntervalUs) / US_PER_SEC,
    replyIntervalSec: n('STEEM_MIN_REPLY_INTERVAL', CHAIN_DEFAULTS.replyIntervalUs) / US_PER_SEC,
    commentEditIntervalSec: n('STEEM_MIN_COMMENT_EDIT_INTERVAL', CHAIN_DEFAULTS.commentEditIntervalUs) / US_PER_SEC,
    voteIntervalSec: n('STEEM_MIN_VOTE_INTERVAL_SEC', CHAIN_DEFAULTS.voteIntervalSec),
    bandwidthWindowSec: n('STEEM_BANDWIDTH_AVERAGE_WINDOW_SECONDS', CHAIN_DEFAULTS.bandwidthWindowSec),
    maxReserveRatio: n('STEEM_MAX_RESERVE_RATIO', CHAIN_DEFAULTS.maxReserveRatio),
    maxTransactionSize: n('STEEM_MAX_TRANSACTION_SIZE', CHAIN_DEFAULTS.maxTransactionSize),
    blockIntervalSec: n('STEEM_BLOCK_INTERVAL', CHAIN_DEFAULTS.blockIntervalSec),
    votingManaRegenSec: n('STEEM_VOTING_MANA_REGENERATION_SECONDS', CHAIN_DEFAULTS.votingManaRegenSec),
  };

  /** The minimum interval (seconds) the chain enforces between two ops of a kind. */
  function minIntervalFor(kind) {
    switch (kind) {
      case 'post': return L.rootCommentIntervalSec;
      case 'comment':
      case 'reply': return L.replyIntervalSec;
      case 'edit': return L.commentEditIntervalSec;
      case 'vote': return L.voteIntervalSec;
      default: return 0;
    }
  }

  return { params: L, minIntervalFor };
}

/**
 * Replay a time-ordered op plan against the chain's consensus INTERVAL rules and
 * report which ops the chain would ACCEPT vs REJECT (and why). This is the core of
 * the dry-run: it answers "if this spam bot fired these ops at these times, what
 * gets through?" without broadcasting anything.
 *
 * Bandwidth (Layer 2) is stake-dependent and can't be exactly computed off-chain
 * without the live reserve_ratio + the account's VESTS share; we model it as a
 * coarse allowance (see `bandwidthVerdict`) and flag it, rather than pretend
 * precision we don't have.
 *
 * @param {Array<{kind:string, tSec:number, sizeBytes?:number}>} ops
 *   tSec = seconds since an arbitrary epoch (monotonic). kind ∈ post|comment|reply|edit|vote
 * @param {object} [config] raw get_config (or {} for defaults)
 * @returns {{accepted:Array, rejected:Array, lastAt:Object, summary:Object}}
 */
export function replayChainConsensus(ops, config = {}) {
  const { minIntervalFor } = chainLimits(config);
  const lastAt = {};                 // kind → tSec of last accepted op of that kind
  const accepted = [];
  const rejected = [];

  for (const op of [...ops].sort((a, b) => a.tSec - b.tSec)) {
    const kind = op.kind;
    const minGap = minIntervalFor(kind);
    const prev = lastAt[kind];
    if (prev !== undefined && op.tSec - prev < minGap) {
      rejected.push({
        ...op,
        reason: `consensus: ${kind} too soon — need ${minGap}s gap, only ${(op.tSec - prev).toFixed(1)}s since last ${kind}`,
        retryAfterSec: +(prev + minGap - op.tSec).toFixed(1),
      });
      continue;
    }
    if (op.sizeBytes && op.sizeBytes > (config.STEEM_MAX_TRANSACTION_SIZE ?? CHAIN_DEFAULTS.maxTransactionSize)) {
      rejected.push({ ...op, reason: `consensus: transaction too large (${op.sizeBytes} bytes)` });
      continue;
    }
    accepted.push(op);
    lastAt[kind] = op.tSec;
  }

  const byKind = (arr) => arr.reduce((m, o) => ((m[o.kind] = (m[o.kind] || 0) + 1), m), {});
  return {
    accepted,
    rejected,
    lastAt,
    summary: {
      total: ops.length,
      accepted: accepted.length,
      rejected: rejected.length,
      acceptedByKind: byKind(accepted),
      rejectedByKind: byKind(rejected),
    },
  };
}

/**
 * Coarse bandwidth (Layer 2) verdict for an account, given its stake share and the
 * live reserve ratio. This is INTENTIONALLY approximate — the exact formula needs the
 * node's internal max_virtual_bandwidth; we model the qualitative truth: a near-zero-
 * stake account can afford only a handful of average-sized ops per bandwidth window.
 *
 * @param {object} a
 * @param {number} a.vestsShare      account VESTS / total VESTS  (0..1)
 * @param {number} [a.reserveRatio]  current network reserve ratio (default maxReserveRatio)
 * @param {number} [a.avgOpBytes]    average op size estimate (default 600 bytes)
 * @param {object} [config]
 * @returns {{affordableOpsPerWindow:number, windowSec:number, note:string}}
 */
export function bandwidthVerdict({ vestsShare, reserveRatio, avgOpBytes = 600 } = {}, config = {}) {
  const { params } = chainLimits(config);
  const rr = Number.isFinite(reserveRatio) ? reserveRatio : params.maxReserveRatio;
  // Qualitative model: the per-window byte allowance scales with stake share * reserve
  // ratio * a base block budget. We use the max block size as the per-block budget and
  // the window length in blocks. This produces the RIGHT SHAPE (zero stake → ~0 ops),
  // which is all the off-chain pre-flight needs; exact enforcement is the node's job.
  const windowBlocks = params.bandwidthWindowSec / params.blockIntervalSec;
  const perBlockShare = Math.max(0, vestsShare) * (rr / params.maxReserveRatio);
  const byteBudget = perBlockShare * params.maxTransactionSize * windowBlocks;
  const affordable = Math.floor(byteBudget / Math.max(1, avgOpBytes));
  return {
    affordableOpsPerWindow: affordable,
    windowSec: params.bandwidthWindowSec,
    note: vestsShare <= 0
      ? 'zero stake: only the chain free-bandwidth grace (a few ops) applies — then "bandwidth limit exceeded"'
      : `~${affordable} avg ops per ${(params.bandwidthWindowSec / 86400).toFixed(0)}-day window at this stake/reserve`,
  };
}

// ── LAYER 3 — the application limiter (the actual #299 deliverable) ─────────────────
//
// A token-bucket + sliding-minimum-interval limiter that the condenser/trollbox calls
// BEFORE accepting an op from a resident. It is stricter than consensus on purpose:
// consensus stops a flood; we want residents to behave like good citizens well inside
// the consensus ceiling, and we want a knob per account class.
//
// Policy classes (tunable): the numbers below are the recommended starting policy and
// are deliberately a bit tighter than chain consensus so the chain is never the thing
// telling a resident "no".

export const POLICY = Object.freeze({
  // unverified / brand-new accounts (incl. a rogue/buggy AI resident): tight.
  unverified: { post: { perHour: 2, minGapSec: 600 }, comment: { perHour: 10, minGapSec: 60 }, vote: { perHour: 40, minGapSec: 10 }, burst: 3 },
  // a registered AI resident (Hathor, Cheetah, operator-blessed bots): generous but bounded.
  resident:   { post: { perHour: 6, minGapSec: 300 }, comment: { perHour: 30, minGapSec: 20 }, vote: { perHour: 120, minGapSec: 4 }, burst: 5 },
  // humans on the condenser: loosest (they're slow anyway).
  human:      { post: { perHour: 10, minGapSec: 120 }, comment: { perHour: 60, minGapSec: 15 }, vote: { perHour: 200, minGapSec: 3 }, burst: 8 },
});

/**
 * Create a stateful application-layer limiter. Designed to live in the condenser /
 * trollbox process (or be backed by a shared store for multi-instance). Soft-fail
 * never throws — a check returns an allow/deny verdict the caller acts on.
 *
 * @param {object} [opts]
 * @param {object} [opts.policy]  one of POLICY.* (default POLICY.unverified)
 * @param {() => number} [opts.now]  ms-clock injector for tests (default Date.now)
 */
export function applicationLimiter({ policy = POLICY.unverified, now = Date.now } = {}) {
  // per-account, per-kind history of accepted op timestamps (ms), trimmed to 1h.
  const hist = new Map(); // account → { kind → number[] }

  function recentFor(account, kind, sinceMs) {
    const a = hist.get(account);
    if (!a || !a[kind]) return [];
    return a[kind].filter((t) => t >= sinceMs);
  }

  /**
   * Check whether `account` may perform `kind` right now. Pure read — does not record.
   * @returns {{ allowed:boolean, reason:string, retryAfterSec:number }}
   */
  function check(account, kind) {
    const rule = policy[kind];
    if (!rule) return { allowed: true, reason: 'no policy for kind', retryAfterSec: 0 };
    const t = now();
    const hourAgo = t - 3_600_000;
    const recent = recentFor(account, kind, hourAgo);

    // 1) per-hour quota
    if (recent.length >= rule.perHour) {
      const oldest = recent[0];
      const retry = Math.ceil((oldest + 3_600_000 - t) / 1000);
      return { allowed: false, reason: `app: ${kind} hourly quota ${rule.perHour} reached`, retryAfterSec: Math.max(1, retry) };
    }
    // 2) minimum gap since last accepted op of this kind
    const last = recent.length ? recent[recent.length - 1] : undefined;
    if (last !== undefined) {
      const gapSec = (t - last) / 1000;
      if (gapSec < rule.minGapSec) {
        return { allowed: false, reason: `app: ${kind} min gap ${rule.minGapSec}s (only ${gapSec.toFixed(1)}s)`, retryAfterSec: Math.ceil(rule.minGapSec - gapSec) };
      }
    }
    // 3) burst guard across ALL kinds in the last 10s
    const burstWindow = t - 10_000;
    let burstCount = 0;
    const a = hist.get(account);
    if (a) for (const k of Object.keys(a)) burstCount += a[k].filter((x) => x >= burstWindow).length;
    if (burstCount >= policy.burst) {
      return { allowed: false, reason: `app: burst guard — ${policy.burst} ops/10s`, retryAfterSec: 10 };
    }
    return { allowed: true, reason: 'ok', retryAfterSec: 0 };
  }

  /** Record an accepted op (call only after the op actually went through). */
  function record(account, kind) {
    const t = now();
    let a = hist.get(account);
    if (!a) { a = {}; hist.set(account, a); }
    if (!a[kind]) a[kind] = [];
    a[kind].push(t);
    // trim to last hour to bound memory
    const hourAgo = t - 3_600_000;
    a[kind] = a[kind].filter((x) => x >= hourAgo);
  }

  /** check + record in one call; returns the same verdict as check(). */
  function admit(account, kind) {
    const v = check(account, kind);
    if (v.allowed) record(account, kind);
    return v;
  }

  return { check, record, admit, _hist: hist };
}

// ── RESOURCE CREDITS (RC) — the depleting/recovering posting budget ──────────────────
//
// On this Steem HF23 fork, every account-authoring op (comment/post/vote/transfer/custom)
// is gated by RESOURCE CREDITS in addition to the consensus intervals above. RC is the
// successor to the old bandwidth model (Layer 2): an account holds a *mana pool*
// proportional to its staked VESTS/POWER, each op COSTS some RC, and the pool REGENERATES
// linearly back to full over a fixed window (STEEM_RC_REGEN_TIME = 5 days on this fork).
//
//   • An account with 0 delegated/staked VESTS has a ~0 RC pool → it literally CANNOT post
//     until it receives a delegation (this is exactly why witness/welcomer.mjs delegates
//     POWER to every new account before anything else).
//   • A funded account can post in bursts up to its pool size, then must wait for regen.
//   • Comment ops are the most expensive (state growth); votes are cheap; transfers mid.
//
// This is a MODEL, not the node's exact RC math (which needs the live state-bytes/exec/
// market pools). It captures the load-bearing truths #299 needs to design our throttle:
// 0-RC = fully blocked; bursts deplete; the pool recovers over time. Costs are tunable.
//
// NOTE on the comment interval: the task references STEEM_MIN_REPLY_INTERVAL_HF20 = 3 s.
// Pre-HF20 Steem used a 20 s reply interval; HF20 dropped it to 3 s (and replaced bandwidth
// with RC). chainLimits() above reports whatever the live get_config carries (probe.mjs
// feeds it), and CHAIN_DEFAULTS keeps the value decoded from this fork's live testnet. The
// HF20 floor is exported here so callers/tests can model the post-HF20 forum explicitly.
export const MIN_REPLY_INTERVAL_HF20_SEC = 3;

// Relative RC cost per op kind (arbitrary units; "comment is the expensive one"). The pool
// size below is denominated in these same units. Tune against live get_account RC data.
export const RC_COST = Object.freeze({
  post: 1500,      // root comment — most expensive (new permlink + state)
  comment: 1000,   // reply
  vote: 50,        // cheap
  transfer: 300,
  custom_json: 200,
});

// RC regenerates fully over this window (Steem RC_REGEN_TIME = 5 days).
export const RC_REGEN_SEC = 432_000;

/**
 * Create a stateful RC meter for ONE account. Models a mana pool that depletes as ops are
 * charged and regenerates linearly toward `max` over RC_REGEN_SEC. Inject `now` (ms) for
 * deterministic tests. Soft-fail: never throws; a check returns an allow/deny verdict.
 *
 * @param {object} [opts]
 * @param {number} [opts.max]      pool capacity in RC units (proportional to staked VESTS).
 *                                 0 ⇒ a zero-stake account: every op is blocked.
 * @param {number} [opts.current]  starting RC (default: full = max)
 * @param {number} [opts.regenSec] full-regen window seconds (default RC_REGEN_SEC)
 * @param {object} [opts.cost]     per-kind cost map (default RC_COST)
 * @param {() => number} [opts.now] ms clock injector (default Date.now)
 */
export function rcMeter({ max = 0, current, regenSec = RC_REGEN_SEC, cost = RC_COST, now = Date.now } = {}) {
  const capacity = Math.max(0, Number(max) || 0);
  let mana = current === undefined ? capacity : Math.max(0, Math.min(capacity, Number(current) || 0));
  let lastT = now();

  // RC units regenerated per millisecond (linear toward capacity).
  const perMs = capacity > 0 && regenSec > 0 ? capacity / (regenSec * 1000) : 0;

  /** Advance the pool to `now`, applying linear regen up to capacity. */
  function _regen() {
    const t = now();
    if (t > lastT && perMs > 0) {
      mana = Math.min(capacity, mana + (t - lastT) * perMs);
    }
    lastT = t;
  }

  function costOf(kind) {
    const c = cost[kind];
    return typeof c === 'number' && c >= 0 ? c : (cost.comment || 1000);
  }

  /** Current available RC (after regen). */
  function available() { _regen(); return mana; }

  /**
   * Would an op of `kind` be affordable right now? Advances the regen clock but does not
   * charge. Returns the chain-style verdict.
   * @returns {{ allowed:boolean, reason:string, have:number, need:number, retryAfterSec:number }}
   */
  function check(kind) {
    _regen();
    const need = costOf(kind);
    if (capacity <= 0) {
      return { allowed: false, reason: 'rc: account has no RC (0 staked/delegated VESTS) — cannot post until delegated POWER', have: 0, need, retryAfterSec: Infinity };
    }
    if (mana >= need) {
      return { allowed: true, reason: 'ok', have: Math.floor(mana), need, retryAfterSec: 0 };
    }
    const deficit = need - mana;
    const retry = perMs > 0 ? Math.ceil(deficit / perMs / 1000) : Infinity;
    return { allowed: false, reason: `rc: insufficient RC (have ${Math.floor(mana)}, need ${need})`, have: Math.floor(mana), need, retryAfterSec: retry };
  }

  /** Charge an op of `kind` (deplete the pool) IF affordable. Returns the verdict. */
  function charge(kind) {
    const v = check(kind);
    if (v.allowed) mana -= costOf(kind);
    return v;
  }

  return { check, charge, available, costOf, capacity, _now: now };
}

/**
 * simulateSpam — the headline #299 harness. Replay a spam burst of `ops` ops, fired every
 * `intervalMs`, against BOTH the consensus interval rules AND a depleting/recovering RC
 * budget, and report which ops would be ACCEPTED vs REJECTED and WHY. Fully offline +
 * deterministic (it runs on a virtual clock — no real waiting, no network).
 *
 * This answers the operator's question directly: "if a bot hammers the forum, what gets
 * through?" — and proves the chain's anti-spam (intervals + RC) spaces/blocks the flood.
 *
 * @param {object} args
 * @param {number} [args.ops=20]           how many ops the spam bot fires
 * @param {number} [args.intervalMs=0]     ms between fired ops (0 = instant flood, worst case)
 * @param {number} [args.rcBudget=0]       RC pool capacity (0 = zero-stake account → all blocked)
 * @param {string} [args.kind='comment']   op kind (post|comment|vote|transfer|custom_json)
 * @param {object} [args.config={}]        raw get_config for the consensus intervals
 * @param {number} [args.startMs=0]        virtual start time (ms)
 * @param {object} [args.cost=RC_COST]     per-kind RC cost map
 * @param {number} [args.regenSec]         RC regen window (default RC_REGEN_SEC)
 * @param {number} [args.minIntervalSec]   override the consensus interval for `kind`
 *                                         (e.g. MIN_REPLY_INTERVAL_HF20_SEC for the HF20 forum)
 * @returns {{
 *   accepted:Array, rejected:Array,
 *   summary:{ total:number, accepted:number, rejected:number, byReason:object },
 *   rcRemaining:number
 * }}
 */
export function simulateSpam({
  ops = 20,
  intervalMs = 0,
  rcBudget = 0,
  kind = 'comment',
  config = {},
  startMs = 0,
  cost = RC_COST,
  regenSec = RC_REGEN_SEC,
  minIntervalSec,
} = {}) {
  const { minIntervalFor } = chainLimits(config);
  let clock = startMs;
  const meter = rcMeter({ max: rcBudget, regenSec, cost, now: () => clock });

  const accepted = [];
  const rejected = [];
  let lastAcceptedSec; // tSec of last accepted op of this kind (consensus interval tracking)
  const minGapSec = typeof minIntervalSec === 'number' ? minIntervalSec : minIntervalFor(kind);

  for (let i = 0; i < ops; i++) {
    clock = startMs + i * intervalMs;
    const tSec = clock / 1000;
    const item = { i, kind, tSec, atMs: clock };

    // 1) consensus interval — the hard, every-node rule (comments 1/Ns).
    if (lastAcceptedSec !== undefined && tSec - lastAcceptedSec < minGapSec) {
      rejected.push({
        ...item,
        reason: `consensus: ${kind} too soon — need ${minGapSec}s gap, only ${(tSec - lastAcceptedSec).toFixed(2)}s since last`,
        retryAfterSec: +(lastAcceptedSec + minGapSec - tSec).toFixed(2),
      });
      continue;
    }

    // 2) RC budget — depletes per op, regenerates over time. 0 budget ⇒ always blocked.
    const rc = meter.check(kind);
    if (!rc.allowed) {
      rejected.push({ ...item, reason: rc.reason, retryAfterSec: rc.retryAfterSec });
      continue;
    }

    // Accept: charge RC + advance the consensus clock.
    meter.charge(kind);
    lastAcceptedSec = tSec;
    accepted.push({ ...item, rcAfter: Math.floor(meter.available()) });
  }

  const byReason = rejected.reduce((m, r) => {
    const tag = r.reason.startsWith('consensus') ? 'consensus-interval' : (r.reason.includes('no RC') ? 'rc-zero' : 'rc-depleted');
    m[tag] = (m[tag] || 0) + 1;
    return m;
  }, {});

  return {
    accepted,
    rejected,
    summary: { total: ops, accepted: accepted.length, rejected: rejected.length, byReason },
    rcRemaining: Math.floor(meter.available()),
  };
}
