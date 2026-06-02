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

if (process.argv[1] && process.argv[1].endsWith('scraper.mjs')) {
  const r = await fetchClean(process.argv[2] || 'https://example.com');
  console.log(`[${r.source}] ${r.title} — ${r.chars} chars\n${r.markdown.slice(0, 600)}`);
}
