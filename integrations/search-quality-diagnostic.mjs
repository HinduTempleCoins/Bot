// search-quality-diagnostic.mjs — Resource-Center search QUALITY + digestibility DIAGNOSTIC (task #132).
//
// The metasearch layer (integrations/soapbox/search-quality.mjs → rankResults/digest) PRODUCES ranked,
// clustered results. This module is the complementary HEALTH check: given the aggregated rows for a
// query (the same {title, url, snippet, provider/providers} shape that search-quality consumes), it
// SCORES how good and how digestible those results are and FLAGS quality problems — so the operator
// can see, at a glance, whether the Resource Center's search is actually returning usable answers.
//
// It does NOT re-implement ranking/clustering (that's search-quality.mjs's job). It grades the OUTPUT:
//   scoreResult(result, query)   → { relevance, sourceQuality, digestibility, dedup, overall } 0..1, pure
//   diagnose(query, results)     → averages + grade A..F + flagged problems
//   runDiagnostic(queries, {search}) → probe a set of queries through an INJECTED search → health report
//   digestibilityHint(result)    → a fix suggestion for a poor result
//   healthBlock(report)          → brief-ready "### Search quality" markdown
//
// The scoring MATH is pure + deterministic — no network. The search source is INJECTED so tests run
// fully offline: pass { search } to runDiagnostic, or set the module default via __setSearch(fn).
// Soft-fail throughout: a query that throws becomes a graded "thin/empty" entry, the pass completes.
//
//   import { scoreResult, diagnose, runDiagnostic, healthBlock } from './integrations/search-quality-diagnostic.mjs'
//   node integrations/search-quality-diagnostic.mjs            # offline demo on a fixture

// ── source-authority tables (mirrors search-quality.mjs so this module is self-contained) ──────────
const AUTHORITY_TLD  = /\.(edu|gov|mil|int|ac\.[a-z]{2}|gov\.[a-z]{2}|edu\.[a-z]{2})(\/|$|:)/i;
const AUTHORITY_HOST = /(^|\.)(wikipedia\.org|wikidata\.org|wikimedia\.org|britannica\.com|nature\.com|science\.org|sciencedirect\.com|springer\.com|jstor\.org|arxiv\.org|doi\.org|ncbi\.nlm\.nih\.gov|pubmed\.|who\.int|un\.org|nasa\.gov|archive\.org|stanford\.edu|mit\.edu|ietf\.org|rfc-editor\.org|crossref\.org|openalex\.org)/i;
const ECOSYSTEM_HOST = /(^|\.)(soapbox\.community|vankush\.|melek\.|kalivankush\.|hindutemple)/i;
const SPAM_HOST      = /(^|\.)(pinterest\.|quora\.com|answers\.com|ehow\.com|wikihow\.com|buzzfeed\.|listverse\.com|ranker\.com|thetoptens\.com|examples?\.com|geeksforgeeks\.org|w3schools\.com|tutorialspoint\.com|brainly\.|coursehero\.com|studocu\.com|slideshare\.net|scribd\.com|.*\.blogspot\.|.*\.wordpress\.com)/i;
const SPAM_TITLE     = /\b(top|best)\s+\d+\b|\b\d+\s+(best|top|ways|things|reasons|tips|tricks|hacks)\b|you won'?t believe|click ?bait/i;
const CITATION       = /\b(doi|isbn|arxiv|pmid|et al\.?|\[\d+\]|\(\d{4}\)|vol\.?\s*\d+|pp?\.\s*\d+)\b/i;

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'is', 'are', 'what', 'how', 'why', 'who', 'with', 'de', 'la', 'el', 'le', 'der', 'die', 'das']);

const clamp01 = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const r2 = (n) => Math.round(n * 100) / 100;

