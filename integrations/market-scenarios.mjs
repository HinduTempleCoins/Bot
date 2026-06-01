// market-scenarios.mjs — READ-ONLY "what-if" generator. No keys, no trading.
// Pulls each token's live ask book ONCE, then runs many RANDOM capital arrangements through the
// price-ladder sweep math to produce "if $X were spent like this → the market would look like Y"
// scenarios. The output is a thinking aid for the AIs (annal/brief) — counterfactuals to reason
// about, NOT recommendations and NOT trades.
//
//   node integrations/market-scenarios.mjs [SYMBOL ...] [--n 12] [--seed 7]
// Writes .local/shared/market-scenarios.md (+ .json) for the annal/brief AIs.

import { writeFileSync, mkdirSync } from 'node:fs';
import { market } from './hive-engine-market.mjs';
import { sweep } from './price-ladder.mjs';
import { hiveUsd as oracleHiveUsd } from './price-oracle.mjs';
import { ISSUED_TOKENS } from './watchlist.mjs';

// tiny deterministic PRNG (seedable so a scenario set is reproducible; Math.random would do too)
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

async function bookOf(symbol) {
  const [info, m, asks] = await Promise.all([market.tokenInfo(symbol), market.metrics(symbol), market.sellBook(symbol, 200)]);
  if (!info) return null;
  return { symbol, supply: +info.circulatingSupply || +info.supply || 0, last: m ? +m.lastPrice : 0,
    asks: asks.map(o => ({ price: +o.price, quantity: +o.quantity })),
    bookHive: asks.reduce((a, o) => a + +o.price * +o.quantity, 0) };
}

// one random arrangement: a total budget split across the given token books
function arrange(r, books, hiveUsd) {
  const budgetUsd = pick(r, [50, 100, 250, 500, 1000, 2000, 3000, 5000, 10000]);
  // random split weights across tokens
  const weights = books.map(() => r() + 0.05);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const legs = books.map((b, i) => {
    const allocUsd = budgetUsd * weights[i] / wsum;
    const allocHive = allocUsd / hiveUsd;
    const s = sweep(b.asks, allocHive);
    const deployedUsd = Math.min(s.spentHive, allocHive) * hiveUsd;
    return {
      symbol: b.symbol,
      allocUsd: +allocUsd.toFixed(2),
      deployedUsd: +deployedUsd.toFixed(2),
      undeployedUsd: +(allocUsd - deployedUsd).toFixed(2),
      tokens: +s.tokens.toFixed(2),
      pctOfSupply: b.supply ? +(s.tokens / b.supply * 100).toFixed(3) : 0,
      lastFromUsd: +(b.last * hiveUsd).toFixed(8),
      lastToUsd: +(s.lastPrice * hiveUsd).toFixed(6),
      clearedBook: s.spentHive >= b.bookHive - 0.01,
    };
  });
  return {
    budgetUsd,
    totalDeployedUsd: +legs.reduce((a, l) => a + l.deployedUsd, 0).toFixed(2),
    totalUndeployedUsd: +legs.reduce((a, l) => a + l.undeployedUsd, 0).toFixed(2),
    legs,
  };
}

export async function scenarios(symbols, { n = 12, seed = 1, hiveUsd } = {}) {
  hiveUsd = hiveUsd || await oracleHiveUsd();
  const books = (await Promise.all(symbols.map(bookOf))).filter(Boolean);
  const r = rng(seed);
  const list = [];
  for (let i = 0; i < n; i++) list.push(arrange(r, books, hiveUsd));
  return { hiveUsd, tokens: books.map(b => ({ symbol: b.symbol, lastUsd: +(b.last * hiveUsd).toFixed(8), bookValueUsd: +(b.bookHive * hiveUsd).toFixed(2), supply: b.supply })), scenarios: list };
}

if (process.argv[1] && process.argv[1].endsWith('market-scenarios.mjs')) {
  const args = process.argv.slice(2);
  const n = +(args[args.indexOf('--n') + 1]) || 12;
  const seed = +(args[args.indexOf('--seed') + 1]) || 1;
  const syms = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
  const targets = syms.length ? syms : ISSUED_TOKENS;
  const out = await scenarios(targets, { n, seed });

  const L = [];
  L.push('# Market what-if scenarios (read-only thinking aid)');
  L.push('');
  L.push('_Random capital arrangements run through the live ask books. Counterfactuals for the AIs to reason about — NOT recommendations, NOT trades. "If $X were spent like this, the market would look like Y."_');
  L.push('');
  L.push('## Tokens (live)');
  for (const t of out.tokens) L.push(`- ${t.symbol}: last $${t.lastUsd}, only ~$${t.bookValueUsd} offered for sale, supply ${t.supply.toLocaleString()}`);
  L.push('');
  out.scenarios.forEach((sc, i) => {
    L.push(`## Scenario ${i + 1} — budget $${sc.budgetUsd} (deploys $${sc.totalDeployedUsd}, $${sc.totalUndeployedUsd} can't deploy)`);
    for (const leg of sc.legs)
      L.push(`- ${leg.symbol}: alloc $${leg.allocUsd} → spends $${leg.deployedUsd}, buys ${leg.tokens.toLocaleString()} (${leg.pctOfSupply}% supply), last $${leg.lastFromUsd}→$${leg.lastToUsd}${leg.clearedBook ? ' (cleared the book)' : ''}`);
    L.push('');
  });
  L.push('---');
  L.push('_Recurring truth across arrangements: most of any budget cannot deploy (thin books), and a swept book prints a high last-price on a tiny float without creating holders. Demand must be built, not bought._');

  const md = L.join('\n');
  mkdirSync('.local/shared', { recursive: true });
  writeFileSync('.local/shared/market-scenarios.json', JSON.stringify(out, null, 2));
  writeFileSync('.local/shared/market-scenarios.md', md);
  console.log(md);
  console.log('\n→ .local/shared/market-scenarios.md (+ .json) for the annal/brief AIs');
}
