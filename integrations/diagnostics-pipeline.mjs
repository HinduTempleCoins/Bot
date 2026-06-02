// diagnostics-pipeline.mjs — the connective tissue (task #179). It fuses the two halves the rest of
// the stack already produces — what the market is DOING (resource-center metrics + proposals) and
// what the market is SAYING (comms-parser news diagnostics) — into ONE digest the briefs read:
//
//   feeds → comms-parser → [all bots] → Data site → BRIEFS → MELEK users
//
// The flow this module sits in (operator's vision, #179):
//   news/article/market feeds
//      → comms-parser.mjs           (sentiment / entities / themes per asset)
//      → resource-center latest.json (price/volume metrics + depth-aware trade proposals)
//      → diagnostics()              (THIS — cross-reference saying-vs-doing → signals)
//          → signals[]              (confluence/divergence between news lean and price action)
//          → suggestedMoves[]       (exchange / bot / currency — each ADVISORY + US-aware)
//          → teachingNotes[]        (plain-English lessons for MELEK users — the "teach" step)
//      → engineBlock()              (brief-ready "### Diagnostics" markdown the 24/7 engine splices)
//
// ADVISORY ONLY. This module reads a snapshot and re-derives nothing executable: it places NO orders,
// loads NO keys, signs NOTHING, and touches NO funds. Every "suggested move" is a thinking aid for
// the operator and a teaching prompt for users — never an instruction to a bot. US-jurisdiction-aware:
// any venue suggestion flags the American-access caveat (KYC / state availability / tax events).
//
//   node integrations/diagnostics-pipeline.mjs           # print the diagnostics brief section
//   node integrations/diagnostics-pipeline.mjs --json     # raw diagnostics object

import { readFile } from 'node:fs/promises';
import { toDiagnostics } from './comms-parser.mjs';

// Same default the resource-center uses, so we read whatever it last wrote without extra config.
const RC_OUT = process.env.RC_OUT || new URL('../data/resource-center', import.meta.url).pathname;

const pctStr = (n) => (n == null || !Number.isFinite(+n) ? '—' : `${n >= 0 ? '+' : ''}${(+n).toFixed(2)}%`);
const num = (n, d = 2) => (n == null || !Number.isFinite(+n) ? '—' : (+n).toLocaleString(undefined, { maximumFractionDigits: d }));

/** Read the last resource-center snapshot. Degrades gracefully: missing/corrupt file → null. */
export async function loadSnapshot() {
  try { return JSON.parse(await readFile(`${RC_OUT}/latest.json`, 'utf8')); } catch { return null; }
}

// Normalize whatever shape the snapshot's news block has into a flat array of per-asset diagnostics.
// Accepts: snapshot.news.assets (the live shape), a raw {assets} digest, or a bare array. Never throws.
function newsRecords(news) {
  if (!news) return [];
  const a = news.assets || news;
  if (Array.isArray(a)) return a.filter(Boolean);
  if (a && typeof a === 'object') return Object.values(a).filter(Boolean);
  return [];
}

// If the snapshot carries no pre-crunched news but DOES carry raw headlines, re-crunch them through
// the comms-parser so the pipeline still works on a partial snapshot. Best-effort, pure.
function ensureRecords(news) {
  const recs = newsRecords(news);
  if (recs.length) return recs;
  if (Array.isArray(news?.headlines) && news.headlines.length) {
    try { return [toDiagnostics(news.headlines, { topic: 'crypto' })]; } catch { return []; }
  }
  return [];
}

// Map the asset bucket a news record is about onto the market metric that measures the same thing,
// so we can read "saying" next to "doing". Returns { label, change } or null.
function marketChangeFor(topic, metrics) {
  if (!metrics) return null;
  const t = String(topic || '').toLowerCase();
  if (t === 'crypto') {
    const he = metrics.hiveEngine;
    if (!he) return null;
    // proxy crypto "doing" by the breadth of HE movers (gainers vs losers lean)
    const g = (he.topGainers || []).reduce((s, r) => s + (+r.change || 0), 0);
    const l = (he.topLosers || []).reduce((s, r) => s + (+r.change || 0), 0);
    return { label: 'Hive-Engine breadth', change: +(g + l).toFixed(2) };
  }
  if (t === 'gold') return metrics.metals?.gold ? { label: 'Gold', change: +metrics.metals.gold.change } : null;
  if (t === 'forex') return metrics.dxy ? { label: 'DXY', change: +metrics.dxy.change } : null;
  if (t === 'markets') return metrics.indices?.sp500 ? { label: 'S&P 500', change: +metrics.indices.sp500.change } : null;
  return null;
}

// US-jurisdiction caveat strings — every venue/currency suggestion carries one. Kept short + honest.
const US_CAVEAT = 'US-access: confirm KYC + your state is supported; spot conversions can be taxable events.';

