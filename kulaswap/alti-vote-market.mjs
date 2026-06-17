// alti-vote-market.mjs — spend ALTI to buy a MELEK upvote from a @soapbox account.
//
// Operator 2026-06-17: "ALTI will be on the Market, and Pay for MELEK Votes from a SoapBox Account on
// MELEK." This is the honest version of a Steem/Hive bid-bot ("the Shop / buy votes" from the NutBox
// model): a member spends ALTI (our SoapBox delegation-mining reward token, the NutBox-"PNUTs"), and a
// designated @soapbox MELEK account casts a proportional upvote on their post. It is a transparent
// PROMOTION market, not pay-to-rank manipulation — the upvote value tracks the ALTI spent, and the voter
// can never oversell its finite voting mana.
//
// What this module IS — and is NOT:
//   - IS: pure planner. ALTI → vote-weight pricing, mana-aware clamping, and an ORDER of two intents
//     (the user's ALTI spend + the @soapbox account's vote). Deterministic, offline, soft-fail.
//   - IS NOT: a broadcaster. The vote is a Graphene `vote` op needing the @soapbox account's POSTING
//     authority (held by MELEK-Signer — zero WIF in this repo, per CLAUDE.md key custody). The ALTI
//     spend is an EVM tx the USER signs. This module never signs, never reads the chain, never moves a
//     token — it emits the plan a key-gated signer / the user's wallet consumes.
//
// House style: ESM, soft-fail (never throws on bad input — clamps/skip), esc() any HTML interpolation,
// deterministic, CLI guarded by process.argv[1]. Offline tests in alti-vote-market.test.mjs.

/** Graphene vote-weight bounds (percent ×100). We only upvote: 0..10000 (= 0..100%). */
export const MAX_WEIGHT = 10000;

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Coerce to a finite non-negative number; anything bad -> fallback. */
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ── pricing ───────────────────────────────────────────────────────────────────────────────────────
// The market is configured by how much a FULL-WEIGHT (100%) vote from the @soapbox account costs, in
// ALTI. Cost scales linearly with weight, so altiSpent → weight is just a proportion (clamped to 100%).
export const DEFAULT_MARKET = Object.freeze({
  voter: 'soapbox',              // the MELEK account that casts the bought votes
  altiPerFullVote: 100,          // ALTI for a 100% upvote (operator-tunable)
  minAlti: 1,                    // smallest order accepted
  spreadBps: 0,                  // optional protocol spread (kept honest: 0 by default)
});

/** mergeMarket — shallow-merge a caller's market params over the defaults. */
export function mergeMarket(m = {}) {
  const d = DEFAULT_MARKET;
  return Object.freeze({
    voter: typeof m.voter === 'string' && m.voter ? m.voter.replace(/^@/, '') : d.voter,
    altiPerFullVote: num(m.altiPerFullVote, d.altiPerFullVote) || d.altiPerFullVote,
    minAlti: num(m.minAlti, d.minAlti),
    spreadBps: Math.min(10000, num(m.spreadBps, d.spreadBps)),
  });
}

/** priceForWeight — ALTI cost to buy a given vote weight (basis points 0..10000) at this market. */
export function priceForWeight(weightBps, market = DEFAULT_MARKET) {
  const m = mergeMarket(market);
  const w = Math.max(0, Math.min(MAX_WEIGHT, num(weightBps)));
  const base = m.altiPerFullVote * (w / MAX_WEIGHT);
  return round(base * (1 + m.spreadBps / 10000), 6);
}

/** weightForAlti — the vote weight (bps) `altiSpent` buys, before any mana clamp. */
export function weightForAlti(altiSpent, market = DEFAULT_MARKET) {
  const m = mergeMarket(market);
  const alti = num(altiSpent);
  const net = alti / (1 + m.spreadBps / 10000);          // strip the spread back out
  const w = (net / m.altiPerFullVote) * MAX_WEIGHT;
  return Math.max(0, Math.min(MAX_WEIGHT, Math.round(w)));
}

function round(x, d = 6) { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; }

// ── mana: what the @soapbox voter can actually afford to cast right now ──────────────────────────────
// A Graphene account's voting power regenerates over time; a 100% vote consumes ~2% of current mana
// (the standard Steem/Hive constant). We never let an order push the voter below a floor, and we clamp
// the delivered weight to what the remaining mana supports — overflow ALTI is REFUNDED, never burned for
// a vote that can't land at full strength.
export const FULL_VOTE_MANA_BPS = 200;   // a 100% vote costs ~2.00% of current voting mana
export const DEFAULT_MANA_FLOOR_BPS = 1000; // keep the voter above 10% mana (don't drain it to zero)

/**
 * manaAffordableWeight — the largest weight (bps) the voter can cast without dropping below the floor.
 *   votingManaBps   current voting power, 0..10000 (10000 = 100%)
 *   floorBps        don't spend mana below this
 * A 100% vote needs FULL_VOTE_MANA_BPS of mana; weight scales linearly with mana spent.
 */
export function manaAffordableWeight({ votingManaBps, floorBps = DEFAULT_MANA_FLOOR_BPS } = {}) {
  const mana = Math.max(0, Math.min(MAX_WEIGHT, num(votingManaBps, MAX_WEIGHT)));
  const floor = Math.max(0, Math.min(MAX_WEIGHT, num(floorBps, DEFAULT_MANA_FLOOR_BPS)));
  const spendable = Math.max(0, mana - floor);           // mana bps we may consume
  // mana consumed = weight/MAX_WEIGHT * FULL_VOTE_MANA_BPS  →  weight = spendable/FULL_VOTE_MANA_BPS * MAX_WEIGHT
  const w = (spendable / FULL_VOTE_MANA_BPS) * MAX_WEIGHT;
  return Math.max(0, Math.min(MAX_WEIGHT, Math.round(w)));
}

