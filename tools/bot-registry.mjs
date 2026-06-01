// bot-registry.mjs — the single place that answers "what bots do we have, are they running, and
// are they reporting data?" Operator 2026-06-01: we need to see what's going on with all the bots.
// The manifest lists every bot + what it does + its schedule + its data output; status() cross-checks
// it against which bots have actually emitted data (via the universal bot-data collector).
//
//   node tools/bot-registry.mjs            # print the registry + reporting status
//   import { BOTS, status } from './bot-registry.mjs'

import { reportingBots, recentBotData } from './bot-data.mjs';

// the manifest. `emits` = the bot-data name it reports under (or null if not yet wired).
export const BOTS = [
  { name: 'wall-bot', what: 'VKBT/CURE buy/sell wall detection + support strategy', schedule: 'every 20 min (melek-wallbot.timer)', module: 'integrations/wall-bot.mjs', emits: 'wall-bot' },
  { name: 'scenario-runner', what: 'what-if market scenarios on angelicalist holdings (≥20% VKBT/CURE)', schedule: 'every 15 min (melek-scenario.timer)', module: 'integrations/scenario-runner.mjs', emits: 'scenario-runner' },
  { name: 'arb-watchlist', what: 'cross-chain arbitrage scan over a token watchlist', schedule: 'on-demand (wire a timer)', module: 'integrations/chains/arb-watchlist.mjs', emits: null },
  { name: 'cex-arb', what: 'cross-EXCHANGE arbitrage (ccxt, net of fees)', schedule: 'on-demand', module: 'integrations/cex-arb.mjs', emits: null },
  { name: 'tradefeed', what: 'sanitized trade-bot feed -> annal', schedule: 'melek-tradefeed.service', module: 'integrations/digest.mjs', emits: null },
  { name: 'wallet-monitor', what: 'watchtower: alert on any value leaving a watched account', schedule: 'built, NOT deployed', module: 'integrations/watchtower/wallet-monitor.mjs', emits: null },
  { name: 'balances', what: '20-chain read-only portfolio watcher', schedule: 'on-demand (needs wallet-config)', module: 'integrations/chains/balances.mjs', emits: null },
  { name: 'cheetah', what: 'attribution/credit + image pHash detection', schedule: 'melek-cheetah.service (fixtures)', module: 'cheetah/index.js', emits: null },
];

/** Cross-check the manifest against what's actually reporting data. */
export function status() {
  const reporting = new Set(reportingBots());
  return BOTS.map((b) => {
    const isReporting = b.emits ? reporting.has(b.emits) : false;
    const last = b.emits ? recentBotData(b.emits, 1)[0] : null;
    return { ...b, reporting: isReporting, lastAt: last?.at || null, lastSummary: last?.summary || null };
  });
}

if (process.argv[1] && process.argv[1].endsWith('bot-registry.mjs')) {
  const rows = status();
  console.log('MELEK bot registry — what runs, on what schedule, and is it reporting data?\n' + '─'.repeat(78));
  for (const r of rows) {
    const flag = r.reporting ? '📊 reporting' : (r.emits ? '— no data yet' : '⚠ no data-collection wired');
    console.log(`${r.name.padEnd(16)} ${flag}`);
    console.log(`   ${r.what}`);
    console.log(`   schedule: ${r.schedule}${r.lastAt ? `  | last: ${r.lastAt} (${r.lastSummary})` : ''}`);
  }
  console.log('─'.repeat(78));
  const wired = rows.filter((r) => r.emits).length;
  console.log(`${wired}/${rows.length} bots wired for data-collection; ${rows.filter((r) => r.reporting).length} currently reporting.`);
  console.log('Retrofit the rest with emitBotData() (tools/bot-data.mjs) — task #132.');
}
