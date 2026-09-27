// ryan-mind/reconcile.mjs — the BOUNCE. Every new claim is retrieved against the claims already in the
// mind, each pair is judged, and every judgement is written as an ANNAL (append-only JSONL). The mind's
// state (which claim is current, which is superseded, which is a held position) is DERIVED from the
// annals + the operator's review decisions; claim records are never edited or deleted.
//
// Relations: supports | refines | contradicts | supersedes | unrelated | self_corrected | diverges_from_consensus
//
// The operator's rules (binding):
//   • Only the operator corrects the operator. A later claim of HIS (writing/chat/email) can supersede an
//     earlier claim of his — recorded as `self_corrected`, the earlier claim kept with status superseded
//     and a link. Third-party sources (forum posters, the assistant side of a chat, consensus) NEVER
//     supersede him; their disagreement is recorded as `contradicts` and nothing changes.
//   • An automatic self-correction needs the later claim to read as a correction (explicit correction
//     language) — or config.auto_self_correct = "later" to let any later own contradiction win. Any other
//     contradiction between two of his own claims goes to the REVIEW QUEUE; nothing changes until he rules.
//   • Checkers (the Hierophant) supply mainstream context. A deliberate divergence (an identification
//     tradition does not make, e.g. Wadjet = Theia) is a HELD POSITION: annal `diverges_from_consensus`,
//     the mainstream view kept alongside as context. A simple fact stated differently from tradition
//     (Malta for Crete) is a PROBABLE SLIP: it only enters review_queue.jsonl for him to confirm.
import { contentTokens, weightedOverlap, containment, polarityConflict, numbersIn, cosine, sha, extractJson } from './util.mjs';
import { STAGE } from './sources.mjs';
import { readClaims } from './store.mjs';

export const RELATIONS = ['supports', 'refines', 'contradicts', 'supersedes', 'unrelated', 'self_corrected', 'diverges_from_consensus'];
const JUDGE_RELATIONS = ['supports', 'refines', 'contradicts', 'supersedes', 'unrelated'];
export const DETERMINISTIC_MODEL = 'deterministic-v1';

