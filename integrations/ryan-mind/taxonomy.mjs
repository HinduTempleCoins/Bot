// ryan-mind/taxonomy.mjs — categories are DATA, not code. taxonomy.json in the data dir is seeded from the
// corpus's own structure (knowledge/ folders, KNOWLEDGE_BASE_ARCHITECTURE.json descriptions + primary
// keywords, _library_catalog.json per-folder keywords) and then grows: `suggestCategories` proposes new
// categories from what uncategorised claims keep talking about, records each proposal in
// taxonomy-log.jsonl, and the categoriser uses proposals immediately (status "proposed") — the operator
// can rename / merge / retire any of them by editing taxonomy.json.
//
// Category: {id, label, description, keywords:[..] (weight 2), weak_keywords:[..] (weight 1), status, seeded_from}
import fs from 'node:fs';
import path from 'node:path';
import { contentTokens, STOPWORDS, slug } from './util.mjs';
import { REPO_ROOT } from './store.mjs';

// container folders (genre, not topic) and machinery folders are not categories on their own
const NON_TOPIC = new Set(['synthesis', 'scripture']);

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

/**
 * Seed a taxonomy from the corpus structure. Pure over the inputs it is handed (tests pass fixtures);
 * `seedFromRepo` below reads them off disk.
 * @param {{folders:string[], architecture?:object, catalog?:object}} input
 */
export function seedTaxonomy({ folders = [], architecture = null, catalog = null } = {}) {
  const fs_ = architecture?.folder_structure || {};
  const pk = architecture?.primary_keywords_by_folder || {};
  // per-folder catalog keywords: keep ones frequent inside the folder and rare across folders
  const perFolder = new Map(); const folderSpread = new Map();
  for (const entries of Object.values(catalog?.byDomain || {})) {
    for (const e of entries || []) {
      const m = String(e?.path || '').match(/^knowledge\/([^/]+)\//); if (!m) continue;
      const f = m[1]; const counts = perFolder.get(f) || new Map(); perFolder.set(f, counts);
      for (const k of e.keywords || []) {
        const kw = String(k).toLowerCase(); if (kw.length < 4 || STOPWORDS.has(kw) || /^\d+$/.test(kw)) continue;
        counts.set(kw, (counts.get(kw) || 0) + 1);
        const s = folderSpread.get(kw) || new Set(); s.add(f); folderSpread.set(kw, s);
      }
    }
  }
  const all = [...new Set([...folders, ...Object.keys(fs_)])].filter((f) => !NON_TOPIC.has(f)).sort();
  const categories = all.map((f) => {
    const counts = perFolder.get(f) || new Map();
    const weak = [...counts.entries()].filter(([k, n]) => n >= 2 && (folderSpread.get(k)?.size || 0) <= 2)
      .sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k]) => k);
    const desc = fs_[f]?.description || '';
    const strong = [...new Set([f.replace(/[_-]+/g, ' '), ...(pk[f] || []).map((k) => String(k).toLowerCase())])];
    return {
      id: f, label: f.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), description: desc,
      keywords: strong, weak_keywords: weak.filter((w) => !strong.includes(w)), status: 'seed',
      seeded_from: [folders.includes(f) && 'knowledge/ folder', fs_[f] && 'KNOWLEDGE_BASE_ARCHITECTURE.json', counts.size && '_library_catalog.json'].filter(Boolean),
    };
  });
  return { version: 1, generated: 'seed', categories };
}