/**
 * Build the structured diagnostics object from a resource-center snapshot.
 *
 * @returns {{
 *   ts: string,
 *   signals: Array<{ topic, kind, sentimentHint, sentimentScore, marketChange, note }>,
 *   suggestedMoves: Array<{ kind:'exchange'|'bot'|'currency', label, rationale, advisory:true, usCaveat:string }>,
 *   teachingNotes: Array<{ title, lesson }>,
 *   sources: { snapshot:boolean, news:boolean, metrics:boolean, proposals:boolean }
 * }}
 */
export function diagnose(snapshot) {
  const ts = new Date().toISOString();
  const s = snapshot || {};
  const metrics = s.metrics || null;
  const records = ensureRecords(s.news);
  const proposalList = s.proposals?.proposals || (Array.isArray(s.proposals) ? s.proposals : []) || [];

  const signals = [];
  const suggestedMoves = [];
  const teachingNotes = [];
  const seenMove = new Set();
  const pushMove = (kind, label, rationale) => {
    const k = `${kind}:${label}`;
    if (seenMove.has(k)) return;
    seenMove.add(k);
    suggestedMoves.push({ kind, label, rationale, advisory: true, usCaveat: US_CAVEAT });
  };

  // 1) SIGNALS — cross-reference what the news is SAYING with what the market is DOING, per asset.
  for (const d of records) {
    if (!d || !d.topic) continue;
    const mc = marketChangeFor(d.topic, metrics);
    const said = d.sentimentHint || 'neutral';
    let kind = 'observation', note = '';
    if (mc && Number.isFinite(mc.change)) {
      const doing = mc.change > 0.05 ? 'up' : mc.change < -0.05 ? 'down' : 'flat';
      const saidUp = said === 'bullish', saidDown = said === 'bearish';
      if ((saidUp && doing === 'up') || (saidDown && doing === 'down')) {
        kind = 'confluence';
        note = `News lean (${said}) agrees with price (${mc.label} ${pctStr(mc.change)}) — the move has narrative behind it.`;
      } else if ((saidUp && doing === 'down') || (saidDown && doing === 'up')) {
        kind = 'divergence';
        note = `News lean (${said}) DISAGREES with price (${mc.label} ${pctStr(mc.change)}) — sentiment and tape are out of step; watch for a turn or a fade.`;
      } else {
        note = `News ${said}; ${mc.label} ${pctStr(mc.change)} (${doing}). No strong confluence this pass.`;
      }
    } else {
      note = `News ${said} on ${d.topic} (${d.headlineCount || 0} headlines)${(d.themes || []).length ? `; themes: ${d.themes.slice(0, 3).map((x) => x.word).join(', ')}` : ''}.`;
    }
    signals.push({
      topic: d.topic, kind, sentimentHint: said,
      sentimentScore: d.sentimentScore ?? 0,
      marketChange: mc, headlineCount: d.headlineCount || 0,
      topMentions: Object.keys(d.mentions || {}).slice(0, 5), note,
    });
  }

  // 2) SUGGESTED MOVES — derived from the signals + the depth-aware proposals already in the snapshot.
  // All three flavors (exchange / bot / currency), all advisory, all US-aware.
  for (const sig of signals) {
    if (sig.kind === 'divergence') {
      pushMove('currency', sig.topic, `Sentiment/price divergence on ${sig.topic} — size down or wait for them to re-align before rotating.`);
    }
    if (sig.kind === 'confluence' && sig.sentimentScore > 0) {
      pushMove('currency', sig.topic, `News + tape both lean ${sig.sentimentHint} on ${sig.topic} — the higher-conviction side of the book this pass.`);
    }
  }
  // bot move — wire the strongest news mention into the copy-trade / circles bots as a watch item.
  const topMention = signals.flatMap((s2) => s2.topMentions).filter(Boolean)[0];
  if (topMention) pushMove('bot', `watch:${topMention}`, `${topMention} is the most-mentioned asset across the feeds — add it to the bots' watch list (copy-trade / profit-circles) as an advisory candidate, not an auto-order.`);
  // exchange move — surface arbitrage proposals as a "which venue" prompt (HE-first, US-aware).
  const arb = proposalList.find((p) => p && (p.kind === 'arbitrage' || /arb/i.test(p.kind || '')));
  if (arb) pushMove('exchange', 'Hive-Engine + a US-accessible CEX', `A depth-aware arbitrage edge exists (${arb.summary || arb.kind}). Start on Hive-Engine (already operational); pair it only with a US-accessible venue.`);
  else pushMove('exchange', 'Hive-Engine (start here)', 'No live arbitrage edge this pass — keep the operational footprint on Hive-Engine and add US-accessible venues deliberately.');
  // currency floor — if the dollar is strong, holding stable is itself a position.
  if (metrics?.dxy?.change != null && +metrics.dxy.change > 0.3) {
    pushMove('currency', 'USD / stable', `Dollar firm (DXY ${pctStr(metrics.dxy.change)}) — sitting in stable is a real position, not a non-decision.`);
  }

  // 3) TEACHING NOTES — the "teach MELEK users" step. Plain-English, no jargon, drawn from THIS pass.
  teachingNotes.push({
    title: 'Two readings of a market',
    lesson: 'Every asset has a price (what it IS doing) and a story (what people are SAYING). When they agree, a move has conviction; when they disagree, one of them is about to give. We show you both so you can tell which.',
  });
  const conf = signals.find((x) => x.kind === 'confluence');
  const div = signals.find((x) => x.kind === 'divergence');
  if (conf) teachingNotes.push({ title: `Why ${conf.topic} looks aligned today`, lesson: `The headlines lean ${conf.sentimentHint} and the price is moving the same way. That agreement is what "conviction" means — it's a clearer setup than a price moving with no story behind it.` });
  if (div) teachingNotes.push({ title: `Why ${div.topic} is a "wait"`, lesson: `The news and the price point opposite ways on ${div.topic}. That's a coin-flip, not a signal. The lesson: when the story and the chart disagree, the patient move is to wait for them to agree.` });
  teachingNotes.push({
    title: 'Advisory means advisory',
    lesson: 'Nothing here places a trade. These are reading aids — like a weather report, not a steering wheel. You (a person) decide; and in the US, every conversion can be a taxable event and every venue has its own KYC and state rules.',
  });

  return {
    ts,
    signals,
    suggestedMoves,
    teachingNotes,
    sources: {
      snapshot: !!snapshot,
      news: records.length > 0,
      metrics: !!metrics,
      proposals: proposalList.length > 0,
    },
  };
}

