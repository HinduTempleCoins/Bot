// search-quality.mjs — the QUALITY + DIGESTIBILITY layer for the metasearch (task #132, a Resource
// Center diagnostic). The scraper's searchAll() fans a query across ~25 engines and returns raw,
// noisy, partly-duplicated rows ({title, url, snippet, provider}). This module takes those raw rows
// (BEFORE or AFTER searchAll's own dedup — it handles both shapes) and turns them into something a
// human or a bot can read fast:
//
//   rankResults(raw, query)  → [{ title, url, snippet, providers[], score, reasons[], why }]  (sorted)
//   digest(raw, query)       → { query, summary, count, clusters:[{ lead, members[], summary }] }
//
// The ranking MATH is pure — no network. The caller (the search server / scraper.research) does the
// fetching; this only ranks + clusters what it's handed. Domain-authority signals from
// domain-insights.mjs (Tranco rank / RDAP age) are OPTIONAL and injected: pass { authority } as a
// map of host→{rank,ageYears} (already fetched by the caller) and we fold it in; without it we
// degrade gracefully to the keyless host/TLD heuristics below. This keeps the consistency with the
// scholar-weighting in scraper.searchAll (#134): scholarly + ecosystem + reputable sources rank up,
// SEO-farm / listicle / low-signal domains rank down.
//
//   import { rankResults, digest } from './integrations/soapbox/search-quality.mjs'
//   node integrations/soapbox/search-quality.mjs <query>     # demo with a tiny fixture

import { normalizeUrl, cleanSnippet, SCHOLARLY } from '../scraper.mjs';
import { buildIndex, score as bm25Score, rrf, typoMatch } from '../bm25.mjs';

// Defensive import of the semantic embeddings layer — OPTIONAL. If it ever fails to load (or is
// removed), the hybrid fusion below degrades to lexical-only. Loaded lazily so this module never throws
// at import time and tests that don't use the semantic path stay fully offline.
let _embeddings = null;
let _embeddingsTried = false;
async function loadEmbeddings() {
  if (_embeddingsTried) return _embeddings;
  _embeddingsTried = true;
  try { _embeddings = await import('../cheetah-embeddings.mjs'); } catch { _embeddings = null; }
  return _embeddings;
}

// ── source-authority tables ──────────────────────────────────────────────────────────────────────
// OUR ecosystem — boosted hardest (we surface our own Library/markets/chains first, like searchAll).
const ECOSYSTEM_HOST = /(^|\.)(soapbox\.community|vankush\.|melek\.|kalivankush\.|hindutemple)/i;
const ECOSYSTEM_CHAINS = /(^|\.)(hive\.blog|blurt\.blog|steemit\.com|peakd\.com|ecency\.com)/i;

// Reputable / primary-source / research domains (mirrors scraper.AUTHORITY_HOST, kept local so this
// module is self-contained and the two can drift independently if needed).
const AUTHORITY_TLD = /\.(edu|gov|mil|int|ac\.[a-z]{2}|gov\.[a-z]{2}|edu\.[a-z]{2})(\/|$|:)/i;
const AUTHORITY_HOST = /(^|\.)(wikipedia\.org|wikidata\.org|wikimedia\.org|britannica\.com|nature\.com|science\.org|sciencedirect\.com|springer\.com|jstor\.org|arxiv\.org|doi\.org|ncbi\.nlm\.nih\.gov|pubmed\.|who\.int|un\.org|nasa\.gov|archive\.org|stanford\.edu|mit\.edu|ietf\.org|rfc-editor\.org|crossref\.org|openalex\.org)/i;

// SEO-farm / listicle / low-signal domains — demoted (mirrors scraper.SPAM_HOST).
const SPAM_HOST = /(^|\.)(pinterest\.|quora\.com|answers\.com|ehow\.com|wikihow\.com|buzzfeed\.|listverse\.com|ranker\.com|thetoptens\.com|examples?\.com|geeksforgeeks\.org|w3schools\.com|tutorialspoint\.com|brainly\.|coursehero\.com|studocu\.com|slideshare\.net|scribd\.com|.*\.blogspot\.|.*\.wordpress\.com)/i;
const SPAM_TITLE = /\b(top|best)\s+\d+\b|\b\d+\s+(best|top|ways|things|reasons|tips|tricks|hacks)\b|you won'?t believe|click ?bait/i;

