// RECOVERED STATIC SNAPSHOT. The original dynamic source for this surface was lost
// (never committed to git, deleted from disk on the production box while the process
// kept running from a deleted inode). It was captured live from the running process
// on 2026-09-23 and is served here as static HTML so the surface survives and can be
// hosted off the vault box. Dynamic behavior (e.g. form POST handling) is NOT preserved;
// rebuild from this snapshot if the surface needs to be interactive again.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP = JSON.parse(readFileSync(path.join(__dirname, 'snapshot.json'), 'utf8'));

export function handler(req, res) {
  try {
    let p = (req.url || '/').split('?')[0];
    if (p.length > 1) p = p.replace(/\/+$/, '') || '/';
    const exact = SNAP[p];
    const hit = exact || SNAP['/'];
    if (!hit) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(exact ? 200 : 404, { 'content-type': hit.ct || 'text/html; charset=utf-8' });
    return res.end(hit.body);
  } catch {
    try { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end('error'); } catch { /* sent */ }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = process.env.PORT || 8080;
  http.createServer(handler).listen(PORT, () => console.log(`[snapshot] serving on :${PORT}`));
}
