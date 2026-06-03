// grounding-sources.mjs — ONE authoritative-evidence aggregator shared by the Fact-Checker, the
// Wiki-Writer, and Cheetah. Given a claim or topic, it returns RANKED, provenance-tagged evidence
// with the most authoritative sources first, so every downstream surface grounds on the same
// "what does the best available source actually say" instead of model memory.
//
// It does NOT fetch on its own schedule or hold any opinion about a claim's truth — it only gathers
// and orders evidence. Truth resolution stays with the fact-checker; attribution stays with Cheetah;
// prose stays with the wiki-writer. This module is the shared evidence floor underneath all three.
//
// Aggregated sources (imported, never edited; each soft-fails independently so a dead source just
// contributes nothing):
//   govapis.mjs        — keyless US-gov readers (primary/authoritative)            → sourceType 'gov'
//   library-catalog.mjs — OpenAlex/Crossref/DOAJ/arXiv scholarly + books            → 'scholarly'
//   scraper.mjs        — Wikipedia/Wikidata lookup (curated reference)             → 'wiki'
//   scraper.mjs        — searchAll keyless web metasearch (fallback)              → 'web'
//
// Confidence is COMPUTED via provenance.mjs sourceConfidence (gov/peer-reviewed score high, web low) —
// never editorial. rankSources() orders by AUTHORITY TIER first (gov > scholarly > wiki > web), then
// by that computed confidence, so a high-confidence web hit never outranks a low-confidence gov one.
//
// Pattern follows macro.mjs: ESM, soft-fail (never throws), CLI guarded by process.argv[1].
//
//   import { sourcesFor, groundClaim, rankSources } from './integrations/grounding-sources.mjs'
//   const ranked = await sourcesFor('lithium carbonate price', { max: 8 })
//   const grounded = await groundClaim('The US national debt exceeds $30 trillion')
//   node integrations/grounding-sources.mjs "phoenix protocol"

import { tag, sourceConfidence } from './soapbox/provenance.mjs';
import { federalRegister } from './soapbox/govapis.mjs';
import { catalogSearch } from './soapbox/library-catalog.mjs';
import { search, searchAll } from './scraper.mjs';

// ── authority tiers ────────────────────────────────────────────────────────────────────────────
// The hard ordering rankSources() applies BEFORE confidence. A primary government record always sits
// above a peer-reviewed paper, which sits above a curated reference, which sits above raw web search.
export const SOURCE_TIERS = { gov: 4, scholarly: 3, wiki: 2, web: 1 };

