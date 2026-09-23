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

// exported so tests can drive it without a live socket
export async function dispatch(req, res, opts = {}) {
  const routes = opts.routes || ROUTES;
  const siteRoot = opts.siteRoot || SITE_ROOT;
  try {
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