// Scholarly PROVIDERS (the engine, not the domain) — corroboration from these means the row came out
// of a curated academic index (CrossRef/PubMed/arXiv/…). Reuses the scraper's canonical set.
const SCHOLARLY_PROVIDERS = SCHOLARLY;

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'is', 'are', 'what', 'how', 'why', 'who', 'with', 'de', 'la', 'el', 'le', 'der', 'die', 'das']);

function hostOf(url) { try { return new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } }

function queryTerms(query) {
  return String(query || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2 && !STOP.has(t));
}

// ── dedup ─────────────────────────────────────────────────────────────────────────────────────────
// Collapse rows that are the SAME page (normalized URL) OR the same title under the same host. The
// merged row keeps the richest snippet + the union of providers (corroboration signal).
function titleKey(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function dedupe(raw = []) {
  const byUrl = new Map();   // normalized url -> merged row
  const titleSeen = new Map(); // `${host}\n${titleKey}` -> normalized url (catch same-title-diff-tracking)
  for (const r of (raw || [])) {
    if (!r || !r.url) continue;
    const url = normalizeUrl(r.url);
    if (!url) continue;
    const snip = cleanSnippet(r.snippet);
    // providers can arrive as a single `provider` (raw) or an array `providers` (already-merged).
    const provs = Array.isArray(r.providers) ? r.providers.filter(Boolean) : (r.provider ? [r.provider] : []);
    const host = hostOf(url);
    const tk = `${host}\n${titleKey(r.title)}`;

    // a same-host same-title row that mapped to a DIFFERENT url folds into the first one we kept.
    let key = url;
    if (titleSeen.has(tk) && titleKey(r.title)) key = titleSeen.get(tk);

    if (!byUrl.has(key)) {
      byUrl.set(key, { title: (r.title || '').trim(), url: key, snippet: snip, providers: [...new Set(provs)] });
      if (titleKey(r.title)) titleSeen.set(tk, key);
    } else {
      const e = byUrl.get(key);
      for (const p of provs) if (!e.providers.includes(p)) e.providers.push(p);
      if (snip.length > e.snippet.length) e.snippet = snip;   // keep the richest snippet
      if (!e.title && r.title) e.title = r.title.trim();
    }
  }
  return [...byUrl.values()];
}

// ── scoring ───────────────────────────────────────────────────────────────────────────────────────
// Transparent composite score, every component tagged in `reasons` so the rank is explainable.
// Optional `authority` map (host -> { rank, ageYears }) from domain-insights folds Tranco popularity
// + RDAP age into the score; absent → keyless heuristics only (graceful degrade).
function scoreRow(r, terms, authority) {
  const host = hostOf(r.url);
  const titleLc = (r.title || '').toLowerCase();
  const reasons = [];
  let s = 0;

  // (1) corroboration — each independent engine beyond the first adds weight.
  const corrob = r.providers.length;
  s += corrob;
  if (corrob >= 3) reasons.push(`corroborated by ${corrob} engines`);
  else if (corrob === 2) reasons.push('2 engines agree');

  // (2) scholarly engines (curated academic indexes).
  const scholarly = r.providers.filter((p) => SCHOLARLY_PROVIDERS.has(p));
  if (scholarly.length) { s += 4; reasons.push(`scholarly source (${scholarly.join('/')})`); }

  // (3) OUR ecosystem — surfaced first, like searchAll.
  if (ECOSYSTEM_HOST.test(host)) { s += 6; reasons.push('our ecosystem'); }
  else if (ECOSYSTEM_CHAINS.test(host)) { s += 2.5; reasons.push('community chain'); }

  // (4) query terms present in the title.
  const hits = terms.filter((t) => titleLc.includes(t)).length;
  if (terms.length && hits) { s += Math.min(3, hits) * 1.5; reasons.push(`${hits}/${terms.length} query terms in title`); }

  // (5) reputable / primary-source domain.
  if (AUTHORITY_HOST.test(host) || AUTHORITY_TLD.test('https://' + host + '/')) { s += 3; reasons.push('authoritative domain'); }

  // (6) external authority signals (optional, injected — degrade gracefully if absent).
  const a = authority && (authority[host] || authority[host?.replace(/^www\./, '')]);
  if (a) {
    if (Number.isFinite(a.rank)) {
      // Tranco: lower rank = more popular. log-scaled bonus, capped.
      const bonus = Math.max(0, Math.min(4, (7 - Math.log10(Math.max(1, a.rank))) ));
      if (bonus > 0) { s += bonus; reasons.push(`popularity rank ~${a.rank} (Tranco)`); }
    }
    if (Number.isFinite(a.ageYears)) {
      if (a.ageYears >= 10) { s += 1.5; reasons.push(`established domain (${a.ageYears}y)`); }
      else if (a.ageYears < 0.5) { s -= 1.5; reasons.push('brand-new domain (caution)'); }
    }
  }

  // (7) freshness, only if the caller attached a date/timestamp (no network here).
  const ts = r.publishedAt || r.date || r.published;
  if (ts) {
    const ms = typeof ts === 'number' ? ts : Date.parse(ts);
    if (Number.isFinite(ms)) {
      const days = (Date.now() - ms) / 86400000;
      if (days >= 0 && days <= 365) { s += 1.5 * (1 - days / 365); reasons.push('recent'); }
    }
  }

  // (8) demote SEO-farm / listicle domains + clickbait titles.
  if (SPAM_HOST.test(host)) { s -= 4; reasons.push('low-signal / SEO-farm domain (demoted)'); }
  if (SPAM_TITLE.test(titleLc)) { s -= 2; reasons.push('listicle/clickbait title (demoted)'); }

  // (9) tiny bonus for having a usable snippet (more digestible).
  if (r.snippet) s += 0.5;

  r.score = Math.round(s * 100) / 100;
  r.reasons = reasons;
  r.why = reasons.length ? reasons.join('; ') : `single source (${r.providers[0] || 'unknown'})`;
  return r;
}

/**
 * Dedupe → score → sort. Pure: no network. `query` drives term-in-title matching; `opts.authority`
 * (optional host→{rank,ageYears} map, e.g. assembled from domain-insights) folds in external signals.
 * Returns [{ title, url, snippet, providers[], score, reasons[], why }] sorted best-first.
 */
export function rankResults(raw = [], query = '', { authority = null } = {}) {
  const terms = queryTerms(query);
  const rows = dedupe(raw).map((r) => scoreRow(r, terms, authority));
  return rows.sort((a, b) =>
    b.score - a.score ||
    b.providers.length - a.providers.length ||
    String(a.url).localeCompare(String(b.url)));
}

// ── clustering ──────────────────────────────────────────────────────────────────────────────────
// Group near-duplicate RESULTS (same topic, different page) so the digest shows one line per cluster
// instead of N near-identical links. Cheap + deterministic: a row joins an existing cluster if it
// shares the same registrable-ish host, OR its title token-set overlaps the cluster lead's by ≥60%.
function regHost(host) {
  const parts = String(host || '').split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : host;
}
function tokenSet(s) { return new Set(titleKey(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t))); }
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function cluster(ranked = []) {
  const clusters = [];
  for (const r of ranked) {
    const host = regHost(hostOf(r.url));
    const toks = tokenSet(r.title);
    let placed = null;
    for (const c of clusters) {
      if ((host && c.host && host === c.host) || jaccard(toks, c.tokens) >= 0.6) { placed = c; break; }
    }
    if (placed) { placed.members.push(r); }
    else clusters.push({ host, tokens: toks, lead: r, members: [r] });
  }
  // cluster score = its best member's score; sort clusters by that.
  for (const c of clusters) c.score = c.members[0].score;
  clusters.sort((a, b) => b.score - a.score);
  return clusters;
}

