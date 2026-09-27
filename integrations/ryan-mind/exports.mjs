// ryan-mind/exports.mjs — what the mind hands downstream. All three go to <data>/exports/ (outside git).
//   rag.jsonl              claims (with derived status/class) + position docs, every row cited
//   train.jsonl            Hathor training pairs: positions, verbatim operator quotes, his corrections
//                          and held divergences — weighted, with provenance; superseded claims and open
//                          slip candidates are NOT taught as current
//   eval-candidates.jsonl  test-set candidates in the integrations/hathor-eval shape
//                          {id, question, ryan_answer, topic, lang, kind, source, status:"pending-operator"}
// Every row carries `privacy` (from its source); `publicOnly` drops anything from a private source.
import { deriveState, splitReview, whenOf } from './reconcile.mjs';
import { readClaims } from './store.mjs';

const lc1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Deterministic question for a claim sentence ("X is Y." → "What is X?"). null when no clean subject. */
export function questionFor(quote) {
  const q = String(quote).replace(/\*\*|__|`/g, '').trim();
  const m = q.match(/^(?:(The|A|An)\s+)?([A-Za-z][A-Za-z0-9'’\- ]{2,60}?)\s+(is|are|was|were|means|represents)\s+(.{10,})$/);
  if (!m || (!m[1] && !/^[A-Z]/.test(m[2]))) return null;
  const subj = `${m[1] ? `${m[1].toLowerCase()} ` : ''}${m[2]}`.trim();
  if (subj.split(/\s+/).length > 8 || /^(this|that|it|these|those|there|he|she|they|we|i)\b/i.test(subj)) return null;
  const verb = m[3] === 'means' ? 'does' : m[3] === 'represents' ? 'does' : m[3];
  return verb === 'does' ? `What does ${subj} ${m[3] === 'means' ? 'mean' : 'represent'}?` : `What ${verb} ${subj}?`;
}

function mustInclude(quote) {
  const words = [...new Set((String(quote).match(/\b[A-Z][a-z]{3,}\b/g) || []).filter((w) => !/^(The|This|That|These|Those|When|Where|What|Which|From|With|Into|Their|There)$/.test(w)))];
  return words.slice(0, 2);
}

export function buildExports({ claims, annals, reviewRows, positions = [], sources = [], tax = null, publicOnly = false }) {
  const state = deriveState(claims, annals, reviewRows);
  const src = new Map(sources.map((s) => [s.id, s]));
  const priv = (sid) => src.get(sid)?.privacy || 'private';
  const keep = (sid) => !publicOnly || priv(sid) === 'public';
  const byId = new Map(claims.map((c) => [c.id, c]));
  const support = new Map();
  for (const a of annals) if ((a.relation === 'supports' || a.relation === 'refines') && a.claim_b) for (const x of [a.claim_a, a.claim_b]) support.set(x, (support.get(x) || 0) + 1);

  const rag = []; const train = []; const evalc = [];
  for (const c of claims) {
    if (!keep(c.source_id)) continue;
    const st = state.get(c.id);
    rag.push({ type: 'claim', id: c.id, text: c.text, quote: c.quote, category: c.category, categories: c.categories, when: whenOf(c), date_basis: c.date_basis, speaker: c.speaker, own: c.own, status: st.status, superseded_by: st.superseded_by, class: st.class, confidence: c.confidence, support: support.get(c.id) || 0, source: { id: c.source_id, kind: c.source_kind, title: c.source_title, path: src.get(c.source_id)?.path || null }, locator: c.locator, privacy: priv(c.source_id) });
    if (!c.own || st.status !== 'active' || st.class === 'slip_candidate' || c.confidence < 0.5) continue;
    const q = questionFor(c.quote);
    const weight = Math.round(c.confidence * (1 + Math.log2(1 + (support.get(c.id) || 0))) * (st.class === 'position' ? 1.25 : 1) * 100) / 100;
    const prov = { claim_ids: [c.id], source_id: c.source_id, source_title: c.source_title, when: whenOf(c), date_basis: c.date_basis, locator: c.locator };
    train.push({ type: 'quote', messages: [{ role: 'user', content: q || `What have you written about ${lc1(c.category.replace(/[_-]+/g, ' '))}?` }, { role: 'assistant', content: c.quote }], weight, category: c.category, provenance: prov, privacy: priv(c.source_id) });
    if (q) evalc.push({ id: `rm-${c.id.slice(2)}`, question: q, ryan_answer: c.quote, topic: c.category, lang: 'en', kind: 'known', must_include: mustInclude(c.quote), source: `${c.source_title} (${src.get(c.source_id)?.path || c.source_id}) ${c.locator}`, status: 'pending-operator', claim_ids: [c.id], privacy: priv(c.source_id) });
  }
  for (const p of positions) {
    const cited = p.current_position?.claims || [];
    const sids = [...new Set(cited.map((c) => c.source_id))];
    if (!cited.length || !sids.every(keep)) continue;
    const privacy = sids.every((s) => priv(s) === 'public') ? 'public' : 'private';
    rag.push({ type: 'position', id: `pos-${p.category}`, category: p.category, label: p.label, statement: p.current_position.statement, cites: cited.map((c) => c.id), held_positions: p.held_positions.map((h) => h.id), history: p.history.length, open_contradictions: p.open_contradictions.length, generated_at: p.generated_at, privacy });
    const answer = [p.current_position.statement, '', ...cited.slice(0, 4).map((c) => `"${c.quote}" — ${c.source}, ${c.when || 'undated'}`)].join('\n');
    train.push({ type: 'position', messages: [{ role: 'user', content: `What is your position on ${p.label}?` }, { role: 'assistant', content: answer }], weight: Math.round((1 + Math.log2(1 + cited.length)) * 100) / 100, category: p.category, provenance: { claim_ids: cited.map((c) => c.id), source_ids: sids, whens: cited.map((c) => c.when) }, privacy });
    evalc.push({ id: `rm-pos-${p.category}`, question: `What is Ryan's position on ${p.label}?`, ryan_answer: cited.slice(0, 3).map((c) => c.quote).join(' '), topic: p.category, lang: 'en', kind: 'known', source: `ryan-mind position ${p.category}`, status: 'pending-operator', claim_ids: cited.map((c) => c.id), privacy });
    for (const h of p.history) {
      if (!keep(h.by.source_id) || !keep(h.superseded.source_id)) continue;
      train.push({ type: 'self_correction', messages: [{ role: 'user', content: `Has your view on ${p.label} changed?` }, { role: 'assistant', content: `Earlier (${h.superseded.when || 'undated'}) I said: "${h.superseded.quote}". Later (${h.by.when || 'undated'}) I corrected it: "${h.by.quote}".` }], weight: 1.5, category: p.category, provenance: { claim_ids: [h.superseded.id, h.by.id], rule: h.rule }, privacy });
    }
    for (const h of p.held_positions) {
      if (!keep(h.source_id)) continue;
      const ctx = h.mainstream_context.map((m) => `${m.text} (${m.source})`).join('; ');
      train.push({ type: 'held_position', messages: [{ role: 'user', content: `Mainstream scholarship would not say "${h.quote}". What do you hold, and what does tradition say?` }, { role: 'assistant', content: `I hold: "${h.quote}". The mainstream view, for context: ${ctx || 'not recorded'}. This is a deliberate position, not an error.` }], weight: 1.5, category: p.category, provenance: { claim_ids: [h.id], relation: 'diverges_from_consensus' }, privacy: priv(h.source_id) });
    }
  }
  return { rag, train, eval: evalc };
}

