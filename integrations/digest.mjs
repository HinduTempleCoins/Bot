// digest.mjs — the ONE annal-ready artifact. READ-ONLY, no keys.
// Runs the readers once and fuses them into a single dated digest the annal/brief AIs read
// each cadence: the analyzer's findings/suggestions (Way 1 + Way 2 + arbitrage + ownership),
// the historical timeline (how it got here), and the base-chain explorer context (the account
// and chain head on the steemd-style layer). Writes the RAW internal copy; the sanitizer then
// produces the shareable copy for the external API-AI tier.
//
//   node integrations/digest.mjs [account]
// Writes .local/trade-analysis.json (raw, for sanitizer) + .local/trade-digest.md (human/annal).

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { analyze } from './trade-analyzer.mjs';
import { buildTimeline } from './timeline.mjs';
import { account as chainAccount, chain as chainHead, CHAIN_LABEL } from './chain-explorer.mjs';
import { holders } from './holders.mjs';
import { TRADE_ACCOUNT, ISSUED_TOKENS } from './watchlist.mjs';

const ACCOUNT = process.argv[2] || TRADE_ACCOUNT;

async function safe(p, fallback = null) { try { return await p; } catch { return fallback; } }

const [analysis, timeline, acct, head, ownership] = await Promise.all([
  safe(analyze(ACCOUNT)),
  safe(buildTimeline(ACCOUNT)),
  safe(chainAccount(ACCOUNT)),
  safe(chainHead()),
  safe(Promise.all(ISSUED_TOKENS.map(s => holders(s).catch(() => null))).then(a => a.filter(Boolean))),
]);

// #30 diff: compare against the prior digest snapshot (net position + finding set)
let priorSnap = null;
try { priorSnap = JSON.parse(readFileSync('.local/trade-digest-prev.json', 'utf8')); } catch {}
const curSnap = {
  netHive: analysis?.totals?.netHive ?? null,
  findings: (analysis?.findings || []).map(f => f.split(':')[0] + ':' + (f.match(/^\w+: (\S+)/)?.[1] || '')),
};
const changed = [];
if (priorSnap) {
  if (priorSnap.netHive != null && curSnap.netHive != null) {
    const d = +(curSnap.netHive - priorSnap.netHive).toFixed(2);
    if (Math.abs(d) >= 1) changed.push(`net position ${d > 0 ? '+' : ''}${d} HIVE since last digest`);
  }
  const ps = new Set(priorSnap.findings || []), cs = new Set(curSnap.findings);
  for (const f of cs) if (!ps.has(f)) changed.push(`NEW: ${f}`);
  for (const f of ps) if (!cs.has(f)) changed.push(`CLEARED: ${f}`);
}

mkdirSync('.local', { recursive: true });
// the analyzer JSON is what the sanitizer consumes — write it exactly as before
if (analysis) writeFileSync('.local/trade-analysis.json', JSON.stringify(analysis, null, 2));

const L = [];
L.push(`# Trade-bot digest — @${ACCOUNT}`);
L.push('');
L.push('_RAW internal copy (the Readers\' fused output). Run the sanitizer before any external AI reads this._');
L.push('');

if (changed.length) {
  L.push('## What changed since last digest');
  for (const c of changed.slice(0, 12)) L.push(`- ${c}`);
  L.push('');
}

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

if (ownership && ownership.length) {
  L.push('## Ownership (is there real outside demand?)');
  for (const o of ownership) L.push(`- ${o.symbol}: issuer ${o.issuerPct}% · affiliated ${o.affiliatedPct}% · REAL outside ${o.realOutsidePct}% (${o.counts.realOutside} accounts ≥1)`);
  L.push('');
}

L.push('---');
L.push('_Next: `node integrations/trade-sanitizer.mjs` → `.local/shared/trade-brief-feed.md` (the only copy the external API AIs may read)._');

// #30: persist this digest's snapshot so the NEXT run can diff against it
try { writeFileSync('.local/trade-digest-prev.json', JSON.stringify(curSnap)); } catch {}

const md = L.join('\n');
writeFileSync('.local/trade-digest.md', md);
console.log(md);
console.log('\n' + '─'.repeat(60));
console.log('→ .local/trade-analysis.json (raw, for sanitizer) + .local/trade-digest.md (annal)');
