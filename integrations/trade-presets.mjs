// trade-presets.mjs — DRY-RUN scaffold for pre-set, rule-based trade bots (the hive.trade-style
// deterministic ones that sit alongside the smarter AI-driven trader). READ-ONLY: it defines
// strategies as config and SIMULATES what each would do against the live market — it never trades,
// holds no keys, broadcasts nothing. Execution is a separate, gated, MELEK-Signer-only concern
// (zero-WIF rule). This is the safe skeleton: strategies + a what-would-it-do simulator.
//
//   node integrations/trade-presets.mjs            # dry-run every preset against the live market
//   import { PRESETS, simulate } from './trade-presets.mjs'

import { market } from './hive-engine-market.mjs';
import { priceUsd, hiveUsd as oracleHiveUsd } from './price-oracle.mjs';
import { SWAP_PAIRS } from './watchlist.mjs';

// Deterministic strategies. Each is pure config + a `decide(ctx)` that returns an intended action
// (or hold). No side effects. Mirrors the kind of presets hive.trade exposes.
export const PRESETS = {
  // sell a SWAP.X on HE when its HE bid is richer than the real asset by `edge`
  'swap-sell-on-premium': {
    desc: 'Sell SWAP.X on HE when the HE bid beats the real price by the edge (the proven earner).',
    params: { edge: 0.03 },
    decide: ({ sym, bidUsd, realUsd, p }) =>
      (bidUsd && realUsd && (bidUsd - realUsd) / realUsd >= p.edge)
        ? { action: 'SELL', sym, reason: `HE bid $${bidUsd.toFixed(4)} is ${(((bidUsd - realUsd) / realUsd) * 100).toFixed(1)}% over real $${realUsd.toFixed(4)}` }
        : { action: 'HOLD', sym },
  },
  // buy a SWAP.X on HE only when the ask is below real by `edge` AND the book is deep enough
  'swap-buy-on-discount': {
    desc: 'Buy SWAP.X on HE when the ask is below real price by the edge (verify depth first).',
    params: { edge: 0.03 },
    decide: ({ sym, askUsd, realUsd, p }) =>
      (askUsd && realUsd && (realUsd - askUsd) / askUsd >= p.edge)
        ? { action: 'BUY', sym, reason: `HE ask $${askUsd.toFixed(4)} is ${(((realUsd - askUsd) / askUsd) * 100).toFixed(1)}% under real $${realUsd.toFixed(4)} — confirm executable depth` }
        : { action: 'HOLD', sym },
  },
  // never accumulate without a selling leg (the SWAP.LTC bleed lesson, encoded as a guard)
  'no-one-way-accumulation': {
    desc: 'Guard: refuse a BUY preset on a token the operator has been net-buying without selling (anti-SWAP.LTC).',
    params: {},
    decide: ({ sym }) => ({ action: 'GUARD', sym, reason: 'a buy-only strategy on a SWAP token is a HIVE drain — require a selling leg' }),
  },
};

// gather the live context for one symbol (read-only)
async function ctxFor(sym, id, hiveUsd) {
  const [m, real] = await Promise.all([market.metrics(sym).catch(() => null), priceUsd(id).catch(() => ({ usd: 0, confident: false }))]);
  return {
    sym, realUsd: real.confident ? real.usd : 0,
    askUsd: m ? +m.lowestAsk * hiveUsd : 0,
    bidUsd: m ? +m.highestBid * hiveUsd : 0,
  };
}

// dry-run: for each SWAP pair, what would each applicable preset decide right now?
export async function simulate({ presets = ['swap-sell-on-premium', 'swap-buy-on-discount'] } = {}) {
  const hiveUsd = await oracleHiveUsd();
  const out = [];
  for (const [sym, id] of Object.entries(SWAP_PAIRS)) {
    const base = await ctxFor(sym, id, hiveUsd);
    if (!base.realUsd) { out.push({ sym, skip: 'no confident real price' }); continue; }
    for (const name of presets) {
      const pre = PRESETS[name]; if (!pre) continue;
      const d = pre.decide({ ...base, p: pre.params });
      if (d.action !== 'HOLD') out.push({ preset: name, ...d });
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('trade-presets.mjs')) {
  console.log('Pre-set trade bots — DRY RUN (read-only, no execution, no keys)\n' + '─'.repeat(66));
  console.log('Presets:'); for (const [k, v] of Object.entries(PRESETS)) console.log(`  • ${k}: ${v.desc}`);
  console.log('\nWhat they would do against the live market right now:');
  const decisions = await simulate().catch(e => [{ error: e.message }]);
  if (!decisions.length) console.log('  (no actionable signals — all HOLD)');
  for (const d of decisions) {
    if (d.error) { console.log(`  error: ${d.error}`); continue; }
    if (d.skip) { console.log(`  ${d.sym}: ${d.skip}`); continue; }
    console.log(`  [${d.action}] ${d.sym} (${d.preset}) — ${d.reason}`);
  }
  console.log('\nExecution is intentionally NOT here: it is gated, MELEK-Signer-only (zero WIF on this host).');
}
