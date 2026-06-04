// pubmed.mjs — the SoapBox biomedical-literature vertical. A reader over two keyless federal sources:
//   • NIH PubMed E-utilities (esearch → esummary)  — 38M+ citations of biomedical research literature
//   • ClinicalTrials.gov v2 (NIH)                  — registered / active clinical trials
//
// This is the "read the research" surface: peer-reviewed article hits + the trials studying a condition.
// It is DISTINCT from pharma.mjs (drug identity / labels / adverse events / RxNorm). Pharma answers
// "what is this drug"; pubmed answers "what does the literature say / what's being studied" — citations
// and trial registrations, not advice.
//
// Pattern follows cdc-health.mjs + biodiversity.mjs: ESM, an injectable __setFetch() seam, every reader
// SOFT-FAILS (returns [] / null — never throws), an as-of timestamp, a guarded CLI, HTML-escaped
// rendering, and NO secrets. E-utilities are KEYLESS; an NCBI API key only RAISES the rate limit and is
// referenced by env NAME only (never a literal). INFORMATIONAL ONLY: research literature, not advice.
//
//   import { searchPubmed, trials, articleDetail, summary, renderPage, dataNote } from './pubmed.mjs'
//   node integrations/soapbox/pubmed.mjs search "psilocybin depression"
//   node integrations/soapbox/pubmed.mjs trials "major depressive disorder"

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
const SOURCE = 'NIH PubMed / ClinicalTrials.gov';

// Env NAME of the optional NCBI E-utilities API key. We read process.env BY THIS NAME — there is no
// literal key in this file, and a missing key simply means we hit the keyless (lower, ~3 req/s) limit.
export const NCBI_API_KEY_ENV = 'NCBI_API_KEY';

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Endpoint roots — kept in one place so a base-URL change is a one-line edit.
export const ENDPOINTS = {
  eutils: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
  clinicaltrials: 'https://clinicaltrials.gov/api/v2', // CURRENT v2 API (the legacy /api/query is retired)
};

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape for safe HTML interpolation (strict-conventions requirement).
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// fetch JSON with soft-fail: any network/parse/non-ok error resolves to null, never throws.
async function getJSON(url, headers = { 'user-agent': UA, accept: 'application/json' }) {
  try {
    const r = await _fetch(url, { headers });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// fetch TEXT with soft-fail: any network/parse/non-ok error resolves to '' (never throws). Used by the
// efetch abstract call, which returns plain text rather than JSON.
async function getText(url, headers = { 'user-agent': UA, accept: 'text/plain' }) {
  try {
    const r = await _fetch(url, { headers });
    if (!r || !r.ok) return '';
    return String((await r.text()) || '').trim();
  } catch { return ''; }
}

// Append the NCBI api_key param IF (and only if) its env var is set — read by name, never a literal.
// Keyless still works; the key just raises the per-second rate limit.
function withApiKey(params) {
  const key = process.env[NCBI_API_KEY_ENV];
  if (key) params.set('api_key', key);
  return params;
}

// Pull a 4-digit year out of a pubdate-ish string ("2024 May 3", "2024", "2024-05" …).
function yearOf(s) {
  const m = String(s == null ? '' : s).match(/(\d{4})/);
  return m ? num(m[1]) : null;
}

// ── PubMed: searchPubmed(query) — esearch → esummary ─────────────────────────────────────────────────
// Two-step E-utilities flow: esearch resolves the query to a list of PMIDs; esummary then fetches the
// document summaries for those PMIDs. We normalize the (numeric-keyed) esummary result into stable rows.
// Soft-fails to [] at every step (no PMIDs, dead network, malformed JSON → []).
export async function searchPubmed(query, { limit = 20 } = {}) {
  const q = str(query);
  if (!q) return [];
  const lim = Math.max(1, Math.min(100, num(limit) || 20));
  return cached(`pubmed:search:${q.toLowerCase()}:${lim}`, TTL.list, async () => {
    // step 1 — esearch: query → PMIDs
    const sp = withApiKey(new URLSearchParams({
      db: 'pubmed', term: q, retmax: String(lim), retmode: 'json', sort: 'relevance',
    }));
    const sj = await getJSON(`${ENDPOINTS.eutils}/esearch.fcgi?${sp.toString()}`);
    const ids = sj?.esearchresult?.idlist;
    if (!Array.isArray(ids) || ids.length === 0) return [];

    // step 2 — esummary: PMIDs → document summaries
    const up = withApiKey(new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'json' }));
    const uj = await getJSON(`${ENDPOINTS.eutils}/esummary.fcgi?${up.toString()}`);
    const result = uj?.result;
    if (!result || typeof result !== 'object') return [];

    const order = Array.isArray(result.uids) ? result.uids : ids;
    return order
      .map((pmid) => result[pmid])
      .filter((rec) => rec && typeof rec === 'object')
      .map((rec) => {
        const pmid = str(rec.uid) || null;
        const authors = Array.isArray(rec.authors)
          ? rec.authors.map((a) => str(a?.name)).filter(Boolean)
          : [];
        return {
          pmid,
          title: str(rec.title) || null,
          authors,
          journal: str(rec.fulljournalname || rec.source) || null,
          year: yearOf(rec.pubdate || rec.sortpubdate || rec.epubdate),
          url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null,
          source: 'PubMed (NIH/NLM)',
        };
      })
      .filter((x) => x.pmid);
  });
}

