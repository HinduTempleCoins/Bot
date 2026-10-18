// site/melek-admin/build.mjs — the Admin Page at https://melek.salon/admin: posts by MELEK's admins, newest
// first. Signed-out visitors to melek.salon land here (melek-extras.js sends them); signed-in people keep the
// normal home page.
//
// Built from the chain on a timer and written as one static file, so the page costs nothing to serve and
// keeps working if the RPC hiccups (the last good build stays up). Own posts only — reblogs are left out.
//
//   ADMIN_ACCOUNTS=vankushfamily,kalivankush ADMIN_OUT=/var/www/melek-admin/index.html node site/melek-admin/build.mjs
//   import { fetchAdminPosts, renderAdminPage } from './build.mjs'   // tests
import { writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const ADMINS = () => env('ADMIN_ACCOUNTS', 'vankushfamily,kalivankush,angelicalist,vankush').split(/[\s,]+/).filter(Boolean);
const RPC = () => env('ADMIN_RPC', 'https://melek.salon/rpc');
const SITE = 'https://melek.salon';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** First image in a post: json_metadata.image[0], else the first markdown/html image in the body. */
export function firstImage(p) {
  try { const m = JSON.parse(p.json_metadata || '{}'); if (Array.isArray(m.image) && m.image[0]) return String(m.image[0]); } catch { /* soft */ }
  const b = String(p.body || '');
  const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(b); if (md) return md[1];
  const im = /<img[^>]+src=["'](https?:\/\/[^"']+)/i.exec(b); if (im) return im[1];
  return '';
}

/** Plain-text excerpt: strip markdown/HTML, collapse whitespace. */
export function excerpt(body, n = 220) {
  const t = String(body || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ').replace(/[#*>`|~]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
}

/** Each admin's own recent top-level posts, merged newest first. Injectable fetch; soft-fail per account. */
export async function fetchAdminPosts({ admins = ADMINS(), rpcUrl = RPC(), fetch: f = globalThis.fetch, perAccount = 20 } = {}) {
  const all = [];
  for (const a of admins) {
    try {
      const r = await f(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_discussions_by_blog', params: [{ tag: a, limit: perAccount }] }) });
      const j = await r.json();
      for (const p of (j && j.result) || []) if (p && p.author === a && !p.parent_author) all.push(p);
    } catch { /* one dead account never empties the page */ }
  }
  const seen = new Set();
  return all.filter((p) => { const k = `${p.author}/${p.permlink}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => String(y.created).localeCompare(String(x.created)));
}

export function renderAdminPage(posts = [], { admins = ADMINS(), builtAt = new Date() } = {}) {
  const cards = posts.length ? posts.map((p) => {
    const url = `${SITE}/${encodeURIComponent(p.category || 'melek')}/@${encodeURIComponent(p.author)}/${encodeURIComponent(p.permlink)}`;
    const img = firstImage(p);
    const date = String(p.created || '').slice(0, 10);
    return `<article class=card><a class=hit href="${esc(url)}">${img ? `<img loading=lazy src="${esc(img)}" alt="">` : ''}
<div class=txt><h2>${esc(p.title || '(untitled)')}</h2><p class=meta>@${esc(p.author)} · ${esc(date)} · in ${esc(p.category || 'melek')}</p>
<p>${esc(excerpt(p.body))}</p></div></a></article>`;
  }).join('\n') : '<p class=empty>No admin posts yet.</p>';
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>MELEK — from the admins</title>
<meta name=description content="The latest posts from MELEK's admins: what is being built, what is live, and what comes next.">
<link rel=canonical href="${SITE}/admin">
<style>
:root{--bg:#f7f8fa;--fg:#1a1d24;--mut:#6b7280;--card:#fff;--line:#e5e7eb;--gold:#f5a623}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1218;--fg:#e5e7eb;--mut:#9ca3af;--card:#161a22;--line:#2a2f3a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line)}
header .brand{font-weight:800;font-size:20px;color:#f39c12;text-decoration:none}
nav a{color:var(--fg);text-decoration:none;margin:0 10px}
.cta{background:#1a1d24;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:700;border-bottom:3px solid var(--gold)}
main{max-width:860px;margin:0 auto;padding:20px 16px}
h1{margin:6px 0 4px}.lead{color:var(--mut);margin:0 0 18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:0 0 14px;overflow:hidden}
.hit{display:flex;gap:14px;color:inherit;text-decoration:none;padding:12px}
.hit img{width:180px;height:120px;object-fit:cover;border-radius:6px;flex:none}
.card h2{font-size:19px;margin:0 0 4px}.meta{color:var(--mut);font-size:13px;margin:0 0 6px}
@media(max-width:600px){.hit{flex-direction:column}.hit img{width:100%;height:180px}}
footer{color:var(--mut);font-size:13px;text-align:center;padding:20px 16px}
.empty{color:var(--mut)}
</style></head><body>
<header><a class=brand href="${SITE}/">MELEK</a><nav><a href="${SITE}/hot">Hot</a><a href="${SITE}/trending">Trending</a><a href="${SITE}/created">New</a><a href="https://pact.pentecaust.com/#groups">Groups</a></nav>
<span><a href="${SITE}/login.html" style="margin-right:10px;color:inherit">Log in</a><a class=cta href="${SITE}/account/signup.html">Sign up</a></span></header>
<main><h1>From the admins</h1>
<p class=lead>What MELEK's admins are building, what is live, and what comes next. Sign up to post, vote and earn MELEK.</p>
${cards}
</main>
<footer>Posts by ${admins.map((a) => '@' + esc(a)).join(', ')} · updated ${esc(builtAt.toISOString().slice(0, 16).replace('T', ' '))} UTC · <a href="${SITE}/created">see everything on MELEK →</a></footer>
</body></html>`;
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs') && process.argv[1].includes('melek-admin')) {
  const out = env('ADMIN_OUT', '/var/www/melek-admin/index.html');
  const posts = await fetchAdminPosts();
  if (!posts.length) { console.log('[admin-page] no posts fetched — keeping the last good page'); process.exit(0); }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out + '.new', renderAdminPage(posts));
  renameSync(out + '.new', out);
  console.log(`[admin-page] ${posts.length} posts -> ${out}`);
}
