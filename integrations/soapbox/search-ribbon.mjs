// search-ribbon.mjs — Search.SoapBox ribbon storefront (queue #130): the vertical-tabs search
// surface. Like a search engine with a row of category tabs (Web · Images · News · Library · Crypto
// · Gov · …), plus two distinguishing controls: a Hathor "AI Mode" toggle (when on, the result page
// leads with a synthesized answer, not just blue links) and a Clarity-score filter slider (drop
// results below a chosen transparency threshold — the Clarity Score from clarity.mjs surfaced as a
// search facet).
//
// This is the DATA + RENDER layer only — a standalone module. Wiring it into server.mjs (routes,
// layout) is a later step. The actual search work is delegated to an injectable searcher so tests
// run fully offline; in production that searcher is backed by scraper.mjs (searchAll / per-provider)
// and resource-center / library backends, each routed by the active tab.
//
// Conventions (matching the rest of integrations/soapbox/): ESM, everything ESCAPED on the way out,
// soft-fail (never throws — a broken searcher yields empty results), injectable searcher for tests,
// CLI guarded on the filename.
//
//   import { RIBBON_TABS, search, renderRibbon, renderResults } from './search-ribbon.mjs'
//   const res = await search('blockchain', { tab: 'crypto', aiMode: true, minClarity: 50 });
//   const html = renderRibbon({ active: 'crypto', query: 'blockchain' }) + renderResults(res);
//   node integrations/soapbox/search-ribbon.mjs crypto "blockchain"

// ── escape (same shape as render.mjs / verticals.mjs) ───────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── the ribbon tabs ─────────────────────────────────────────────────────────────────────────────
// Each { key, label, route }. Ordered general → specialized so the row reads like a search engine's
// tab strip. `route` is where the wired server will mount the vertical; the keys MATCH the real
// SoapBox verticals (site/soapbox/verticals.mjs) where one exists, so the ribbon and the page agree.
export const RIBBON_TABS = [
  { key: 'web', label: 'Web', route: '/search' },
  { key: 'images', label: 'Images', route: '/images' },
  { key: 'news', label: 'News', route: '/news' },
  { key: 'library', label: 'Library', route: '/library' },
  { key: 'crypto', label: 'Crypto', route: '/crypto' },
  { key: 'gov', label: 'Gov', route: '/gov' },
  { key: 'legal', label: 'Legal', route: '/legal' },
  { key: 'weather', label: 'Weather', route: '/weather' },
  { key: 'maps', label: 'Maps', route: '/maps' },
  { key: 'bio', label: 'Bio', route: '/biodiversity' },
  { key: 'pharma', label: 'Pharma', route: '/pharma' },
  { key: 'energy', label: 'Energy', route: '/energy' },
];

const TAB_KEYS = new Set(RIBBON_TABS.map((t) => t.key));
const tabFor = (key) => RIBBON_TABS.find((t) => t.key === key) || RIBBON_TABS[0];

// ── injectable searcher ─────────────────────────────────────────────────────────────────────────
// A searcher is `async (query, { tab, aiMode, minClarity }) => results | { results, ai }` where
// results is [{ title, url, snippet, clarity? }]. In production this is backed by scraper.mjs and the
// library/resource backends, routed by `tab`. Tests inject a canned one via __setSearcher.
let _searcher = null;
export function __setSearcher(fn) { _searcher = typeof fn === 'function' ? fn : null; }

// Normalize whatever the searcher returns into { results, ai }. Accepts an array (results only) or an
// object with { results, ai }/{ results, aiAnswer }. Anything malformed degrades to empty results.
function normalizeSearcherOutput(out) {
  if (Array.isArray(out)) return { results: out, ai: '' };
  if (out && typeof out === 'object') {
    const results = Array.isArray(out.results) ? out.results : [];
    const ai = out.ai || out.aiAnswer || '';
    return { results, ai };
  }
  return { results: [], ai: '' };
}

// Coerce one raw hit into a clean result row. clarity is kept only when it's a finite number.
function shapeResult(r) {
  if (!r || typeof r !== 'object') return null;
  const title = String(r.title || r.name || '').trim();
  const url = String(r.url || r.link || '').trim();
  if (!title && !url) return null;
  const out = { title: title || url, url, snippet: String(r.snippet || r.description || '').trim() };
  const c = Number(r.clarity);
  if (Number.isFinite(c)) out.clarity = c;
  return out;
}