export function runExports(store, { publicOnly = false } = {}) {
  const claims = readClaims(store);
  const annals = store.readJsonl('annals.jsonl');
  const reviewRows = store.readJsonl('review_queue.jsonl');
  const idx = store.readJson('positions/_index.json', {}) || {};
  const positions = Object.values(idx).map((e) => store.readJson(`positions/${e.file}.json`, null)).filter(Boolean);
  const sources = store.readJson('sources.json', []) || [];
  const out = buildExports({ claims, annals, reviewRows, positions, sources, publicOnly });
  const suffix = publicOnly ? '.public' : '';
  const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  store.writeText(`exports/rag${suffix}.jsonl`, jl(out.rag));
  store.writeText(`exports/train${suffix}.jsonl`, jl(out.train));
  store.writeText(`exports/eval-candidates${suffix}.jsonl`, jl(out.eval));
  const { items, decisions } = splitReview(reviewRows);
  const srcOf = new Map(claims.map((c) => [c.id, c.source_id]));
  const privOf = new Map(sources.map((s) => [s.id, s.privacy]));
  const visible = (it) => !publicOnly || (it.claim_ids || []).every((id) => privOf.get(srcOf.get(id)) === 'public');
  store.writeText(`exports/review-open${suffix}.jsonl`, jl(items.filter((i) => !decisions.has(i.id) && visible(i))));
  return { ok: true, rag: out.rag.length, train: out.train.length, eval: out.eval.length };
}
