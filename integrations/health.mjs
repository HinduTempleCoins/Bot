// health.mjs — READ-ONLY one-shot health check of the whole integrations layer. No keys.
// Pings every reader once and reports up/down + latency, so a cron (or the Telegram /status)
// can verify the market-intelligence layer in a single call.
//
//   node integrations/health.mjs            # human table
//   node integrations/health.mjs --json     # machine-readable

import { market } from './hive-engine-market.mjs';
import { priceUsd } from './price-oracle.mjs';
import { scanArb } from './arb-scanner.mjs';
import { chain } from './chain-explorer.mjs';
import { chainStatus } from './chains/multichain.mjs';
import { TRADE_ACCOUNT } from './watchlist.mjs';
import { marketHistory } from './tradebot-forensics.mjs';

const checks = [
  ['hive-engine-market', async () => { const m = await market.metrics('VKBT'); return m ? `last ${(+m.lastPrice).toFixed(8)}` : 'no metrics'; }],
  ['price-oracle', async () => { const p = await priceUsd('hive'); return `HIVE $${p.usd} (${p.sources} src${p.confident ? ', confident' : ''})`; }],
  ['arb-scanner', async () => { const a = await scanArb(); return `${a.opportunities.length} exec opp / ${a.rows.length} pairs`; }],
  ['chain-explorer', async () => { const c = await chain(); return `${c.label} head ${c.headBlock}`; }],
  ['tradebot-forensics', async () => { const ops = await marketHistory(TRADE_ACCOUNT, 50); return `${ops.length} ops for @${TRADE_ACCOUNT}`; }],
  ['multichain:ethereum', async () => { const s = await chainStatus('ethereum'); return s?.error ? `err ${s.error}` : `block ${s.height}`; }],
  ['multichain:solana', async () => { const s = await chainStatus('solana'); return s?.error ? `err ${s.error}` : `slot ${s.height}`; }],
];

const results = await Promise.all(checks.map(async ([name, fn]) => {
  const t0 = process.hrtime.bigint();
  try { const sample = await fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; return { name, ok: true, ms: Math.round(ms), sample }; }
  catch (e) { const ms = Number(process.hrtime.bigint() - t0) / 1e6; return { name, ok: false, ms: Math.round(ms), sample: e.message }; }
}));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: results.every(r => r.ok), checks: results }, null, 2));
} else {
  const up = results.filter(r => r.ok).length;
  console.log(`Integrations health — ${up}/${results.length} up\n${'─'.repeat(66)}`);
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(24)} ${String(r.ms + 'ms').padStart(7)}  ${String(r.sample).slice(0, 30)}`);
}
process.exit(results.every(r => r.ok) ? 0 : 1);
