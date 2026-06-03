// arcade.mjs — server-side score + reward logic for a casual SoapBox arcade game (queue #190).
// Engine-agnostic: a Phaser/GDevelop client renders the game and calls into this layer for the
// authoritative session, score validation, leaderboard, and reward intent. The client is NEVER
// trusted — every score is re-checked here against the session's elapsed time and reported events.
//
// PURE-ish: all state lives in module-local maps, no network, no clock-faking surprises (time is
// injectable). Anti-cheat lives in `plausible()`. The reward faucet is INJECTED and dry-run by
// default — see reward().
//
//   import { startSession, submitScore, leaderboard, reward } from './arcade.mjs'
//   node integrations/games/arcade.mjs            # run a tiny self-demo
//
// REWARD SOURCING: payouts come from the externally-funded offerwall / advertiser faucet, NOT
// from chain emission and NOT from the witness treasury. The faucet is passed in by the caller
// (who owns the funding relationship); this module only computes a gated payout *intent*.

import { randomUUID } from 'node:crypto';

// injectable clock so tests are deterministic and the server can't be tricked by client time
let _now = () => Date.now();
export function __setNow(fn) { _now = fn || (() => Date.now()); }

// ---- in-memory stores (a real deployment swaps these for a shared store; the logic is the same) ----
const SESSIONS = new Map();   // token -> { user, startedAt, submitted }
const SCORES = [];            // { user, score, at } — accepted scores only

export function __reset() { SESSIONS.clear(); SCORES.length = 0; }

// ---- tunables for anti-cheat (a casual arcade; numbers are deliberately generous but finite) ----
export const RULES = {
  maxPointsPerEvent: 100,   // no single scored event is worth more than this
  maxPointsPerSecond: 250,  // hard rate ceiling regardless of events (catches time-warp cheats)
  maxSessionMs: 30 * 60_000, // a session older than 30 min is stale; scores rejected
  minSessionMs: 500,        // a "game" that lasted < 0.5s didn't really happen
};

// ---- session lifecycle ----

// startSession(user) -> opaque session token. Each token is single-use for submission.
export function startSession(user) {
  const u = String(user || '').trim();
  if (!u) throw new Error('startSession: user required');
  const token = randomUUID();
  SESSIONS.set(token, { user: u, startedAt: _now(), submitted: false });
  return token;
}

// ---- anti-cheat: is `score` plausible given elapsed time and the reported events? ----
// Returns { ok, reason }. PURE — no side effects, easy to unit test in isolation.
export function plausible({ score, events, elapsedMs }) {
  const s = Number(score);
  if (!Number.isFinite(s) || s < 0) return { ok: false, reason: 'score not a non-negative number' };
  if (!Number.isInteger(s)) return { ok: false, reason: 'score must be an integer' };
  if (!Number.isFinite(elapsedMs) || elapsedMs < RULES.minSessionMs) return { ok: false, reason: 'session too short' };
  if (elapsedMs > RULES.maxSessionMs) return { ok: false, reason: 'session expired' };

  const n = Number.isFinite(events) ? events : Array.isArray(events) ? events.length : null;
  if (n == null || n < 0) return { ok: false, reason: 'events required (count or array)' };

  // 1) can't score more than the per-event ceiling allows
  if (s > n * RULES.maxPointsPerEvent) return { ok: false, reason: 'score exceeds points possible for reported events' };

  // 2) can't score faster than the per-second ceiling allows (catches inflated/instant scores)
  const maxByTime = (elapsedMs / 1000) * RULES.maxPointsPerSecond;
  if (s > maxByTime) return { ok: false, reason: 'score exceeds max rate for elapsed time' };

  return { ok: true, reason: 'ok' };
}

// submitScore({sessionToken, score, events}) -> { accepted, score?, reason? }
// Validates: session exists, not already used, not expired, and score is plausible vs events/time.
export function submitScore({ sessionToken, score, events } = {}) {
  const sess = SESSIONS.get(sessionToken);
  if (!sess) return { accepted: false, reason: 'unknown or invalid session' };
  if (sess.submitted) return { accepted: false, reason: 'session already submitted' };

  const elapsedMs = _now() - sess.startedAt;
  const verdict = plausible({ score, events, elapsedMs });
  if (!verdict.ok) {
    sess.submitted = true; // burn the session on a rejected submit — one shot, no retry-fishing
    return { accepted: false, reason: verdict.reason };
  }

  sess.submitted = true;
  const entry = { user: sess.user, score: Number(score), at: _now() };
  SCORES.push(entry);
  return { accepted: true, score: entry.score };
}

// leaderboard({ limit }) -> top scores, highest first (ties broken by earliest achieved).
export function leaderboard({ limit = 10 } = {}) {
  return [...SCORES]
    .sort((a, b) => (b.score - a.score) || (a.at - b.at))
    .slice(0, limit)
    .map((e, i) => ({ rank: i + 1, user: e.user, score: e.score, at: e.at }));
}

// ---- reward: a payout INTENT, gated by the externally-funded faucet ----
// reward(score, { faucet }) -> { funded, amount, intent }
// The faucet is INJECTED and represents the offerwall/advertiser pool. With no faucet (or a
// dry-run faucet) nothing is paid — we only emit the intent the caller can later fund. Rewards
// are NOT chain emission and NOT treasury spend; they come from the advertiser faucet only.
export function payoutFor(score) {
  // 1 unit per 1000 points, capped — casual, advertiser-funded micro-rewards.
  return Math.min(10, Math.floor((Number(score) || 0) / 1000));
}

export function reward(score, { faucet } = {}) {
  const amount = payoutFor(score);
  const intent = { kind: 'arcade-reward', score: Number(score) || 0, amount, source: 'offerwall-faucet' };

  // No faucet injected → no payout. The reward is funded externally or not at all.
  if (!faucet || typeof faucet.fund !== 'function') {
    return { funded: false, amount: 0, intent, reason: 'no faucet (dry-run)' };
  }
  // Dry-run faucets advertise themselves and fund nothing.
  if (faucet.dryRun) {
    return { funded: false, amount: 0, intent, reason: 'faucet in dry-run' };
  }
  if (amount <= 0) {
    return { funded: false, amount: 0, intent, reason: 'score below reward threshold' };
  }

  const receipt = faucet.fund(intent); // caller's faucet owns the actual transfer
  return { funded: true, amount, intent, receipt };
}

// CLI self-demo (guarded; never runs on import)
if (process.argv[1] && process.argv[1].endsWith('arcade.mjs')) {
  __reset();
  const t = startSession('demo-player');
  // pretend 20s of play with 60 scoring events
  __setNow(() => Date.now() + 20_000);
  const r = submitScore({ sessionToken: t, score: 4200, events: 60 });
  __setNow(null);
  console.log('submitScore:', r);
  console.log('leaderboard:', leaderboard());
  console.log('reward (no faucet):', reward(4200));
  const faucet = { dryRun: false, fund: (i) => ({ ok: true, tx: 'demo-' + i.amount }) };
  console.log('reward (live faucet):', reward(4200, { faucet }));
}
