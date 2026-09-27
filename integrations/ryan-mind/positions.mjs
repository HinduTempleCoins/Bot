// ryan-mind/positions.mjs — roll annals up, per category, into POSITION documents (the "briefs"):
//   {category, label, current_position:{statement, claims:[{id, quote, source, when, class, support}]},
//    held_positions (deliberate divergences from consensus, with the mainstream view as context),
//    history (what changed, when, why — every self-correction), open_contradictions, review_open, stats}
// Incremental: positions/_state.json remembers how many claims / annals / review rows it has folded in;
// only categories touched by new rows are rebuilt. `full:true` rebuilds everything.
import { deriveState, splitReview, whenOf } from './reconcile.mjs';
import { readClaims } from './store.mjs';

function labelOf(tax, id) { return (tax?.categories || []).find((c) => c.id === id)?.label || id; }
function cite(c, st) { return { id: c.id, quote: c.quote, source: c.source_title, source_id: c.source_id, when: whenOf(c), class: st?.class || c.class, speaker: c.speaker }; }

/** Build one category's position document. Pure. */
export function buildPosition(cat, { claims, annals, reviewRows, state, tax, statement = null, now }) {
  const inCat = claims.filter((c) => c.category === cat);
  const ids = new Set(inCat.map((c) => c.id));
  const byId = new Map(claims.map((c) => [c.id, c]));
  const support = new Map();
  for (const a of annals) if ((a.relation === 'supports' || a.relation === 'refines') && a.claim_b) for (const x of [a.claim_a, a.claim_b]) if (ids.has(x)) support.set(x, (support.get(x) || 0) + 1);
  const active = inCat.filter((c) => state.get(c.id)?.status === 'active' && c.own);
  const score = (c) => c.confidence * (1 + Math.log2(1 + (support.get(c.id) || 0))) + (state.get(c.id)?.class === 'position' ? 0.2 : 0) + (state.get(c.id)?.class === 'slip_candidate' ? -1 : 0);
  const top = [...active].sort((a, b) => score(b) - score(a) || whenOf(b).localeCompare(whenOf(a))).slice(0, 6);
  const history = annals.filter((a) => a.relation === 'self_corrected' && (ids.has(a.claim_a) || ids.has(a.claim_b)))
    .map((a) => { const n = byId.get(a.claim_a), o = byId.get(a.claim_b); return { when: n ? whenOf(n) : a.ts, recorded: a.ts, rule: a.rule, why: a.reason, model: a.model, superseded: o ? cite(o, state.get(o.id)) : { id: a.claim_b }, by: n ? cite(n, state.get(n.id)) : { id: a.claim_a } }; })
    .sort((x, y) => String(x.when).localeCompare(String(y.when)));
  const open_contradictions = annals.filter((a) => a.relation === 'contradicts' && a.claim_b && (ids.has(a.claim_a) || ids.has(a.claim_b))
    && state.get(a.claim_a)?.status === 'active' && state.get(a.claim_b)?.status === 'active')
    .map((a) => ({ a: cite(byId.get(a.claim_a), state.get(a.claim_a)), b: cite(byId.get(a.claim_b), state.get(a.claim_b)), reason: a.reason, rule: a.rule, review_id: a.review_id || null, model: a.model }));
  const held_positions = inCat.filter((c) => state.get(c.id)?.class === 'position' && state.get(c.id)?.status === 'active')
    .map((c) => ({ ...cite(c, state.get(c.id)), relation_to_consensus: 'diverges_from_consensus', mainstream_context: state.get(c.id)?.consensus || [] }));
  const { items, decisions } = splitReview(reviewRows);
  const review_open = items.filter((it) => !decisions.has(it.id) && it.claim_ids.some((x) => ids.has(x))).map((it) => ({ id: it.id, type: it.type, question: it.question }));
  return {
    category: cat, label: labelOf(tax, cat), generated_at: now(),
    current_position: {
      statement: statement || top.slice(0, 3).map((c) => c.text).join(' '),
      statement_basis: statement ? 'model summary of the cited claims' : 'verbatim: the top-ranked active claims, joined',
      claims: top.map((c) => ({ ...cite(c, state.get(c.id)), support: support.get(c.id) || 0, confidence: c.confidence })),
    },
    held_positions, history, open_contradictions, review_open,
    stats: { claims: inCat.length, own_active: active.length, superseded: inCat.filter((c) => state.get(c.id)?.status === 'superseded').length, sources: new Set(inCat.map((c) => c.source_id)).size },
  };
}

