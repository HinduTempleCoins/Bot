// scraper.mjs — the "resource center" fetch tool. The force-multiplier: it gives the fact-checker
// and the brief/annal writers REAL fetched page content (clean markdown) to ground what they write,
// instead of model memory — the root-cause fix for brief hallucination, the same move that fixed the
// Library's synthesis.
//
// Stack (per the 2026 survey): Jina Reader (r.jina.ai) for clean URL→markdown, keyless + LLM-optimized
// (~67% fewer tokens than raw HTML); a plain-fetch + tag-strip fallback if Jina is unavailable. The
// crawler phase (link-following at scale) is deliberately NOT here yet — that's Crawlee, later.
//
//   import { fetchClean, fetchMany } from './scraper.mjs'
//   const { markdown, title } = await fetchClean('https://en.wikipedia.org/wiki/Alexander_Shulgin')
//   node integrations/scraper.mjs https://example.com

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const JINA = process.env.JINA_READER || 'https://r.jina.ai/';
const cache = new Map();                       // url -> { value, expires }
const TTL = +(process.env.SCRAPER_TTL_MS || 3_600_000);

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function withTimeout(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try { return await _fetch(url, { ...opts, signal: ctrl.signal, headers: { 'user-agent': UA, ...(opts.headers || {}) } }); }
  finally { clearTimeout(t); }
}

// crude HTML → text fallback (used only if Jina is down). Strips scripts/styles/tags, decodes a few entities.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

/**
 * Fetch one URL as clean markdown/text. Returns { url, title, markdown, source, chars }. Cached.
 * `maxChars` truncates for LLM context budgets (default 12k). Never throws — returns markdown:'' on failure.
 */
export async function fetchClean(url, { maxChars = 12000, fresh = false } = {}) {
  if (!/^https?:\/\//.test(url)) return { url, title: '', markdown: '', source: 'invalid', chars: 0 };
  const hit = cache.get(url);
  if (!fresh && hit && hit.expires > Date.now()) return hit.value;
  let out = { url, title: '', markdown: '', source: '', chars: 0 };
  try {
    // primary: Jina Reader → clean markdown
    const r = await withTimeout(`${JINA}${url}`, { headers: { 'x-respond-with': 'markdown' } });
    if (r.ok) {
      const md = (await r.text()).slice(0, maxChars);
      const title = (md.match(/^Title:\s*(.+)$/m) || md.match(/^#\s+(.+)$/m) || [])[1] || '';
      out = { url, title: title.trim(), markdown: md, source: 'jina', chars: md.length };
    } else throw new Error(`jina ${r.status}`);
  } catch {
    try { // fallback: raw fetch + strip
      const r = await withTimeout(url, {});
      const html = await r.text();
      const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
      const text = htmlToText(html).slice(0, maxChars);
      out = { url, title: title.trim(), markdown: text, source: 'fallback', chars: text.length };
    } catch (e) { out = { url, title: '', markdown: '', source: 'error:' + e.message, chars: 0 }; }
  }
  cache.set(url, { value: out, expires: Date.now() + TTL });
  return out;
}

/** Fetch several URLs concurrently (bounded). For a brief's resource list or a fact-check's evidence set. */
export async function fetchMany(urls = [], opts = {}) {
  const limit = opts.concurrency || 4; const out = []; const q = [...urls];
  async function worker() { while (q.length) { const u = q.shift(); out.push(await fetchClean(u, opts)); } }
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, worker));
  return out;
}

// ── screenshot: capture a page as PNG (for the Resource Center + Cheetah's credit/attribution) ──
// Uses Playwright with the system Chromium if available (the box has chromium cached). Graceful:
// returns { ok:false, reason } when Playwright/Chromium aren't installed, so callers degrade cleanly.
// NOTE: PDFs (whitepapers) are already handled by fetchClean() via Jina Reader — no extra step needed.
export async function screenshot(url, { path, fullPage = true, timeout = 30000 } = {}) {
  if (!/^https?:\/\//.test(url)) return { ok: false, reason: 'invalid url' };
  let pw;
  try { pw = await import('playwright'); } catch {
    try { pw = await import('playwright-core'); } catch { return { ok: false, reason: 'playwright not installed (npm i playwright-core where chromium exists)' }; }
  }
  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle', timeout }).catch(() => page.goto(url, { timeout }));
    const buf = await page.screenshot({ fullPage, path, type: 'png' });
    const title = await page.title().catch(() => '');
    return { ok: true, url, title, path: path || null, bytes: buf?.length || 0, capturedAt: new Date().toISOString() };
  } catch (e) { return { ok: false, reason: e.message }; }
  finally { if (browser) await browser.close().catch(() => {}); }
}

// ── search: keyless web search (DuckDuckGo HTML) → [{title, url, snippet}] ──────────────────────
// Jina Search (s.jina.ai) now needs a key; DuckDuckGo's HTML endpoint is keyless and returns real
// results (incl. forum/Bitcointalk/Altcoinstalks threads — ideal for the link-finder + fact-checker).
const decodeDDG = (href) => {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return ''; } }
  return href.startsWith('//') ? 'https:' + href : href;
};
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';

