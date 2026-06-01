// arb-scanner.mjs — READ-ONLY live arbitrage checker. The edge the bot actually profited from
// (SWAP.BLURT/SWAP.DOGE): a HIVE-Engine SWAP.X token should track the real asset. When its
// HIVE-Engine price (in HIVE × HIVE/USD) drifts from the real X/USD price, that's an opportunity.
// No keys, no trading — surfaces opportunities for the analyzer/AIs to suggest.
//
//   node integrations/arb-scanner.mjs

import { crypto } from './free-apis.mjs';
import { market } from './hive-engine-market.mjs';

// SWAP token -> coingecko id (the real asset it wraps)
const PAIRS = {
  'SWAP.BTC': 'bitcoin', 'SWAP.ETH': 'ethereum', 'SWAP.LTC': 'litecoin',
  'SWAP.DOGE': 'dogecoin', 'SWAP.BLURT': 'blurt', 'SWAP.STEEM': 'steem',
};
const THRESHOLD = 0.03; // 3% edge worth flagging

const cg = await crypto.coingecko(['hive', ...Object.values(PAIRS)].join(','), 'usd').catch(() => ({}));
const hiveUsd = cg.hive?.usd || 0;
if (!hiveUsd) { console.error('no HIVE/USD price'); process.exit(1); }

console.log(`Live arbitrage scan — HIVE $${hiveUsd} (read-only)\n${'─'.repeat(74)}`);
console.log('token        HE price(HIVE)   implied USD     real USD       edge   signal');
console.log('─'.repeat(74));

const opportunities = [];
for (const [sym, id] of Object.entries(PAIRS)) {
  try {
    const m = await market.metrics(sym);
    const realUsd = cg[id]?.usd || 0;
    // EXECUTABLE prices, not stale lastPrice: to BUY on HE you pay the lowest ask; to SELL you hit the highest bid.
    const ask = m ? +m.lowestAsk : 0;   // buy here
    const bid = m ? +m.highestBid : 0;  // sell here
    if (!realUsd || (!ask && !bid)) { console.log(`${sym.padEnd(12)} (no live book / price)`); continue; }
    const askUsd = ask * hiveUsd, bidUsd = bid * hiveUsd;
    // buy-edge: real value vs what you pay (ask). sell-edge: what you get (bid) vs real value.
    const buyEdge = ask ? (realUsd - askUsd) / askUsd : -1;
    const sellEdge = bid ? (bidUsd - realUsd) / realUsd : -1;
    let edge = 0, signal = 'fair';
    if (buyEdge >= THRESHOLD && buyEdge >= sellEdge) { edge = buyEdge; signal = `BUY ${sym} on HE (ask)`; }
    else if (sellEdge >= THRESHOLD) { edge = sellEdge; signal = `SELL ${sym} on HE (bid)`; }
    if (edge >= THRESHOLD) opportunities.push({ sym, edge, signal, askUsd, bidUsd, realUsd });
    console.log(`${sym.padEnd(12)} ask$${askUsd.toFixed(2).padStart(9)} bid$${bidUsd.toFixed(2).padStart(9)} real$${realUsd.toFixed(2).padStart(9)} ${(edge * 100).toFixed(1).padStart(6)}%  ${signal}`);
  } catch (e) { console.log(`${sym.padEnd(12)} error ${e.message}`); }
}
console.log('─'.repeat(74));
if (opportunities.length) {
  console.log(`\n${opportunities.length} live opportunity(ies) ≥${THRESHOLD * 100}% edge:`);
  for (const o of opportunities.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)))
    console.log(`  • ${o.signal} — ${(o.edge * 100).toFixed(1)}% edge vs real $${o.realUsd.toFixed(2)} ⚠ verify order-book DEPTH before acting (thin asks mislead)`);
} else console.log('\nNo ≥3% mispricings right now — swap markets fairly aligned.');
