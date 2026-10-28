// site/yoni/server.mjs — YoniShrine: the adult-facing reference surface.
//
// ⭐ WHY THIS IS A SEPARATE SERVER AND NOT A SECOND INSTANCE OF site/wiki.
// The wiki server always includes site/wiki/seed-articles in its article search path, so pointing a
// second copy at a different ARTICLES_DIR would still serve the entire public Library of Ashurbanipal
// on this host. The two shelves must not bleed into each other: this one has its own article
// directory, its own index, and an age gate the public Library does not have. It reuses the public
// wiki's RENDERER and nothing else.
//
// ⭐ THE GATE IS PER SURFACE, NOT PER SITE.
// integrations/agegate decides what each surface needs. The reference articles here are editorial
// and anatomical — they fail the "lascivious exhibition" element and do not trigger the state
// age-verification statutes on their own — so they are served at level `none`. Galleries, video and
// live, when they exist, declare higher levels and pay for a real check at their own door. Gating
// everything uniformly is how the verification bill becomes the largest line item.
//
// House style: ESM, esc() all interpolation, handler(req,res) exported for tests, CLI guarded.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { renderWiki, slugify, titleize } from '../wiki/render.mjs';
import { policyFor, check as gateCheck, reveal, previewMode } from '../../integrations/agegate/model.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8161);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://yonishrine.com').replace(/\/+$/, '');
const ARTICLES_DIR = process.env.YONI_ARTICLES_DIR || path.join(__dir, 'articles');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Articles live in one directory and nowhere else — see the note above. */
export function listArticles(dir = ARTICLES_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.wiki')).sort(); } catch { return []; }
  return files.map((f) => {
    const slug = f.replace(/\.wiki$/, '');
    let bytes = 0;
    try { bytes = fs.statSync(path.join(dir, f)).size; } catch { /* ignore */ }
    return { slug, title: titleize(slug), file: path.join(dir, f), bytes };
  });
}

export function readArticle(slug, dir = ARTICLES_DIR) {
  const safe = String(slug || '').replace(/[^A-Za-z0-9_.-]/g, '');
  if (!safe || safe.includes('..')) return null;
  try { return fs.readFileSync(path.join(dir, `${safe}.wiki`), 'utf8'); } catch { return null; }
}

const STYLE = `<style>
:root{--bg:#120d14;--panel:#1b141d;--line:#312436;--ink:#ece6ef;--mut:#a294ab;--acc:#d4a5c8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 Georgia,'Iowan Old Style',serif}
header{border-bottom:1px solid var(--line);padding:14px 20px;display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
header a{color:var(--acc);text-decoration:none;font-weight:bold}
header span{color:var(--mut);font-size:14px}
main{max-width:860px;margin:0 auto;padding:22px 20px 60px}
h1{font-size:30px;line-height:1.25;margin:.2em 0 .5em}
h2{font-size:22px;border-bottom:1px solid var(--line);padding-bottom:4px;margin-top:1.6em}
h3{font-size:18px;margin-top:1.3em}
a{color:var(--acc)}
table{border-collapse:collapse;margin:1em 0;width:100%;font-size:15px}
th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
th{background:#241a27}
code,pre{background:#0f0b11;border:1px solid var(--line);border-radius:6px;padding:2px 6px;font-family:ui-monospace,Menlo,monospace;font-size:13px}
pre{padding:10px;overflow:auto}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.mut{color:var(--mut)}
ul.idx{list-style:none;padding:0}
ul.idx li{border-bottom:1px solid var(--line);padding:10px 0}
ul.idx a{font-size:18px}
</style>`;

const shell = (title, body, desc = '') => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=rating content="adult">
<meta name=robots content="noindex,nofollow">
${STYLE}</head><body>
<header><a href="/">YoniShrine</a><span>reference shelf</span></header>
<main>${body}</main></body></html>`;

function indexPage() {
  const arts = listArticles();
  const rows = arts.map((a) => `<li><a href="/a/${esc(a.slug)}">${esc(a.title)}</a>
    <div class=mut>${(a.bytes / 1024).toFixed(0)} KB</div></li>`).join('');
  return shell('YoniShrine — reference', `
<h1>Reference shelf</h1>
<p class=mut>Source material and legal reference. These pages are editorial and anatomical: they are
served without an age gate because they do not meet the "lascivious exhibition" element that triggers
record-keeping, and they do not on their own trigger the state age-verification statutes. Other
surfaces on this property declare their own level.</p>
<ul class=idx>${rows || '<li class=mut>No articles yet.</li>'}</ul>
<div class=card><b>Not legal advice.</b> <span class=mut>These pages describe statutes and decided
cases. They do not substitute for a lawyer admitted in the relevant jurisdiction.</span></div>`,
    'Reference shelf: law, rights and source material.');
}

function articlePage(slug) {
  const src = readArticle(slug);
  if (src == null) return null;
  let html = '';
  try { html = renderWiki(src).html; } catch { html = '<p>Could not render this page.</p>'; }
  const title = titleize(slug);
  return shell(`${title} — YoniShrine`, `<h1>${esc(title)}</h1>${html}
<p class=mut><a href="/">← back to the shelf</a></p>`, title);
}

export async function handler(req, res) {
  let url;
  try { url = new URL(req.url || '/', 'http://x'); } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('bad url');
  }
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const html = (code, body) => {
    res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' });
    res.end(body);
  };

  if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

  // Deliberately not indexed while the property is being assembled.
  if (p === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('User-agent: *\nDisallow: /\n');
  }

  if (p === '/gate') {
    const surface = url.searchParams.get('surface') || 'wiki';
    const who = url.searchParams.get('subject') || '';
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, surface, policy: policyFor(surface), state: gateCheck(who, surface) }));
  }

  if (p === '/') return html(200, indexPage());

  if (p.startsWith('/a/')) {
    const page = articlePage(p.slice(3));
    return page ? html(200, page) : html(404, shell('Not found — YoniShrine', '<h1>Not found</h1><p class=mut><a href="/">← back to the shelf</a></p>'));
  }

  return html(404, shell('Not found — YoniShrine', '<h1>Not found</h1><p class=mut><a href="/">← back to the shelf</a></p>'));
}

export { policyFor, reveal, previewMode };

if (process.argv[1] && process.argv[1].endsWith('site/yoni/server.mjs')) {
  createServer(handler).listen(PORT, HOST, () =>
    console.log(`YoniShrine on ${BASE_URL} (bound ${HOST}:${PORT}, ${listArticles().length} articles)`));
}
