// legal-knowledge-graph.mjs — Task #219 (v3 doc §11): the LEGAL KNOWLEDGE GRAPH module.
//
// Turns the Law.SoapBox legal vertical from a flat index into a THEORY-MAPPED graph organized
// around the founder's own handwritten framework (the ~900-case / 74-FastCase-page compilation).
// Under Feist the raw cases are uncopyrightable public domain, but the original SELECTION and
// ARRANGEMENT — the founder's categories — are the protectable, defensible human-authored layer.
// So the founder's categories are FIRST-CLASS nodes here, not tags.
//
// This module is the GRAPH LAYER + the treatment-NLP heuristic. It is PURE: it fetches nothing.
// Node population comes from the readers that already exist in this repo — CourtListener / CAP /
// GovInfo in integrations/soapbox/legal.mjs — whose already-fetched records are handed to
// ingestCase(). Shape mirrors integrations/accountability-graph.mjs (createGraph(), sourced
// records, soft-fail, HTML-escaped render, guarded CLI) so the two graphs feel like one system,
// and judge nodes here cross-link to that accountability graph (§6A.2).
//
// THE DISCIPLINE — encoded structurally, not as policy prose:
//   • Treatment ("is this still good law") is the Westlaw/Lexis human-editorial moat. We only
//     APPROXIMATE it with NLP. So detectTreatment() ALWAYS returns a confidence 0..1 and an
//     `authoritative: false` / `disclaimer` flag. A false "good law" is dangerous — this module
//     NEVER asserts a case is good law, and the render always shows the not-authoritative note.
//   • Soft-fail: bad input returns null / [] / a typed empty. Nothing here throws.
//
//   import { createGraph, ingestCase, detectTreatment, query, renderGraph, renderNode,
//            SEED_CATEGORIES, NODE_TYPES, EDGE_TYPES, escapeHtml } from './legal-knowledge-graph.mjs'
//   node integrations/legal-knowledge-graph.mjs demo

// ── allowed vocabularies ──────────────────────────────────────────────────────────────────
export const NODE_TYPES = Object.freeze(['case', 'statute', 'rule', 'maxim', 'category', 'judge']);

export const EDGE_TYPES = Object.freeze([
  'cites',            // case → case (CourtListener citation network)
  'overrules',        // case → case (negative treatment)
  'distinguishes',    // case → case
  'applies-statute',  // case → statute/rule
  'falls-under-category', // case/statute/rule → category (the founder's taxonomy)
  'authored-by',      // case → judge
]);

// The founder's handwritten taxonomy (v3 §11.1) — seeded as first-class category nodes. Each
// carries the keyword set that lets ingestCase() auto-wire a case under the right category.
export const SEED_CATEGORIES = Object.freeze([
  {
    id: 'cat:definitions',
    name: 'Definitions',
    note: 'Foundational definitional cases — what the terms of art mean.',
    keywords: ['definition', 'defined as', 'means', 'term of art', 'construed', 'construction'],
  },
  {
    id: 'cat:coercion',
    name: 'Coercion',
    note: 'Coercion — harm to credit / business reputation.',
    keywords: ['coercion', 'coerce', 'duress', 'extortion', 'business reputation', 'credit', 'tortious interference'],
  },
  {
    id: 'cat:captive-audience',
    name: 'Captive-Audience/Forced-to-Listen',
    note: 'Captive-audience doctrine — being forced to listen / unable to avert the eye.',
    keywords: ['captive audience', 'captive-audience', 'forced to listen', 'unwilling listener', 'avert', 'unable to avoid'],
  },
  {
    id: 'cat:music-as-torture',
    name: 'Music-as-torture',
    note: 'Music / sound used as an instrument of torture or torment.',
    keywords: ['music as torture', 'loud music', 'sonic', 'sound torture', 'acoustic', 'noise as'],
  },
  {
    id: 'cat:cyberstalking',
    name: 'Cyberstalking',
    note: 'Cyberstalking, online harassment, electronic course-of-conduct.',
    keywords: ['cyberstalking', 'cyberstalk', 'online harassment', 'stalking', 'course of conduct', 'electronic communication'],
  },
  {
    id: 'cat:free-speech-sedition',
    name: 'Free-Speech/Sedition',
    note: 'Free speech and its limits — incitement, sedition, true threats.',
    keywords: ['free speech', 'first amendment', 'sedition', 'seditious', 'incitement', 'true threat', 'protected speech'],
  },
]);

