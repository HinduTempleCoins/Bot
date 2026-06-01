// cex-arb.mjs — READ-ONLY cross-EXCHANGE arbitrage scanner via ccxt public endpoints. No keys.
// Operator 2026-06-01: "look at other exchanges and do arbitrage between exchanges." The same
// pair (e.g. BTC/USDT) often has a higher bid on one venue than the lowest ask on another — buy
// low, sell high, IF the edge clears both venues' taker fees. This SURFACES those spreads for the
// analyzer/AIs; it never trades (execution needs keys + withdrawal paths, a separate gated step).
//
//   node integrations/cex-arb.mjs BTC/USDT
//   node integrations/cex-arb.mjs ETH/USDT binance,kraken,kucoin
//   import { bestCrossExchange, scanSymbol } from './cex-arb.mjs'

import ccxt from 'ccxt';

const DEFAULT_EXCHANGES = (process.env.CEX_LIST || 'binance,kraken,coinbase,kucoin,okx,bybit,gate').split(',');
const DEFAULT_TAKER = 0.001; // 0.1% fallback if an exchange doesn't expose its fee

// PURE: given per-exchange quotes, find the best buy-low (ask) / sell-high (bid) pair and the
// NET edge after both taker fees. quotes: [{ exchange, bid, ask, takerFee }]. Returns null if none.
export function bestCrossExchange(quotes) {
  const valid = quotes.filter((q) => q.bid > 0 && q.ask > 0);
  if (valid.length < 2) return null;
  let best = null;
  for (const buy of valid) {              // we BUY at buy.ask
    for (const sell of valid) {           // we SELL at sell.bid
      if (buy.exchange === sell.exchange) continue;
      const buyFee = buy.takerFee ?? DEFAULT_TAKER;
      const sellFee = sell.takerFee ?? DEFAULT_TAKER;
      // cost to acquire 1 unit incl. fee; proceeds from selling 1 unit net of fee
      const cost = buy.ask * (1 + buyFee);
      const proceeds = sell.bid * (1 - sellFee);
      const edge = (proceeds - cost) / cost;
      if (!best || edge > best.edge) {
        best = { buyOn: buy.exchange, buyAsk: buy.ask, sellOn: sell.exchange, sellBid: sell.bid, edge, netEdgePct: +(edge * 100).toFixed(3) };
      }
    }
  }
  return best;
}

// fetch one exchange's public ticker for a symbol (no key). Returns a quote or null.
async function quoteFrom(name, symbol) {
  try {
    const Ex = ccxt[name];
    if (!Ex) return null;
    const ex = new Ex({ enableRateLimit: true, timeout: 12000 });
    const t = await ex.fetchTicker(symbol);
    const takerFee = ex.fees?.trading?.taker ?? DEFAULT_TAKER;
    return { exchange: name, bid: +t.bid || 0, ask: +t.ask || 0, takerFee, last: +t.last || 0 };
  } catch { return null; }
}

// scan one symbol across a set of exchanges; returns the quotes + the best cross-exchange spread.
export async function scanSymbol(symbol, exchanges = DEFAULT_EXCHANGES) {
  const quotes = (await Promise.all(exchanges.map((n) => quoteFrom(n.trim(), symbol)))).filter(Boolean);
  return { symbol, quotes, best: bestCrossExchange(quotes) };
}

if (process.argv[1] && process.argv[1].endsWith('cex-arb.mjs')) {
  const symbol = process.argv[2] || 'BTC/USDT';
  const exchanges = (process.argv[3] || '').split(',').filter(Boolean);
  const { quotes, best } = await scanSymbol(symbol, exchanges.length ? exchanges : DEFAULT_EXCHANGES);
  console.log(`Cross-exchange scan: ${symbol} — read-only, keyless (${quotes.length} venues)\n` + '─'.repeat(60));
  for (const q of quotes.sort((a, b) => a.ask - b.ask)) console.log(`  ${q.exchange.padEnd(10)} bid ${q.bid}  ask ${q.ask}  (taker ${(q.takerFee * 100).toFixed(2)}%)`);
  console.log('─'.repeat(60));
  if (best && best.edge > 0) console.log(`  ARB: buy on ${best.buyOn} @ ${best.buyAsk} → sell on ${best.sellOn} @ ${best.sellBid}  = ${best.netEdgePct}% net of fees`);
  else if (best) console.log(`  best spread ${best.netEdgePct}% (negative net of fees — no arb)`);
  else console.log('  not enough venues quoted');
  console.log('\n(Execution needs exchange keys + withdrawal routing — a separate gated step.)');
}