// ── search providers — each returns [{title, url, snippet, provider}] ──
// DuckDuckGo (keyless, default). Google CSE + Brave are keyed (activate when keys are in env/vault).
async function searchDuckDuckGo(query, limit) {
  const r = await withTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'user-agent': BROWSER_UA } });
  const html = await r.text();
  const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)</g)];
  const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim());
  const out = [];
  for (let i = 0; i < links.length && out.length < limit; i++) {
    const url = decodeDDG(links[i][1].replace(/&amp;/g, '&'));
    const title = links[i][2].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim();
    if (url && /^https?:\/\//.test(url) && title) out.push({ title, url, snippet: snips[i] || '', provider: 'duckduckgo' });
  }
  return out;
}
// Google Programmable Search (CSE): needs GOOGLE_SEARCH_API_KEY + GOOGLE_CSE_ID (the cx). 100/day free.
async function searchGoogle(query, limit) {
  const key = process.env.GOOGLE_SEARCH_API_KEY, cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return [];
  const r = await withTimeout(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=${Math.min(10, limit)}`);
  const d = await r.json();
  return (d.items || []).map((i) => ({ title: i.title, url: i.link, snippet: i.snippet || '', provider: 'google' }));
}
// Brave Search API: needs BRAVE_SEARCH_API_KEY. ~2k/mo free.
async function searchBrave(query, limit) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const r = await withTimeout(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(20, limit)}`, { headers: { 'X-Subscription-Token': key, accept: 'application/json' } });
  const d = await r.json();
  return (d.web?.results || []).map((i) => ({ title: i.title, url: i.url, snippet: i.description || '', provider: 'brave' }));
}
// Wikipedia (keyless) — authoritative for entities/biography/science (great fact-check anchor).
async function searchWikipedia(query, limit) {
  const r = await withTimeout(`https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=${limit}&search=${encodeURIComponent(query)}`, { headers: { 'user-agent': UA } });
  const [, titles = [], descs = [], urls = []] = await r.json();
  return titles.map((t, i) => ({ title: t, url: urls[i], snippet: descs[i] || '', provider: 'wikipedia' }));
}

