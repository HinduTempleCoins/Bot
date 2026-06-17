// hathor-disposition.mjs — apply Crypt-ology to the Hathor account (operator 2026-06-17).
//
// The server-side glue between cryptology.mjs (the LSD-Dream-Emulator per-person map) and Hathor's live
// behaviour: her DISPOSITION-greeting (BRIEF.md §3 — a stance, never a scripted line) and her FAUCET-style
// tipping/grants. Hathor is the Pizza-Bot + Discord bot + MELEK witness in one; this is the relational
// brain the witness/Discord/welcomer hosts call. It is injected into kulaswap/hathor-brain.mjs as the
// optional `deps.cryptology` so the browser chat brain stays fs-free while the server side gets the real map.
//
// THE FAUCET MODEL (operator: tipping is "like a faucet" — claim-based, NOT a Pizza push, NOT infinite
// worthless emission): a claim is PULLED by the user, RATE-LIMITED per account (cooldown), drips a small but
// MEANINGFUL amount from a FINITE reservoir, and the drip size is gated by the Crypt-ology relationship +
// karma (earned, not flat). cf. the live PRANA/MELEK faucets + the welcome-grant ([[welcome-grant-formula]]).
//
// House style: soft-fail-never-throw, injectable clock + store file, pure where possible, no network, no keys.

import {
  recall, observe, dispositionOf, suggestTopics, accountKey, EVENTS, loadStore,
} from './cryptology.mjs';

// recall(account, store) — load the right store once (default store when no file given).
const profileOf = (key, file) => recall(key, file ? loadStore(file) : loadStore());

// ── disposition (the stance + topics Hathor opens with, per person) ──────────────────────────────────────
/** dispositionFor — the Witness's current stance toward `account` + topics to lean into. Read-only. */
export function dispositionFor(account, { file } = {}) {
  const p = profileOf(accountKey(account), file);
  const disp = dispositionOf(p);
  return { ...disp, topics: suggestTopics(p, 3), totalInteractions: p?.totalInteractions || 0 };
}

/** A disposition-FLAVORED opening cue (NOT a fixed line — BRIEF §3). The system prompt renders the actual
 *  words; this returns the stance + a register hint so the greeting is a disposition, not a script. */
export function dispositionGreeting(disp) {
  const stance = (disp && disp.stance) || 'welcoming';
  const register = {
    welcoming:   'open, generous, orienting — a first meeting',
    open:        'plain, present, unhurried',
    warm:        'warm, familiar, glad-to-see-you',
    familiar:    'easy, in-on-it, fewer preliminaries',
    deferential: 'respectful of their standing; defer to their depth',
    guarded:     'courteous but measured; trust not yet earned',
  }[stance] || 'open, present';
  return { stance, register, depth: (disp && disp.preferredDepth) || 'medium' };
}

// ── the faucet (claim-based, cooldown'd, reservoir-bounded, relationship-gated) ───────────────────────────
export const FAUCET_DEFAULTS = Object.freeze({
  cooldownMs: 24 * 60 * 60 * 1000, // one claim per account per 24h (the rate limit)
  baseDrip: 1,                     // base meaningful drip (units); scaled by relationship + karma
  minStanding: -20,                // a hostile/guarded standing can't claim (earned, not free-for-all)
  maxMultiplier: 3,                // closeness+karma can lift the drip up to 3× base — never unbounded
});

/**
 * faucetClaim — decide a faucet drip for `account`. A PULL: returns whether the claim is allowed now, and
 * the (meaningful, bounded) amount. Rate-limited by cooldown, gated by Crypt-ology standing + karma, and
 * capped by the remaining reservoir — so it is never infinite. Pure given the injected now + state.
 *
 * @param {object} a
 *  account, now(ms), lastClaimAt(ms|0), reservoir(remaining units), karma(0..100, optional),
 *  cooldownMs, baseDrip, file (cryptology store)
 * @returns {{ ok, amount, reason, nextClaimAt }}
 */
export function faucetClaim({ account, now = Date.now(), lastClaimAt = 0, reservoir = Infinity, karma = 0, file, ...opts } = {}) {
  const cfg = { ...FAUCET_DEFAULTS, ...opts };
  const key = accountKey(account);
  if (!key) return { ok: false, amount: 0, reason: 'no-account', nextClaimAt: 0 };

  // 1) rate limit — one claim per cooldown window (the faucet's defining property).
  const elapsed = now - (+lastClaimAt || 0);
  if (lastClaimAt && elapsed < cfg.cooldownMs) {
    return { ok: false, amount: 0, reason: 'cooldown', nextClaimAt: (+lastClaimAt) + cfg.cooldownMs };
  }
  // 2) reservoir — finite tap; empty → no drip (never infinite).
  if (!(reservoir > 0)) return { ok: false, amount: 0, reason: 'reservoir-empty', nextClaimAt: now };

  // 3) relationship gate — standing below the floor can't claim (earned, not free).
  const disp = dispositionOf(profileOf(key, file));
  if (disp.standing < cfg.minStanding) {
    return { ok: false, amount: 0, reason: 'standing-too-low', nextClaimAt: now + cfg.cooldownMs };
  }

  // 4) meaningful, BOUNDED amount: base × (1 + relationship+karma lift), capped at maxMultiplier, then by
  //    the reservoir. closeness/standing in [-..100], karma in [0..100] → a [1, maxMultiplier] multiplier.
  const rel = Math.max(0, (Math.max(0, disp.closeness) + Math.max(0, disp.standing)) / 200); // 0..~1
  const k = Math.max(0, Math.min(100, +karma || 0)) / 100;                                   // 0..1
  const mult = 1 + (cfg.maxMultiplier - 1) * Math.min(1, (rel + k) / 2);
  const amount = Math.min(reservoir, Math.round(cfg.baseDrip * mult * 1000) / 1000);
  return { ok: amount > 0, amount, reason: 'ok', nextClaimAt: now + cfg.cooldownMs, multiplier: Math.round(mult * 100) / 100 };
}

// ── record an interaction (moves their coordinates on the map) ────────────────────────────────────────────
/** recordInteraction — observe a named Crypt-ology event for `account` (persisted). Soft-fails. EVENTS keys
 *  are the legible vocabulary (greeted/warm_exchange/taught/helped/thanked/deep_question/…). */
export function recordInteraction(account, event, { file } = {}) {
  if (!EVENTS[event]) return { ok: false, reason: 'unknown-event' };
  try { const p = observe(accountKey(account), event, { persist: true, file }); return { ok: true, stance: dispositionOf(p).stance }; }
  catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}

/** Build the `deps.cryptology` object that kulaswap/hathor-brain.mjs's handleMessage optionally consults. */
export function makeBrainDep({ file } = {}) {
  return {
    dispositionFor: (account) => dispositionFor(account, { file }),
    greeting: (account) => dispositionGreeting(dispositionFor(account, { file })),
    record: (account, event) => recordInteraction(account, event, { file }),
  };
}
