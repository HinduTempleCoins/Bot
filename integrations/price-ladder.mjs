// price-ladder.mjs — READ-ONLY market-impact model for a price-support campaign. No keys, no
// trading. Answers "if I deploy $X buying up the ask book, how far does the price move, how many
// tokens do I actually get, and how much of $X can I even deploy given the (thin) liquidity?"
//
// The reality this surfaces: VKBT/CURE order books are paper-thin. You can't "buy $3k of cheap
// tokens" because almost nothing is offered for sale — a budget clears the whole book and leaves
// a vanity top-of-book price on a tiny acquired float. The durable lever is demand (holders +
// education), not a one-time sweep. This tool quantifies both sides.
//
//   node integrations/price-ladder.mjs [SYMBOL ...] [--budget 3000] [--targets 0.01,0.05,0.10,0.25]
//   import { ladder } from './price-ladder.mjs'

import { market } from './hive-engine-market.mjs';
import { hiveUsd as oracleHiveUsd } from './price-oracle.mjs';
import { ISSUED_TOKENS } from './watchlist.mjs';

// walk asks (ascending price) spending up to budgetHive; returns what actually fills
export function sweep(asks, budgetHive) {
  let spent = 0, tokens = 0, lastPrice = 0;
  for (const o of asks) {
    const price = +o.price, qty = +o.quantity;
    if (!(price > 0) || !(qty > 0)) continue;
    const levelCost = price * qty;
    if (spent + levelCost <= budgetHive) { spent += levelCost; tokens += qty; lastPrice = price; }
    else {
      const remain = budgetHive - spent;
      if (remain <= 0) break;
      const partialQty = remain / price;
      spent += remain; tokens += partialQty; lastPrice = price; break;
    }
  }
  return { spentHive: spent, tokens, lastPrice };
}

// cost (HIVE) + tokens to clear every ask strictly below a target price (in HIVE/token)
function costToReach(asks, targetHive) {
  let cost = 0, tokens = 0, reached = 0;
  for (const o of asks) {
    const price = +o.price, qty = +o.quantity;
    if (!(price > 0) || price >= targetHive) break; // asks are ascending; stop at the target
    cost += price * qty; tokens += qty; reached = price;
  }
  return { costHive: cost, tokens, reachedHive: reached };
}

export async function ladder(symbol, { budgetUsd = 3000, targetsUsd = [0.01, 0.05, 0.10, 0.25], hiveUsd } = {}) {
  hiveUsd = hiveUsd || await oracleHiveUsd();
  const [info, m, asks] = await Promise.all([
    market.tokenInfo(symbol), market.metrics(symbol), market.sellBook(symbol, 200),
  ]);
  if (!info) return null;
  const supply = +info.circulatingSupply || +info.supply || 0;
  const last = m ? +m.lastPrice : 0;
  const bookHive = asks.reduce((a, o) => a + +o.price * +o.quantity, 0);
  const bookTokens = asks.reduce((a, o) => a + +o.quantity, 0);
  const budgetHive = budgetUsd / hiveUsd;

  // what the full budget does
  const swept = sweep(asks, budgetHive);
  // per target price
  const targets = targetsUsd.map((usd) => {
    const targetHive = usd / hiveUsd;
    const r = costToReach(asks, targetHive);
    return {
      targetUsd: usd, targetHive,
      costHive: +r.costHive.toFixed(2), costUsd: +(r.costHive * hiveUsd).toFixed(2),
      tokens: +r.tokens.toFixed(2), pctOfSupply: supply ? +(r.tokens / supply * 100).toFixed(3) : 0,
      reachable: r.reachedHive > 0 && r.costHive <= budgetHive,
    };
  });

  return {
    symbol, hiveUsd, supply,
    lastHive: last, lastUsd: +(last * hiveUsd).toFixed(8),
    book: { levels: asks.length, tokensForSale: +bookTokens.toFixed(2), valueHive: +bookHive.toFixed(2), valueUsd: +(bookHive * hiveUsd).toFixed(2),
      topAskUsd: asks.length ? +(+asks[asks.length - 1].price * hiveUsd).toFixed(6) : 0 },
    budget: { usd: budgetUsd, hive: +budgetHive.toFixed(2),
      deployableUsd: +(Math.min(swept.spentHive, budgetHive) * hiveUsd).toFixed(2),
      clearsWholeBook: swept.spentHive >= bookHive - 0.01,
      tokensAcquired: +swept.tokens.toFixed(2), pctOfSupply: supply ? +(swept.tokens / supply * 100).toFixed(3) : 0,
      resultingLastUsd: +(swept.lastPrice * hiveUsd).toFixed(6) },
    targets,
  };
}

if (process.argv[1] && process.argv[1].endsWith('price-ladder.mjs')) {
  const args = process.argv.slice(2);
  const budgetUsd = +(args[args.indexOf('--budget') + 1]) || 3000;
  const ti = args.indexOf('--targets');
  const targetsUsd = ti >= 0 ? args[ti + 1].split(',').map(Number) : [0.01, 0.05, 0.10, 0.25];
  const syms = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
  const targets = syms.length ? syms : ISSUED_TOKENS;
  const hiveUsd = await oracleHiveUsd();
  console.log(`Price-support campaign model — budget $${budgetUsd} | HIVE $${hiveUsd} (read-only, no trading)\n${'═'.repeat(72)}`);
  for (const s of targets) {
    const r = await ladder(s, { budgetUsd, targetsUsd, hiveUsd }).catch(e => ({ error: e.message }));
    if (!r || r.error) { console.log(`\n${s}: ${r?.error || 'not found'}`); continue; }
    console.log(`\n${s} — last $${r.lastUsd} | supply ${r.supply.toLocaleString()}`);
    console.log(`  FOR SALE right now: ${r.book.tokensForSale.toLocaleString()} tokens across ${r.book.levels} asks = $${r.book.valueUsd} total (top ask $${r.book.topAskUsd})`);
    console.log(`  $${budgetUsd} budget → deploys only $${r.budget.deployableUsd} (${r.budget.clearsWholeBook ? 'CLEARS THE WHOLE BOOK' : 'partial'}), buys ${r.budget.tokensAcquired.toLocaleString()} tokens = ${r.budget.pctOfSupply}% of supply, last → $${r.budget.resultingLastUsd}`);
    console.log(`  cost to lift LAST price to each target:`);
    for (const t of r.targets)
      console.log(`     $${String(t.targetUsd).padEnd(5)} → clear $${String(t.costUsd).padStart(8)} of asks, get ${t.tokens.toLocaleString()} tok (${t.pctOfSupply}% supply)${t.reachable ? '' : '  ⚠ book too thin / beyond budget'}`);
  }
  console.log(`\n${'─'.repeat(72)}`);
  console.log('Reality: these books are thin. A budget clears the float and prints a vanity top-of-book');
  console.log('price on few tokens — it does NOT create holders. Durable lift = bids for a real floor +');
  console.log('demand (wallets seeing it, Discord education) so there are buyers, not just a swept book.');
}
