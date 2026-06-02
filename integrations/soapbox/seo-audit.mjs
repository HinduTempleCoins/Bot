// seo-audit.mjs — "pre-search-engine" technical SEO checks for our own pages (operator 2026-06-02).
// Crawls a list of our URLs and reports, per page and site-wide, the things a search engine cares about
// BEFORE it will rank us: title/description quality, canonical, indexability, Open Graph/Twitter cards,
// structured data (JSON-LD), one-H1, viewport, lang, hreflang (we're going multilingual), word count,
// internal links, image alt text, and status. Plus site-level: robots.txt + sitemap reachability.
// Pure regex parsing, no deps. Read-only. Feeds the /seo dashboard and (later) the annal/brief writers.

const UA = 'Mozilla/5.0 (compatible; SoapBox-SEO/1.0; +https://data.soapbox.community)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const get = (html, re) => { const m = html.match(re); return m ? (m[1] || '').trim() : ''; };
const all = (html, re) => { const out = []; let m; while ((m = re.exec(html))) out.push(m[1] || m[0]); return out; };
// attribute values may be quoted OR unquoted (valid HTML5) — match both. `name` may contain ':' (og:*).
const metaC = (html, name, attr = 'name') => get(html, new RegExp(`<meta[^>]+${attr}=["']?${name}["']?[^>]*content=["']([^"']*)["']`, 'i'))
  || get(html, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']?${name}["']?`, 'i'));

const OK = 'ok', WARN = 'warn', FAIL = 'fail';

/** Audit one page's HTML. Returns { url, status, checks:[{id,level,msg}], score }. */
export function auditHtml(url, html, status = 200) {
  const c = [];
  const add = (id, level, msg) => c.push({ id, level, msg });

  if (status !== 200) add('status', FAIL, `HTTP ${status}`);
  else add('status', OK, 'HTTP 200');

  const title = get(html, /<title[^>]*>([^<]*)<\/title>/i);
  if (!title) add('title', FAIL, 'No <title>');
  else if (title.length < 10 || title.length > 65) add('title', WARN, `Title ${title.length} chars (aim 10–65): "${title.slice(0, 70)}"`);
  else add('title', OK, `Title ${title.length} chars`);

  const desc = metaC(html, 'description');
  if (!desc) add('description', FAIL, 'No meta description');
  else if (desc.length < 50 || desc.length > 165) add('description', WARN, `Description ${desc.length} chars (aim 50–165)`);
  else add('description', OK, `Description ${desc.length} chars`);

  const canon = get(html, /<link[^>]+rel=["']?canonical["']?[^>]*href=["']([^"']+)["']/i);
  add('canonical', canon ? OK : WARN, canon ? `Canonical → ${canon}` : 'No canonical link');

  const robots = metaC(html, 'robots').toLowerCase();
  if (robots.includes('noindex')) add('indexable', WARN, `meta robots = "${robots}" (noindex — intentional?)`);
  else add('indexable', OK, robots ? `robots: ${robots}` : 'indexable (no robots meta)');

  const h1s = all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  if (h1s.length === 0) add('h1', FAIL, 'No <h1>');
  else if (h1s.length > 1) add('h1', WARN, `${h1s.length} <h1> tags (use one)`);
  else add('h1', OK, 'Exactly one <h1>');

  add('viewport', /name=["']?viewport/i.test(html) ? OK : FAIL, /name=["']?viewport/i.test(html) ? 'Mobile viewport set' : 'No viewport meta (not mobile-ready)');
  const lang = get(html, /<html[^>]+lang=["']?([a-zA-Z-]+)/i);
  add('lang', lang ? OK : WARN, lang ? `lang="${lang}"` : 'No <html lang> (needed for i18n)');

  const og = metaC(html, 'og:title', 'property') && metaC(html, 'og:description', 'property');
  add('opengraph', og ? OK : WARN, og ? 'Open Graph tags present' : 'Missing Open Graph (social cards)');
  const tw = metaC(html, 'twitter:card');
  add('twitter', tw ? OK : WARN, tw ? `twitter:card = ${tw}` : 'No twitter:card');

  const jsonld = /<script[^>]+application\/ld\+json/i.test(html);
  add('structured', jsonld ? OK : WARN, jsonld ? 'JSON-LD structured data present' : 'No structured data (JSON-LD)');

  const hreflang = all(html, /<link[^>]+hreflang=["']([^"']+)["']/gi);
  add('hreflang', hreflang.length ? OK : WARN, hreflang.length ? `hreflang: ${hreflang.length} locales` : 'No hreflang (add when multilingual ships)');

  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  if (words < 100) add('content', WARN, `Thin content (~${words} words)`);
  else add('content', OK, `~${words} words`);

  const links = all(html, /<a[^>]+href=["']([^"']+)["']/gi);
  const internal = links.filter((h) => h.startsWith('/') || h.includes('soapbox.community')).length;
  add('links', internal >= 3 ? OK : WARN, `${internal} internal links, ${links.length - internal} external`);

  const imgs = all(html, /<img\b[^>]*>/gi);
  const noAlt = imgs.filter((t) => !/\balt=/i.test(t)).length;
  if (imgs.length) add('img-alt', noAlt ? WARN : OK, noAlt ? `${noAlt}/${imgs.length} images missing alt` : `all ${imgs.length} images have alt`);

  const fails = c.filter((x) => x.level === FAIL).length, warns = c.filter((x) => x.level === WARN).length;
  const score = Math.max(0, Math.round(100 - fails * 18 - warns * 6));
  return { url, status, checks: c, fails, warns, score };
}

/** Fetch + audit one URL. */
export async function auditPage(url) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    const html = await r.text();
    return auditHtml(url, html, r.status);
  } catch (e) { return { url, status: 0, checks: [{ id: 'fetch', level: FAIL, msg: 'fetch failed: ' + e.message }], fails: 1, warns: 0, score: 0 }; }
}

/** Site-level: robots.txt + sitemap.xml reachability and that robots references the sitemap. */
export async function auditSiteFiles(base) {
  const out = [];
  try {
    const r = await _fetch(`${base}/robots.txt`, { headers: { 'user-agent': UA } });
    const t = await r.text();
    out.push({ id: 'robots', level: r.ok ? OK : FAIL, msg: r.ok ? `robots.txt ok${/sitemap:/i.test(t) ? ' (references sitemap)' : ' (no Sitemap: line)'}` : 'robots.txt missing' });
  } catch { out.push({ id: 'robots', level: FAIL, msg: 'robots.txt unreachable' }); }
  try {
    const r = await _fetch(`${base}/sitemap.xml`, { headers: { 'user-agent': UA } });
    const t = await r.text();
    const n = (t.match(/<loc>/g) || []).length;
    out.push({ id: 'sitemap', level: r.ok && n ? OK : FAIL, msg: r.ok ? `sitemap.xml: ${n} URLs` : 'sitemap.xml missing' });
  } catch { out.push({ id: 'sitemap', level: FAIL, msg: 'sitemap.xml unreachable' }); }
  return out;
}

/** Full audit: site files + each path. Returns { base, site, pages, summary }. */
export async function auditSite(base, paths = ['/']) {
  const site = await auditSiteFiles(base);
  const pages = [];
  for (const p of paths) pages.push(await auditPage(base + p)); // sequential = gentle on our own server
  const avg = pages.length ? Math.round(pages.reduce((a, x) => a + x.score, 0) / pages.length) : 0;
  const fails = pages.reduce((a, x) => a + x.fails, 0) + site.filter((s) => s.level === FAIL).length;
  const warns = pages.reduce((a, x) => a + x.warns, 0) + site.filter((s) => s.level === WARN).length;
  return { base, site, pages, summary: { avgScore: avg, pages: pages.length, fails, warns } };
}

if (process.argv[1] && process.argv[1].endsWith('seo-audit.mjs')) {
  const base = process.argv[2] || 'https://data.soapbox.community';
  const paths = process.argv.slice(3);
  const r = await auditSite(base, paths.length ? paths : ['/', '/commodities', '/macro', '/directory', '/learn']);
  console.log(`\nSEO audit — ${base}   avg score ${r.summary.avgScore}/100   (${r.summary.fails} fails, ${r.summary.warns} warns)`);
  console.log('site:', r.site.map((s) => `${s.level === OK ? '✓' : s.level === WARN ? '!' : '✗'} ${s.msg}`).join('  '));
  for (const p of r.pages) {
    console.log(`\n${p.score}/100  ${p.url}`);
    for (const c of p.checks.filter((x) => x.level !== OK)) console.log(`   ${c.level === WARN ? '!' : '✗'} ${c.msg}`);
  }
}