// ── domain knowledge APIs (keyless, authoritative) — chemistry / history / academic fact anchors ──
async function searchPubChem(query, limit) {            // chemistry: compounds + properties
  const r = await withTimeout(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(query)}/property/MolecularFormula,IUPACName/JSON`, { headers: { 'user-agent': UA } });
  if (!r.ok) return [];
  const d = await r.json().catch(() => null);
  return (d?.PropertyTable?.Properties || []).slice(0, limit).map((p) => ({
    title: `${query} — ${p.MolecularFormula || ''} (${p.IUPACName || ''})`.trim(),
    url: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`, snippet: `PubChem CID ${p.CID}; formula ${p.MolecularFormula}`, provider: 'pubchem',
  }));
}
async function searchWikidata(query, limit) {           // structured facts / entities / history / dates
  const r = await withTimeout(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=${limit}&search=${encodeURIComponent(query)}`, { headers: { 'user-agent': UA } });
  const d = await r.json().catch(() => ({}));
  return (d.search || []).map((e) => ({ title: e.label || e.id, url: `https://www.wikidata.org/wiki/${e.id}`, snippet: e.description || '', provider: 'wikidata' }));
}
async function searchCrossRef(query, limit) {           // academic literature (DOIs)
  const r = await withTimeout(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=title,DOI,container-title,published`, { headers: { 'user-agent': UA } });
  const d = await r.json().catch(() => ({}));
  return (d.message?.items || []).map((i) => ({ title: (i.title || [''])[0], url: `https://doi.org/${i.DOI}`, snippet: (i['container-title'] || [''])[0] || '', provider: 'crossref' })).filter((x) => x.title);
}
async function searchPubMed(query, limit) {             // biomedical / pharmacology literature
  const s = await withTimeout(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${limit}&term=${encodeURIComponent(query)}`, { headers: { 'user-agent': UA } });
  const ids = (await s.json().catch(() => ({})))?.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const sum = await withTimeout(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`, { headers: { 'user-agent': UA } });
  const res = (await sum.json().catch(() => ({})))?.result || {};
  return ids.map((id) => res[id]).filter(Boolean).map((a) => ({ title: a.title, url: `https://pubmed.ncbi.nlm.nih.gov/${a.uid}/`, snippet: `${a.source || ''} ${a.pubdate || ''}`.trim(), provider: 'pubmed' }));
}

async function searchOpenAlex(query, limit) {           // scholarly works (keyless, reliable)
  const r = await withTimeout(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}&select=title,doi,id,publication_year,primary_location`, { headers: { 'user-agent': UA } });
  const d = await r.json().catch(() => ({}));
  return (d.results || []).map((w) => ({ title: w.title || '', url: w.doi || w.primary_location?.landing_page_url || w.id, snippet: `${w.primary_location?.source?.display_name || ''} ${w.publication_year || ''}`.trim(), provider: 'openalex' })).filter((x) => x.title && x.url);
}
async function searchSemanticScholar(query, limit) {    // peer-reviewed papers (best-effort; rate-limited without a key)
  const r = await withTimeout(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,url,year,venue`, { headers: { 'user-agent': UA } });
  if (!r.ok) return [];
  const d = await r.json().catch(() => ({}));
  return (d.data || []).map((p) => ({ title: p.title, url: p.url, snippet: `${p.venue || ''} ${p.year || ''}`.trim(), provider: 'semanticscholar' })).filter((x) => x.title && x.url);
}
async function searchArxiv(query, limit) {              // preprints (CS / physics / math — e.g. multi-agent AI)
  const r = await withTimeout(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`, { headers: { 'user-agent': UA } });
  const xml = await r.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, limit).map((m) => {
    const e = m[1];
    const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1].replace(/\s+/g, ' ').trim();
    const url = (e.match(/<id>([^<]+)<\/id>/) || [, ''])[1].trim();
    const snippet = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [, ''])[1].replace(/\s+/g, ' ').trim().slice(0, 160);
    return { title, url, snippet, provider: 'arxiv' };
  }).filter((x) => x.title && x.url);
}

export const PROVIDERS = { duckduckgo: searchDuckDuckGo, google: searchGoogle, brave: searchBrave, wikipedia: searchWikipedia };
// scholarly/authoritative providers — weighted ABOVE general web in searchAll (research > popular opinion).
export const SCHOLARLY = new Set(['crossref', 'pubmed', 'openalex', 'semanticscholar', 'arxiv', 'pubchem', 'wikidata']);
// knowledge providers are queried by searchAll too, but irrelevant ones simply return [] (e.g. PubChem
// for a non-compound query) so they add authoritative depth without noise.
export const KNOWLEDGE = { pubchem: searchPubChem, wikidata: searchWikidata, crossref: searchCrossRef, pubmed: searchPubMed, openalex: searchOpenAlex, semanticscholar: searchSemanticScholar, arxiv: searchArxiv };

/** Single-provider search (default duckduckgo). Cached. */
export async function search(query, { limit = 8, provider = 'duckduckgo' } = {}) {
  if (!query) return [];
  const ck = `search:${provider}:${query}:${limit}`;
  const hit = cache.get(ck); if (hit && hit.expires > Date.now()) return hit.value;
  let results = [];
  const fn = PROVIDERS[provider] || KNOWLEDGE[provider] || searchDuckDuckGo;
  try { results = await fn(query, limit); } catch { /* keep [] */ }
  cache.set(ck, { value: results, expires: Date.now() + TTL });
  return results;
}

/**
 * Aggregate across ALL enabled providers (keyed ones auto-skip if no key) → merged, deduped by URL,
 * ranked by how many providers returned it. The "better set of information" — not one engine's view.
 */
export async function searchAll(query, { limit = 12, knowledge = true } = {}) {
  if (!query) return [];
  const names = knowledge ? [...Object.keys(PROVIDERS), ...Object.keys(KNOWLEDGE)] : Object.keys(PROVIDERS);
  const lists = await Promise.all(names.map((n) => search(query, { limit: 10, provider: n }).catch(() => [])));
  const byUrl = new Map();
  lists.flat().forEach((r) => {
    const k = r.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (!byUrl.has(k)) byUrl.set(k, { ...r, providers: [r.provider] });
    else { const e = byUrl.get(k); if (!e.providers.includes(r.provider)) e.providers.push(r.provider); if (!e.snippet && r.snippet) e.snippet = r.snippet; }
  });
  // rank: scholarly sources weighted ABOVE general web (research papers > popular opinion), then by
  // how many providers agree. A result seen by any SCHOLARLY provider gets a +3 bonus.
  const score = (r) => r.providers.length + (r.providers.some((p) => SCHOLARLY.has(p)) ? 3 : 0);
  return [...byUrl.values()].sort((a, b) => score(b) - score(a) || b.providers.length - a.providers.length).slice(0, limit);
}

/**
 * search → fetch the top results' clean content → combined evidence. The fact-checker / brief
 * "resource center" entry point: one call gives grounded source material for a query.
 */
export async function research(query, { results = 6, fetchTop = 3, maxChars = 6000 } = {}) {
  const hits = await searchAll(query, { limit: results });
  const fetched = await fetchMany(hits.slice(0, fetchTop).map((h) => h.url), { maxChars });
  const byUrl = Object.fromEntries(fetched.map((f) => [f.url, f]));
  return {
    query,
    sources: hits.map((h) => ({ ...h, markdown: byUrl[h.url]?.markdown || '', fetched: !!byUrl[h.url]?.markdown })),
  };
}

if (process.argv[1] && process.argv[1].endsWith('scraper.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'search') { const r = await search(rest.join(' ')); r.forEach((x, i) => console.log(`${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet.slice(0, 120)}`)); }
  else if (cmd === 'research') { const r = await research(rest.join(' ')); console.log(`query: ${r.query}\n`); r.sources.forEach((s) => console.log(`• ${s.title} ${s.fetched ? '✓fetched ' + s.markdown.length + 'ch' : ''}\n  ${s.url}`)); }
  else if (cmd === 'screenshot') { const r = await screenshot(rest[0], { path: rest[1] || '/tmp/shot.png' }); console.log(JSON.stringify(r)); }
  else if (cmd === 'all') { const r = await searchAll(rest.join(' ')); r.forEach((x, i) => console.log(`${i + 1}. [${x.providers.join('+')}] ${x.title}\n   ${x.url}`)); }
  else { const r = await fetchClean(cmd || 'https://example.com'); console.log(`[${r.source}] ${r.title} — ${r.chars} chars\n${r.markdown.slice(0, 600)}`); }
}