/** Pure helper: keep only results whose clarity score is >= minClarity. Results WITHOUT a clarity
 *  score pass through untouched when minClarity is 0, and are dropped when a positive floor is set
 *  (an unscored result can't prove it clears the bar). Never throws. */
export function clarityFilter(results, minClarity = 0) {
  const list = Array.isArray(results) ? results : [];
  const floor = Number(minClarity) || 0;
  if (floor <= 0) return list.slice();
  return list.filter((r) => Number.isFinite(Number(r?.clarity)) && Number(r.clarity) >= floor);
}

/**
 * Run a search for one tab. Calls the injected searcher, shapes + (optionally) clarity-filters the
 * results, and — when aiMode is on — attaches an aiAnswer (from the searcher's `ai` field, or a stub
 * note that Hathor AI Mode would synthesize one). Soft-fails to empty results; never throws.
 *
 * @returns {Promise<{query,tab,results:[{title,url,snippet,clarity?}],aiAnswer?}>}
 */
export async function search(query, { tab = 'web', aiMode = false, minClarity = 0 } = {}) {
  const q = String(query == null ? '' : query).trim();
  const tabKey = TAB_KEYS.has(tab) ? tab : 'web';
  const base = { query: q, tab: tabKey, results: [] };
  if (!q || !_searcher) {
    if (aiMode) base.aiAnswer = aiAnswerFor(q, tabKey, base.results, '');
    return base;
  }

  let raw;
  try {
    raw = await _searcher(q, { tab: tabKey, aiMode: !!aiMode, minClarity: Number(minClarity) || 0 });
  } catch { raw = null; }                                  // soft-fail: searcher blew up → empty

  const { results: rawResults, ai } = normalizeSearcherOutput(raw);
  let results = rawResults.map(shapeResult).filter(Boolean);
  const floor = Number(minClarity) || 0;
  if (floor > 0) results = clarityFilter(results, floor);

  const out = { query: q, tab: tabKey, results };
  if (aiMode) out.aiAnswer = aiAnswerFor(q, tabKey, results, ai);
  return out;
}

// The AI answer: prefer the searcher's own synthesized `ai` text; otherwise a stub making the AI-Mode
// behavior explicit (the wired version will hand results to Hathor for synthesis).
function aiAnswerFor(query, tab, results, ai) {
  if (ai && String(ai).trim()) return String(ai).trim();
  if (!query) return 'Hathor AI Mode: enter a query and Hathor will synthesize an answer from the results.';
  const n = results.length;
  return `Hathor AI Mode synthesizes an answer for “${query}” from ${n} ${tab} result${n === 1 ? '' : 's'}. `
    + `(Synthesis is wired to Hathor in Phase 3; this is the AI-Mode answer slot.)`;
}

// ── render: the tab ribbon + controls ───────────────────────────────────────────────────────────
const clarityMarks = [0, 25, 50, 75];

/**
 * The ribbon bar: the search box, the row of vertical tabs (active one highlighted), the AI-Mode
 * toggle, and the Clarity slider control. Returns escaped HTML. Never throws.
 */
export function renderRibbon({ active = 'web', query = '', aiMode = false, minClarity = 0 } = {}) {
  const activeKey = TAB_KEYS.has(active) ? active : 'web';
  const q = String(query == null ? '' : query);
  const activeTab = tabFor(activeKey);

  const tabs = RIBBON_TABS.map((t) => {
    const on = t.key === activeKey;
    const href = `${esc(t.route)}?q=${encodeURIComponent(q)}`;
    return `<a class="ribbon-tab${on ? ' active' : ''}"${on ? ' aria-current="page"' : ''} `
      + `data-tab="${esc(t.key)}" href="${href}">${esc(t.label)}</a>`;
  }).join('');

  const slider = `<label class="ribbon-clarity">Clarity ≥ `
    + `<input type="range" name="minClarity" min="0" max="100" step="5" value="${esc(String(Number(minClarity) || 0))}" `
    + `list="ribbon-clarity-marks" aria-label="Minimum Clarity score">`
    + `<output class="ribbon-clarity-val">${esc(String(Number(minClarity) || 0))}</output>`
    + `<datalist id="ribbon-clarity-marks">${clarityMarks.map((m) => `<option value="${m}">`).join('')}</datalist>`
    + `</label>`;

  const aiToggle = `<label class="ribbon-ai"><input type="checkbox" name="aiMode" value="1"`
    + `${aiMode ? ' checked' : ''} aria-label="Hathor AI Mode"> <span>Hathor AI Mode</span></label>`;

  return `<div class="search-ribbon">`
    + `<form class="ribbon-form" method="get" action="${esc(activeTab.route)}" role="search">`
    + `<input class="ribbon-q" type="search" name="q" value="${esc(q)}" placeholder="Search SoapBox…" `
    + `autocomplete="off" aria-label="Search query">`
    + `<button class="ribbon-go" type="submit">Search</button>`
    + `<div class="ribbon-controls">${aiToggle}${slider}</div>`
    + `</form>`
    + `<nav class="ribbon-tabs" aria-label="Search verticals">${tabs}</nav>`
    + `</div>`;
}