const str = (v) => (v == null ? '' : String(v)).trim();
const now = () => new Date().toISOString();

// HTML escape — every interpolated value passes through this before reaching markup.
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Validate a { name, url } source descriptor. Returns a clean object or null. */
function cleanSource(src) {
  if (!src || typeof src !== 'object') return null;
  const name = str(src.name);
  if (!name) return null;
  return { name, url: str(src.url) || null };
}

// ── treatment detection (the hard, probabilistic layer) ─────────────────────────────────────
// Pattern → { type, confidence, weight }. Confidence is deliberately < 1.0 even for the strongest
// signal: this is a heuristic, not Shepard's/KeyCite. NEVER assert "good law".
const TREATMENT_PATTERNS = [
  { re: /\bwe\s+(?:hereby\s+)?overrule\b/i,            type: 'overruled',   confidence: 0.85 },
  { re: /\boverrul(?:ed|ing|es)\b/i,                    type: 'overruled',   confidence: 0.55 },
  { re: /\babrogated\s+by\b/i,                          type: 'abrogated',   confidence: 0.8 },
  { re: /\bsuperseded\s+by\s+statute\b/i,               type: 'superseded',  confidence: 0.8 },
  { re: /\bsuperseded\s+by\b/i,                         type: 'superseded',  confidence: 0.55 },
  { re: /\bdistinguish(?:ed|es|ing)\b/i,                type: 'distinguished', confidence: 0.5 },
  { re: /\bcriticiz(?:ed|es|ing)\b/i,                   type: 'criticized',  confidence: 0.45 },
  { re: /\bcall(?:ed|s)?\s+into\s+question\b/i,         type: 'criticized',  confidence: 0.45 },
  { re: /\b(?:we\s+)?(?:reaffirm|follow(?:ed|ing|s)?|adhere\s+to)\b/i, type: 'followed', confidence: 0.4 },
];

// Treatment types that are NEGATIVE for the cited case (used by query()'s treatment filter).
export const NEGATIVE_TREATMENTS = Object.freeze(['overruled', 'abrogated', 'superseded', 'criticized', 'distinguished']);

/**
 * Scan an opinion's text for treatment signals. ALWAYS returns an object carrying confidence and
 * the not-authoritative disclaimer — even when nothing is found. NEVER asserts good law.
 *   detectTreatment('we overrule Smith v. Jones') →
 *     { type:'overruled', confidence:0.85, evidence:'we overrule', authoritative:false, disclaimer:'…' }
 *   detectTreatment('a plain recitation of facts') →
 *     { type:'none', confidence:0, evidence:null, authoritative:false, disclaimer:'…' }
 */
export function detectTreatment(opinionText) {
  const text = str(opinionText);
  const disclaimer =
    'Heuristic NLP treatment signal — NOT authoritative. This is not Shepard’s/KeyCite and does '
    + 'not establish whether a case is good law. Verify against the actual opinion.';
  if (!text) {
    return { type: 'none', confidence: 0, evidence: null, authoritative: false, disclaimer };
  }
  let best = null;
  for (const p of TREATMENT_PATTERNS) {
    const m = text.match(p.re);
    if (m && (!best || p.confidence > best.confidence)) {
      best = { type: p.type, confidence: p.confidence, evidence: m[0] };
    }
  }
  if (!best) {
    return { type: 'none', confidence: 0, evidence: null, authoritative: false, disclaimer };
  }
  return {
    type: best.type,
    confidence: best.confidence,
    evidence: best.evidence,
    authoritative: false, // ALWAYS — a false "good law" is dangerous.
    disclaimer,
  };
}

/** Match a free-text blob against the seed categories' keyword sets. Returns matched category ids. */
export function matchCategories(text) {
  const hay = str(text).toLowerCase();
  if (!hay) return [];
  const out = [];
  for (const c of SEED_CATEGORIES) {
    if (c.keywords.some((k) => hay.includes(k.toLowerCase()))) out.push(c.id);
  }
  return out;
}

