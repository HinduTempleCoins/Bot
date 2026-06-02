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

// ── search: keyless web search (DuckDuckGo HTML) → [{title, url, snippet}] ──────────────────────
// Jina Search (s.jina.ai) now needs a key; DuckDuckGo's HTML endpoint is keyless and returns real
// results (incl. forum/Bitcointalk/Altcoinstalks threads — ideal for the link-finder + fact-checker).
const decodeDDG = (href) => {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return ''; } }
  return href.startsWith('//') ? 'https:' + href : href;
};
export async function search(query, { limit = 8 } = {}) {
  if (!query) return [];
  const key = `search:${query}:${limit}`;
  const hit = cache.get(key); if (hit && hit.expires > Date.now()) return hit.value;
  let results = [];
  try {
    // DuckDuckGo's HTML endpoint flags non-browser UAs (returns 202, empty) — use a real browser UA.
    const r = await withTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0' },
    });
    const html = await r.text();
    // titles+urls, then snippets, matched in document order and zipped.
    const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)</g)];
    const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim());
    for (let i = 0; i < links.length && results.length < limit; i++) {
      const url = decodeDDG(links[i][1].replace(/&amp;/g, '&'));
      const title = links[i][2].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim();
      if (url && /^https?:\/\//.test(url) && title) results.push({ title, url, snippet: snips[i] || '' });
    }
  } catch { /* return what we have */ }
  cache.set(key, { value: results, expires: Date.now() + TTL });
  return results;
}

/**
 * search → fetch the top results' clean content → combined evidence. The fact-checker / brief
 * "resource center" entry point: one call gives grounded source material for a query.
 */
export async function research(query, { results = 5, fetchTop = 3, maxChars = 6000 } = {}) {
  const hits = await search(query, { limit: results });
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
  else { const r = await fetchClean(cmd || 'https://example.com'); console.log(`[${r.source}] ${r.title} — ${r.chars} chars\n${r.markdown.slice(0, 600)}`); }
}
