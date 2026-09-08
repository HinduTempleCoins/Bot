// pool/www/seo.mjs — robots.txt + sitemap.xml for pool.soapbox.community.
//
// WHY A GENERATOR AND NOT JUST TWO FILES. The pool frontend is STATIC: Caddy serves
// /opt/melek-pool/www with `try_files {path} /index.html`, so a request for /robots.txt or
// /sitemap.xml that has no matching file falls through to the SPA shell. That is exactly the
// failure the crawl audit found — the host answered 200 to both, with HTML. A crawler reading
// `<!DOCTYPE html>` as robots.txt learns nothing, and a sitemap that is not a <urlset> is worse
// than none: it is a broken promise the engine may stop re-fetching.
//
// The fix is real files on disk, but they must not drift from the pages that actually exist. So
// the truth lives here — PAGES + two pure builders — and the committed pool/www/robots.txt and
// pool/www/sitemap.xml are its output. seo.test.mjs asserts the committed files still equal what
// this module produces, so editing one without the other fails the suite.
//
//   node pool/www/seo.mjs --write     # regenerate the two files next to this one
//
// NOTE ON INDEXNOW: the ownership file (/<key>.txt) cannot be env-driven on a static host — there
// is no process to read INDEXNOW_KEY. Drop the key file into /opt/melek-pool/www at deploy time if
// the pool is ever submitted; nothing in this repo generates or holds a key value.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { robotsTxt, sitemapXml } from '../../integrations/soapbox/crawlers.mjs';

export const BASE_URL = (process.env.POOL_BASE_URL || 'https://pool.soapbox.community').replace(/\/$/, '');

// The real, currently-deployed pages. index.html, the My Coins page, and the in-browser wallet.
export const PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/mycoins.html', changefreq: 'weekly', priority: '0.8' },
  { path: '/wallet/', changefreq: 'weekly', priority: '0.8' },
];

/** The robots.txt body. Pure. */
export function poolRobotsTxt(base = BASE_URL) {
  return robotsTxt(base);
}

/** The sitemap.xml body — a spec-valid <urlset>. Pure; `lastmod` is passed in so it is testable. */
export function poolSitemapXml(base = BASE_URL, lastmod = '') {
  return sitemapXml(base, PAGES.map((p) => ({ ...p, ...(lastmod ? { lastmod } : {}) })));
}

/** handler(req,res) — the same two documents over HTTP, for a test or a future dynamic front door. */
export function handler(req, res) {
  let p = '/';
  try { p = new URL(String((req && req.url) || '/'), 'http://localhost').pathname; } catch { p = '/'; }
  if (p === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(poolRobotsTxt());
  }
  if (p === '/sitemap.xml') {
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
    return res.end(poolSitemapXml(BASE_URL, new Date().toISOString().slice(0, 10)));
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  return res.end('not found');
}

export default { BASE_URL, PAGES, poolRobotsTxt, poolSitemapXml, handler };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  if (process.argv.includes('--write')) {
    writeFileSync(join(here, 'robots.txt'), poolRobotsTxt(), 'utf8');
    writeFileSync(join(here, 'sitemap.xml'), poolSitemapXml(), 'utf8');
    console.log(`wrote robots.txt + sitemap.xml for ${BASE_URL} (${PAGES.length} pages)`);
  } else {
    process.stdout.write(poolRobotsTxt() + '\n' + poolSitemapXml());
  }
}