// ── digest ────────────────────────────────────────────────────────────────────────────────────────
// A plain-English summary line per cluster + a one-line overall summary. So a bot/human reads the
// answer instead of scrolling raw links.
function plainSummary(cluster, terms) {
  const lead = cluster.lead;
  const host = hostOf(lead.url);
  const tags = [];
  if (ECOSYSTEM_HOST.test(host)) tags.push('our ecosystem');
  else if (cluster.members.some((m) => m.providers.some((p) => SCHOLARLY_PROVIDERS.has(p)))) tags.push('research source');
  else if (AUTHORITY_HOST.test(host) || AUTHORITY_TLD.test('https://' + host + '/')) tags.push('authoritative');
  const engines = new Set(); for (const m of cluster.members) for (const p of m.providers) engines.add(p);
  const corr = engines.size > 1 ? `${engines.size} engines` : `${[...engines][0] || 'one source'}`;
  const extra = cluster.members.length > 1 ? `, +${cluster.members.length - 1} related` : '';
  const base = lead.snippet ? lead.snippet.replace(/\s+/g, ' ').slice(0, 160) : (lead.title || host);
  const tag = tags.length ? `[${tags.join(', ')}] ` : '';
  return `${tag}${base} (${host}; ${corr}${extra})`.replace(/\s+/g, ' ').trim();
}