export function positionMarkdown(p) {
  const L = [`# Position — ${p.label}`, '', `_category \`${p.category}\` · ${p.stats.claims} claims from ${p.stats.sources} sources · generated ${p.generated_at}_`, '', '## Current position', '', p.current_position.statement || '_(no active own claims yet)_', ''];
  for (const c of p.current_position.claims) L.push(`- > ${c.quote}`, `  — ${c.source}, ${c.when || 'undated'} · \`${c.id}\` · support ${c.support}${c.class !== 'neutral' ? ` · ${c.class}` : ''}`);
  if (p.held_positions.length) { L.push('', '## Held positions (diverge from consensus — deliberate)'); for (const h of p.held_positions) { L.push(`- > ${h.quote} (\`${h.id}\`)`); for (const m of h.mainstream_context) L.push(`  - mainstream context: ${m.text} — ${m.source}`); } }
  if (p.history.length) { L.push('', '## History (his own corrections)'); for (const h of p.history) L.push(`- ${h.when}: "${h.superseded.quote || h.superseded.id}" → "${h.by.quote || h.by.id}" — ${h.why}`); }
  if (p.open_contradictions.length) { L.push('', '## Open contradictions'); for (const o of p.open_contradictions) L.push(`- "${o.a?.quote}" (${o.a?.when}) ⟂ "${o.b?.quote}" (${o.b?.when}) — ${o.reason}${o.review_id ? ` · review ${o.review_id}` : ''}`); }
  if (p.review_open.length) { L.push('', '## Awaiting his ruling'); for (const r of p.review_open) L.push(`- [${r.id}] ${r.question}`); }
  return L.join('\n') + '\n';
}

export function summaryPrompt(label, claims) {
  return [`Write the author's CURRENT POSITION on "${label}" in 2-3 sentences, using ONLY these statements of his.`,
    'Cite claim ids in square brackets after each sentence. Do not add facts. Return JSON {"statement": "..."}.',
    ...claims.map((c) => `[${c.id}] ${c.quote}`)].join('\n');
}

/**
 * Regenerate position documents (incremental unless full). Writes positions/<cat>.json + .md and _index.json.
 * @param {{tax?:object, llm?:Function, full?:boolean, now?:()=>string}} opts
 */
export async function rebuildPositions(store, { tax = null, llm = null, full = false, now = () => new Date().toISOString() } = {}) {
  const claims = readClaims(store);
  const annals = store.readJsonl('annals.jsonl');
  const reviewRows = store.readJsonl('review_queue.jsonl');
  const state = deriveState(claims, annals, reviewRows);
  const recats = store.readJsonl('recategorized.jsonl').length;
  let cur = full ? null : store.readJson('positions/_state.json', null);
  if (cur && (cur.recats_seen || 0) !== recats) cur = null; // a category moved → rebuild all
  const byId = new Map(claims.map((c) => [c.id, c]));
  let touched;
  if (!cur) touched = new Set(claims.map((c) => c.category));
  else {
    touched = new Set();
    for (const c of claims.slice(cur.claims_seen || 0)) touched.add(c.category);
    for (const a of annals.slice(cur.annals_seen || 0)) for (const x of [a.claim_a, a.claim_b]) if (byId.has(x)) touched.add(byId.get(x).category);
    for (const r of reviewRows.slice(cur.reviews_seen || 0)) for (const x of r.claim_ids || []) if (byId.has(x)) touched.add(byId.get(x).category);
    if (reviewRows.slice(cur.reviews_seen || 0).some((r) => r.type === 'decision')) {
      const items = new Map(reviewRows.filter((r) => r.type !== 'decision').map((r) => [r.id, r]));
      for (const d of reviewRows.slice(cur.reviews_seen || 0).filter((r) => r.type === 'decision')) for (const x of items.get(d.review_id)?.claim_ids || []) if (byId.has(x)) touched.add(byId.get(x).category);
    }
  }
  const index = store.readJson('positions/_index.json', {}) || {};
  const built = [];
  for (const cat of [...touched].sort()) {
    let statement = null;
    if (typeof llm === 'function') {
      const pre = buildPosition(cat, { claims, annals, reviewRows, state, tax, now });
      const top = pre.current_position.claims.slice(0, 5);
      if (top.length) {
        try {
          const r = await llm(summaryPrompt(pre.label, top));
          const m = String(r).match(/"statement"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          const s = m ? JSON.parse(`"${m[1]}"`) : '';
          if (s && top.some((c) => s.includes(c.id))) statement = s; // must cite what it summarises
        } catch { /* deterministic statement */ }
      }
    }
    const p = buildPosition(cat, { claims, annals, reviewRows, state, tax, statement, now });
    if (statement) p.current_position.model = llm.modelName || 'llm';
    const file = cat.replace(/[^a-z0-9_-]+/gi, '_');
    store.writeJson(`positions/${file}.json`, p);
    store.writeText(`positions/${file}.md`, positionMarkdown(p));
    index[cat] = { file, label: p.label, claims: p.stats.claims, history: p.history.length, open_contradictions: p.open_contradictions.length, review_open: p.review_open.length, held_positions: p.held_positions.length, updated: p.generated_at };
    built.push(cat);
  }
  store.writeJson('positions/_index.json', index);
  store.writeJson('positions/_state.json', { claims_seen: claims.length, annals_seen: annals.length, reviews_seen: reviewRows.length, recats_seen: recats, at: now() });
  return { ok: true, rebuilt: built.length, categories: built, incremental: !!cur };
}