export function seedFromRepo(repoRoot = REPO_ROOT) {
  const k = path.join(repoRoot, 'knowledge');
  let folders = [];
  try { folders = fs.readdirSync(k, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* none */ }
  return seedTaxonomy({ folders, architecture: readJson(path.join(k, 'KNOWLEDGE_BASE_ARCHITECTURE.json')), catalog: readJson(path.join(k, '_library_catalog.json')) });
}

export function loadTaxonomy(store, repoRoot = REPO_ROOT) {
  const t = store.readJson('taxonomy.json', null);
  if (t && Array.isArray(t.categories)) return t;
  const seeded = seedFromRepo(repoRoot);
  store.writeJson('taxonomy.json', seeded);
  return seeded;
}

// compile keyword → token lists once per taxonomy object
const _compiled = new WeakMap();
function compile(tax) {
  let c = _compiled.get(tax); if (c) return c;
  c = (tax?.categories || []).filter((x) => x.status !== 'retired').map((cat) => ({
    id: cat.id,
    kws: [...(cat.keywords || []).map((k) => [contentTokens(k), 2]), ...(cat.weak_keywords || []).map((k) => [contentTokens(k), 1])].filter(([t]) => t.length),
  }));
  _compiled.set(tax, c); return c;
}

/**
 * Score text (+ its context path, at half weight) against every category.
 * @returns {{category:string, categories:string[], scores:Object}} — category 'uncategorized' when nothing reaches minScore.
 */
export function categorize(text, context, tax, { minScore = 2 } = {}) {
  const tt = new Set(contentTokens(text)); const ct = new Set(contentTokens(context));
  const scores = {};
  for (const cat of compile(tax)) {
    let s = 0;
    for (const [toks, w] of cat.kws) {
      if (toks.every((t) => tt.has(t))) s += w;
      else if (toks.every((t) => ct.has(t))) s += w / 2;
    }
    if (s > 0) scores[cat.id] = s;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const hits = ranked.filter(([, s]) => s >= minScore).map(([id]) => id);
  return { category: hits[0] || 'uncategorized', categories: hits.slice(0, 3), scores };
}

// words too general to name a category on their own
const GENERIC = new Set(`system systems work time year years people world form forms way process thing things part parts point
level levels kind type types case cases fact facts idea ideas term terms example examples number numbers place places
create creat created creation confirm confirmed connect connected connection connections modern knowledge human humans
generation generations ancient history historical original complete full major important different specific
general common single multiple entire total direct directly through across between within without
understand understanding pattern patterns framework frameworks document documents section sections protocol
protocols version versions level structure structures practice practices element elements aspect aspects
evidence research study studies analysis result results source sources today current future present past`.split(/\s+/).map((w) => w.trim()).filter(Boolean));

/** Candidate category terms in a claim: proper nouns (non-initial capitalised words) and content bigrams. */
export function candidateTerms(text) {
  const out = new Map(); // key (stemmed) -> surface
  const t = String(text ?? '');
  const words = t.match(/[A-Za-z][A-Za-z'’-]+/g) || [];
  words.forEach((w, i) => {
    if (i === 0 || !/^[A-Z][a-z]{3,}/.test(w)) return;
    const k = contentTokens(w)[0]; if (!k || GENERIC.has(k) || GENERIC.has(w.toLowerCase())) return;
    if (!out.has(k)) out.set(k, w);
  });
  const toks = contentTokens(t).filter((x) => !/^\d+$/.test(x));
  const surf = (t.toLowerCase().match(/[a-z][a-z'’-]+/g) || []).filter((w) => !STOPWORDS.has(w) && w.length >= 3);
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i], b = toks[i + 1];
    if (a.length < 4 || b.length < 4 || a === b || GENERIC.has(a) || GENERIC.has(b)) continue;
    const k = `${a} ${b}`; if (!out.has(k)) out.set(k, surf[i] && surf[i + 1] ? `${surf[i]} ${surf[i + 1]}` : k);
  }
  return out;
}

/**
 * Propose new categories from what UNCATEGORISED claims share. A term (proper noun or content bigram)
 * qualifies when it appears in at least `minClaims` uncategorised claims drawn from at least `minSources`
 * sources and is not already a keyword. Returns {taxonomy (new object), proposals}. Existing categories
 * are never edited here — proposals are appended with status "proposed" for the operator to keep or retire.
 */
export function suggestCategories(claims, tax, { minClaims = 4, minSources = 2, max = 8 } = {}) {
  const known = new Set();
  for (const c of tax?.categories || []) for (const k of [...(c.keywords || []), ...(c.weak_keywords || [])]) known.add(contentTokens(k).join(' '));
  const existingIds = new Set((tax?.categories || []).map((c) => c.id));
  const df = new Map(); // key -> {claims:Set, sources:Set, surface}
  const unc = claims.filter((c) => c.category === 'uncategorized');
  const termsOf = new Map();
  for (const c of unc) {
    const terms = candidateTerms(c.text); termsOf.set(c.id, terms);
    for (const [k, surface] of terms) {
      if (known.has(k)) continue;
      const e = df.get(k) || { claims: new Set(), sources: new Set(), surface }; df.set(k, e);
      e.claims.add(c.id); e.sources.add(c.source_id);
    }
  }
  const cands = [...df.entries()].filter(([, e]) => e.claims.size >= minClaims && e.sources.size >= minSources)
    .sort((a, b) => b[1].claims.size - a[1].claims.size || b[0].length - a[0].length);
  const proposals = []; const covered = new Set();
  for (const [k, e] of cands) {
    if (proposals.length >= max) break;
    const id = `proposed-${slug(e.surface, 40)}`;
    if (existingIds.has(id)) continue;
    // mostly the same claims as an earlier proposal → it is a facet of that one, not a new category
    const overlap = [...e.claims].filter((x) => covered.has(x)).length / e.claims.size;
    if (overlap > 0.6) continue;
    const co = new Map();
    for (const cid of e.claims) for (const [u] of termsOf.get(cid) || []) if (u !== k && !u.includes(' ')) co.set(u, (co.get(u) || 0) + 1);
    const weak = [...co.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([u]) => u);
    proposals.push({ id, label: e.surface, description: `Proposed from ${e.claims.size} uncategorised claims across ${e.sources.size} sources`, keywords: [k], weak_keywords: weak, status: 'proposed', evidence: { claims: e.claims.size, sources: e.sources.size, sample: [...e.claims].slice(0, 5) } });
    for (const x of e.claims) covered.add(x);
  }
  return { taxonomy: { ...tax, categories: [...(tax?.categories || []), ...proposals] }, proposals };
}