function hostOf(url) {
  try { return new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch { return ''; }
}
function queryTerms(query) {
  return String(query || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2 && !STOP.has(t));
}
function titleKey(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function providersOf(r) {
  return Array.isArray(r?.providers) ? r.providers.filter(Boolean) : (r?.provider ? [r.provider] : []);
}

// ── per-result scoring (pure, deterministic) ───────────────────────────────────────────────────────
/**
 * Score a single aggregated result against the query. Every sub-score is 0..1.
 *   relevance     — query-term coverage across title + snippet.
 *   sourceQuality — reputable domain / scholarly provider / has-citation; SEO-farm + clickbait demote.
 *   digestibility — snippet length in a readable band (not thin, not a wall of text), title present.
 *   dedup         — 1.0 unless `_dupOf` is set by diagnose() (near-duplicate of an earlier row).
 *   overall       — weighted blend.
 * Pure: no network, no shared state. `query` may be '' (relevance then neutral-low).
 */
export function scoreResult(result = {}, query = '') {
  const terms = queryTerms(query);
  const host = hostOf(result.url);
  const title = String(result.title || '');
  const snippet = String(result.snippet || '');
  const hay = (title + ' ' + snippet).toLowerCase();
  const provs = providersOf(result);

  // relevance — fraction of distinct query terms that appear, with a small bonus for title hits.
  let relevance;
  if (!terms.length) {
    relevance = 0.5; // no query to match against → neutral, don't punish.
  } else {
    const hit = terms.filter((t) => hay.includes(t)).length;
    const titleHit = terms.filter((t) => title.toLowerCase().includes(t)).length;
    relevance = clamp01((hit / terms.length) * 0.8 + (titleHit / terms.length) * 0.2);
  }

  // sourceQuality — authority/scholarly/citation up; spam/clickbait down. Centered near 0.5.
  let sq = 0.45;
  if (AUTHORITY_HOST.test(host) || AUTHORITY_TLD.test('https://' + host + '/')) sq += 0.35;
  if (ECOSYSTEM_HOST.test(host)) sq += 0.15;
  if (provs.some((p) => /crossref|pubmed|arxiv|openalex|semanticscholar|core|doaj|scholar/i.test(p))) sq += 0.25;
  if (CITATION.test(snippet) || CITATION.test(title)) sq += 0.1;
  if (provs.length >= 3) sq += 0.1; else if (provs.length === 2) sq += 0.05;
  if (SPAM_HOST.test(host)) sq -= 0.45;
  if (SPAM_TITLE.test(title)) sq -= 0.2;
  if (!host) sq -= 0.3; // no parseable source at all.
  const sourceQuality = clamp01(sq);

  // digestibility — readable snippet length + a real title. Band: ~60..280 chars is the sweet spot.
  let dg = 0;
  const len = snippet.trim().length;
  if (len === 0) dg = 0.1;                       // nothing to read.
  else if (len < 40) dg = 0.45;                  // too thin.
  else if (len <= 300) dg = 1.0;                 // digestible.
  else if (len <= 600) dg = 0.7;                 // long-ish.
  else dg = 0.4;                                 // wall of text.
  if (title.trim()) dg = Math.min(1, dg + 0.1); else dg = Math.max(0, dg - 0.2);
  // penalize obvious markup left in the snippet (poor cleaning = poor digestibility).
  if (/<[a-z][^>]*>|&[a-z]+;/i.test(snippet)) dg -= 0.2;
  const digestibility = clamp01(dg);

  // dedup — diagnose() marks near-dupes via `_dupOf`; standalone scoring treats the row as unique.
  const dedup = result._dupOf ? 0 : 1;

  const overall = clamp01(
    relevance * 0.40 + sourceQuality * 0.30 + digestibility * 0.20 + dedup * 0.10,
  );
  return {
    relevance: r2(relevance),
    sourceQuality: r2(sourceQuality),
    digestibility: r2(digestibility),
    dedup: r2(dedup),
    overall: r2(overall),
  };
}

// ── near-duplicate detection (for dedupRate) ───────────────────────────────────────────────────────
function regHost(host) { const p = String(host || '').split('.'); return p.length > 2 ? p.slice(-2).join('.') : host; }
function tokenSet(s) { return new Set(titleKey(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t))); }
function jaccard(a, b) { if (!a.size || !b.size) return 0; let i = 0; for (const t of a) if (b.has(t)) i++; return i / (a.size + b.size - i); }

// Mark rows that are near-duplicates of an EARLIER row (same normalized url, same host+title, or a
// ≥0.7 title-token overlap on the same registrable host). Mutates copies, never the inputs.
function markDuplicates(results = []) {
  const out = results.map((r) => ({ ...r }));
  const seenUrl = new Set();
  const kept = []; // { rhost, toks, idx }
  for (const r of out) {
    const host = hostOf(r.url);
    const url = (r.url || '').split('#')[0].replace(/[?&]utm_[^=]+=[^&]*/gi, '').replace(/[?&]$/, '');
    const toks = tokenSet(r.title);
    let dup = false;
    if (url && seenUrl.has(url)) dup = true;
    if (!dup) {
      for (const k of kept) {
        if (host && k.rhost === regHost(host) && jaccard(toks, k.toks) >= 0.7) { dup = true; break; }
      }
    }
    if (dup) r._dupOf = true;
    else { if (url) seenUrl.add(url); kept.push({ rhost: regHost(host), toks }); }
  }
  return out;
}

// ── per-query diagnosis ────────────────────────────────────────────────────────────────────────────
function gradeFor(overall) {
  if (overall >= 0.85) return 'A';
  if (overall >= 0.70) return 'B';
  if (overall >= 0.55) return 'C';
  if (overall >= 0.40) return 'D';
  return 'F';
}

/**
 * Diagnose the quality + digestibility of one query's aggregated results. Pure: no network.
 * Returns { query, n, avgRelevance, avgSourceQuality, avgDigestibility, avgOverall, duplicateRate,
 *           lowQualityCount, grade, problems[], scores[] }.
 */
export function diagnose(query = '', results = []) {
  const rows = markDuplicates(Array.isArray(results) ? results : []);
  const n = rows.length;
  if (!n) {
    return {
      query, n: 0, avgRelevance: 0, avgSourceQuality: 0, avgDigestibility: 0, avgOverall: 0,
      duplicateRate: 0, lowQualityCount: 0, grade: 'F',
      problems: ['thin results — no results returned for this query'], scores: [],
    };
  }
  const scores = rows.map((r) => scoreResult(r, query));
  const avg = (k) => r2(scores.reduce((a, s) => a + s[k], 0) / n);
  const avgRelevance = avg('relevance');
  const avgSourceQuality = avg('sourceQuality');
  const avgDigestibility = avg('digestibility');
  const avgOverall = avg('overall');
  const dupCount = rows.filter((r) => r._dupOf).length;
  const duplicateRate = r2(dupCount / n);
  const lowQualityCount = scores.filter((s) => s.sourceQuality < 0.4).length;

  const problems = [];
  if (n < 3) problems.push(`thin results — only ${n} result${n === 1 ? '' : 's'}`);
  if (avgRelevance < 0.4) problems.push(`low relevance — query terms barely appear (avg ${avgRelevance})`);
  if (lowQualityCount / n >= 0.5) problems.push(`too many low-quality sources — ${lowQualityCount}/${n} are weak/SEO-farm`);
  if (duplicateRate >= 0.3) problems.push(`high duplicate rate — ${Math.round(duplicateRate * 100)}% near-duplicates`);
  const tooLong = scores.filter((s) => s.digestibility <= 0.4).length;
  const tooThin = rows.filter((r) => String(r.snippet || '').trim().length > 0 && String(r.snippet || '').trim().length < 40).length;
  if (tooLong / n >= 0.4) problems.push(`snippets too long — ${tooLong}/${n} are walls of text`);
  if (tooThin / n >= 0.4) problems.push(`snippets too short — ${tooThin}/${n} are too thin to be useful`);
  if (avgDigestibility < 0.5) problems.push(`hard to digest — average snippet readability is low (${avgDigestibility})`);

  return {
    query, n, avgRelevance, avgSourceQuality, avgDigestibility, avgOverall,
    duplicateRate, lowQualityCount, grade: gradeFor(avgOverall), problems, scores,
  };
}

// ── injected search source (offline-by-default for tests) ──────────────────────────────────────────
let _search = null;
/** Inject the search function used by runDiagnostic: async (query) => results[] | { results[] }. */
export function __setSearch(fn) { _search = typeof fn === 'function' ? fn : null; }

function resultsFrom(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.results)) return raw.results;
  if (raw && Array.isArray(raw.rows)) return raw.rows;
  return [];
}

