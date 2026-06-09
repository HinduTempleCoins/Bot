// arb-scanner.mjs — READ-ONLY live arbitrage checker. The edge the bot actually profited from
// (SWAP.BLURT/SWAP.DOGE): a HIVE-Engine SWAP.X token should track the real asset. When its
// executable HIVE-Engine price drifts from the real X/USD price, that's an opportunity.
//
// Trustworthy by construction — three guards so a thin/stale book can't fake a signal:
//   1. real price = outlier-rejected median across several sources (price-oracle), must be confident
//   2. the HE side must be genuinely two-sided (a real bid AND a real ask)
//   3. depth-aware: we walk the order book and only count edge that is EXECUTABLE for a
//      meaningful amount of HIVE — a 1-token phantom ask no longer reads as a 138% opportunity
//
// No keys, no trading. Surfaces opportunities (with executable size) for the analyzer/AIs.
//
//   node integrations/arb-scanner.mjs            # print a live scan
//   import { scanArb } from './arb-scanner.mjs'  # { hiveUsd, rows, opportunities }

import { writeFileSync, readFileSync } from 'node:fs';
import { crypto } from './free-apis.mjs';
import { market } from './hive-engine-market.mjs';
import { priceUsd } from './price-oracle.mjs';
import { SWAP_PAIRS as PAIRS, ARB_THRESHOLD as THRESHOLD } from './watchlist.mjs';

const MIN_EXEC_HIVE = +(process.env.ARB_MIN_EXEC_HIVE || 20); // ignore edges you can't move ≥this much HIVE through
const HISTORY_FILE = process.env.ARB_HISTORY_FILE || 'vankush-arbitrage-history.json';

// ── PHANTOM-EDGE GUARD (broad-scan audit) ────────────────────────────────────────────────────────
// Even past guards 1–3 + the live legs-off-spot guard (#23), the standing scan topped its feed with
// PHANTOM edges off dead/orphaned/one-sided Hive-Engine books: SWAP.ETH read 139%, SWAP.MATIC 18.7%.
// Mechanism: a book with a real quote on only ONE side (or a single thin cheap-side level) lets the
// depth walk report a huge "executable" edge against a STALE book-vs-real comparand. Such rows are
// NOT deleted (a thin book can thicken; we still want eyes on it) — they are FLAGGED suspect
// (boolean + human reason) and DOWN-RANKED below every clean row so the proven SWAP.DOGE-class edges
// stay on top. Tunables are env-overridable so the live scan can be retuned without a code change.
const SUSPECT_MIN_DEPTH_HIVE = +(process.env.ARB_SUSPECT_MIN_DEPTH_HIVE || 5); // cheap-side floor: below this exec HIVE the edge is phantom-thin
const STALE_OFF_REAL = +(process.env.ARB_STALE_OFF_REAL || 0.5);               // both legs ≥this far off real ⇒ stale comparand (50% default)

// Walk the ask side (buying SWAP.X on HE): spend HIVE at each ask level (price ascending) while
// the level's USD cost is still below the real price. Returns size-weighted edge + executable HIVE
// + the count of book levels that actually contributed (a one-level cheap side reads as thin/orphaned).
export function executableBuy(askLevels, realUsd, hiveUsd) {
  let execHive = 0, edgeHiveWeighted = 0, levels = 0;
  for (const lvl of askLevels) {
    const price = +lvl.price, qty = +lvl.quantity;      // price in HIVE per token
    if (!(price > 0) || !(qty > 0)) continue;
    const costUsd = price * hiveUsd;                    // what a token costs here, in USD
    const lvlEdge = (realUsd - costUsd) / costUsd;       // how underpriced this level is
    if (lvlEdge < THRESHOLD) break;                      // book has caught up — stop
    const hiveHere = price * qty;
    execHive += hiveHere; edgeHiveWeighted += hiveHere * lvlEdge; levels += 1;
  }
  return { execHive, edge: execHive ? edgeHiveWeighted / execHive : 0, levels };
}
// Walk the bid side (selling SWAP.X on HE): hit bids (price descending) while the bid's USD value beats real.
export function executableSell(bidLevels, realUsd, hiveUsd) {
  let execHive = 0, edgeHiveWeighted = 0, levels = 0;
  for (const lvl of bidLevels) {
    const price = +lvl.price, qty = +lvl.quantity;
    if (!(price > 0) || !(qty > 0)) continue;
    const valueUsd = price * hiveUsd;
    const lvlEdge = (valueUsd - realUsd) / realUsd;
    if (lvlEdge < THRESHOLD) break;
    const hiveHere = price * qty;
    execHive += hiveHere; edgeHiveWeighted += hiveHere * lvlEdge; levels += 1;
  }
  return { execHive, edge: execHive ? edgeHiveWeighted / execHive : 0, levels };
}

