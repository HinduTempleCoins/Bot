// web-search.mjs — one search/fetch capability over the operator's free research keys, for the
// Resource Center + the Briefs/Annals generators (operator 2026-06-17: "get that … in the Resource
// Center, and the Annals and Briefs").
//
// Providers (keys live in the box server env, never the repo):
//   • Tavily   (TAVILY_API_KEY)    — primary web search, answer-oriented
//   • Exa      (EXA_API_KEY)       — neural search fallback
//   • Firecrawl(FIRECRAWL_API_KEY) — URL → clean markdown (for RAG ingest / reading a page)
//
// Design: injectable fetch (__setFetch), SOFT-FAIL-NEVER-THROW (missing key or network error → empty
// result, never an exception — the brief/RC run must never break on research), normalized output.
// No key configured → returns { ok:false, reason:'no-provider', results:[] } so callers degrade cleanly.

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
/** Test/runtime hook to inject fetch. */
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';
const str = (s) => String(s == null ? '' : s);

async function postJson(url, body, headers = {}) {
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Normalize any provider hit to { title, url, snippet }. */
function norm(title, url, snippet) {
  return { title: str(title).slice(0, 300), url: str(url), snippet: str(snippet).slice(0, 1000) };
}

// ── providers ───────────────────────────────────────────────────────────────────────────────────
async function tavily(query, limit) {
  const key = env('TAVILY_API_KEY');
  if (!key) return null;
  const j = await postJson('https://api.tavily.com/search', {
    api_key: key, query, max_results: limit, search_depth: 'basic',
  });
  if (!j || !Array.isArray(j.results)) return null;
  const results = j.results.map((x) => norm(x.title, x.url, x.content));
  return { provider: 'tavily', answer: str(j.answer), results };
}

async function exa(query, limit) {
  const key = env('EXA_API_KEY');
  if (!key) return null;
  const j = await postJson('https://api.exa.ai/search', {
    query, numResults: limit, contents: { text: { maxCharacters: 800 } },
  }, { 'x-api-key': key });
  if (!j || !Array.isArray(j.results)) return null;
  const results = j.results.map((x) => norm(x.title, x.url, (x.text || (x.highlights && x.highlights[0]) || '')));
  return { provider: 'exa', answer: '', results };
}

/**
 * search(query, { limit }) — Tavily first, Exa fallback. Returns
 * { ok, provider, answer, results:[{title,url,snippet}] }. Never throws; no key → ok:false.
 */
export async function search(query, { limit = 5 } = {}) {
  const q = str(query).trim();
  if (!q) return { ok: false, reason: 'empty-query', results: [] };
  const n = Math.max(1, Math.min(20, Number(limit) || 5));
  const hit = (await tavily(q, n)) || (await exa(q, n));
  if (!hit) return { ok: false, reason: 'no-provider', results: [] };
  return { ok: hit.results.length > 0, ...hit };
}

/**
 * fetchUrl(url) — Firecrawl scrape to clean markdown for RAG/reading. Returns { ok, markdown, title }.
 * Never throws; no key / failure → ok:false.
 */
export async function fetchUrl(url) {
  const u = str(url).trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, reason: 'bad-url', markdown: '' };
  const key = env('FIRECRAWL_API_KEY');
  if (!key) return { ok: false, reason: 'no-firecrawl', markdown: '' };
  const j = await postJson('https://api.firecrawl.dev/v1/scrape',
    { url: u, formats: ['markdown'] }, { authorization: `Bearer ${key}` });
  const data = j && (j.data || j);
  const md = data && (data.markdown || data.content);
  if (!md) return { ok: false, reason: 'no-content', markdown: '' };
  return { ok: true, markdown: str(md), title: str(data.metadata && data.metadata.title) };
}

/** providersConfigured() — which research keys are present (for health/diagnostics). */
export function providersConfigured() {
  return {
    tavily: !!env('TAVILY_API_KEY'),
    exa: !!env('EXA_API_KEY'),
    firecrawl: !!env('FIRECRAWL_API_KEY'),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const q = process.argv.slice(2).join(' ') || 'MELEK blockchain witness';
  search(q).then((r) => console.log(JSON.stringify(r, null, 2)));
}