/**
 * Digest raw multi-engine results into a readable answer. Pure: no network.
 * Returns { query, count, summary, clusters:[{ lead, members[], summary, hosts[] }] }.
 *   - summary: one-line overview ("12 results across 5 sources; top: …").
 *   - clusters[].summary: plain-English line per topic-cluster.
 * `opts.top` caps clusters returned (default 8); `opts.authority` is forwarded to rankResults.
 */
export function digest(raw = [], query = '', { top = 8, authority = null } = {}) {
  const ranked = rankResults(raw, query, { authority });
  const terms = queryTerms(query);
  const clusters = cluster(ranked).slice(0, top).map((c) => ({
    lead: c.lead,
    members: c.members,
    hosts: [...new Set(c.members.map((m) => hostOf(m.url)).filter(Boolean))],
    score: c.score,
    summary: plainSummary(c, terms),
  }));

  const sources = new Set(); for (const r of ranked) for (const p of r.providers) sources.add(p);
  const lead = ranked[0];
  const summary = ranked.length
    ? `${ranked.length} result${ranked.length === 1 ? '' : 's'} across ${sources.size} source${sources.size === 1 ? '' : 's'}` +
      (lead ? `; top: ${(lead.title || hostOf(lead.url)).slice(0, 80)}` : '') +
      (terms.length ? ` (query: ${terms.join(' ')})` : '')
    : `No results for "${query}".`;

  return { query, count: ranked.length, summary, clusters };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ADDITIVE EXTENSIONS (task #222, OSS-benchmark ADOPT) — NEW exports only. Everything above is
// unchanged: rankResults / dedupe / cluster / digest keep working exactly as before. These add:
//   - rankHybrid(): fuse the existing explainable lexical ranking with a BM25 ranking (and optionally a
//     semantic embeddings ranking) via Reciprocal Rank Fusion — recovers recall the single-signal
//     ranker misses, without a score-scale mismatch.
//   - typo tolerance + proximity reward as extra signals on top of scoreRow().
//   - facets(): provider/host/scholarly/authority counts for a filter UI.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Comparable text for a row: title + snippet (what BM25 / proximity / typo match against).
function rowText(r) {
  return [r && r.title, r && r.snippet].filter((x) => typeof x === 'string' && x).join(' ');
}

/**
 * Typo-tolerant count of how many query terms are present in `text`, allowing bounded-edit-distance
 * matches (Meilisearch-style). Exact hits and 1–2 edit typo hits both count. PURE.
 * Returns { exact, fuzzy, matched:[] } where matched lists the query terms that hit (exact or fuzzy).
 */
export function fuzzyTermHits(text, terms) {
  const toks = String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
  if (!toks.length || !terms.length) return { exact: 0, fuzzy: 0, matched: [] };
  const vocab = new Set(toks);
  let exact = 0;
  let fuzzy = 0;
  const matched = [];
  for (const t of terms) {
    if (vocab.has(t)) { exact++; matched.push(t); continue; }
    const m = typoMatch(t, vocab);            // bounded edit distance, refuses far terms
    if (m && m.distance > 0) { fuzzy++; matched.push(t); }
  }
  return { exact, fuzzy, matched };
}

/**
 * Proximity reward: how close together the matched query terms sit in `text`. Terms that appear within
 * a tight window score higher (a strong relevance signal — Typesense/Meilisearch both rank on it).
 * Returns 0..1 (1 = all matched terms adjacent). PURE. <2 matched terms → 0 (nothing to be near).
 */
export function proximityScore(text, terms) {
  const toks = String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
  if (toks.length < 2 || terms.length < 2) return 0;
  const want = new Set(terms);
  // first position of each distinct matched query term
  const pos = new Map();
  for (let i = 0; i < toks.length; i++) {
    if (want.has(toks[i]) && !pos.has(toks[i])) pos.set(toks[i], i);
  }
  if (pos.size < 2) return 0;
  const positions = [...pos.values()].sort((a, b) => a - b);
  const span = positions[positions.length - 1] - positions[0];   // window covering all matched terms
  const ideal = positions.length - 1;                            // perfectly adjacent
  // 1 when span==ideal (adjacent), decaying toward 0 as the span widens.
  return ideal / Math.max(ideal, span);
}

/**
 * Hybrid ranking: fuse the existing explainable lexical ranking (rankResults) with a BM25 ranking over
 * the same rows, plus typo-tolerance + proximity bonuses, via Reciprocal Rank Fusion. Optionally folds
 * in a semantic embeddings ranking (cheetah-embeddings) when `opts.semantic` is true and the module is
 * available — degrades to lexical+BM25 otherwise.
 *
 * ADDITIVE: rankResults() is untouched and still works alone. This is a new, opt-in path.
 *
 * @returns Promise<[{ ...row, score, reasons[], why, hybridScore, fuseRank }]> best-first.
 *          `score`/`reasons`/`why` are the ORIGINAL explainable signals (preserved); `hybridScore` is
 *          the RRF fusion value that drives the new order. Pure given a fixed (or absent) embedder.
 */
export async function rankHybrid(raw = [], query = '', { authority = null, semantic = false, k = 60 } = {}) {
  const terms = queryTerms(query);
  // (1) the existing explainable lexical ranking (also gives us the deduped, scored rows to return).
  const lexical = rankResults(raw, query, { authority });
  if (!lexical.length) return [];

  // stable id per row for fusion (normalized url is unique post-dedupe).
  const idOf = (r) => r.url;
  const byId = new Map(lexical.map((r) => [idOf(r), r]));

  // (2) BM25 ranking over the same rows (title+snippet). Falls back gracefully if a row has no text.
  const docs = lexical.map((r) => ({ id: idOf(r), text: rowText(r) }));
  const bm25Ranked = bm25Score(buildIndex(docs), query).map((x) => x.id);

  // (3) typo + proximity blended signal → its own ranking (so RRF can weigh it as a list).
  const blended = lexical
    .map((r) => {
      const text = rowText(r);
      const fh = fuzzyTermHits(text, terms);
      const prox = proximityScore(text, terms);
      // record the new signals on the row as extra reasons (explainable, additive — never removes old ones)
      if (fh.fuzzy) r.reasons.push(`${fh.fuzzy} fuzzy term match${fh.fuzzy === 1 ? '' : 'es'}`);
      if (prox >= 0.5) r.reasons.push('query terms near each other');
      r.why = r.reasons.length ? r.reasons.join('; ') : r.why;
      return { id: idOf(r), s: (fh.exact + fh.fuzzy) + prox };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.id);

  const lists = [lexical.map(idOf), bm25Ranked];
  if (blended.length) lists.push(blended);

  // (4) optional semantic ranking via the embeddings module (defensive — absent → skipped).
  if (semantic) {
    const emb = await loadEmbeddings();
    if (emb && typeof emb.rankSources === 'function') {
      try {
        const candidates = lexical.map((r) => ({ id: idOf(r), text: rowText(r) }));
        const sem = await emb.rankSources(query, candidates);
        const semList = sem.map((x) => x.id).filter((id) => byId.has(id));
        if (semList.length) lists.push(semList);
      } catch { /* semantic optional — ignore */ }
    }
  }

  // (5) Reciprocal Rank Fusion of all the ranked lists.
  const fused = rrf(lists, { k });
  const out = [];
  fused.forEach((f, i) => {
    const row = byId.get(f.id);
    if (row) { row.hybridScore = Math.round(f.score * 1e6) / 1e6; row.fuseRank = i; out.push(row); }
  });
  // any row that somehow didn't appear in any list (shouldn't happen) appended in lexical order.
  for (const r of lexical) if (!out.includes(r)) { r.hybridScore = 0; r.fuseRank = out.length; out.push(r); }
  return out;
}

/**
 * Facet counts over a ranked/raw result set for a filter UI. PURE, no network.
 * Returns { total, byProvider:{}, byHost:{}, scholarly, ecosystem, authority }:
 *   - byProvider: count of results carrying each engine/provider.
 *   - byHost: count per result host.
 *   - scholarly / ecosystem / authority: counts of results in those categories.
 * Accepts rows in either raw ({provider}) or merged ({providers[]}) shape; dedupes first for stable
 * counts unless already ranked (rows with a `score` are treated as final).
 */
export function facets(results = []) {
  const rows = (Array.isArray(results) && results.some((r) => r && 'score' in r))
    ? results
    : dedupe(results);
  const byProvider = {};
  const byHost = {};
  let scholarly = 0;
  let ecosystem = 0;
  let authority = 0;
  for (const r of rows) {
    if (!r || !r.url) continue;
    const host = hostOf(r.url);
    if (host) byHost[host] = (byHost[host] || 0) + 1;
    const provs = Array.isArray(r.providers) ? r.providers : (r.provider ? [r.provider] : []);
    for (const p of new Set(provs)) byProvider[p] = (byProvider[p] || 0) + 1;
    if (provs.some((p) => SCHOLARLY_PROVIDERS.has(p))) scholarly++;
    if (ECOSYSTEM_HOST.test(host) || ECOSYSTEM_CHAINS.test(host)) ecosystem++;
    if (AUTHORITY_HOST.test(host) || AUTHORITY_TLD.test('https://' + host + '/')) authority++;
  }
  return { total: rows.length, byProvider, byHost, scholarly, ecosystem, authority };
}

if (process.argv[1] && process.argv[1].endsWith('search-quality.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'alexander shulgin pihkal';
  // tiny offline fixture so the demo needs no network.
  const fixture = [
    { title: 'Alexander Shulgin', url: 'https://en.wikipedia.org/wiki/Alexander_Shulgin', snippet: 'American chemist', provider: 'wikipedia' },
    { title: 'Alexander Shulgin', url: 'http://en.wikipedia.org/wiki/Alexander_Shulgin?utm_source=ddg', snippet: 'chemist and author of PiHKAL', provider: 'duckduckgo' },
    { title: 'Top 10 Facts About Shulgin You Won\'t Believe', url: 'https://listverse.com/2019/shulgin-facts', snippet: 'clickbait', provider: 'duckduckgo' },
    { title: 'PiHKAL phenethylamine synthesis', url: 'https://doi.org/10.1021/abc', snippet: 'peer-reviewed', provider: 'crossref' },
    { title: 'Shulgin on the MELEK Library', url: 'https://wiki.soapbox.community/shulgin', snippet: 'our corpus entry', provider: 'wikipedia' },
  ];
  const d = digest(fixture, q);
  console.log(`SUMMARY: ${d.summary}\n`);
  d.clusters.forEach((c, i) => console.log(`${i + 1}. (${c.score}) ${c.summary}\n   ${c.lead.url}\n   why: ${c.lead.why}`));
}
