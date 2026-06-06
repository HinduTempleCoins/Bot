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

// drop empty/null entries from a structured-fields object so a row never carries dead keys.
function compactFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// Normalize a raw hit from any upstream into our stable evidence shape + attach a provenance envelope
// and a computed confidence. Returns null for hits with no title or no url (nothing to cite).
//
// `fields` (data-loss-audit, #284) carries the STRUCTURED upstream data that a snippet string would
// otherwise flatten away — agency/type/date for gov, authors/year/doi/cited/openAccess for scholarly.
// Those rich fields are surfaced ADDITIVELY (the original title/url/snippet/sourceType/confidence/
// provenance shape is unchanged), so downstream consumers (the fact-checker, wiki-writer, Cheetah)
// can read the real datum instead of re-parsing a human-readable snippet. Empty fields are dropped.
function toEvidence(raw, sourceType, fields = {}) {
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
    // additive structured fields — present only when the upstream actually carried them.
    ...compactFields(fields),
  };
}

// ── per-source adapters (each soft-fails to { rows:[], error }) ───────────────────────────────────
// Every adapter takes (topic, fns) where fns lets a caller INJECT a fake for offline testing. When a
// fake isn't injected, the real imported function is used. None of these ever throw.
//
// SOFT-FAIL-HONEST (data-loss-audit, #284): an adapter that fails or finds nothing returns its REASON
// alongside the (empty) rows, so sourcesFor can report WHY a tier contributed nothing instead of
// silently swallowing it. House style is soft-fail-honest, not soft-fail-mute.
//
// FIELD PRESERVATION (#284): each adapter now forwards the upstream's STRUCTURED fields into toEvidence
// (gov: agency/type/date; scholarly: authors/year/doi/cited/openAccess/venue) so the rich datum survives
// instead of being flattened into the human-readable `snippet`. The snippet is still built for display.

async function fromGov(topic, fn) {
  try {
    const rows = await fn(topic);
    const arr = Array.isArray(rows) ? rows : [];
    const out = arr.map((d) => toEvidence({
      title: d.title,
      url: d.url,
      snippet: [d.agency, d.type, d.date].filter(Boolean).join(' · '),
    }, 'gov', {
      // structured gov fields preserved additively (previously discarded into the snippet string).
      agency: str(d.agency), docType: str(d.type), date: str(d.date),
    })).filter(Boolean);
    return { rows: out, error: out.length ? null : 'no results' };
  } catch (e) { return { rows: [], error: `gov source failed: ${e && e.message ? e.message : String(e)}` }; }
}

async function fromScholarly(topic, fn) {
  try {
    const out = await fn(topic, { limit: 12 });
    const rows = Array.isArray(out?.results) ? out.results : (Array.isArray(out) ? out : []);
    const ev = rows.map((r) => toEvidence({
      title: r.title,
      url: r.url,
      snippet: [(r.authors || []).slice(0, 3).join(', '), r.year ? `(${r.year})` : '']
        .filter(Boolean).join(' '),
    }, 'scholarly', {
      // the rich scholarly record (the historic "Case Text"-style loss) preserved additively.
      authors: Array.isArray(r.authors) ? r.authors : undefined,
      year: r.year != null ? r.year : undefined,
      doi: str(r.doi) || undefined,
      citedByCount: typeof r.cited === 'number' ? r.cited : undefined,
      openAccess: typeof r.openAccess === 'boolean' ? r.openAccess : undefined,
      venue: str(r.venue) || undefined,
      pubType: str(r.type) || undefined,
    })).filter(Boolean);
    return { rows: ev, error: ev.length ? null : 'no results' };
  } catch (e) { return { rows: [], error: `scholarly source failed: ${e && e.message ? e.message : String(e)}` }; }
}

async function fromWiki(topic, fn) {
  try {
    // Wikipedia + Wikidata via scraper's single-provider search. Either may soft-fail to [].
    // Promise.resolve() so an injected SYNCHRONOUS fake (returning a plain array) works too.
    const [wp, wd] = await Promise.all([
      Promise.resolve().then(() => fn(topic, { provider: 'wikipedia', limit: 6 })).catch(() => []),
      Promise.resolve().then(() => fn(topic, { provider: 'wikidata', limit: 6 })).catch(() => []),
    ]);
    const out = [...(wp || []), ...(wd || [])]
      .map((r) => toEvidence(r, 'wiki', { provider: str(r.provider) || undefined })).filter(Boolean);
    return { rows: out, error: out.length ? null : 'no results' };
  } catch (e) { return { rows: [], error: `wiki source failed: ${e && e.message ? e.message : String(e)}` }; }
}

async function fromWeb(topic, fn) {
  try {
    const rows = await fn(topic, { limit: 12 });
    const arr = Array.isArray(rows) ? rows : [];
    const out = arr.map((r) => toEvidence(r, 'web', { provider: str(r.provider) || undefined })).filter(Boolean);
    return { rows: out, error: out.length ? null : 'no results' };
  } catch (e) { return { rows: [], error: `web source failed: ${e && e.message ? e.message : String(e)}` }; }
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
 * Returns [{ title, url, snippet, sourceType, confidence, provenance, ...structured }], deduped by url,
 * capped at max. Structured upstream fields (agency/type/date, authors/year/doi/cited/openAccess) ride
 * along ADDITIVELY when present. Never throws — any failing source simply contributes nothing.
 *
 * Pass { withDiagnostics:true } to instead get { results, sourceErrors } where sourceErrors maps each
 * source that contributed nothing to the REASON why (soft-fail-honest, #284) — so a caller can tell a
 * "down" source from a "no hits" one. The default (array) return is unchanged for back-compat.
 */
export async function sourcesFor(topic, { max = 8, sources = {}, withDiagnostics = false } = {}) {
  const q = str(topic);
  if (!q) return withDiagnostics ? { results: [], sourceErrors: { topic: 'empty topic' } } : [];
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

  // collect WHY any source contributed nothing (soft-fail-honest) instead of swallowing it.
  const sourceErrors = {};
  for (const [name, r] of [['gov', gov], ['scholarly', scholarly], ['wiki', wiki], ['web', web]]) {
    if (r.error) sourceErrors[name] = r.error;
  }

  const fused = rankSources([...gov.rows, ...scholarly.rows, ...wiki.rows, ...web.rows]);
  const results = dedupByUrl(fused).slice(0, Math.max(0, max | 0) || 8);
  return withDiagnostics ? { results, sourceErrors } : results;
}

// ── groundClaim ────────────────────────────────────────────────────────────────────────────────
/**
 * Ground a single claim: gather its supporting evidence and report the strongest source TYPE backing
 * it. Thin wrapper over sourcesFor so the fact-checker can ask "what's the best evidence for this?"
 *   groundClaim(claim, { max, sources })  → { claim, evidence: [...], strongestSourceType, sourceErrors }
 * `strongestSourceType` is the highest authority tier present in the evidence (or null if none found).
 * `sourceErrors` (#284) reports WHY any source contributed nothing, so an empty/thin grounding is
 * explainable ("scholarly source failed: …") rather than silently empty. Never throws.
 */
export async function groundClaim(claim, opts = {}) {
  const c = str(claim);
  const { results: evidence, sourceErrors } = await sourcesFor(c, { ...opts, withDiagnostics: true });
  let strongestSourceType = null;
  let bestTier = 0;
  for (const e of evidence) {
    const t = SOURCE_TIERS[e.sourceType] || 0;
    if (t > bestTier) { bestTier = t; strongestSourceType = e.sourceType; }
  }
  return { claim: c, evidence, strongestSourceType, sourceErrors };
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
