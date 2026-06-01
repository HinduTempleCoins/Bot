// timeline.mjs — READ-ONLY "visualize what the bot did over time". No keys.
// tradebot-forensics gives the end-state totals; this draws the PATH there: cumulative
// realized HIVE day by day, per-token first/last activity, and the rolling arbitrage-scan
// history. Lets the annal/brief AIs say "the SWAP.LTC bleed happened over week X", not just
// "net is negative".
//
//   node integrations/timeline.mjs [account]   (default = TRADE_ACCOUNT)
// Writes .local/trade-timeline.json and prints a compact day-bucketed curve.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { marketHistory } from './tradebot-forensics.mjs';
import { TRADE_ACCOUNT } from './watchlist.mjs';

const ARB_HISTORY = process.env.ARB_HISTORY_FILE || 'vankush-arbitrage-history.json';

// HIVE-Engine accountHistory timestamps are unix-epoch seconds; normalize to YYYY-MM-DD.
function day(ts) {
  if (ts == null || ts === '') return '';
  const s = String(ts);
  if (/^\d+$/.test(s)) { const ms = +s < 1e12 ? +s * 1000 : +s; return new Date(ms).toISOString().slice(0, 10); }
  return s.slice(0, 10); // already an ISO string
}
const epoch = (ts) => (ts == null ? 0 : +ts);

export async function buildTimeline(account) {
  const ops = await marketHistory(account);
  return reconstructTimeline(ops, account);
}

// pure: turn a list of market ops into the day-bucketed cumulative curve + per-token windows.
// Injectable (no network) so it is unit-testable.
export function reconstructTimeline(ops, account = 'account') {
  // order oldest→newest by epoch timestamp (fall back to block number)
  ops = [...ops].sort((a, b) => (epoch(a.timestamp) - epoch(b.timestamp)) || ((a.blockNumber || 0) - (b.blockNumber || 0)));

  const byDay = new Map();      // day -> { realized, buys, sells, hiveSpent, hiveRecv }
  const tokens = new Map();     // symbol -> { first, last, net, buys, sells }
  let cum = 0;
  const curve = [];             // [{ day, cumRealized, dayRealized }]

  for (const o of ops) {
    const d = o.data || o;
    const s = d.symbol; if (!s) continue;
    const hive = +(d.quantityHive ?? d.quantityHIVE ?? 0);
    if (!hive) continue;
    const isBuy = o.operation === 'market_buy';
    const isSell = o.operation === 'market_sell';
    if (!isBuy && !isSell) continue;
    const delta = isSell ? hive : -hive;     // sells add HIVE, buys spend it
    cum += delta;

    const dk = day(o.timestamp);
    const b = byDay.get(dk) || { realized: 0, buys: 0, sells: 0, hiveSpent: 0, hiveRecv: 0 };
    b.realized += delta;
    if (isBuy) { b.buys++; b.hiveSpent += hive; } else { b.sells++; b.hiveRecv += hive; }
    byDay.set(dk, b);

    const t = tokens.get(s) || { first: o.timestamp, last: o.timestamp, net: 0, buys: 0, sells: 0 };
    t.last = o.timestamp; t.net += delta; if (isBuy) t.buys++; else t.sells++;
    tokens.set(s, t);
  }

  for (const [d, b] of [...byDay.entries()].sort()) curve.push({ day: d, dayRealized: +b.realized.toFixed(2), buys: b.buys, sells: b.sells });
  let running = 0;
  for (const pt of curve) { running += pt.dayRealized; pt.cumRealized = +running.toFixed(2); }

  // worst and best single day (where the bleed / gains actually happened)
  const sorted = [...curve].sort((a, b) => a.dayRealized - b.dayRealized);
  const worst = sorted.slice(0, 3);
  const best = sorted.slice(-3).reverse();

  // rolling arb-scan history, if present
  let arb = null;
  try {
    const h = JSON.parse(readFileSync(ARB_HISTORY, 'utf8'));
    const freq = {};
    for (const o of h.opportunities || []) freq[o.sym] = (freq[o.sym] || 0) + 1;
    arb = { scans: h.scans || 0, opportunitiesFound: h.opportunitiesFound || 0, startTime: h.startTime, byToken: freq };
  } catch {}

  return {
    account, ops: ops.length, days: curve.length,
    finalCumRealized: curve.length ? curve[curve.length - 1].cumRealized : 0,
    worstDays: worst, bestDays: best,
    tokens: [...tokens.entries()]
      .map(([symbol, t]) => ({ symbol, net: +t.net.toFixed(2), buys: t.buys, sells: t.sells, first: day(t.first), last: day(t.last) }))
      .sort((a, b) => a.net - b.net),
    curve, arb,
  };
}

if (process.argv[1] && process.argv[1].endsWith('timeline.mjs')) {
  const account = process.argv[2] || TRADE_ACCOUNT;
  const tl = await buildTimeline(account);
  mkdirSync('.local', { recursive: true });
  writeFileSync('.local/trade-timeline.json', JSON.stringify(tl, null, 2));

  console.log(`\n═══════ TRADE TIMELINE — @${tl.account} ═══════`);
  console.log(`${tl.ops} ops across ${tl.days} active days | final cumulative realized: ${tl.finalCumRealized} HIVE\n`);
  if (tl.worstDays.length) {
    console.log('WORST days (where HIVE bled):');
    for (const d of tl.worstDays) console.log(`  ${d.day}: ${d.dayRealized} HIVE  (${d.buys} buys / ${d.sells} sells)`);
    console.log('BEST days (where HIVE came back):');
    for (const d of tl.bestDays) console.log(`  ${d.day}: +${d.dayRealized} HIVE  (${d.buys} buys / ${d.sells} sells)`);
  }
  console.log('\nPer-token net over its active window (losers first):');
  for (const t of tl.tokens.slice(0, 12)) console.log(`  ${t.symbol.padEnd(12)} ${String(t.net).padStart(11)} HIVE   ${t.first} → ${t.last}  (${t.buys}b/${t.sells}s)`);
  if (tl.arb) console.log(`\nArb scans logged: ${tl.arb.scans} (${tl.arb.opportunitiesFound} executable opps) — by token: ${JSON.stringify(tl.arb.byToken)}`);
  console.log('\n→ .local/trade-timeline.json');
}
