// arb-watchlist.mjs — run the cross-chain spread scanner over a WATCHLIST on a cadence, rank the
// real opportunities, and write them into the annals feed (.local/shared/) so the AIs reason about
// cross-chain mispricing over time. Read-only — surfaces spreads, never executes. Operator: feed
// the cross-chain arb into the digest -> annals.
//
//   node integrations/chains/arb-watchlist.mjs            # scan the default watchlist once
//   node integrations/chains/arb-watchlist.mjs WETH USDC  # scan specific tokens
//   import { rankOpportunities, scanWatchlist } from './chains/arb-watchlist.mjs'

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { crossChainSpread } from './crosschain-arb.mjs';

// high-volume tokens that genuinely trade on multiple chains/DEXes (where cross-chain spreads are
// real, not phantom). Operator can override via CEX-style env.
export const WATCHLIST = (process.env.ARB_WATCHLIST || 'WETH,USDC,USDT,WBTC,DAI,LINK,UNI,AAVE,PEPE,ARB').split(',').map((s) => s.trim());
const MIN_SPREAD = parseFloat(process.env.ARB_WATCH_MIN_SPREAD || '3'); // % — only log spreads worth a look

// PURE: from a set of {query, opportunity} results, keep the real opportunities and rank them.
export function rankOpportunities(results, { minSpread = MIN_SPREAD } = {}) {
  return results
    .filter((r) => r && r.opportunity && r.opportunity.spreadPct >= minSpread)
    // drop same-venue "spreads": buy and sell on the SAME chain/dex is not a cross-venue arb —
    // it's two look-alike tokens sharing a symbol (phantom the median filter didn't fully reject).
    .filter((r) => r.opportunity.buyOn !== r.opportunity.sellOn)
    .map((r) => ({ token: r.query, ...r.opportunity }))
    .sort((a, b) => b.spreadPct - a.spreadPct);
}

// scan every token in the watchlist (sequential to respect DEXScreener rate limits).
// opts.spots — optional { TOKEN: spotUsd } map; passes a reference spot into the scanner's per-leg
// sanity guard so a poisoned pair is dropped + recorded as suspicious instead of logged as profit.
export async function scanWatchlist(tokens = WATCHLIST, { spots = {} } = {}) {
  const results = [];
  const suspicious = [];
  for (const t of tokens) {
    const r = await crossChainSpread(t, { spotUsd: spots[t] }).catch(() => null);
    if (r) {
      results.push({ query: t, venues: r.venues?.length || 0, opportunity: r.opportunity });
      if (r.suspicious) suspicious.push({ token: t, ...r.suspicious });
    }
  }
  return { scannedAt: new Date().toISOString(), tokens: tokens.length, results, suspicious, opportunities: rankOpportunities(results) };
}

function record(scan) {
  mkdirSync('.local/shared', { recursive: true });
  // append-only log (the data)
  const logPath = '.local/cross-chain-arb-log.jsonl';
  const prior = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  writeFileSync(logPath, prior + JSON.stringify({ at: scan.scannedAt, opportunities: scan.opportunities, suspicious: scan.suspicious || [] }) + '\n');
  // markdown for the annal/brief AIs (delivered by publish-feed)
  const L = [`# Cross-chain arbitrage watchlist — ${scan.scannedAt}`, '', `Scanned ${scan.tokens} tokens. ${scan.opportunities.length} opportunity(ies) ≥${MIN_SPREAD}%:`, ''];
  if (!scan.opportunities.length) L.push('_No cross-chain spread above threshold on liquid venues right now (markets efficient)._');
  for (const o of scan.opportunities) L.push(`- **${o.token}** — ${o.spreadPct}% : buy ${o.buyOn} ($${o.buyUsd}) → sell ${o.sellOn} ($${o.sellUsd}); executable liq ~$${Math.round(o.executableLiqUsd).toLocaleString()}`);
  if (scan.suspicious?.length) {
    L.push('', `**${scan.suspicious.length} suspicious signal(s) DROPPED** (leg priced too far off reference spot — likely poisoned pair):`);
    for (const s of scan.suspicious) L.push(`- ⛔ **${s.token}** — ${s.spreadPct}% signal dropped: ${s.reason}`);
  }
  L.push('', '_Read-only signal. Verify bridge cost + slippage before sizing. Never auto-executed._');
  writeFileSync('.local/shared/cross-chain-arb.md', L.join('\n'));
}

if (process.argv[1] && process.argv[1].endsWith('arb-watchlist.mjs')) {
  const tokens = process.argv.slice(2).filter(Boolean);
  const scan = await scanWatchlist(tokens.length ? tokens : WATCHLIST);
  record(scan);
  console.log(`Cross-chain arb watchlist — ${scan.tokens} tokens, ${scan.opportunities.length} opportunities ≥${MIN_SPREAD}%`);
  for (const o of scan.opportunities) console.log(`  ⚡ ${o.token}: ${o.spreadPct}% — buy ${o.buyOn} → sell ${o.sellOn}`);
  if (!scan.opportunities.length) console.log('  (markets efficient — no spread above threshold)');
  console.log('\n→ .local/cross-chain-arb-log.jsonl + .local/shared/cross-chain-arb.md (annal feed)');
}