/** Run the full pipeline: load the latest snapshot, diagnose it. Best-effort, never throws. */
export async function diagnostics() {
  const snap = await loadSnapshot().catch(() => null);
  return diagnose(snap);
}

const KIND_ARROW = { confluence: '✓', divergence: '⚠', observation: '•' };

/** Render the diagnostics object as a brief-ready markdown section. Pure, never throws. */
export function renderMarkdown(diag) {
  const d = diag || { signals: [], suggestedMoves: [], teachingNotes: [], sources: {} };
  const L = [];
  L.push(`### Diagnostics — signals → suggested moves → teaching`);
  L.push(`*Fuses what the market is **saying** (news) with what it's **doing** (price/volume) into one read. ADVISORY ONLY — no keys, no orders, nothing executes. US-jurisdiction-aware.*`);
  L.push('');

  // signals
  L.push(`**Signals** (news lean vs. price action):`);
  if (d.signals?.length) {
    for (const s of d.signals) {
      const a = KIND_ARROW[s.kind] || '•';
      L.push(`- ${a} **${s.topic}** — ${s.kind}: ${s.note}`);
    }
  } else L.push(`- _No signals this pass (snapshot or feeds unavailable)._`);
  L.push('');

  // suggested moves
  L.push(`**Suggested moves** (advisory — operator decides, bots do NOT auto-act):`);
  if (d.suggestedMoves?.length) {
    for (const m of d.suggestedMoves) {
      L.push(`- _[${m.kind}]_ **${m.label}** — ${m.rationale}`);
      L.push(`    ↳ ${m.usCaveat}`);
    }
  } else L.push(`- _None derivable this pass._`);
  L.push('');

  // teaching
  L.push(`**Teaching notes** (plain-English, for MELEK users):`);
  if (d.teachingNotes?.length) {
    for (const t of d.teachingNotes) L.push(`- **${t.title}.** ${t.lesson}`);
  } else L.push(`- _None this pass._`);
  L.push('');
  const src = d.sources || {};
  L.push(`*Inputs: snapshot ${src.snapshot ? '✓' : '✗'} · news ${src.news ? '✓' : '✗'} · metrics ${src.metrics ? '✓' : '✗'} · proposals ${src.proposals ? '✓' : '✗'}. Engine: diagnostics-pipeline.mjs · advisory only.*`);
  return L.join('\n');
}

/**
 * The single entry point the resource-center engine splices in (mirrors cross-venue / copy-trade /
 * impact engineBlock contract): returns a markdown string, never throws, empty string on total failure.
 */
export async function engineBlock() {
  try {
    const diag = await diagnostics();
    return renderMarkdown(diag);
  } catch { return ''; }
}

export default { loadSnapshot, diagnose, diagnostics, renderMarkdown, engineBlock };

if (process.argv[1] && process.argv[1].endsWith('diagnostics-pipeline.mjs')) {
  const diag = await diagnostics();
  if (process.argv.includes('--json')) console.log(JSON.stringify(diag, null, 2));
  else console.log(renderMarkdown(diag));
}
