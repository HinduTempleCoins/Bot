// hive-engine-market.mjs — READ-ONLY HIVE-Engine / TribalDEX market explorer ("Way 2").
// The market-side view to set against the bot's own trades (tradebot-forensics.mjs = "Way 1").
// No keys. Buy/sell books, recent fills, metrics, supply, top holders for any token.
//
//   node integrations/hive-engine-market.mjs <SYMBOL> [SYMBOL2 ...]
//   node integrations/hive-engine-market.mjs            # the bot's key tokens

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const RPC = 'https://api.hive-engine.com/rpc/contracts';

async function find(contract, table, query, limit = 100, indexes = []) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'find', params: { contract, table, query, limit, offset: 0, indexes } }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result || [];
}
async function findOne(contract, table, query) { return (await find(contract, table, query, 1))[0] || null; }

export const market = {
  metrics: (symbol) => findOne('market', 'metrics', { symbol }),
  buyBook: (symbol, limit = 10) => find('market', 'buyBook', { symbol }, limit, [{ index: 'priceDec', descending: true }]),
  sellBook: (symbol, limit = 10) => find('market', 'sellBook', { symbol }, limit, [{ index: 'priceDec', descending: false }]),
  trades: (symbol, limit = 15) => find('market', 'tradesHistory', { symbol }, limit, [{ index: 'timestamp', descending: true }]),
  tokenInfo: (symbol) => findOne('tokens', 'tokens', { symbol }),
  topHolders: (symbol, limit = 10) => find('tokens', 'balances', { symbol }, limit, [{ index: 'balance', descending: true }]),
};

function num(x, d = 6) { return (+x || 0).toFixed(d); }

async function snapshot(symbol) {
  console.log(`\n══════════ ${symbol} — market view ══════════`);
  const [info, m, buys, sells, trades] = await Promise.all([
    market.tokenInfo(symbol).catch(() => null),
    market.metrics(symbol).catch(() => null),
    market.buyBook(symbol, 5).catch(() => []),
    market.sellBook(symbol, 5).catch(() => []),
    market.trades(symbol, 8).catch(() => []),
  ]);
  if (!info) { console.log('  token not found on HIVE-Engine'); return; }
  const supply = +info.circulatingSupply || +info.supply || 0;
  const last = m ? +m.lastPrice : 0;
  console.log(`  issuer:@${info.issuer}  supply:${supply.toLocaleString()}  mcap≈${num(supply * last, 1)} HIVE`);
  if (m) console.log(`  last:${num(m.lastPrice)}  bid:${num(m.highestBid)}  ask:${num(m.lowestAsk)}  vol24h:${num(m.volume, 2)}  %chg:${num(m.priceChangePercent, 2)}`);
  const spread = (buys[0] && sells[0]) ? ((+sells[0].price - +buys[0].price) / +sells[0].price * 100) : null;
  console.log(`  TOP BID: ${buys.map(b => `${num(b.price)}×${num(b.quantity, 1)}`).join('  ') || '—'}`);
  console.log(`  TOP ASK: ${sells.map(s => `${num(s.price)}×${num(s.quantity, 1)}`).join('  ') || '—'}`);
  if (spread != null) console.log(`  spread: ${spread.toFixed(2)}%`);
  console.log(`  recent fills: ${trades.map(t => `${t.type === 'buy' ? '↑' : '↓'}${num(t.price)}`).join(' ') || '—'}`);
  return { symbol, last, supply, mcap: supply * last, bid: m ? +m.highestBid : 0, ask: m ? +m.lowestAsk : 0, vol: m ? +m.volume : 0 };
}

if (process.argv[1] && process.argv[1].endsWith('hive-engine-market.mjs')) {
  const syms = process.argv.slice(2);
  const targets = syms.length ? syms : ['VKBT', 'CURE', 'SWAP.LTC', 'SWAP.BLURT', 'SWAP.DOGE', 'BBH'];
  console.log('HIVE-Engine / TribalDEX market explorer (read-only)');
  for (const s of targets) { try { await snapshot(s); } catch (e) { console.log(`\n  ${s}: ${e.message}`); } }
}