/**
 * Decide whether a scored row is a suspect PHANTOM edge. Pure + total — never throws.
 * A row is suspect when ANY of:
 *   • the HE book is one-sided: a genuine top-of-book on only one side (missing bid OR ask), OR the
 *     side we'd actually execute is backed by a single thin level (orphaned/one-sided in practice), OR
 *   • the cheap-side executable depth is below SUSPECT_MIN_DEPTH_HIVE (phantom-thin), OR
 *   • BOTH bid and ask sit ≥STALE_OFF_REAL away from the real price (the comparand is stale).
 * Down-ranking, not deletion: the caller keeps the row but sorts it below every clean row.
 * @returns {{suspect:boolean, reason:string|null}}
 */
export function classifySuspect({ ask, bid, askUsd, bidUsd, realUsd, execHive, side, askLevels = 0, bidLevels = 0 }) {
  const reasons = [];
  const a = +ask, b = +bid, eh = +execHive;
  // 1. one-sided book — a genuine quote on only one side
  if (!(a > 0) || !(b > 0)) reasons.push('one-sided HE book (missing bid or ask)');
  // 1b. the side we'd execute is backed by a single thin level (orphaned/one-sided in practice)
  const tradedLevels = side === 'buy' ? +askLevels : side === 'sell' ? +bidLevels : 0;
  if (side && tradedLevels > 0 && tradedLevels < 2 && !(eh >= MIN_EXEC_HIVE)) {
    reasons.push('cheap side backed by a single thin level');
  }
  // 2. cheap-side executable depth below the floor
  if (eh > 0 && eh < SUSPECT_MIN_DEPTH_HIVE) {
    reasons.push(`thin executable depth (${eh.toFixed(1)} < ${SUSPECT_MIN_DEPTH_HIVE} HIVE)`);
  }
  // 3. stale comparand: BOTH legs far off the real price
  const offAsk = +realUsd > 0 && +askUsd > 0 ? Math.abs(+askUsd - +realUsd) / +realUsd : 0;
  const offBid = +realUsd > 0 && +bidUsd > 0 ? Math.abs(+bidUsd - +realUsd) / +realUsd : 0;
  if (offAsk >= STALE_OFF_REAL && offBid >= STALE_OFF_REAL) {
    reasons.push(`both legs far off real (ask ${(offAsk * 100).toFixed(0)}%, bid ${(offBid * 100).toFixed(0)}% — stale comparand)`);
  }
  return reasons.length ? { suspect: true, reason: reasons.join('; ') } : { suspect: false, reason: null };
}

export async function scanArb() {
  const cg = await crypto.coingecko(['hive', ...Object.values(PAIRS)].join(','), 'usd').catch(() => ({}));
  const hp = await priceUsd('hive', cg.hive?.usd ?? null);
  const hiveUsd = hp.usd;
  if (!hiveUsd) return { hiveUsd: 0, hiveConfident: false, rows: [], opportunities: [] };

  const rows = [], opportunities = [];
  for (const [sym, id] of Object.entries(PAIRS)) {
    try {
      const m = await market.metrics(sym).catch(() => null);
      const [real, asks, bids] = await Promise.all([
        priceUsd(id, cg[id]?.usd ?? null),
        market.sellBook(sym, 12).catch(() => []),   // asks (people selling SWAP.X) — we BUY here
        market.buyBook(sym, 12).catch(() => []),     // bids (people buying SWAP.X) — we SELL here
      ]);
      const realUsd = real.usd;
      const ask = m ? +m.lowestAsk : 0, bid = m ? +m.highestBid : 0;
      // GUARD 1: need a confident, multi-source real price
      if (!real.confident || !realUsd) { rows.push({ sym, note: `real price not confident (${real.sources} src)`, realUsd }); continue; }
      // GUARD 2: need a genuinely two-sided HE book
      if (!(ask > 0) || !(bid > 0)) { rows.push({ sym, note: 'one-sided/empty HE book', realUsd, ask, bid }); continue; }

      // GUARD 3: depth-aware executable edge on each side
      const buy = executableBuy(asks, realUsd, hiveUsd);
      const sell = executableSell(bids, realUsd, hiveUsd);
      let edge = 0, signal = 'fair', execHive = 0, side = null;
      if (buy.execHive >= sell.execHive && buy.edge >= THRESHOLD) { edge = buy.edge; execHive = buy.execHive; signal = `BUY ${sym} on HE`; side = 'buy'; }
      else if (sell.edge >= THRESHOLD) { edge = sell.edge; execHive = sell.execHive; signal = `SELL ${sym} on HE`; side = 'sell'; }

      const row = { sym, askUsd: ask * hiveUsd, bidUsd: bid * hiveUsd, realUsd, edge, execHive, signal, side };
      // PHANTOM-EDGE GUARD: flag (don't delete) dead/orphaned/one-sided/stale books, then down-rank below.
      const { suspect, reason } = classifySuspect({
        ask, bid, askUsd: row.askUsd, bidUsd: row.bidUsd, realUsd, execHive, side,
        askLevels: buy.levels, bidLevels: sell.levels,
      });
      row.suspect = suspect; row.suspectReason = reason;
      rows.push(row);
      // only a real opportunity if you can actually move a meaningful amount of HIVE through it
      if (edge >= THRESHOLD && execHive >= MIN_EXEC_HIVE) opportunities.push(row);
    } catch (e) { rows.push({ sym, note: `error ${e.message}` }); }
  }
  // RANK: clean rows first (suspect phantom edges sink below every clean row), then by realizable HIVE.
  opportunities.sort((a, b) =>
    (a.suspect === b.suspect ? 0 : a.suspect ? 1 : -1) || (b.execHive * b.edge - a.execHive * a.edge));
  return { hiveUsd, hiveConfident: hp.confident, rows, opportunities };
}