const DEFAULT_PROBES = [
  'alexander shulgin pihkal',
  'hive engine token clarity',
  'graphene witness block production',
  'shaivite temple history',
];

/**
 * Run a set of probe queries through the INJECTED search, diagnose each, and aggregate a health report.
 * Soft-fail: a query whose search throws is graded as empty (thin). Pure aside from the injected I/O.
 * Returns { ts, queries:n, avgOverall, avgRelevance, avgSourceQuality, avgDigestibility, avgDuplicateRate,
 *           grade, perQuery:[{query,grade,n,avgOverall,problems}], problems[] }.
 */
export async function runDiagnostic(queries = DEFAULT_PROBES, { search } = {}) {
  const fn = typeof search === 'function' ? search : _search;
  const probes = (Array.isArray(queries) && queries.length) ? queries : DEFAULT_PROBES;
  const perQuery = [];
  for (const q of probes) {
    let results = [];
    if (fn) {
      try { results = resultsFrom(await fn(q)); } catch { results = []; }
    }
    const d = diagnose(q, results);
    perQuery.push({
      query: q, grade: d.grade, n: d.n,
      avgOverall: d.avgOverall, avgRelevance: d.avgRelevance,
      avgSourceQuality: d.avgSourceQuality, avgDigestibility: d.avgDigestibility,
      duplicateRate: d.duplicateRate, problems: d.problems,
    });
  }
  const k = perQuery.length || 1;
  const mean = (key) => r2(perQuery.reduce((a, p) => a + (p[key] || 0), 0) / k);
  const avgOverall = mean('avgOverall');
  // surface the most common problems across probes, deduped, most-frequent first.
  const counts = new Map();
  for (const p of perQuery) for (const pr of p.problems) {
    const tag = pr.split('—')[0].trim(); // collapse to the problem class.
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const problems = [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([tag, c]) => `${tag}${c > 1 ? ` (${c} queries)` : ''}`);

  return {
    ts: new Date().toISOString(),
    queries: perQuery.length,
    avgOverall,
    avgRelevance: mean('avgRelevance'),
    avgSourceQuality: mean('avgSourceQuality'),
    avgDigestibility: mean('avgDigestibility'),
    avgDuplicateRate: mean('duplicateRate'),
    grade: gradeFor(avgOverall),
    perQuery,
    problems,
  };
}

// ── per-result improvement hint ────────────────────────────────────────────────────────────────────
/** Plain suggestion to improve a single poor result (most-impactful fix first). Pure. */
export function digestibilityHint(result = {}, query = '') {
  const s = scoreResult(result, query);
  const len = String(result.snippet || '').trim().length;
  if (result._dupOf) return 'drop near-duplicate (already covered by an earlier result)';
  if (len === 0) return 'add a snippet — there is nothing to read';
  if (len < 40) return 'expand snippet — too thin to summarize';
  if (len > 600) return 'trim snippet — too long to scan, cut to ~1–2 sentences';
  if (/<[a-z][^>]*>|&[a-z]+;/i.test(result.snippet)) return 'clean snippet — strip leftover HTML/entities';
  if (s.sourceQuality < 0.4) return 'add citation or prefer a more authoritative source';
  if (s.relevance < 0.4) return 'low relevance — verify it actually matches the query';
  if (!String(result.title || '').trim()) return 'add a title for this result';
  return 'looks good — no change needed';
}

// ── brief-ready markdown ─────────────────────────────────────────────────────────────────────────
const GRADE_MARK = { A: '🟢', B: '🟢', C: '🟡', D: '🟠', F: '🔴' };

/** Render a runDiagnostic() report as a brief-ready "### Search quality" markdown block. */
export function healthBlock(report) {
  if (!report) return '### Search quality\n\nNo diagnostic data.';
  const L = [];
  L.push('### Search quality');
  L.push(`${GRADE_MARK[report.grade] || ''} Overall grade **${report.grade}** (${report.avgOverall}) across ${report.queries} probe ${report.queries === 1 ? 'query' : 'queries'}.`);
  L.push(`Relevance ${report.avgRelevance} · source quality ${report.avgSourceQuality} · digestibility ${report.avgDigestibility} · duplicate rate ${Math.round((report.avgDuplicateRate || 0) * 100)}%.`);
  if (Array.isArray(report.perQuery) && report.perQuery.length) {
    L.push('');
    for (const p of report.perQuery) {
      L.push(`- **${p.grade}** \`${p.query}\` — ${p.n} result${p.n === 1 ? '' : 's'}, overall ${p.avgOverall}${p.problems.length ? ` · ${p.problems[0]}` : ''}`);
    }
  }
  if (Array.isArray(report.problems) && report.problems.length) {
    L.push('');
    L.push('Top problems: ' + report.problems.slice(0, 5).join('; ') + '.');
  }
  L.push('');
  L.push('*Diagnostic: search-quality-diagnostic.mjs · scores result health, advisory only.*');
  return L.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('search-quality-diagnostic.mjs')) {
  // offline demo — a tiny canned search so the CLI needs no network.
  __setSearch(async (q) => [
    { title: 'Alexander Shulgin', url: 'https://en.wikipedia.org/wiki/Alexander_Shulgin', snippet: 'American chemist and author who synthesized and bioassayed hundreds of psychoactive compounds; wrote PiHKAL (1991).', provider: 'wikipedia' },
    { title: 'PiHKAL synthesis', url: 'https://doi.org/10.1021/abc', snippet: 'Peer-reviewed phenethylamine synthesis route. doi:10.1021/abc (1991).', provider: 'crossref' },
    { title: 'Top 10 Facts You Won\'t Believe', url: 'https://listverse.com/x', snippet: 'clickbait', provider: 'duckduckgo' },
    { title: 'Alexander Shulgin', url: 'http://en.wikipedia.org/wiki/Alexander_Shulgin?utm_source=ddg', snippet: 'American chemist', provider: 'duckduckgo' },
  ]);
  const report = await runDiagnostic([process.argv.slice(2).join(' ') || 'alexander shulgin pihkal']);
  console.log(healthBlock(report));
}