// ── render: the results list ────────────────────────────────────────────────────────────────────
const clarityBand = (c) => (c >= 80 ? 'high' : c >= 55 ? 'moderate' : c >= 30 ? 'limited' : 'opaque');

function clarityBadge(c) {
  const v = Number(c);
  if (!Number.isFinite(v)) return '';
  const band = clarityBand(v);
  return `<span class="clarity-badge clarity-${esc(band)}" title="Clarity Score — legibility, not endorsement">`
    + `Clarity ${esc(String(Math.round(v)))} · ${esc(band)}</span>`;
}

function resultRow(r) {
  const title = esc(r.title || r.url || 'Untitled');
  const link = r.url
    ? `<a class="result-title" href="${esc(r.url)}" target="_blank" rel="noopener nofollow">${title}</a>`
    : `<span class="result-title">${title}</span>`;
  const host = r.url ? `<span class="result-url">${esc(hostOf(r.url))}</span>` : '';
  const snip = r.snippet ? `<p class="result-snippet">${esc(r.snippet)}</p>` : '';
  return `<li class="result">${link} ${clarityBadge(r.clarity)} ${host}${snip}</li>`;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return url; }
}

/**
 * Render a search() result object as escaped HTML: the AI-answer box (when present), then the results
 * list with Clarity badges. Empty results render a friendly "no results" line. Never throws.
 */
export function renderResults(searchResult) {
  const sr = searchResult && typeof searchResult === 'object' ? searchResult : {};
  const results = Array.isArray(sr.results) ? sr.results : [];
  const query = String(sr.query || '');

  const aiBox = sr.aiAnswer
    ? `<div class="ai-answer" role="note"><span class="ai-answer-label">Hathor AI Mode</span>`
      + `<p class="ai-answer-text">${esc(sr.aiAnswer)}</p></div>`
    : '';

  if (!results.length) {
    const msg = query
      ? `<p class="results-empty">No results for “${esc(query)}”.</p>`
      : `<p class="results-empty">Enter a query to search.</p>`;
    return `<div class="search-results">${aiBox}${msg}</div>`;
  }

  const list = `<ol class="results-list">${results.map(resultRow).join('')}</ol>`;
  return `<div class="search-results">${aiBox}${list}</div>`;
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('search-ribbon.mjs')) {
  // Live CLI: wire the production searcher (scraper.mjs searchAll), then run a query.
  const tab = process.argv[2] || 'web';
  const query = process.argv.slice(3).join(' ') || 'blockchain';
  try {
    const { searchAll } = await import('../scraper.mjs');
    __setSearcher(async (q) => {
      const hits = await searchAll(q, { limit: 10 }).catch(() => []);
      return { results: hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet })) };
    });
  } catch { /* no scraper available — search() will soft-fail to empty */ }
  const res = await search(query, { tab, aiMode: true });
  console.log(`Tabs: ${RIBBON_TABS.map((t) => t.key).join(' · ')}\n`);
  console.log(`Query: ${res.query} [${res.tab}]  (${res.results.length} results)`);
  if (res.aiAnswer) console.log(`AI: ${res.aiAnswer}`);
  res.results.forEach((r, i) => console.log(`${i + 1}. ${r.title}\n   ${r.url}`));
}