// append a one-line scan summary to the rolling history (feeds the timeline view)
export function recordScan(result) {
  let hist;
  try { hist = JSON.parse(readFileSync(HISTORY_FILE, 'utf8')); } catch { hist = { startTime: null, scans: 0, opportunitiesFound: 0, opportunities: [] }; }
  hist.scans = (hist.scans || 0) + 1;
  hist.opportunitiesFound = (hist.opportunitiesFound || 0) + result.opportunities.length;
  for (const o of result.opportunities) {
    hist.opportunities.push({ sym: o.sym, side: o.side, edgePct: +(o.edge * 100).toFixed(1), execHive: +o.execHive.toFixed(1), realUsd: +o.realUsd.toFixed(4) });
  }
  if (hist.opportunities.length > 500) hist.opportunities = hist.opportunities.slice(-500);
  try { writeFileSync(HISTORY_FILE, JSON.stringify(hist, null, 2)); } catch {}
  return hist;
}

if (process.argv[1] && process.argv[1].endsWith('arb-scanner.mjs')) {
  const { hiveUsd, hiveConfident, rows, opportunities } = await scanArb();
  console.log(`Live arbitrage scan — HIVE $${hiveUsd.toFixed(6)} ${hiveConfident ? '✓' : '⚠ unconfirmed'} (read-only, depth-aware)\n${'─'.repeat(78)}`);
  console.log('token        ask USD     bid USD    real USD     edge   exec HIVE  signal');
  console.log('─'.repeat(78));
  for (const r of rows) {
    if (r.note) { console.log(`${r.sym.padEnd(12)} (${r.note})`); continue; }
    console.log(`${r.sym.padEnd(12)} ${r.askUsd.toFixed(2).padStart(9)} ${r.bidUsd.toFixed(2).padStart(10)} ${r.realUsd.toFixed(2).padStart(11)} ${(r.edge * 100).toFixed(1).padStart(6)}% ${r.execHive.toFixed(0).padStart(9)}  ${r.signal}${r.suspect ? `  ⚠ SUSPECT: ${r.suspectReason}` : ''}`);
  }
  console.log('─'.repeat(78));
  if (opportunities.length) {
    console.log(`\n${opportunities.length} EXECUTABLE opportunity(ies) ≥${THRESHOLD * 100}% edge with ≥${MIN_EXEC_HIVE} HIVE depth (clean first; suspect phantom edges flagged + down-ranked):`);
    for (const o of opportunities) console.log(`  • ${o.signal} — ${(o.edge * 100).toFixed(1)}% edge, ~${o.execHive.toFixed(0)} HIVE executable (real $${o.realUsd.toFixed(4)})${o.suspect ? `  ⚠ SUSPECT: ${o.suspectReason}` : ''}`);
  } else console.log('\nNo executable mispricings right now — swap markets fairly aligned (thin/stale asks filtered out).');
  recordScan({ hiveUsd, rows, opportunities });
}
