// market-depth.mjs — READ-ONLY "visualize on the market": whale concentration (who holds the
// token) + buy/sell walls, for the issued tokens. Answers "is anyone but us holding this?" and
// "what's the wall structure?". No keys. Feeds the analyzer/AIs the ownership + depth picture.
//
//   node integrations/market-depth.mjs [SYMBOL ...]   (default VKBT CURE)

import { market } from './hive-engine-market.mjs';

const ISSUER = 'kalivankush';

function walls(orders) {
  // aggregate order book into price levels with cumulative size
  const levels = orders.slice(0, 8).map(o => ({ price: +o.price, qty: +o.quantity, hive: +o.price * +o.quantity }));
  return levels;
}

// data-returning ownership summary (for the analyzer/AIs)
export async function ownership(symbol) {
  const [info, holders, m] = await Promise.all([
    market.tokenInfo(symbol).catch(() => null),
    market.topHolders(symbol, 12).catch(() => []),
    market.metrics(symbol).catch(() => null),
  ]);
  if (!info) return null;
  const supply = +info.circulatingSupply || +info.supply || 0;
  let issuerPct = 0, top3 = 0, outsideHolders = 0;
  holders.forEach((h, i) => {
    const bal = +h.balance + (+h.stake || 0);
    const pct = supply ? bal / supply * 100 : 0;
    if (h.account === ISSUER) issuerPct += pct;
    if (i < 3) top3 += pct;
    if (h.account !== ISSUER && bal >= 1) outsideHolders++;
  });
  return { symbol, issuer: info.issuer, supply, issuerPct: +issuerPct.toFixed(1), top3: +top3.toFixed(1), outsideHolders, last: m ? +m.lastPrice : 0 };
}

async function depth(symbol) {
  console.log(`\n══════════ ${symbol} — ownership + depth ══════════`);
  const [info, holders, buys, sells, m] = await Promise.all([
    market.tokenInfo(symbol).catch(() => null),
    market.topHolders(symbol, 12).catch(() => []),
    market.buyBook(symbol, 8).catch(() => []),
    market.sellBook(symbol, 8).catch(() => []),
    market.metrics(symbol).catch(() => null),
  ]);
  if (!info) { console.log('  not found'); return; }
  const supply = +info.circulatingSupply || +info.supply || 0;
  console.log(`  issuer:@${info.issuer}  supply:${supply.toLocaleString()}  last:${m ? (+m.lastPrice).toFixed(8) : '—'} HIVE`);

  // whales
  console.log('  TOP HOLDERS (whale concentration):');
  let issuerPct = 0, top3 = 0;
  holders.forEach((h, i) => {
    const bal = +h.balance + (+h.stake || 0);
    const pct = supply ? bal / supply * 100 : 0;
    if (h.account === ISSUER) issuerPct += pct;
    if (i < 3) top3 += pct;
    if (i < 6) console.log(`    ${(h.account + (h.account === ISSUER ? ' (issuer/us)' : '')).padEnd(24)} ${bal.toLocaleString().padStart(14)}  ${pct.toFixed(1)}%`);
  });
  console.log(`  → top-3 hold ${top3.toFixed(1)}% | issuer(@${ISSUER}) holds ${issuerPct.toFixed(1)}%`);

  // walls
  const buyHive = walls(buys).reduce((a, l) => a + l.hive, 0);
  const sellQty = walls(sells).reduce((a, l) => a + l.qty, 0);
  console.log(`  BUY WALL (support): ${buyHive.toFixed(2)} HIVE across ${buys.length} levels; top bid ${buys[0] ? (+buys[0].price).toFixed(8) : '—'}`);
  console.log(`  SELL WALL (resistance): ${sellQty.toLocaleString()} tokens across ${sells.length} levels; low ask ${sells[0] ? (+sells[0].price).toFixed(8) : '—'}`);

  return { symbol, supply, issuerPct, top3, last: m ? +m.lastPrice : 0 };
}

if (process.argv[1] && process.argv[1].endsWith('market-depth.mjs')) {
  const syms = process.argv.slice(2);
  const targets = syms.length ? syms : ['VKBT', 'CURE'];
  console.log('Market depth + whale view (read-only)');
  for (const s of targets) { try { await depth(s); } catch (e) { console.log(`\n  ${s}: ${e.message}`); } }
  console.log('\nNote: high issuer% + low outside holding = the "price push" is largely self-trading, not real demand.');
}
