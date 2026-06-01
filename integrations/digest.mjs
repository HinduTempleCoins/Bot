// digest.mjs — the ONE annal-ready artifact. READ-ONLY, no keys.
// Runs the readers once and fuses them into a single dated digest the annal/brief AIs read
// each cadence: the analyzer's findings/suggestions (Way 1 + Way 2 + arbitrage + ownership),
// the historical timeline (how it got here), and the base-chain explorer context (the account
// and chain head on the steemd-style layer). Writes the RAW internal copy; the sanitizer then
// produces the shareable copy for the external API-AI tier.
//
//   node integrations/digest.mjs [account]
// Writes .local/trade-analysis.json (raw, for sanitizer) + .local/trade-digest.md (human/annal).

import { writeFileSync, mkdirSync } from 'node:fs';
import { analyze } from './trade-analyzer.mjs';
import { buildTimeline } from './timeline.mjs';
import { account as chainAccount, chain as chainHead, CHAIN_LABEL } from './chain-explorer.mjs';
import { TRADE_ACCOUNT } from './watchlist.mjs';

const ACCOUNT = process.argv[2] || TRADE_ACCOUNT;

async function safe(p, fallback = null) { try { return await p; } catch { return fallback; } }

const [analysis, timeline, acct, head] = await Promise.all([
  safe(analyze(ACCOUNT)),
  safe(buildTimeline(ACCOUNT)),
  safe(chainAccount(ACCOUNT)),
  safe(chainHead()),
]);

mkdirSync('.local', { recursive: true });
// the analyzer JSON is what the sanitizer consumes — write it exactly as before
if (analysis) writeFileSync('.local/trade-analysis.json', JSON.stringify(analysis, null, 2));

const L = [];
L.push(`# Trade-bot digest — @${ACCOUNT}`);
L.push('');
L.push('_RAW internal copy (the Readers\' fused output). Run the sanitizer before any external AI reads this._');
L.push('');

if (head) {
  L.push(`## Base chain (${CHAIN_LABEL})`);
  L.push(`- head block ${head.headBlock} | current witness @${head.currentWitness} | supply ${head.supply}`);
  if (acct) {
    L.push(`- @${acct.name}: liquid ${acct.balance}, hbd ${acct.hbd}, staked ${acct.vesting}, ${acct.postCount} posts`);
    L.push(`  - note: liquid base-token balance is the on-chain side; trading capital lives in HIVE-Engine tokens below.`);
  }
  L.push('');
}

if (analysis) {
  L.push('## Position (Way 1 trades + Way 2 market)');
  L.push(`- window ${analysis.window_ops} ops | realized ${analysis.totals.realizedHive} + holdings ${analysis.totals.unrealizedHive} = **${analysis.totals.netHive} HIVE**`);
  L.push('');
  L.push('| token | role | net HIVE | held≈HIVE | last |');
  L.push('|---|---|---:|---:|---:|');
  for (const t of analysis.tokens.slice(0, 16)) L.push(`| ${t.symbol} | ${t.issued ? 'issued' : 'traded'} | ${t.netHive} | ${t.heldHive} | ${t.lastPrice} |`);
  L.push('');
  L.push('### Findings');
  for (const f of analysis.findings) L.push(`- ${f}`);
  L.push('');
  L.push('### Suggestions');
  analysis.suggestions.forEach((s, i) => L.push(`${i + 1}. ${s}`));
  L.push('');
}

if (timeline) {
  L.push('## Timeline (how it got here)');
  L.push(`- ${timeline.ops} ops across ${timeline.days} active days | final cumulative realized ${timeline.finalCumRealized} HIVE`);
  if (timeline.worstDays?.length) L.push(`- worst days: ${timeline.worstDays.map(d => `${d.day} (${d.dayRealized})`).join(', ')}`);
  if (timeline.bestDays?.length) L.push(`- best days: ${timeline.bestDays.map(d => `${d.day} (+${d.dayRealized})`).join(', ')}`);
  if (timeline.arb) L.push(`- arb scans logged: ${timeline.arb.scans} (${timeline.arb.opportunitiesFound} executable opps)`);
  L.push('');
}

L.push('---');
L.push('_Next: `node integrations/trade-sanitizer.mjs` → `.local/shared/trade-brief-feed.md` (the only copy the external API AIs may read)._');

const md = L.join('\n');
writeFileSync('.local/trade-digest.md', md);
console.log(md);
console.log('\n' + '─'.repeat(60));
console.log('→ .local/trade-analysis.json (raw, for sanitizer) + .local/trade-digest.md (annal)');