// ── the order ───────────────────────────────────────────────────────────────────────────────────────
/**
 * quoteVote — given an ALTI spend and the voter's current mana, return the deliverable vote + any refund.
 * Returns { ok, weightBps, weightPct, altiCharged, altiRefunded, manaCostBps, reason }.
 *   altiSpent       ALTI the buyer wants to spend
 *   votingManaBps   the @soapbox voter's current voting power (0..10000)
 *   market          pricing params (DEFAULT_MARKET)
 *   floorBps        mana floor for the voter
 * Soft-fail: below-minimum or zero-mana → { ok:false, reason }.
 */
export function quoteVote({ altiSpent, votingManaBps = MAX_WEIGHT, market = DEFAULT_MARKET, floorBps } = {}) {
  const m = mergeMarket(market);
  const alti = num(altiSpent);
  if (alti < m.minAlti) return { ok: false, reason: 'below-minimum', minAlti: m.minAlti, weightBps: 0 };

  const wanted = weightForAlti(alti, m);
  const affordable = manaAffordableWeight({ votingManaBps, floorBps });
  if (affordable <= 0) return { ok: false, reason: 'voter-out-of-mana', weightBps: 0, altiRefunded: round(alti) };

  const weightBps = Math.min(wanted, affordable);
  const altiCharged = priceForWeight(weightBps, m);      // charge only for the weight actually delivered
  const altiRefunded = round(Math.max(0, alti - altiCharged));
  const manaCostBps = round((weightBps / MAX_WEIGHT) * FULL_VOTE_MANA_BPS, 4);
  return {
    ok: true,
    weightBps,
    weightPct: round(weightBps / 100, 2),
    altiCharged,
    altiRefunded,
    manaCostBps,
    clampedByMana: weightBps < wanted,
    reason: weightBps < wanted ? 'mana-clamped' : 'full',
  };
}

/**
 * buildVoteOrder — the two-intent plan that fulfils a bought vote. NOTHING here is signed/broadcast.
 *   account         the BUYER's MELEK account (whose post is voted) — for the receipt
 *   author/permlink the post to upvote (author defaults to the buyer)
 *   altiSpent       ALTI offered
 *   altiSpendTo     where the buyer's ALTI goes (treasury/burn address) — caller supplies
 * Returns { ok, quote, spend, vote } or { ok:false, reason }. `spend` is an EVM intent the USER signs;
 * `vote` is a Graphene vote op the @soapbox account's signer casts.
 */
export function buildVoteOrder({ account, author, permlink, altiSpent, votingManaBps = MAX_WEIGHT,
  market = DEFAULT_MARKET, floorBps, altiSpendTo } = {}) {
  const m = mergeMarket(market);
  const buyer = String(account || '').replace(/^@/, '');
  const target = String(author || account || '').replace(/^@/, '');
  if (!buyer || !permlink) return { ok: false, reason: 'need account + permlink' };

  const quote = quoteVote({ altiSpent, votingManaBps, market: m, floorBps });
  if (!quote.ok) return { ok: false, reason: quote.reason, quote };

  return {
    ok: true,
    quote,
    spend: {
      type: 'alti-spend',
      token: 'ALTI',
      from: buyer,
      to: altiSpendTo || null,        // treasury or burn sink — caller/config supplies
      amount: quote.altiCharged,
      refund: quote.altiRefunded,
      unsigned: true,
      note: 'buyer signs this ALTI transfer in their wallet',
    },
    vote: {
      type: 'graphene-vote',
      voter: m.voter,                 // the @soapbox account
      author: target,
      permlink: String(permlink),
      weight: quote.weightBps,        // 0..10000
      unsigned: true,
      note: 'cast by the @soapbox account via MELEK-Signer after the ALTI spend confirms',
    },
  };
}

// ── a tiny UI fragment (Shop tab) ───────────────────────────────────────────────────────────────────
/** renderQuote — an HTML snippet describing a quote for the Shop UI (all interpolation esc()'d). */
export function renderQuote(quote = {}, market = DEFAULT_MARKET) {
  const m = mergeMarket(market);
  if (!quote || !quote.ok) {
    return `<div class="alti-vote err">Can't fill that order${quote && quote.reason ? `: ${esc(quote.reason)}` : ''}.</div>`;
  }
  const refund = quote.altiRefunded > 0 ? ` <span class="refund">(+${esc(quote.altiRefunded)} ALTI refunded)</span>` : '';
  const clamp = quote.clampedByMana ? ` <span class="note">— clamped to @${esc(m.voter)}'s available voting power</span>` : '';
  return `<div class="alti-vote ok">Spend <b>${esc(quote.altiCharged)} ALTI</b>${refund} → a <b>${esc(quote.weightPct)}%</b> upvote from @${esc(m.voter)}.${clamp}</div>`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [, , altiArg, manaArg] = process.argv;
  const q = quoteVote({ altiSpent: Number(altiArg || 50), votingManaBps: Number(manaArg || MAX_WEIGHT) });
  console.log(JSON.stringify(q, null, 2));
}
