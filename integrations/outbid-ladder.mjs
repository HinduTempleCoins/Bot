// outbid-ladder.mjs — PURE planner for a COMPETITIVE OUTBID LADDER: a step-by-step sequence of
// micro-increment bids that gradually top a competitor's order while respecting a per-session cap.
//
// This implements the trade-queue rules:
//   • gradual outbidding in 0.00000010 HIVE increments
//   • micro-pushes maintain anchoring (each step is one tiny increment above the last)
//   • 5% max increase per session
//
// Distinct from its siblings:
//   • price-nudge.mjs — plans ONE outbid-ratchet move (with cooldown/daily-cap state).
//   • price-ladder.mjs — sweeps a BUDGET across resting asks.
//   • THIS — emits the full micro-increment OUTBID sequence to climb from a start price up to (but
//     never past) a competitor's top, capped at the session-rise ceiling.
//
// PURE + offline: no network, no IO, no state. Soft-fail — bad input returns an empty capped ladder,
// never throws.
//
//   node integrations/outbid-ladder.mjs            # demo: print a sample ladder
//   import { outbidLadder, nextBid, respectsCap, renderLadder, DEFAULTS } from './outbid-ladder.mjs'

export const DEFAULTS = Object.freeze({
  increment: 0.00000010,   // 0.00000010 HIVE micro-increment
  maxSessionRisePct: 0.05, // 5% max increase per session
  decimals: 8,             // HIVE price precision
});

const num = (v) => {
  const f = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(f) ? f : null;
};

// round to a fixed number of decimals, returned as a number (kills float noise so prices stay on-grid).
function round(value, decimals = DEFAULTS.decimals) {
  const d = Number.isFinite(decimals) ? decimals : DEFAULTS.decimals;
  const f = +(+value).toFixed(d);
  return Number.isFinite(f) ? f : 0;
}

/**
 * Compute the single next outbid: one increment above the current top, on-grid.
 * @returns {number|null} the next bid, or null on invalid input (soft-fail).
 */
export function nextBid({ currentTop, ourLast, increment = DEFAULTS.increment } = {}) {
  const top = num(currentTop);
  const inc = num(increment);
  if (top == null || inc == null) return null;
  // ourLast is informational/optional; the next outbid anchors to the current top + one increment.
  void ourLast;
  return round(top + inc, DEFAULTS.decimals);
}

/**
 * Is `bid` within the per-session rise cap measured from `startPrice`?
 * @returns {boolean} false on invalid input (treat as not-respecting → caller stops).
 */
export function respectsCap(startPrice, bid, maxSessionRisePct = DEFAULTS.maxSessionRisePct) {
  const start = num(startPrice);
  const b = num(bid);
  const pct = num(maxSessionRisePct);
  if (start == null || b == null || pct == null || start <= 0) return false;
  const maxAllowed = start * (1 + pct);
  return b <= maxAllowed + 1e-12;
}

/**
 * Build the full outbid ladder: micro-increment steps climbing from startPrice toward competitorTop,
 * stopping at the FIRST of: reaching/exceeding competitorTop, hitting the session-rise cap, or maxSteps.
 *
 * @returns {{ steps: Array<{bid:number, risePctFromStart:number}>, finalBid: number|null, capped: boolean, reason: string }}
 *   Soft-fail: any missing/invalid number → { steps:[], finalBid:null, capped:true, reason:'invalid-input' }.
 */
export function outbidLadder({
  startPrice,
  competitorTop,
  increment = DEFAULTS.increment,
  maxSessionRisePct = DEFAULTS.maxSessionRisePct,
  maxSteps = 50,
} = {}) {
  const start = num(startPrice);
  const top = num(competitorTop);
  const inc = num(increment);
  const pct = num(maxSessionRisePct);
  const cap = Number.isInteger(maxSteps) && maxSteps > 0 ? maxSteps : 50;

  if (start == null || top == null || inc == null || pct == null || inc <= 0 || start <= 0) {
    return { steps: [], finalBid: null, capped: true, reason: 'invalid-input' };
  }

  // Already at/above the competitor's top — nothing to climb.
  if (start >= top - 1e-12) {
    return { steps: [], finalBid: round(start), capped: false, reason: 'already-at-or-above-competitor' };
  }

  const steps = [];
  let current = start;
  let capped = false;
  let reason = '';

  for (let i = 0; i < cap; i++) {
    const candidate = round(current + inc, DEFAULTS.decimals);

    // never overshoot the competitor's top — one increment past their top wins, but we top by exactly
    // one increment ABOVE only if that increment stays under the session cap; reaching their price is
    // the goal, so stop once a step would meet or pass it.
    if (candidate >= top - 1e-12) {
      // place the final winning bid exactly one increment over the competitor, if it respects the cap.
      const winning = round(top + inc, DEFAULTS.decimals);
      if (respectsCap(start, winning, pct)) {
        steps.push({ bid: winning, risePctFromStart: round((winning - start) / start, 6) });
        current = winning;
        reason = 'reached-competitor-top';
      } else {
        capped = true;
        reason = steps.length ? 'session-cap-reached' : 'session-cap-blocks-first-step';
      }
      break;
    }

    // enforce the per-session rise cap on every step.
    if (!respectsCap(start, candidate, pct)) {
      capped = true;
      reason = steps.length ? 'session-cap-reached' : 'session-cap-blocks-first-step';
      break;
    }

    steps.push({ bid: candidate, risePctFromStart: round((candidate - start) / start, 6) });
    current = candidate;

    if (i === cap - 1) { reason = 'max-steps-reached'; capped = false; }
  }

  if (!reason) reason = 'max-steps-reached';
  const finalBid = steps.length ? steps[steps.length - 1].bid : round(start);
  return { steps, finalBid, capped, reason };
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Render a ladder as a Markdown table. Soft-fail: bad input → a short note instead of a table.
 * @returns {string}
 */
export function renderLadder(ladder) {
  if (!ladder || !Array.isArray(ladder.steps)) return '_no ladder_';
  if (ladder.steps.length === 0) {
    return `_no steps — ${esc(ladder.reason || 'empty')}${ladder.capped ? ' (capped)' : ''}_`;
  }
  const rows = ladder.steps
    .map((s, i) => `| ${i + 1} | ${esc(s.bid)} | ${esc((s.risePctFromStart * 100).toFixed(4))}% |`)
    .join('\n');
  const footer = `\n\n**final bid:** ${esc(ladder.finalBid)} · **capped:** ${ladder.capped ? 'yes' : 'no'} · ${esc(ladder.reason)}`;
  return `| step | bid | rise from start |\n|---|---|---|\n${rows}${footer}`;
}

if (process.argv[1] && process.argv[1].endsWith('outbid-ladder.mjs')) {
  const start = parseFloat(process.argv[2]) || 0.00001000;
  const top = parseFloat(process.argv[3]) || 0.00001005;
  const ladder = outbidLadder({ startPrice: start, competitorTop: top });
  console.log(`outbid-ladder — start ${start} → competitor top ${top}  (increment ${DEFAULTS.increment}, cap ${DEFAULTS.maxSessionRisePct * 100}%)`);
  console.log('─'.repeat(64));
  console.log(renderLadder(ladder));
}