// ── the graph ───────────────────────────────────────────────────────────────────────────────
export function createGraph() {
  const nodes = new Map(); // id -> node
  const edges = [];        // array of edge objects

  /** Add (or merge) a node. type must be in NODE_TYPES. Returns the node, or null if rejected. */
  function addNode(node) {
    if (!node || typeof node !== 'object') return null;
    const type = str(node.type);
    if (!NODE_TYPES.includes(type)) return null;
    const id = str(node.id) || str(node.name);
    if (!id) return null;

    const clean = { id, type, name: str(node.name) || id };
    // Carry a small set of fact fields per type; never a verdict / "good law" flag.
    for (const f of ['citation', 'court', 'dateFiled', 'note', 'url', 'jurisdiction', 'judge']) {
      const v = str(node[f]);
      if (v) clean[f] = v;
    }
    if (Array.isArray(node.keywords)) clean.keywords = node.keywords.map(str).filter(Boolean);
    // treatment, if attached, is the heuristic object (carries its own disclaimer); never a verdict.
    if (node.treatment && typeof node.treatment === 'object') clean.treatment = node.treatment;

    const existing = nodes.get(id);
    if (existing) { Object.assign(existing, clean); return existing; }
    nodes.set(id, clean);
    return clean;
  }

  /**
   * Add an edge. REQUIRES a valid type and both endpoints. A `source` { name, url } is recommended
   * (and required for treatment edges, where attribution matters); plain structural edges (cites,
   * falls-under-category) may omit it. An edge with an unknown type or a missing endpoint is rejected.
   */
  function addEdge(edge) {
    if (!edge || typeof edge !== 'object') return null;
    const type = str(edge.type);
    if (!EDGE_TYPES.includes(type)) return null;
    const from = str(edge.from);
    const to = str(edge.to);
    if (!from || !to) return null;

    const rec = { type, from, to };
    const source = cleanSource(edge.source);
    if (source) rec.source = source;
    const asOf = str(edge.asOf);
    if (asOf) rec.asOf = asOf;
    // A treatment edge carries its heuristic object so confidence + disclaimer travel WITH the edge.
    if (edge.treatment && typeof edge.treatment === 'object') {
      rec.treatment = edge.treatment;
      // structurally guarantee the never-authoritative invariant on the edge.
      rec.treatment.authoritative = false;
    }
    if (edge.label) rec.label = str(edge.label);
    edges.push(rec);
    return rec;
  }

  /** All edges touching a node, annotated with the neighbor id + direction. */
  function neighbors(id) {
    const want = str(id);
    if (!want) return [];
    return edges
      .filter((e) => e.from === want || e.to === want)
      .map((e) => ({ ...e, other: e.from === want ? e.to : e.from, direction: e.from === want ? 'out' : 'in' }));
  }

  function node(id) { return nodes.get(str(id)) || null; }
  function nodesByType(type) { const t = str(type); return Array.from(nodes.values()).filter((n) => n.type === t); }
  function edgesByType(type) { const t = str(type); return edges.filter((e) => e.type === t); }
  function size() { return { nodes: nodes.size, edges: edges.length }; }

  const graph = {
    addNode, addEdge, node, neighbors, nodesByType, edgesByType, size,
    nodes: () => Array.from(nodes.values()),
    edges: () => edges.slice(),
  };

  // Seed the founder's taxonomy as first-class category nodes.
  for (const c of SEED_CATEGORIES) {
    addNode({ type: 'category', id: c.id, name: c.name, note: c.note, keywords: c.keywords });
  }
  return graph;
}

// ── case ingestion ────────────────────────────────────────────────────────────────────────
/**
 * Ingest one case record (shaped like integrations/soapbox/legal.mjs searchOpinions() output, with
 * optional `cites`, `opinionText`, `categories`, `judge`) into the graph. Adds:
 *   • the case node
 *   • cites edges to each cited case (`cites: [{ id, caseName }]` or [string ids])
 *   • falls-under-category edges from matched keywords (caseName + snippet + opinionText) and/or
 *     any explicitly-passed `categories`
 *   • an authored-by edge to a judge node when `judge` is present (cross-link target for §6A.2)
 *   • a treatment object on the case node when opinionText yields a signal
 * Returns { caseId, added:{ nodes, edges }, categories, treatment } or null on a bad record.
 */