function mentionsWord(text, w) { return new RegExp(`\\b${String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(String(text)); }

export function whenOf(c) { return c?.at || c?.date || ''; }

// ── derived state ─────────────────────────────────────────────────────────────────────────────────
/**
 * Fold annals + review decisions into per-claim state. Pure.
 * @returns {Map<string,{status:'active'|'superseded', superseded_by:string|null, class:'position'|'slip_candidate'|'neutral', reviews:string[], consensus:Array}>}
 */
export function deriveState(claims, annals = [], reviewRows = []) {
  const st = new Map();
  for (const c of claims) st.set(c.id, { status: 'active', superseded_by: null, class: c.class || 'neutral', reviews: [], consensus: [] });
  for (const a of annals) {
    if (a.relation === 'self_corrected' && st.has(a.claim_b)) { const s = st.get(a.claim_b); s.status = 'superseded'; s.superseded_by = a.claim_a; }
    if (a.relation === 'diverges_from_consensus' && st.has(a.claim_a)) { const s = st.get(a.claim_a); s.class = 'position'; s.consensus = a.consensus || []; }
  }
  const { items, decisions } = splitReview(reviewRows);
  for (const it of items) {
    const d = decisions.get(it.id);
    if (it.type === 'slip') {
      const s = st.get(it.claim_ids[0]); if (!s) continue;
      if (!d) { s.class = 'slip_candidate'; s.reviews.push(it.id); }
      else if (d.decision === 'hold') s.class = 'position';
      else if (d.decision === 'slip_confirmed') { s.status = 'superseded'; s.superseded_by = d.keep || 'operator'; s.class = 'neutral'; }
    } else if (!d) { for (const id of it.claim_ids) st.get(id)?.reviews.push(it.id); }
  }
  // an operator decision on an inconsistency is written as a self_corrected annal (model "operator"), so it is folded above
  return st;
}

export function splitReview(rows) {
  const items = []; const decisions = new Map();
  for (const r of rows || []) { if (r.type === 'decision') decisions.set(r.review_id, r); else items.push(r); }
  return { items, decisions };
}

// ── lexical index ────────────────────────────────────────────────────────────────────────────────
export function buildIdf(claims) {
  const df = new Map();
  for (const c of claims) for (const t of new Set(contentTokens(c.text))) df.set(t, (df.get(t) || 0) + 1);
  const N = Math.max(1, claims.length);
  const idf = (t) => Math.log(1 + N / (df.get(t) || 1));
  return { idf, df, N };
}

class Mind {
  constructor(idfPack) { this.idfPack = idfPack; this.claims = []; this.tokens = []; this.inv = new Map(); this.vecs = []; }
  add(c, vec = null) {
    const i = this.claims.length; const toks = contentTokens(c.text);
    this.claims.push(c); this.tokens.push(toks); this.vecs.push(vec);
    for (const t of new Set(toks)) { const l = this.inv.get(t) || []; l.push(i); this.inv.set(t, l); }
  }
  lexical(c, { k, minSim, pool = null }) {
    const { idf, df, N } = this.idfPack; const toks = contentTokens(c.text);
    const cand = new Set();
    for (const t of new Set(toks)) { if ((df.get(t) || 0) > Math.max(20, N * 0.05)) continue; for (const i of this.inv.get(t) || []) cand.add(i); }
    const out = [];
    for (const i of cand) {
      const b = this.claims[i]; if (b.id === c.id || (b.source_id === c.source_id && b.locator === c.locator)) continue;
      if (pool && !pool(b)) continue;
      const s = weightedOverlap(toks, this.tokens[i], idf); if (s >= minSim) out.push({ claim: b, sim: s });
    }
    return out.sort((x, y) => y.sim - x.sim).slice(0, k);
  }
  semantic(c, vec, { k, minSim, pool = null }) {
    const out = [];
    this.claims.forEach((b, i) => {
      if (!this.vecs[i] || b.id === c.id || (b.source_id === c.source_id && b.locator === c.locator)) return;
      if (pool && !pool(b)) return;
      const s = cosine(vec, this.vecs[i]); if (s >= minSim) out.push({ claim: b, sim: s });
    });
    return out.sort((x, y) => y.sim - x.sim).slice(0, k);
  }
}

// ── judging ──────────────────────────────────────────────────────────────────────────────────────
/** Deterministic judge: a = the claim being bounced in, b = a claim already in the mind. */
export function judgeDeterministic(a, b, { idf = () => 1, df = null, N = 0 } = {}) {
  const ta = contentTokens(a.text), tb = contentTokens(b.text);
  const s = weightedOverlap(ta, tb, idf);
  const newer = whenOf(a) >= whenOf(b) ? a : b;
  // disagreement signals: a real polarity conflict, or the same statement with different figures
  let disagree = null;
  // the denied/asserted token must be distinctive (rare in the corpus), not a common word both happen to use
  const distinctive = df ? (t) => (df.get(t) || 0) <= Math.max(3, N * 0.01) : () => true;
  const pc = s >= 0.4 ? polarityConflict(a.text, b.text, { distinctive }) : null;
  if (pc) disagree = `one side denies what the other asserts ("${pc}"; overlap ${s.toFixed(2)})`;
  const na = numbersIn(a.text), nb = numbersIn(b.text);
  if (!disagree && s >= 0.55 && na.size && nb.size && ![...na].some((n) => nb.has(n))) {
    const strip = (t) => t.filter((x) => !/^\d+$/.test(x));
    if (weightedOverlap(strip(ta), strip(tb), idf) >= 0.6) disagree = `same statement, different figures (${[...na].join(', ')} vs ${[...nb].join(', ')})`;
  }
  if (disagree && newer.correction_marker) return { relation: 'supersedes', reason: `the later claim is worded as a correction and ${disagree}` };
  if (disagree) return { relation: 'contradicts', reason: disagree };
  // correction language WITHOUT disagreement is a correction aimed elsewhere (e.g. at Ptolemy) — agreement here
  if (s >= 0.8) return { relation: 'supports', reason: `restatement (overlap ${s.toFixed(2)})` };
  if (containment(ta, tb) >= 0.7 && ta.length >= tb.length * 1.3) return { relation: 'refines', reason: `adds detail to the earlier claim (contains ${Math.round(containment(ta, tb) * 100)}% of it)` };
  if (containment(tb, ta) >= 0.7 && tb.length >= ta.length * 1.3) return { relation: 'refines', reason: `the earlier claim is the fuller statement of this one` };
  if (s >= 0.4) return { relation: 'supports', reason: `substantial overlap (${s.toFixed(2)})` };
  return { relation: 'unrelated', reason: `weak overlap (${s.toFixed(2)})` };
}

export function judgePrompt(a, b) {
  return [
    'Two claims by the same author (or a claim and a related source). Decide how CLAIM A relates to CLAIM B.',
    'relation: "supports" (agrees/restates), "refines" (adds detail or narrows), "contradicts" (both cannot be true),',
    '"supersedes" (A explicitly corrects/replaces B), or "unrelated". Return JSON {"relation": "...", "reason": "<one sentence>"}.',
    `CLAIM A (${whenOf(a) || 'undated'}; ${a.source_kind}): ${a.text}`,
    `CLAIM B (${whenOf(b) || 'undated'}; ${b.source_kind}): ${b.text}`,
  ].join('\n');
}

async function judge(a, b, { llm, idf, df, N }) {
  if (typeof llm === 'function') {
    try {
      const j = extractJson(await llm(judgePrompt(a, b)));
      const rel = String(j?.relation || '').toLowerCase().trim();
      if (JUDGE_RELATIONS.includes(rel)) return { relation: rel, reason: String(j?.reason || '').slice(0, 400) || '(no reason given)', model: llm.modelName || 'llm' };
    } catch { /* fall through */ }
  }
  return { ...judgeDeterministic(a, b, { idf, df, N }), model: DETERMINISTIC_MODEL };
}

/**
 * Apply the operator's rules to a raw judgement. Returns {annal, review?}.
 * a = claim being bounced in; b = claim already in the mind.
 */
export function applyRules(a, b, j, { config = {}, ts }) {
  const base = { ts, claim_a: a.id, claim_b: b.id, relation: j.relation, reason: j.reason, model: j.model, similarity: j.sim != null ? Math.round(j.sim * 1000) / 1000 : undefined, category_a: a.category, category_b: b.category };
  if (j.relation !== 'contradicts' && j.relation !== 'supersedes') return { annal: base };
  const wa = whenOf(a), wb = whenOf(b);
  const [newer, older] = wa > wb ? [a, b] : wb > wa ? [b, a] : [null, null];
  const bothOperator = a.own && b.own;
  if (!bothOperator) {
    const outsider = !a.own ? a : b;
    return { annal: { ...base, relation: 'contradicts', rule: 'external-never-supersedes', reason: `${j.reason} — ${outsider.speaker || outsider.source_kind} is not the operator; recorded, never supersedes him` } };
  }
  const marked = !!newer?.correction_marker;
  const autoLater = config.auto_self_correct === 'later';
  if (newer && newer.can_supersede && (marked || autoLater)) {
    return { annal: { ...base, claim_a: newer.id, claim_b: older.id, relation: 'self_corrected', supersedes: older.id, rule: marked ? 'later-own-correction' : 'later-own-wins', reason: `${j.reason} — his later statement (${whenOf(newer)}) supersedes his earlier one (${whenOf(older)}); earlier kept, marked superseded` } };
  }
  const first = newer ? older : a, second = newer ? newer : b;
  const review = {
    id: `r-${sha(`inconsistency|${[a.id, b.id].sort().join('|')}`, 12)}`, ts, type: 'inconsistency', status: 'open',
    claim_ids: [first.id, second.id], category: a.category,
    said: [{ claim_id: first.id, when: whenOf(first), source: first.source_title, quote: first.quote }, { claim_id: second.id, when: whenOf(second), source: second.source_title, quote: second.quote }],
    question: `On ${whenOf(first) || 'an undated occasion'} you said "${first.quote}"; on ${whenOf(second) || 'another occasion'} you said "${second.quote}". Which stands — or are both held?`,
  };
  return { annal: { ...base, relation: 'contradicts', rule: newer ? 'own-contradiction-needs-review' : 'same-date-needs-review', review_id: review.id }, review };
}

// ── the pass ─────────────────────────────────────────────────────────────────────────────────────
function sortForMind(claims) {
  return [...claims].sort((x, y) => (STAGE[x.source_kind] ?? 9) - (STAGE[y.source_kind] ?? 9) || whenOf(x).localeCompare(whenOf(y)) || x.id.localeCompare(y.id));
}

/**
 * Run the bounce over every claim not yet reconciled. Writes annals.jsonl, review_queue.jsonl, state.json
 * (and embeddings.jsonl when an embedder is wired) through `store` (dry-run safe).
 * @param {object} store
 * @param {{llm?:Function, embed?:Function, checkers?:Array, k?:number, minLex?:number, minSem?:number, limit?:number, now?:()=>string, onProgress?:Function}} opts
 */
export async function reconcile(store, opts = {}) {
  const { llm = null, embed = null, checkers = [], k = 4, minLex = 0.3, minSem = 0.78, limit = Infinity, now = () => new Date().toISOString(), onProgress = null } = opts;
  const claims = readClaims(store);
  const config = store.readJson('config.json', {}) || {};
  const state = store.readJson('state.json', { reconciled: [] }) || { reconciled: [] };
  const done = new Set(state.reconciled || []);
  const reviewExisting = new Set(store.readJsonl('review_queue.jsonl').map((r) => r.id));
  const idfPack = buildIdf(claims);
  const vecCache = new Map(); const embModel = embed?.modelName || null;
  if (embed) for (const r of store.readJsonl('embeddings.jsonl')) if (r.model === embModel) vecCache.set(r.claim_id, r.v);
  const newVecs = [];
  const getVec = async (c) => {
    if (!embed) return null;
    if (vecCache.has(c.id)) return vecCache.get(c.id);
    const v = await embed(c.text).catch(() => null);
    if (Array.isArray(v)) { vecCache.set(c.id, v); newVecs.push({ claim_id: c.id, model: embModel, v }); }
    return v || null;
  };

  const mind = new Mind(idfPack);
  const ordered = sortForMind(claims);
  for (const c of ordered) if (done.has(c.id)) mind.add(c, embed ? await getVec(c) : null);

  const pending = ordered.filter((c) => !done.has(c.id)).slice(0, limit);
  const annals = []; const reviews = []; const counts = {};
  let i = 0;
  for (const c of pending) {
    const vec = embed ? await getVec(c) : null;
    // email is read AGAINST the chats: chat-derived claims are retrieved first, then the rest of the mind
    const pools = c.source_kind === 'email' ? [(b) => b.source_kind === 'chat', (b) => b.source_kind !== 'chat'] : [null];
    let cands = [];
    for (const pool of pools) {
      const need = k - cands.length; if (need <= 0) break;
      const got = vec ? mind.semantic(c, vec, { k: need, minSim: minSem, pool }) : mind.lexical(c, { k: need, minSim: minLex, pool });
      cands.push(...got.filter((g) => !cands.some((x) => x.claim.id === g.claim.id)));
    }
    for (const { claim: b, sim } of cands) {
      const j = await judge(c, b, { llm, idf: idfPack.idf, df: idfPack.df, N: idfPack.N });
      const { annal, review } = applyRules(c, b, { ...j, sim }, { config, ts: now() });
      annals.push(annal); counts[annal.relation] = (counts[annal.relation] || 0) + 1;
      if (review && !reviewExisting.has(review.id)) { reviews.push(review); reviewExisting.add(review.id); }
    }
    // checkers: mainstream context + probable-slip flags (operator claims only)
    if (c.own) {
      for (const ch of checkers) {
        let r; try { r = await ch.check(c); } catch { r = null; }
        if (!r?.ok || r.stance !== 'differs') continue;
        if (r.kind === 'identification') {
          annals.push({ ts: now(), claim_a: c.id, claim_b: null, relation: 'diverges_from_consensus', reason: `held position: ${r.identifications.filter((x) => !x.mainstream_source).map((x) => `${x.a} = ${x.b}`).join('; ')} — not a mainstream identification; mainstream view recorded as context, never as a correction`, model: `checker:${ch.name}`, checker: ch.name, consensus: r.mainstream, category_a: c.category });
          counts.diverges_from_consensus = (counts.diverges_from_consensus || 0) + 1;
        } else if (r.kind === 'fact') {
          const f = r.fact || {};
          const says = (t) => f.subject && mentionsWord(t, f.subject) && [f.value, ...(f.alternatives || [])].filter(Boolean).some((v) => mentionsWord(t, v));
          const elsewhereOwn = mind.claims.filter((b) => b.own && b.id !== c.id && says(b.text))
            .slice(0, 3).map((b) => ({ claim_id: b.id, when: whenOf(b), source: b.source_title, quote: b.quote }));
          const item = {
            id: `r-${sha(`slip|${c.id}|${ch.name}`, 12)}`, ts: now(), type: 'slip', status: 'open', claim_ids: [c.id], category: c.category, checker: ch.name,
            said: [{ claim_id: c.id, when: whenOf(c), source: c.source_title, quote: c.quote }], elsewhere: [...elsewhereOwn, ...(r.elsewhere || [])], tradition_says: r.tradition_says,
            question: `You said "${c.quote}" (${whenOf(c) || 'undated'}, ${c.source_title}).${elsewhereOwn.length ? ` Elsewhere you said "${elsewhereOwn[0].quote}".` : ''} Tradition says: ${r.tradition_says}. Slip, or held position?`,
          };
          if (!reviewExisting.has(item.id)) { reviews.push(item); reviewExisting.add(item.id); counts.slip_flagged = (counts.slip_flagged || 0) + 1; }
        }
      }
    }
    done.add(c.id); mind.add(c, vec);
    if (onProgress) onProgress(++i, pending.length);
  }
  store.appendJsonl('annals.jsonl', annals);
  store.appendJsonl('review_queue.jsonl', reviews);
  if (newVecs.length) store.appendJsonl('embeddings.jsonl', newVecs);
  store.writeJson('state.json', { ...state, reconciled: [...done], last_reconcile: now() });
  return { ok: true, examined: pending.length, annals: annals.length, reviews: reviews.length, counts, remaining: claims.length - done.size, model: llm?.modelName || DETERMINISTIC_MODEL, retrieval: embed ? `embed:${embModel}` : 'lexical' };
}

/**
 * Record an operator ruling on a review item (append-only). decision:
 *   'slip_confirmed' (the flagged claim was a slip; optional keep = the claim that stands),
 *   'hold'           (deliberate — a held position),
 *   'keep'           (inconsistency: `keep` claim stands, the other is self-corrected by operator ruling),
 *   'both'           (inconsistency: both held; nothing superseded).
 */
export function decideReview(store, reviewId, decision, { keep = null, note = '', now = () => new Date().toISOString() } = {}) {
  const rows = store.readJsonl('review_queue.jsonl');
  const { items, decisions } = splitReview(rows);
  const it = items.find((r) => r.id === reviewId);
  if (!it) return { ok: false, reason: `no review item ${reviewId}` };
  if (decisions.has(reviewId)) return { ok: false, reason: `${reviewId} already decided` };
  if (!['slip_confirmed', 'hold', 'keep', 'both'].includes(decision)) return { ok: false, reason: `unknown decision ${decision}` };
  if (decision === 'keep' && !it.claim_ids.includes(keep)) return { ok: false, reason: 'keep must be one of the item\'s claim ids' };
  const ts = now();
  store.appendJsonl('review_queue.jsonl', [{ type: 'decision', review_id: reviewId, ts, decision, keep, note, by: 'operator' }]);
  if (decision === 'keep') {
    const other = it.claim_ids.find((x) => x !== keep);
    store.appendJsonl('annals.jsonl', [{ ts, claim_a: keep, claim_b: other, relation: 'self_corrected', supersedes: other, rule: 'operator-ruling', reason: `operator ruled on ${reviewId}: ${note || 'this statement stands'}`, model: 'operator' }]);
  }
  return { ok: true };
}