// ── PubMed: articleDetail(pmid) — a fuller single-record view ─────────────────────────────────────────
// One esummary call for a single PMID, normalized into a richer record (adds DOI, volume/issue/pages,
// publication types, abstract-source link). Soft-fails to null.
export async function articleDetail(pmid) {
  const id = str(pmid);
  if (!id) return null;
  return cached(`pubmed:detail:${id}`, TTL.metadata, async () => {
    const up = withApiKey(new URLSearchParams({ db: 'pubmed', id, retmode: 'json' }));
    const uj = await getJSON(`${ENDPOINTS.eutils}/esummary.fcgi?${up.toString()}`);
    const rec = uj?.result?.[id];
    if (!rec || typeof rec !== 'object') return null;
    const authors = Array.isArray(rec.authors)
      ? rec.authors.map((a) => str(a?.name)).filter(Boolean)
      : [];
    const doi = Array.isArray(rec.articleids)
      ? str(rec.articleids.find((a) => str(a?.idtype) === 'doi')?.value) || null
      : null;

    // esummary carries metadata but NOT the abstract — fetch it with a keyless efetch (rettype=abstract,
    // retmode=text). Soft-fails to '' (so the detail still returns its metadata if the abstract is
    // unavailable). The abstract is the article's OWN published summary, informational only.
    const ap = withApiKey(new URLSearchParams({ db: 'pubmed', id, rettype: 'abstract', retmode: 'text' }));
    const abstractText = await getText(`${ENDPOINTS.eutils}/efetch.fcgi?${ap.toString()}`);

    return {
      pmid: str(rec.uid) || id,
      title: str(rec.title) || null,
      authors,
      journal: str(rec.fulljournalname || rec.source) || null,
      year: yearOf(rec.pubdate || rec.sortpubdate || rec.epubdate),
      pubdate: str(rec.pubdate) || null,
      volume: str(rec.volume) || null,
      issue: str(rec.issue) || null,
      pages: str(rec.pages) || null,
      doi,
      doiUrl: doi ? `https://doi.org/${doi}` : null,
      abstract: abstractText || null,
      pubTypes: Array.isArray(rec.pubtype) ? rec.pubtype.map(str).filter(Boolean) : [],
      url: `https://pubmed.ncbi.nlm.nih.gov/${str(rec.uid) || id}/`,
      source: 'PubMed (NIH/NLM)',
    };
  });
}

// ── ClinicalTrials.gov v2: trials({ condition, status }) ──────────────────────────────────────────────
// CURRENT v2 endpoint: /api/v2/studies?query.term=...&format=json. Each study nests under
// protocolSection; we pull the fields a list view needs (NCT id, title, status, phase, conditions).
// Optional client-side status filter (e.g. RECRUITING). Soft-fails to [].
export async function trials({ condition, status, limit = 20 } = {}) {
  const cond = str(condition);
  if (!cond) return [];
  const want = str(status).toUpperCase();
  const lim = Math.max(1, Math.min(100, num(limit) || 20));
  return cached(`pubmed:trials:${cond.toLowerCase()}:${want}:${lim}`, TTL.list, async () => {
    const u = `${ENDPOINTS.clinicaltrials}/studies?query.term=${encodeURIComponent(cond)}` +
      `&pageSize=${lim}&format=json`;
    const j = await getJSON(u);
    const rows = j?.studies;
    if (!Array.isArray(rows)) return [];
    return rows
      .map((s) => {
        const ps = s?.protocolSection || {};
        const id = ps.identificationModule || {};
        const st = ps.statusModule || {};
        const design = ps.designModule || {};
        const cm = ps.conditionsModule || {};
        const desc = ps.descriptionModule || {};
        const elig = ps.eligibilityModule || {};
        const nct = str(id.nctId) || null;
        return {
          nctId: nct,
          title: str(id.briefTitle || id.officialTitle) || null,
          status: str(st.overallStatus) || null,
          phase: Array.isArray(design.phases) ? design.phases.map(str).filter(Boolean) : [],
          conditions: Array.isArray(cm.conditions) ? cm.conditions.map(str).filter(Boolean) : [],
          // the protocolSection we already fetched also carries the study's plain-language summary and its
          // eligibility criteria — surface them so a trial card answers "what is this / can I join" without
          // a second request. Soft-default to null when absent.
          briefSummary: str(desc.briefSummary) || null,
          eligibilityCriteria: str(elig.eligibilityCriteria) || null,
          url: nct ? `https://clinicaltrials.gov/study/${nct}` : null,
          source: 'ClinicalTrials.gov v2 (NIH)',
        };
      })
      .filter((x) => x.nctId)
      .filter((x) => !want || str(x.status).toUpperCase() === want);
  });
}