export function ingestCase(caseRecord, graph = createGraph()) {
  const rec = caseRecord && typeof caseRecord === 'object' ? caseRecord : null;
  if (!rec) return null;
  const caseId = str(rec.id) || str(rec.caseName) || str(rec.caseNameFull);
  if (!caseId) return null;

  let nAdded = 0; let eAdded = 0;
  const addN = (n) => { if (graph.addNode(n)) nAdded++; };
  const addE = (e) => { if (graph.addEdge(e)) eAdded++; };

  const source = cleanSource(rec.source) || { name: str(rec.sourceName) || 'CourtListener', url: str(rec.url) || null };
  const asOf = str(rec.asOf) || str(rec.dateFiled) || now();

  // 1) the case node.
  const treatment = rec.opinionText ? detectTreatment(rec.opinionText) : null;
  const treatedNode = (treatment && treatment.type !== 'none') ? { treatment } : {};
  addN({
    type: 'case',
    id: caseId,
    name: str(rec.caseName) || str(rec.caseNameFull) || caseId,
    citation: str(rec.citation) || undefined,
    court: str(rec.court) || undefined,
    dateFiled: str(rec.dateFiled) || undefined,
    url: str(rec.url) || undefined,
    judge: str(rec.judge) || undefined,
    ...treatedNode,
  });

  // 2) citation edges.
  const cites = Array.isArray(rec.cites) ? rec.cites : [];
  for (const c of cites) {
    const cId = typeof c === 'string' ? str(c) : (str(c?.id) || str(c?.caseName));
    if (!cId) continue;
    if (typeof c === 'object') {
      addN({ type: 'case', id: cId, name: str(c.caseName) || cId, citation: str(c.citation) || undefined });
    } else {
      addN({ type: 'case', id: cId, name: cId });
    }
    addE({ type: 'cites', from: caseId, to: cId, source });
  }

  // 3) category edges — from explicit list + keyword match across the case's text.
  const text = [rec.caseName, rec.caseNameFull, rec.snippet, rec.opinionText].map(str).join(' \n ');
  const explicit = Array.isArray(rec.categories) ? rec.categories.map(str).filter(Boolean) : [];
  const matched = matchCategories(text);
  const categoryIds = Array.from(new Set([...explicit, ...matched]));
  for (const catId of categoryIds) {
    // tolerate a category passed by name as well as by id.
    const byName = SEED_CATEGORIES.find((c) => c.name.toLowerCase() === catId.toLowerCase());
    const cid = byName ? byName.id : catId;
    if (!graph.node(cid)) continue; // only wire to known seed categories
    addE({ type: 'falls-under-category', from: caseId, to: cid, source });
  }

  // 4) authored-by judge edge (cross-links into accountability-graph §6A.2).
  if (str(rec.judge)) {
    const judgeId = str(rec.judgeId) || `judge:${str(rec.judge)}`;
    addN({ type: 'judge', id: judgeId, name: str(rec.judge), court: str(rec.court) || undefined });
    addE({ type: 'authored-by', from: caseId, to: judgeId, source });
  }

  return {
    caseId,
    added: { nodes: nAdded, edges: eAdded },
    categories: categoryIds,
    treatment: treatment && treatment.type !== 'none' ? treatment : null,
  };
}

// ── query ─────────────────────────────────────────────────────────────────────────────────
/**
 * Query the graph for cases matching a category and/or a treatment filter.
 *   query(graph, { category: 'Coercion', treatment: 'negative' })
 *     → every case node that falls-under Coercion AND carries a negative-treatment signal.
 * `category` accepts a category id ('cat:coercion') or display name ('Coercion').
 * `treatment` accepts: a specific type ('overruled'), 'negative' (any negative type),
 *   'any' (has any non-none signal), or omitted (no treatment filter).
 * Returns an array of case nodes (each with its treatment object when present). Never throws.
 */
export function query(graph, { category, treatment } = {}) {
  if (!graph || typeof graph.nodesByType !== 'function') return [];
  let cases = graph.nodesByType('case');

  if (category) {
    const want = str(category);
    const byName = SEED_CATEGORIES.find((c) => c.name.toLowerCase() === want.toLowerCase());
    const catId = byName ? byName.id : want;
    cases = cases.filter((c) =>
      graph.neighbors(c.id).some((e) => e.type === 'falls-under-category' && e.other === catId));
  }

  if (treatment) {
    const want = str(treatment).toLowerCase();
    cases = cases.filter((c) => {
      const t = c.treatment;
      if (!t || t.type === 'none') return false;
      if (want === 'any') return true;
      if (want === 'negative') return NEGATIVE_TREATMENTS.includes(t.type);
      return t.type === want;
    });
  }

  return cases;
}

