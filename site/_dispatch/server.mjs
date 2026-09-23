// MELEK web dispatcher — one process, routes by Host header to each surface's
// exported handler(req,res). Lets the whole public web tier run off a single node
// process on a non-vault box (Caddy fronts it and reverse_proxies every domain here).
//
// House style: ESM, esc()-free (delegates to each surface), CLI guarded, PORT from env.
// Each surface already exports handler(req,res) and guards its own CLI entry, so importing
// it here is side-effect-free. Unknown hosts soft-fail to 404; a broken surface soft-fails
// to 502 without taking down the others.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..'); // .../site

// A single misbehaving surface (async throw after it loads, a rejected timer, etc.)
// must never take down the whole web tier. Log and keep serving the other 80+.
process.on('uncaughtException', (e) => { try { console.error('[dispatch] uncaughtException:', e && e.message); } catch { /* noop */ } });
process.on('unhandledRejection', (e) => { try { console.error('[dispatch] unhandledRejection:', e && (e.message || e)); } catch { /* noop */ } });

export const ROUTES = JSON.parse(readFileSync(path.join(__dirname, 'routes.json'), 'utf8'));

// dir -> handler (or null if it failed to load). Cached after first resolve.
const _handlers = new Map();

export function hostToDir(host, routes = ROUTES) {
  if (!host) return null;
  const h = String(host).toLowerCase().split(':')[0].replace(/^www\./, '');
  return routes[h] || null;
}

export async function loadHandler(dir, siteRoot = SITE_ROOT) {
  if (_handlers.has(dir)) return _handlers.get(dir);
  let handler = null;
  try {
    const mod = await import(path.join(siteRoot, dir, 'server.mjs'));
    handler = mod.handler || (mod.default && mod.default.handler) || null;
  } catch {
    handler = null;
  }
  _handlers.set(dir, handler);
  return handler;
}

// Central SEO/GEO: serve a welcoming robots.txt and a COMPLETE master sitemap-index for EVERY host we
// route — so all ~87 surfaces are crawlable + AI-findable (GPTBot/ClaudeBot/PerplexityBot/… welcomed) and
// every domain appears in one index, even the surfaces that don't implement these paths themselves.
// Dynamic import + try/catch: if the SEO module is missing this silently falls through to the surface, so
// it can never take the tier down. Per-surface /sitemap.xml (real sub-URLs) and /llms.txt are left intact.
export async function serveSeo(req, res, routes) {
  const p = String(req.url || '/').split('?')[0];
  if (p !== '/robots.txt' && p !== '/sitemap-index.xml' && p !== '/sitemaps.xml') return false;
  const host = String((req.headers && req.headers.host) || '').toLowerCase().split(':')[0].replace(/^www\./, '');
  if (!host) return false;
  try {
    const c = await import('../../integrations/soapbox/crawlers.mjs');
    const base = `https://${host}`;
    if (p === '/robots.txt') {
      const body = `${c.robotsTxt(base)}\nSitemap: ${base}/sitemap-index.xml\n`;
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' });
      res.end(body); return true;
    }
    // master index over every public host we serve (apex/www collapsed, deduped)
    const hosts = [...new Set(Object.keys(routes).map((h) => h.replace(/^www\./, '')))].sort();
    const today = new Date().toISOString().slice(0, 10);
    const body = c.sitemapIndexXml(hosts.map((h) => ({ url: `https://${h}`, lastmod: today })));
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' });
    res.end(body); return true;
  } catch { return false; }
}

// exported so tests can drive it without a live socket
export async function dispatch(req, res, opts = {}) {
  const routes = opts.routes || ROUTES;
  const siteRoot = opts.siteRoot || SITE_ROOT;
  try {
    if (await serveSeo(req, res, routes)) return;
    const dir = hostToDir(req.headers && req.headers.host, routes);
    if (!dir) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('No MELEK surface for this host.');
    }
    const handler = await loadHandler(dir, siteRoot);
    if (!handler) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Surface temporarily unavailable.');
    }
    return await handler(req, res);
  } catch {
    try {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('error');
    } catch { /* headers already sent */ }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = process.env.PORT || 8080;
  http.createServer((req, res) => dispatch(req, res)).listen(PORT, () => {
    console.log(`[dispatch] ${Object.keys(ROUTES).length} surfaces on :${PORT}`);
  });
}
