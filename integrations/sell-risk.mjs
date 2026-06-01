// sell-risk.mjs — READ-ONLY downside-risk indicator. No keys, no trading.
// "If this holder sells, how far does it drop — and have they been selling already?"
// For each top holder it (1) simulates dumping 25/50/100% of their bag DOWN the live bid book
// and reports the resulting last price + % drop, and (2) scans their recent market history for
// actual sells of this token. Feeds the annal/brief AIs a concrete fragility picture.
//
//   node integrations/sell-risk.mjs [SYMBOL ...]   (default = ISSUED_TOKENS)

import { find, historyPage } from './he-client.mjs';
import { market } from './hive-engine-market.mjs';
import { hiveUsd as oracleHiveUsd } from './price-oracle.mjs';
import { ISSUED_TOKENS, TRADE_ACCOUNT } from './watchlist.mjs';

// sell `qty` tokens DOWN the bid book (bids are descending price); returns HIVE received + the
// lowest price reached (where the price would sit after the dump).
function dumpIntoBids(bids, qty) {
  let got = 0, sold = 0, lastPrice = bids[0] ? +bids[0].price : 0;
  for (const o of bids) {
    const price = +o.price, avail = +o.quantity;
    if (!(price > 0) || !(avail > 0)) continue;
    const take = Math.min(avail, qty - sold);
    got += take * price; sold += take; lastPrice = price;
    if (sold >= qty) break;
  }
  return { hiveReceived: got, sold, floorPrice: lastPrice, unsold: Math.max(0, qty - sold) };
}

// recent sells of `symbol` by `account` from their market history (have they been dumping?)
async function recentSells(account, symbol, cap = 500) {
  let ops = [], offset = 0;
  while (ops.length < cap) {
    const batch = await historyPage(account, { limit: 500, offset, ops: 'market_sell' }).catch(() => []);
    if (!batch.length) break;
    ops.push(...batch); offset += batch.length;
    if (batch.length < 500) break;
  }
  const sells = ops.filter(o => (o.data?.symbol || o.symbol) === symbol);
  const qty = sells.reduce((a, o) => a + +((o.data || o).quantityTokens ?? (o.data || o).quantity ?? 0), 0);
  return { count: sells.length, qtySold: +qty.toFixed(3), lastTs: sells[0]?.timestamp || null };
}

export async function sellRisk(symbol, { topN = 5, hiveUsd } = {}) {
  hiveUsd = hiveUsd || await oracleHiveUsd();
  const [info, m, bids, balances] = await Promise.all([
    market.tokenInfo(symbol), market.metrics(symbol),
    market.buyBook(symbol, 200), find('tokens', 'balances', { symbol }, 30, [{ index: 'balance', descending: true }]),
  ]);
  if (!info) return null;
  const supply = +info.circulatingSupply || +info.supply || 0;
  const last = m ? +m.lastPrice : 0;
  const bidSupportHive = bids.reduce((a, o) => a + +o.price * +o.quantity, 0);

  // whales = top holders excluding the issuer/us
  const whales = balances
    .map(b => ({ account: b.account, bal: +b.balance + (+b.stake || 0) }))
    .filter(w => w.account !== TRADE_ACCOUNT && w.bal >= 1)
    .slice(0, topN);

  const rows = [];
  for (const w of whales) {
    const scen = [0.25, 0.5, 1.0].map(frac => {
      const d = dumpIntoBids(bids, w.bal * frac);
      const dropPct = last ? (last - d.floorPrice) / last * 100 : 0;
      return { frac, hiveReceivedUsd: +(d.hiveReceived * hiveUsd).toFixed(2), floorUsd: +(d.floorPrice * hiveUsd).toFixed(8), dropPct: +dropPct.toFixed(1), unsold: +d.unsold.toFixed(2) };
    });
    const recent = await recentSells(w.account, symbol).catch(() => ({ count: 0, qtySold: 0 }));
    rows.push({ account: w.account, bal: +w.bal.toFixed(2), pctOfSupply: supply ? +(w.bal / supply * 100).toFixed(3) : 0, scenarios: scen, recent });
  }
  return { symbol, last, lastUsd: +(last * hiveUsd).toFixed(8), supply, bidSupportUsd: +(bidSupportHive * hiveUsd).toFixed(2), whales: rows };
}

if (process.argv[1] && process.argv[1].endsWith('sell-risk.mjs')) {
  const syms = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const targets = syms.length ? syms : ISSUED_TOKENS;
  const hiveUsd = await oracleHiveUsd();
  console.log(`Sell-risk / whale-dump indicator — HIVE $${hiveUsd} (read-only)\n${'═'.repeat(72)}`);
  for (const s of targets) {
    const r = await sellRisk(s, { hiveUsd }).catch(e => ({ error: e.message }));
    if (!r || r.error) { console.log(`\n${s}: ${r?.error || 'not found'}`); continue; }
    console.log(`\n${s} — last $${r.lastUsd} | total bid support only $${r.bidSupportUsd}`);
    if (!r.whales.length) { console.log('  no outside holders ≥1 token'); continue; }
    for (const w of r.whales) {
      const full = w.scenarios.find(x => x.frac === 1.0);
      console.log(`  @${w.account.padEnd(18)} holds ${w.bal.toLocaleString()} (${w.pctOfSupply}% supply)`);
      console.log(`     dump ALL → price ${full.dropPct}% down to $${full.floorUsd}, nets only $${full.hiveReceivedUsd}${full.unsold > 0 ? ` (${full.unsold.toLocaleString()} can't even sell — no bids)` : ''}`);
      if (w.recent.count) console.log(`     ⚠ already sold ${w.recent.count}× recently (${w.recent.qtySold.toLocaleString()} tokens)`);
    }
  }
  console.log(`\n${'─'.repeat(72)}`);
  console.log('Low bid support = even a small holder dumping craters the printed price. The mirror of');
  console.log('the thin ask book: easy to spike up, easy to crater down — both signal "no real market yet."');
}
