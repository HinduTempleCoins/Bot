// trade-analyzer.mjs — fuses Way 1 (what the bot did, on-chain P&L) + Way 2 (live market) into
// ranked findings + concrete, rules-based suggestions. READ-ONLY, no keys. Emits JSON that the
// annal/brief AIs consume (after the sanitizer). This is the "watch + suggest" core.
//
//   node integrations/trade-analyzer.mjs [account]   (default kalivankush)
// Writes .local/trade-analysis.json and prints a readable report.

import { writeFileSync, mkdirSync } from 'node:fs';
import { marketHistory, reconstruct, currentHoldings } from './tradebot-forensics.mjs';
import { market } from './hive-engine-market.mjs';
import { scanArb } from './arb-scanner.mjs';

const ACCOUNT = process.argv[2] || 'kalivankush';
const PARITY_TARGET = 1.0;           // VKBT/CURE strategic target (HIVE)
const ISSUED = new Set(['VKBT', 'CURE']); // tokens this account issues / tries to push

function pct(n) { return `${(n * 100).toFixed(1)}%`; }

async function analyze(account) {
  const ops = await marketHistory(account);
  const { sym } = reconstruct(ops);
  const holdings = Object.fromEntries((await currentHoldings(account)).map(h => [h.symbol, h.balance + h.stake]));

  const tokens = [];
  for (const [s, v] of Object.entries(sym)) {
    if (!(v.buys || v.sells)) continue;
    const net = v.hiveRecv - v.hiveSpent;
    const held = holdings[s] || 0;
    let last = 0, ask = 0, bid = 0, spread = null;
    try { const m = await market.metrics(s); if (m) { last = +m.lastPrice; ask = +m.lowestAsk; bid = +m.highestBid; } } catch {}
    if (ask && bid) spread = (ask - bid) / ask;
    tokens.push({ symbol: s, ...v, net, held, heldHive: held * last, last, spread, issued: ISSUED.has(s) });
  }
  tokens.sort((a, b) => a.net - b.net); // losers first

  const findings = [], suggestions = [];
  for (const t of tokens) {
    if (t.net <= -50 && t.held === 0)
      { findings.push(`SINK: ${t.symbol} lost ${(-t.net).toFixed(0)} HIVE and holds nothing now — pure bleed.`);
        suggestions.push(`STOP trading ${t.symbol}. It cost ${(-t.net).toFixed(0)} HIVE with zero recovery. Disable whatever strategy buys it.`); }
    else if (t.net >= 200)
      { findings.push(`WORKS: ${t.symbol} netted +${t.net.toFixed(0)} HIVE (${t.sells} sells).`);
        suggestions.push(`SCALE ${t.symbol}: this is where profit came from. Increase allocation / keep the arbitrage running.`); }
    if (t.issued && t.last > 0) {
      const gap = PARITY_TARGET / t.last;
      findings.push(`PARITY: ${t.symbol} trades at ${t.last.toFixed(6)} HIVE vs target ${PARITY_TARGET} — ${gap.toFixed(0)}× away. Held ${t.held.toLocaleString()} = only ${t.heldHive.toFixed(1)} HIVE.`);
      suggestions.push(`RETHINK ${t.symbol} push-to-parity: a ${gap.toFixed(0)}× move is unrealistic by self-buying. Cap spend; treat the ${t.heldHive.toFixed(0)} HIVE bag as sunk, not an asset.`);
    }
    if (t.held > 0 && t.heldHive < 1 && t.spread != null && t.spread > 0.5)
      { findings.push(`STUCK: ${t.symbol} held ${t.held.toLocaleString()} but worth <1 HIVE and ${pct(t.spread)} spread — illiquid/dead.`);
        suggestions.push(`Do not add to ${t.symbol}; it is illiquid (${pct(t.spread)} spread). Capital here is effectively frozen.`); }
  }

  // live arbitrage opportunities (the proven earner): SWAP.X HE price vs real asset
  let liveArb = [];
  try {
    const { opportunities } = await scanArb();
    liveArb = opportunities.map(o => ({ signal: o.signal, edgePct: +(o.edge * 100).toFixed(1), realUsd: +o.realUsd.toFixed(2) }));
    for (const o of liveArb) {
      findings.push(`LIVE ARB: ${o.signal} — ${o.edgePct}% edge (verify order-book depth).`);
      suggestions.push(`Consider ${o.signal}: ${o.edgePct}% mispricing vs real $${o.realUsd}. Confirm executable depth before sizing.`);
    }
  } catch {}

  const realized = tokens.reduce((a, t) => a + t.net, 0);
  const unrealized = tokens.reduce((a, t) => a + t.heldHive, 0);
  return {
    liveArb,
    account, generatedAtNote: 'stamp on write', window_ops: ops.length,
    totals: { realizedHive: +realized.toFixed(2), unrealizedHive: +unrealized.toFixed(2), netHive: +(realized + unrealized).toFixed(2) },
    tokens: tokens.map(t => ({ symbol: t.symbol, buys: t.buys, sells: t.sells, netHive: +t.net.toFixed(2), held: t.held, heldHive: +t.heldHive.toFixed(2), lastPrice: t.last, issued: t.issued })),
    findings, suggestions,
  };
}

const result = await analyze(ACCOUNT);
mkdirSync('.local', { recursive: true });
writeFileSync('.local/trade-analysis.json', JSON.stringify(result, null, 2));

console.log(`\n═══════ TRADE ANALYSIS — @${result.account} ═══════`);
console.log(`window: ${result.window_ops} ops | realized ${result.totals.realizedHive} + holdings ${result.totals.unrealizedHive} = ${result.totals.netHive} HIVE\n`);
console.log('FINDINGS:'); result.findings.forEach(f => console.log('  • ' + f));
console.log('\nSUGGESTIONS:'); result.suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
console.log('\n→ .local/trade-analysis.json (for the annal/brief AIs, after sanitizing)');