// ── render (escaped HTML) ───────────────────────────────────────────────────────────────────
/** Render the treatment block for a node/edge — confidence + the not-authoritative disclaimer. */
function renderTreatment(t) {
  if (!t || t.type === 'none') return '';
  const pct = Math.round((Number(t.confidence) || 0) * 100);
  return (
    `<div class="lkg-treatment" data-authoritative="false">`
    + `<strong>Treatment:</strong> ${escapeHtml(t.type)} `
    + `<span class="lkg-confidence">(confidence ${pct}%)</span>`
    + (t.evidence ? ` <span class="lkg-evidence">&ldquo;${escapeHtml(t.evidence)}&rdquo;</span>` : '')
    + `<p class="lkg-disclaimer"><em>${escapeHtml(t.disclaimer || 'Heuristic signal — not authoritative; verify against the opinion.')}</em></p>`
    + `</div>`
  );
}

/** Render a single node — for a case, includes its citation list and treatment (with disclaimer). */
export function renderNode(node, graph = null) {
  if (!node || typeof node !== 'object') return '';
  const n = node;
  const parts = [`<div class="lkg-node lkg-${escapeHtml(n.type)}">`];
  parts.push(`<h3>${escapeHtml(n.name || n.id)}</h3>`);
  const meta = [];
  if (n.citation) meta.push(`<span class="lkg-citation">${escapeHtml(n.citation)}</span>`);
  if (n.court) meta.push(`<span class="lkg-court">${escapeHtml(n.court)}</span>`);
  if (n.dateFiled) meta.push(`<span class="lkg-date">${escapeHtml(n.dateFiled)}</span>`);
  if (meta.length) parts.push(`<div class="lkg-meta">${meta.join(' · ')}</div>`);
  if (n.note) parts.push(`<p class="lkg-note">${escapeHtml(n.note)}</p>`);

  if (n.treatment) parts.push(renderTreatment(n.treatment));

  // citation list, when we have the graph to read edges from.
  if (graph && typeof graph.neighbors === 'function') {
    const cited = graph.neighbors(n.id).filter((e) => e.type === 'cites' && e.direction === 'out');
    if (cited.length) {
      const items = cited.map((e) => {
        const tgt = graph.node(e.other);
        return `<li>${escapeHtml(tgt ? (tgt.name || tgt.id) : e.other)}</li>`;
      }).join('');
      parts.push(`<div class="lkg-cites"><strong>Cites:</strong><ul>${items}</ul></div>`);
    }
  }
  if (n.url) parts.push(`<p class="lkg-src"><a href="${escapeHtml(n.url)}" rel="nofollow noopener">source</a></p>`);
  parts.push(`</div>`);
  return parts.join('');
}

/** Render the whole graph as escaped HTML — categories, then cases (each with cites + treatment). */
export function renderGraph(graph) {
  if (!graph || typeof graph.nodesByType !== 'function') return '<div class="lkg-empty">No graph.</div>';
  const cats = graph.nodesByType('category');
  const cases = graph.nodesByType('case');
  const out = ['<section class="lkg">'];
  out.push(`<h2>Legal Knowledge Graph</h2>`);
  out.push(`<p class="lkg-note"><em>Treatment signals are heuristic and NOT authoritative — never relied on for whether a case is good law.</em></p>`);

  out.push('<div class="lkg-categories"><h3>Founder’s categories</h3><ul>');
  for (const c of cats) {
    out.push(`<li><strong>${escapeHtml(c.name)}</strong>${c.note ? ` — ${escapeHtml(c.note)}` : ''}</li>`);
  }
  out.push('</ul></div>');

  out.push('<div class="lkg-cases">');
  for (const c of cases) out.push(renderNode(c, graph));
  out.push('</div>');

  out.push('</section>');
  return out.join('');
}

// ── guarded CLI demo ────────────────────────────────────────────────────────────────────────
const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();

if (isMain) {
  const g = createGraph();
  ingestCase({
    id: 'us:smith-v-jones',
    caseName: 'Smith v. Jones',
    citation: '123 U.S. 456',
    court: 'SCOTUS',
    dateFiled: '1990-01-01',
    judge: 'Hon. Example J.',
    cites: [{ id: 'us:doe-v-roe', caseName: 'Doe v. Roe' }],
    categories: ['Coercion'],
    opinionText: 'For these reasons we overrule the contrary holding regarding business reputation and credit.',
    url: 'https://www.courtlistener.com/opinion/1/smith-v-jones/',
  }, g);
  console.log('size:', g.size());
  console.log('coercion + negative treatment:', query(g, { category: 'Coercion', treatment: 'negative' }).map((c) => c.name));
  console.log('\n--- render ---\n' + renderGraph(g));
}
