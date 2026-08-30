// melek-sitemap.mjs — generate sitemap.xml for melek.salon from live chain content, so search engines
// can crawl every post + the key pages ("MELEK.salon indexed all over the Internet"). READ-ONLY, soft-fail.
//
//   node site/melek-sitemap.mjs > /var/www/melek-seo/sitemap.xml   # (a timer regenerates it)
//
// buildSitemap(urls) is pure + testable; fetchPostUrls() pulls recent posts across active tags.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

const RPC = () => process.env.MELEK_RPC_URL || 'https://melek.salon/rpc';
const BASE = () => (process.env.MELEK_CONDENSER_URL || 'https://melek.salon').replace(/\/$/, '');
const ACTIVE_TAGS = ['melek', 'vankush', 'move', 'life', 'photography', 'art', 'crypto', 'hive', 'story', 'news'];
const STATIC_PAGES = ['/', '/created', '/trending', '/hot', '/@hathor', '/@melek', '/kula-paper'];

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** Pure: build a urlset XML from {loc, lastmod?, priority?} entries (deduped by loc). */
export function buildSitemap(entries) {
  const seen = new Set(); const rows = [];
  for (const e of entries || []) {
    const loc = e && e.loc; if (!loc || seen.has(loc)) continue; seen.add(loc);
    rows.push('  <url><loc>' + xmlEsc(loc) + '</loc>'
      + (e.lastmod ? '<lastmod>' + xmlEsc(e.lastmod) + '</lastmod>' : '')
      + (e.priority != null ? '<priority>' + e.priority + '</priority>' : '')
      + '</url>');
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + rows.join('\n') + '\n</urlset>\n';
}

async function rpc(method, params) {
  try {
    const r = await _fetch(RPC(), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.' + method, params }) });
    const j = await r.json(); return j && 'result' in j ? j.result : null;
  } catch { return null; }
}

/** Pull recent post URLs across the active tags. Returns [{loc, lastmod, priority}]. */
export async function fetchPostUrls({ perTag = 40 } = {}) {
  const base = BASE();
  const batches = await Promise.all(ACTIVE_TAGS.map((tag) =>
    Promise.resolve().then(() => rpc('get_discussions_by_created', [{ tag, limit: perTag }])).catch(() => null)));
  const seen = new Set(); const out = [];
  for (const b of (batches || [])) for (const p of (Array.isArray(b) ? b : [])) {
    if (!p.author || !p.permlink) continue;
    const loc = `${base}/@${p.author}/${p.permlink}`;
    if (seen.has(loc)) continue; seen.add(loc);
    out.push({ loc, lastmod: (p.created || '').split('T')[0] || undefined, priority: '0.6' });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = BASE();
  const statics = STATIC_PAGES.map((p) => ({ loc: base + p, priority: p === '/' ? '1.0' : '0.8' }));
  const posts = await fetchPostUrls({});
  process.stdout.write(buildSitemap([...statics, ...posts]));
}