// Per-sourceType provenance hints handed to provenance.tag(). `source` keys map into provenance.mjs's
// SOURCE_RELIABILITY table so confidence comes out right (gov ≈ 0.92+, scholarly ≈ 0.88+, wiki ≈ 0.85,
// web ≈ 0.35). freshnessClass picks a sane decay: gov/web are LIVE pulls; scholarly/wiki are 'static'
// reference (a paper or an encyclopedia fact doesn't go stale on an hourly clock).
const PROV = {
  gov: { source: 'gov', freshnessClass: 'LIVE' },
  scholarly: { source: 'openalex', freshnessClass: 'static' },
  wiki: { source: 'wikipedia', freshnessClass: 'static' },
  web: { source: 'web', freshnessClass: 'LIVE' },
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Normalize a raw hit from any upstream into our stable evidence shape + attach a provenance envelope
// and a computed confidence. Returns null for hits with no title or no url (nothing to cite).
function toEvidence(raw, sourceType) {
  const title = str(raw?.title);
  const url = str(raw?.url);
  if (!title || !url) return null;
  const snippet = str(raw?.snippet) || str(raw?.description) || '';
  const provHint = PROV[sourceType] || PROV.web;
  // tag() mutates+returns the record; we tag a fresh object so upstream rows aren't touched.
  const rec = tag({ title, url, snippet, sourceType }, { ...provHint, fetchedAt: Date.now() });
  return {
    title,
    url,
    snippet,
    sourceType,
    confidence: sourceConfidence(rec),
    provenance: rec._provenance,
  };
}

// ── per-source adapters (each soft-fails to []) ──────────────────────────────────────────────────
// Every adapter takes (topic, fns) where fns lets a caller INJECT a fake for offline testing. When a
// fake isn't injected, the real imported function is used. None of these ever throw.

async function fromGov(topic, fn) {
  try {
    const rows = await fn(topic);
    return (Array.isArray(rows) ? rows : []).map((d) => toEvidence({
      title: d.title,
      url: d.url,
      snippet: [d.agency, d.type, d.date].filter(Boolean).join(' · '),
    }, 'gov')).filter(Boolean);
  } catch { return []; }
}

async function fromScholarly(topic, fn) {
  try {
    const out = await fn(topic, { limit: 12 });
    const rows = Array.isArray(out?.results) ? out.results : (Array.isArray(out) ? out : []);
    return rows.map((r) => toEvidence({
      title: r.title,
      url: r.url,
      snippet: [(r.authors || []).slice(0, 3).join(', '), r.year ? `(${r.year})` : '']
        .filter(Boolean).join(' '),
    }, 'scholarly')).filter(Boolean);
  } catch { return []; }
}

async function fromWiki(topic, fn) {
  try {
    // Wikipedia + Wikidata via scraper's single-provider search. Either may soft-fail to [].
    // Promise.resolve() so an injected SYNCHRONOUS fake (returning a plain array) works too.
    const [wp, wd] = await Promise.all([
      Promise.resolve().then(() => fn(topic, { provider: 'wikipedia', limit: 6 })).catch(() => []),
      Promise.resolve().then(() => fn(topic, { provider: 'wikidata', limit: 6 })).catch(() => []),
    ]);
    return [...(wp || []), ...(wd || [])]
      .map((r) => toEvidence(r, 'wiki')).filter(Boolean);
  } catch { return []; }
}

async function fromWeb(topic, fn) {
  try {
    const rows = await fn(topic, { limit: 12 });
    return (Array.isArray(rows) ? rows : []).map((r) => toEvidence(r, 'web')).filter(Boolean);
  } catch { return []; }
}

// ── rankSources (PURE) ───────────────────────────────────────────────────────────────────────────
/**
 * Pure ordering of an evidence list. Authority tier DESC (gov > scholarly > wiki > web) is the primary
 * key; computed confidence DESC breaks ties within a tier; url is the final stable tiebreaker. Does
 * NOT fetch, dedupe, or mutate — callers hand it the fused list. Unknown sourceTypes sort to the bottom.
 */
export function rankSources(list) {
  return [...(Array.isArray(list) ? list : [])]
    .filter((r) => r && typeof r === 'object')
    .sort((a, b) => {
      const ta = SOURCE_TIERS[a.sourceType] || 0;
      const tb = SOURCE_TIERS[b.sourceType] || 0;
      if (tb !== ta) return tb - ta;
      const ca = Number.isFinite(a.confidence) ? a.confidence : 0;
      const cb = Number.isFinite(b.confidence) ? b.confidence : 0;
      if (cb !== ca) return cb - ca;
      return String(a.url || '').localeCompare(String(b.url || ''));
    });
}

// Dedup by url, keeping the FIRST occurrence (which, after rankSources, is the highest-authority one).
function dedupByUrl(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (!r?.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

// ── sourcesFor ─────────────────────────────────────────────────────────────────────────────────
/**
 * Gather ranked, provenance-tagged evidence for a topic from all sources, most authoritative first.
 *   sourcesFor(topic, { max = 8, sources })
 * `sources` lets callers inject fakes for testing (any subset; missing ones use the real imports):
 *   { gov, scholarly, wiki, web }  — each a function with the same signature as the real adapter takes.
 *     gov(topic)                    → [{ title, url, agency?, type?, date? }]
 *     scholarly(topic, {limit})     → { results: [...] } | [...]
 *     wiki(topic, {provider,limit}) → [{ title, url, snippet? }]   (called once per provider)
 *     web(topic, {limit})           → [{ title, url, snippet? }]
 * Returns [{ title, url, snippet, sourceType, confidence, provenance }], deduped by url, capped at max.
 * Never throws — any failing source simply contributes nothing.
 */
export async function sourcesFor(topic, { max = 8, sources = {} } = {}) {
  const q = str(topic);
  if (!q) return [];
  const govFn = sources.gov || federalRegister;
  const schFn = sources.scholarly || catalogSearch;
  const wikiFn = sources.wiki || search;
  const webFn = sources.web || searchAll;

  const [gov, scholarly, wiki, web] = await Promise.all([
    fromGov(q, govFn),
    fromScholarly(q, schFn),
    fromWiki(q, wikiFn),
    fromWeb(q, webFn),
  ]);

  const fused = rankSources([...gov, ...scholarly, ...wiki, ...web]);
  return dedupByUrl(fused).slice(0, Math.max(0, max | 0) || 8);
}

// ── groundClaim ────────────────────────────────────────────────────────────────────────────────
/**
 * Ground a single claim: gather its supporting evidence and report the strongest source TYPE backing
 * it. Thin wrapper over sourcesFor so the fact-checker can ask "what's the best evidence for this?"
 *   groundClaim(claim, { max, sources })  → { claim, evidence: [...], strongestSourceType }
 * `strongestSourceType` is the highest authority tier present in the evidence (or null if none found).
 * Never throws.
 */
export async function groundClaim(claim, opts = {}) {
  const c = str(claim);
  const evidence = await sourcesFor(c, opts);
  let strongestSourceType = null;
  let bestTier = 0;
  for (const e of evidence) {
    const t = SOURCE_TIERS[e.sourceType] || 0;
    if (t > bestTier) { bestTier = t; strongestSourceType = e.sourceType; }
  }
  return { claim: c, evidence, strongestSourceType };
}

// ── CLI (offline-safe wrapper around live sources) ───────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('grounding-sources.mjs')) {
  const topic = process.argv.slice(2).join(' ') || 'phoenix protocol';
  const grounded = await groundClaim(topic);
  console.log(`\nGrounding: "${topic}"  — strongest: ${grounded.strongestSourceType || '(none)'}\n`);
  for (const e of grounded.evidence) {
    console.log(`  [${e.sourceType.padEnd(9)} c=${String(e.confidence).padStart(3)}] ${e.title.slice(0, 70)}`);
    console.log(`    ${e.url}`);
  }
}
