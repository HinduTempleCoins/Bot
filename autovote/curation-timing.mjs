/**
 * autovote/curation-timing.mjs — PURE per-chain optimal-vote-delay logic.
 *
 * No I/O, no chain access. Deterministic and unit-tested (curation-timing.test.mjs).
 * The vote engine consults this to decide WHEN to fire a curation vote so we
 * capture the maximum curation reward each chain's reward mechanic allows.
 *
 * ── The mechanic, per chain (this is why the delay differs) ──────────────────
 *
 *   HIVE  — Since Hardfork 25 "Equilibrium" (30 Jun 2021) the 5-minute reverse
 *           auction was REMOVED. Curation is shared near-linearly by stake among
 *           everyone who votes within the 24h window; there is NO early-vote
 *           penalty and NO front-run reward. So: vote PROMPTLY (a small settle
 *           delay only). Timing optimization is effectively dead on Hive —
 *           stake and post-selection are what matter.
 *           (Source: hiveio "Hive Hardfork 25 Equilibrium"; @tarazkp / @themarkymark
 *            post-HF25 curation posts.)
 *
 *   STEEM — Retains the 5-minute LINEAR reverse auction. Voting before the window
 *   BLURT   closes donates a linear fraction of your curation back to the reward
 *           pool: vote at 1 min → forfeit ~80%, 2 min → ~60%, ... 5 min → keep
 *           100%. So: schedule the vote for ~5 min (300s) after the post's
 *           creation time, plus a small buffer, and NEVER fire before 5 min.
 *           (Source: steem.center "Rewards"; @sacrosanct "HiveBasics" [now the
 *            historical Hive shape, current Steem/Blurt shape]; Blurt @rycharde
 *            "Why Are Curation Rewards on Blurt Almost Always Half the Vote".)
 *
 * The "optimal time to vote" (classic @steemitromney idea) is exactly this: vote
 * right at the window edge to keep 100% curation while still beating later curators.
 */

/**
 * Per-chain curation-timing constants. All times in SECONDS.
 *
 *   reverseAuctionSec — length of the linear reverse auction (0 = none).
 *   bufferSec         — small pad added past the auction edge so the window has
 *                       fully closed before we fire (clock skew / block lag).
 *   promptDelaySec    — for no-auction chains: a small settle delay (lets the
 *                       post propagate / settle) but no penalty either way.
 */
export const CHAIN_TIMING = {
  // Hive: no reverse auction post-HF25 → vote promptly within the 24h window.
  hive: { reverseAuctionSec: 0, bufferSec: 0, promptDelaySec: 20 },

  // Steem: 5-min linear reverse auction → fire at ~5:20 after post time.
  steem: { reverseAuctionSec: 300, bufferSec: 20, promptDelaySec: 0 },

  // Blurt: same 5-min linear reverse auction shape as Steem.
  blurt: { reverseAuctionSec: 300, bufferSec: 20, promptDelaySec: 0 },

  // MELEK testnet: treat like a no-auction chain (vote promptly). The MELEK
  // chain is a Graphene/Blurt fork; if a reverse auction is enabled there later,
  // give it its own entry. Until then, prompt is correct + harmless on testnet.
  'melek-testnet': { reverseAuctionSec: 0, bufferSec: 0, promptDelaySec: 0 },
};

/** Default for an unknown chain: be conservative and treat it like Steem/Blurt. */
export const DEFAULT_TIMING = { reverseAuctionSec: 300, bufferSec: 20, promptDelaySec: 0 };

/** The 24h window after which a vote earns no/curtailed curation on these chains. */
export const CURATION_WINDOW_SEC = 24 * 3600;

/** Look up the timing profile for a chain id (case-insensitive, soft-fall to default). */
export function timingFor(chain) {
  const key = String(chain || '').toLowerCase();
  return CHAIN_TIMING[key] || DEFAULT_TIMING;
}

/**
 * optimalVoteDelaySeconds(chain, postAgeSeconds, config?) → number ≥ 0
 *
 * Returns how many MORE seconds to wait (from now) before firing the vote, given
 * how old the post already is (postAgeSeconds, seconds since the post's creation).
 *
 *   No-auction chain (Hive/MELEK):
 *     delay = max(0, promptDelaySec − postAge)   (a small settle delay, never negative)
 *
 *   Reverse-auction chain (Steem/Blurt):
 *     target = reverseAuctionSec + bufferSec      (e.g. 320s = 5:20)
 *     delay  = max(0, target − postAge)
 *     → if the post is already past the auction edge, delay is 0 (fire now);
 *       if it's brand new, we wait until ~5:20 to keep 100% curation;
 *       we CLAMP so we never return a delay that would fire before the edge.
 *
 * `config` overrides (all optional, seconds):
 *   minDelaySec        — a floor applied to the result (e.g. the user's own delayMs/1000).
 *   maxDelaySec        — a ceiling (so a clock-skewed postAge can't push the delay absurdly high).
 *   bufferSec          — override the per-chain auction buffer.
 *   promptDelaySec     — override the per-chain prompt settle delay.
 *   reverseAuctionSec  — override the per-chain auction length (testing / future chains).
 *
 * Pure: same inputs → same output. No clock read.
 */
export function optimalVoteDelaySeconds(chain, postAgeSeconds, config = {}) {
  const t = timingFor(chain);
  const age = Math.max(0, Number(postAgeSeconds) || 0);

  const reverseAuctionSec = num(config.reverseAuctionSec, t.reverseAuctionSec);
  const bufferSec = num(config.bufferSec, t.bufferSec);
  const promptDelaySec = num(config.promptDelaySec, t.promptDelaySec);

  let delay;
  if (reverseAuctionSec > 0) {
    // Reverse-auction chain: aim for just past the auction edge.
    const target = reverseAuctionSec + bufferSec;
    delay = Math.max(0, target - age);
  } else {
    // No-auction chain: a small settle delay only; never negative.
    delay = Math.max(0, promptDelaySec - age);
  }

  // Apply optional floor/ceiling.
  const minDelaySec = num(config.minDelaySec, 0);
  if (delay < minDelaySec) delay = minDelaySec;
  if (config.maxDelaySec != null) {
    const max = num(config.maxDelaySec, Infinity);
    if (delay > max) delay = max;
  }

  return Math.round(delay);
}

/**
 * Convenience for the engine: given an event time (ms) and the post's creation
 * time (ms), return the absolute fireAt (ms) that captures full curation,
 * never earlier than `floorMs` (the user's own configured delay floor).
 */
export function optimalFireAtMs(chain, { nowMs, postTimeMs, floorMs = 0, config = {} } = {}) {
  const now = Number(nowMs) || Date.now();
  const postAgeSec = postTimeMs != null ? Math.max(0, (now - Number(postTimeMs)) / 1000) : 0;
  const delaySec = optimalVoteDelaySeconds(chain, postAgeSec, config);
  const fireAt = now + delaySec * 1000;
  return Math.max(fireAt, now + Math.max(0, Number(floorMs) || 0));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
