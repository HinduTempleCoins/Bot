// arb-scanner.mjs — READ-ONLY live arbitrage checker. The edge the bot actually profited from
// (SWAP.BLURT/SWAP.DOGE): a HIVE-Engine SWAP.X token should track the real asset. When its
// executable HIVE-Engine price (bid/ask × HIVE/USD) drifts from the real X/USD price, that's an
// opportunity. No keys, no trading — surfaces opportunities for the analyzer/AIs to suggest.
//
//   node integrations/arb-scanner.mjs            # print a live scan
//   import { scanArb } from './arb-scanner.mjs'  # { hiveUsd, rows, opportunities }

import { crypto } from './free-apis.mjs';
import { market } from './hive-engine-market.mjs';

// SWAP token -> coingecko id (the real asset it wraps)
const PAIRS = {
  'SWAP.BTC': 'bitcoin', 'SWAP.ETH': 'ethereum', 'SWAP.LTC': 'litecoin',
  'SWAP.DOGE': 'dogecoin', 'SWAP.BLURT': 'blurt', 'SWAP.STEEM': 'steem',
};
const THRESHOLD = 0.03; // 3% edge worth flagging

export async function scanArb() {
  const cg = await crypto.coingecko(['hive', ...Object.values(PAIRS)].join(','), 'usd').catch(() => ({}));
  const hiveUsd = cg.hive?.usd || 0;
  if (!hiveUsd) return { hiveUsd: 0, rows: [], opportunities: [] };
  const rows = [], opportunities = [];
  for (const [sym, id] of Object.entries(PAIRS)) {
    try {
      const m = await market.metrics(sym);
      const realUsd = cg[id]?.usd || 0;
      const ask = m ? +m.lowestAsk : 0;   // buy here
      const bid = m ? +m.highestBid : 0;  // sell here
      if (!realUsd || (!ask && !bid)) { rows.push({ sym, note: 'no live book/price' }); continue; }
      const askUsd = ask * hiveUsd, bidUsd = bid * hiveUsd;
      const buyEdge = ask ? (realUsd - askUsd) / askUsd : -1;
      const sellEdge = bid ? (bidUsd - realUsd) / realUsd : -1;
      let edge = 0, signal = 'fair';
      if (buyEdge >= THRESHOLD && buyEdge >= sellEdge) { edge = buyEdge; signal = `BUY ${sym} on HE (ask)`; }
      else if (sellEdge >= THRESHOLD) { edge = sellEdge; signal = `SELL ${sym} on HE (bid)`; }
      const row = { sym, askUsd, bidUsd, realUsd, edge, signal };
      rows.push(row);
      if (edge >= THRESHOLD) opportunities.push(row);
    } catch (e) { rows.push({ sym, note: `error ${e.message}` }); }
  }
  opportunities.sort((a, b) => b.edge - a.edge);
  return { hiveUsd, rows, opportunities };
}

if (process.argv[1] && process.argv[1].endsWith('arb-scanner.mjs')) {
  const { hiveUsd, rows, opportunities } = await scanArb();
  console.log(`Live arbitrage scan — HIVE $${hiveUsd} (read-only)\n${'─'.repeat(72)}`);
  console.log('token        ask USD     bid USD    real USD     edge   signal');
  console.log('─'.repeat(72));
  for (const r of rows) {
    if (r.note) { console.log(`${r.sym.padEnd(12)} (${r.note})`); continue; }
    console.log(`${r.sym.padEnd(12)} ${r.askUsd.toFixed(2).padStart(9)} ${r.bidUsd.toFixed(2).padStart(10)} ${r.realUsd.toFixed(2).padStart(11)} ${(r.edge * 100).toFixed(1).padStart(6)}%  ${r.signal}`);
  }
  console.log('─'.repeat(72));
  if (opportunities.length) {
    console.log(`\n${opportunities.length} opportunity(ies) ≥${THRESHOLD * 100}% edge:`);
    for (const o of opportunities) console.log(`  • ${o.signal} — ${(o.edge * 100).toFixed(1)}% vs real $${o.realUsd.toFixed(2)} ⚠ verify order-book DEPTH (thin asks mislead)`);
  } else console.log('\nNo ≥3% mispricings right now — swap markets fairly aligned.');
}
