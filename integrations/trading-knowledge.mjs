// trading-knowledge.mjs — the trade bot's "knowledge brain" for intraday + arbitrage decisions.
//
// Operator: deep-dive day-trading + volatile coins (SHIB-class) + real arbitrage wins into JSON, then
// "plug the trade bot into that part of the brain." This module loads knowledge/trading/*.json (the
// compiled deep-dive) and gives the scanner / decades-brain / briefs a grounded, regime-aware view of
// WHAT to do, WHICH coins to watch, and WHICH arbitrage patterns are actually replicable at our size.
//
// READ-ONLY. No keys, no orders. It informs decisions; the signer/executor still gates any broadcast.
//
//   import { recommend, watchlist, arbitrageCases, briefBlock } from './trading-knowledge.mjs';
//   const plan = recommend({ regime: 'ranging' });   // → fit strategies + risk rules for thin books
//
// CLI:  node integrations/trading-knowledge.mjs [recommend <regime> | coins [--us] | arb [--replicable] | brief]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.TRADING_KB_DIR || path.join(__dirname, '..', 'knowledge', 'trading');

let _cache = null;
function load() {
  if (_cache) return _cache;
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
  _cache = {
    playbook: read('day-trading-playbook.json') || { strategies: [], indicators: [], riskRules: [] },
    coins: read('volatile-coins-watchlist.json') || { criteria: [], watchlist: [] },
    arb: read('arbitrage-cases.json') || { cases: [], patterns: [] },
  };
  return _cache;
}
export function __reset() { _cache = null; } // tests

export function strategies() { return load().playbook.strategies || []; }
export function indicators() { return load().playbook.indicators || []; }
export function riskRules() { return load().playbook.riskRules || []; }

/** Volatile coins to watch. {usOnly:true} → only US-tradeable. */
export function watchlist({ usOnly = false } = {}) {
  const list = load().coins.watchlist || [];
  return usOnly ? list.filter((c) => c.usTradeable) : list;
}
export function watchSymbols(opts) { return watchlist(opts).map((c) => c.symbol); }

/** Arbitrage cases. {replicableOnly:true} → only those marked replicable at small size. */
export function arbitrageCases({ replicableOnly = false } = {}) {
  const cases = load().arb.cases || [];
  return replicableOnly ? cases.filter((c) => c.replicableAtSmallSize) : cases;
}
export function arbitragePatterns() { return load().arb.patterns || []; }

// Regime → which strategies fit. Keyword-match the deep-dive's whenItWorks/how text. Our bot's bias
// (from the synthesis): thin books + slow fills + small size → favor mean-reversion / range / VWAP
// pullback with resting limits; scalping & momentum-chasing are out-of-budget for our fill speed.
const REGIME_TERMS = {
  ranging: ['range', 'mean-reversion', 'mean reversion', 'sideways', 'bollinger', 'vwap'],
  trending: ['trend', 'momentum', 'breakout', 'vwap'],
  volatile: ['catalyst', 'news', 'breakout', 'momentum'],
};
const OUT_OF_BUDGET = ['scalp']; // fill-speed / fee drag we can't win

/**
 * Recommend intraday strategies for a market regime, biased to what works on our thin books at small
 * size. Returns { regime, fit:[strategy...], avoid:[name...], riskRules, note }.
 * @param {{regime?: 'ranging'|'trending'|'volatile'|'unknown'}} [opts]
 */
export function recommend({ regime = 'ranging' } = {}) {
  const all = strategies();
  const terms = REGIME_TERMS[regime] || REGIME_TERMS.ranging;
  const matches = (s) => {
    const hay = `${s.name} ${s.how} ${s.whenItWorks}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  };
  const outOfBudget = (s) => OUT_OF_BUDGET.some((t) => s.name.toLowerCase().includes(t));
  const fit = all.filter((s) => matches(s) && !outOfBudget(s));
  const avoid = all.filter(outOfBudget).map((s) => s.name);
  return {
    regime,
    fit: fit.map((s) => ({ name: s.name, entry: s.entry, exit: s.exit, risk: s.risk })),
    avoid,
    riskRules: riskRules(),
    note: 'Thin books + small size: resting LIMIT entries, ATR-sized stops, R:R >= 2:1, hard daily loss cap. Scalping/momentum-chasing out-of-budget for our fill speed.',
  };
}

/** Plain-markdown block for the briefs (what the bot should watch + do today). */
export function briefBlock() {
  const kb = load();
  if (!(kb.playbook.strategies || []).length) return '';
  const us = watchlist({ usOnly: true }).slice(0, 6).map((c) => `${c.symbol} (${c.typicalDailyRangePct})`).join(', ');
  const repl = arbitrageCases({ replicableOnly: true }).length;
  const rec = recommend({ regime: 'ranging' });
  return [
    '### Trade knowledge (intraday + arbitrage)',
    '',
    `Watch (US-tradeable, volatile): ${us || '—'}.`,
    `Default play on our thin books: ${rec.fit.map((s) => s.name).join(', ') || 'mean-reversion / range'} — ${rec.note}`,
    `Arbitrage patterns replicable at our size: ${repl} of ${arbitrageCases().length} documented cases. Avoid: ${rec.avoid.join(', ') || 'scalping'}.`,
    '_Advisory only — read-only, no orders; signer-gated._',
  ].join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('trading-knowledge.mjs');
if (isMain) {
  const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const us = process.argv.includes('--us');
  const repl = process.argv.includes('--replicable');
  if (cmd === 'recommend') console.log(JSON.stringify(recommend({ regime: arg || 'ranging' }), null, 2));
  else if (cmd === 'coins') console.log(JSON.stringify(watchlist({ usOnly: us }), null, 2));
  else if (cmd === 'arb') console.log(JSON.stringify(arbitrageCases({ replicableOnly: repl }), null, 2));
  else console.log(briefBlock());
}