// ── Headline snapshot ────────────────────────────────────────────────────────────────────────────────
// Pure aggregation (no I/O) over already-fetched data: { articles:[...], trials:[...] }. Tallies article
// counts by year and trial counts by status.
export function summary(data = {}) {
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const trialRows = Array.isArray(data.trials) ? data.trials : [];

  const byYear = {};
  for (const a of articles) {
    const y = a && a.year != null ? String(a.year) : 'unknown';
    byYear[y] = (byYear[y] || 0) + 1;
  }
  const byStatus = {};
  for (const t of trialRows) {
    const s = t && str(t.status) ? str(t.status) : 'unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  const years = articles.map((a) => a && a.year).filter((y) => y != null);

  return {
    articleCount: articles.length,
    trialCount: trialRows.length,
    byYear,
    byStatus,
    latestYear: years.length ? Math.max(...years) : null,
    earliestYear: years.length ? Math.min(...years) : null,
    asOf: new Date().toISOString(),
  };
}

// ── Provenance / disclaimer note ─────────────────────────────────────────────────────────────────────
export function dataNote(asOf) {
  const when = str(asOf) || new Date().toISOString().slice(0, 10);
  return `source: ${SOURCE}, as of ${when}; informational, not medical advice`;
}

// ── Render an escaped HTML section ───────────────────────────────────────────────────────────────────
// data = { articles:[{pmid,title,authors,journal,year,url}], trials:[{nctId,title,status,phase,...}] }.
// EVERY interpolated value is HTML-escaped. Returns a self-contained <section>.
export function renderPage(data = {}) {
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const trialRows = Array.isArray(data.trials) ? data.trials : [];
  const s = summary(data);

  const artItems = articles.slice(0, 25).map((a) => {
    const auth = Array.isArray(a.authors) && a.authors.length
      ? esc(a.authors.slice(0, 3).join(', ') + (a.authors.length > 3 ? ', et al.' : ''))
      : '';
    const meta = [esc(a.journal || ''), a.year != null ? esc(String(a.year)) : '']
      .filter(Boolean).join(' · ');
    const title = a.url
      ? `<a href="${esc(a.url)}" rel="noopener">${esc(a.title || a.pmid || '')}</a>`
      : esc(a.title || a.pmid || '');
    return `    <li class="article"><span class="title">${title}</span>`
      + (auth ? ` <span class="authors">${auth}</span>` : '')
      + (meta ? ` <span class="meta">${meta}</span>` : '')
      + `</li>`;
  }).join('\n');
  const artList = artItems
    ? `  <h3>Research literature (PubMed)</h3>\n  <ul class="articles">\n${artItems}\n  </ul>`
    : '';

  const trialItems = trialRows.slice(0, 25).map((t) => {
    const phase = Array.isArray(t.phase) && t.phase.length ? esc(t.phase.join(', ')) : '';
    const title = t.url
      ? `<a href="${esc(t.url)}" rel="noopener">${esc(t.title || t.nctId || '')}</a>`
      : esc(t.title || t.nctId || '');
    return `    <li class="trial"><span class="title">${title}</span>`
      + ` <span class="nct">${esc(t.nctId || '')}</span>`
      + (t.status ? ` <span class="status">${esc(t.status)}</span>` : '')
      + (phase ? ` <span class="phase">${phase}</span>` : '')
      + `</li>`;
  }).join('\n');
  const trialList = trialItems
    ? `  <h3>Active &amp; registered trials (ClinicalTrials.gov)</h3>\n  <ul class="trials">\n${trialItems}\n  </ul>`
    : '';

  return [
    '<section class="pubmed">',
    '  <h2>Biomedical Research</h2>',
    `  <p class="counts">${esc(String(s.articleCount))} article(s) · ${esc(String(s.trialCount))} trial(s)</p>`,
    artList,
    trialList,
    '  <p class="disclaimer">Informational only — research literature, not medical advice.</p>',
    `  <p class="note">${esc(dataNote(s.asOf))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

// ── CLI: node integrations/soapbox/pubmed.mjs <search|trials|detail|page> <query|pmid> ────────────────
if (process.argv[1] && process.argv[1].endsWith('pubmed.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const q = rest.join(' ');
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  if (cmd === 'search') out('pubmed search', await searchPubmed(q || 'psilocybin depression'));
  else if (cmd === 'trials') out('clinical trials', await trials({ condition: q || 'major depressive disorder' }));
  else if (cmd === 'detail') out('article detail', await articleDetail(q));
  else if (cmd === 'page') {
    const [articles, trialRows] = await Promise.all([
      searchPubmed(q || 'psilocybin depression').catch(() => []),
      trials({ condition: q || 'psilocybin depression' }).catch(() => []),
    ]);
    console.log(renderPage({ articles, trials: trialRows }));
  } else console.log('usage: pubmed.mjs <search <query>|trials <condition>|detail <pmid>|page <query>>');
}
