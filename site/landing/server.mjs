// server.mjs — site/landing: a public "where is it?" landing page that SURFACES things already built
// but that the operator couldn't find — specifically:
//   1) the Hathor Welcome / intro post (`@hathor/introducing-hathor-on-melek` on the testnet), and
//   2) the latest CheetahAdvanced run results (the alpha-report / policing-run output).
//
// The page does ZERO network on its own. Data is supplied via injected READERS (the house seam):
//   __setWelcomeReader(async () => ({ ...welcomePost }))
//   __setCheetahReader(async () => ({ ...cheetahResults }))
// Both readers soft-fail (never throw) — a missing/empty reader just renders a graceful "not wired yet"
// state so the page is always useful. renderLanding({welcomePost, cheetahResults}) is the pure view and
// esc()s every interpolation. handler(req,res) is exported for tests; the CLI is guarded by process.argv[1].
//
//   PORT=8120 BASE_URL=https://melek.salon node site/landing/server.mjs
//
// Shapes (all fields optional — the view degrades gracefully):
//   welcomePost   = { author, permlink, title, url, blurb, body, created, votes, payout }
//   cheetahResults = { generatedAt, source, summary?:{scanned,matches,credited,flagged}, url,
//                      results:[ { title, platform, status, score, url, note } ] }

import { createServer } from 'node:http';

const PORT = +(process.env.PORT || 8120);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Sibling sites we link out to — overridable by env, plain public URLs only (no hostnames/IPs baked in).
const WITNESS_SITE = (process.env.WITNESS_SITE || 'https://witness.melek.salon').replace(/\/$/, '');
const CHEETAH_SITE = (process.env.CHEETAH_SITE || 'https://alpha.melek.salon/cheetah').replace(/\/$/, '');
const COMMANDS_SITE = (process.env.COMMANDS_SITE || 'https://alpha.melek.salon/commands').replace(/\/$/, '');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── injectable readers (the only data source; page itself does no network) ──────
// Defaults return null so an un-wired deploy renders the graceful empty state.
let welcomeReader = async () => null;
let cheetahReader = async () => null;
export function __setWelcomeReader(fn) { welcomeReader = fn; }
export function __setCheetahReader(fn) { cheetahReader = fn; }
export function __resetReaders() { welcomeReader = async () => null; cheetahReader = async () => null; }

// soft-fail-never-throw wrapper around a reader
async function safeRead(fn) {
  try { const v = await fn(); return v || null; } catch { return null; }
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--dn:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:880px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:18px;margin:0 0 8px} .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:16px 0}
  .blurb{font-size:15px;color:var(--fg);margin:6px 0 12px}
  .meta{color:var(--mut);font-size:13px;margin:0 0 10px;display:flex;gap:14px;flex-wrap:wrap}
  .btn{display:inline-block;background:var(--blue);color:#06101f;font-weight:700;border-radius:8px;padding:9px 18px;margin:4px 8px 0 0}
  .btn:hover{text-decoration:none;opacity:.92} .btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line2)}
  .btn.ghost:hover{border-color:var(--blue);color:var(--blue)}
  table{width:100%;border-collapse:collapse;margin:8px 0;font-size:14px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--mut);font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td.n{font-variant-numeric:tabular-nums;text-align:right}
  .pill{font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;border:1px solid var(--line2);color:var(--mut);white-space:nowrap}
  .pill.credited{color:var(--up);border-color:#3fb95066} .pill.flagged{color:var(--gold);border-color:#d2992266}
  .pill.match{color:var(--blue);border-color:#58a6ff44} .pill.clear{color:var(--mut)}
  .stats{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 12px}
  .stat{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;padding:10px 14px;min-width:90px}
  .stat .v{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums} .stat .k{color:var(--mut);font-size:12px}
  .empty{color:var(--mut);font-size:14px;padding:6px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:28px;margin-top:24px}
</style>`;

const pageShell = (title, body) => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="MELEK landing — find the Hathor Witness welcome post and the latest CheetahAdvanced run results in one place.">
<meta name=robots content="index,follow"><link rel=canonical href="${esc(BASE_URL)}/">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">◈ MELEK <span>landing</span></a>
  <div class=topbar-r><a href="${esc(WITNESS_SITE)}" title="Witness School">Witness</a><a href="${esc(CHEETAH_SITE)}" title="CheetahAdvanced reports">Cheetah</a><a href="${esc(COMMANDS_SITE)}" title="Command menu demo">Commands</a></div></header>
<main class=wrap>${body}</main>
<footer>MELEK · Hathor AI Witness. This page only surfaces things already built. <a href="${esc(WITNESS_SITE)}">Witness</a> · <a href="${esc(CHEETAH_SITE)}">Cheetah</a> · <a href="${esc(COMMANDS_SITE)}">Commands</a></footer></body></html>`;

// ── Welcome section ─────────────────────────────────────────────────────────────
function welcomeSection(post) {
  if (!post) {
    return `<section class=card id=welcome><h2>👋 Hathor's Welcome post</h2>
      <p class=empty>Not wired yet — once a welcome-post reader is connected, the intro post will appear here with a link to the chain.</p>
      <a class="btn ghost" href="${esc(WITNESS_SITE)}">Visit the Witness School →</a></section>`;
  }
  const author = (post.author || 'hathor').replace(/^@/, '');
  const permlink = post.permlink || '';
  // Prefer an explicit url; otherwise build a readable @author/permlink reference.
  const ref = author && permlink ? `@${author}/${permlink}` : (post.url || '');
  const link = post.url || WITNESS_SITE; // explicit url wins; otherwise point at the Witness site
  const blurb = post.blurb || (post.body ? String(post.body).replace(/\s+/g, ' ').trim().slice(0, 280) : '');
  const metas = [];
  if (post.created) metas.push(`<span>posted ${esc(String(post.created).slice(0, 10))}</span>`);
  if (post.votes != null) metas.push(`<span>${esc(post.votes)} votes</span>`);
  if (post.payout) metas.push(`<span>${esc(post.payout)}</span>`);
  if (ref) metas.push(`<span><code>${esc(ref)}</code></span>`);
  return `<section class=card id=welcome>
    <h2>👋 ${esc(post.title || 'Introducing Hathor on MELEK')}</h2>
    ${metas.length ? `<div class=meta>${metas.join('')}</div>` : ''}
    ${blurb ? `<p class=blurb>${esc(blurb)}${blurb.length >= 280 ? '…' : ''}</p>` : ''}
    <a class=btn href="${esc(link)}">Read the welcome post →</a>
    <a class="btn ghost" href="${esc(WITNESS_SITE)}">Witness School</a>
  </section>`;
}

// ── Cheetah results section ──────────────────────────────────────────────────────
const STATUS_PILL = {
  credited: 'credited', flagged: 'flagged', match: 'match', clear: 'clear',
};
function statusPill(status) {
  const s = String(status || '').toLowerCase();
  const cls = STATUS_PILL[s] || 'clear';
  return `<span class="pill ${cls}">${esc(status || 'clear')}</span>`;
}

function cheetahSection(data) {
  if (!data) {
    return `<section class=card id=cheetah><h2>🐆 Latest Cheetah results</h2>
      <p class=empty>Not wired yet — once a results reader is connected, the most recent CheetahAdvanced run will appear here.</p>
      <a class="btn ghost" href="${esc(CHEETAH_SITE)}">See Cheetah reports →</a></section>`;
  }
  const rows = Array.isArray(data.results) ? data.results : [];
  const s = data.summary || {};
  const stat = (k, label) => (s[k] != null
    ? `<div class=stat><div class=v>${esc(s[k])}</div><div class=k>${esc(label)}</div></div>` : '');
  const stats = [stat('scanned', 'scanned'), stat('matches', 'matches'), stat('credited', 'credited'), stat('flagged', 'flagged')].filter(Boolean).join('');
  const metas = [];
  if (data.generatedAt) metas.push(`<span>run ${esc(String(data.generatedAt).slice(0, 19).replace('T', ' '))}</span>`);
  if (data.source) metas.push(`<span>source: ${esc(data.source)}</span>`);
  let tableHtml;
  if (rows.length) {
    tableHtml = `<table><thead><tr><th>Item</th><th>Platform</th><th>Status</th><th class=n>Score</th><th>Note</th></tr></thead><tbody>${
      rows.map((r) => {
        const name = r.url
          ? `<a href="${esc(r.url)}" rel="noopener nofollow" target=_blank>${esc(r.title || r.url)}</a>`
          : esc(r.title || '(untitled)');
        const score = r.score != null ? esc(r.score) : '—';
        return `<tr><td>${name}</td><td>${esc(r.platform || '—')}</td><td>${statusPill(r.status)}</td><td class=n>${score}</td><td>${esc(r.note || '')}</td></tr>`;
      }).join('')
    }</tbody></table>`;
  } else {
    tableHtml = '<p class=empty>This run produced no result rows.</p>';
  }
  return `<section class=card id=cheetah>
    <h2>🐆 Latest Cheetah results</h2>
    ${metas.length ? `<div class=meta>${metas.join('')}</div>` : ''}
    ${stats ? `<div class=stats>${stats}</div>` : ''}
    ${tableHtml}
    <a class=btn href="${esc(data.url || CHEETAH_SITE)}">Open the full Cheetah report →</a>
  </section>`;
}

// ── pure view ────────────────────────────────────────────────────────────────────
// renderLanding({welcomePost, cheetahResults}) → full HTML page. Pure, esc()s everything,
// degrades gracefully when either input is missing/empty.
export function renderLanding({ welcomePost = null, cheetahResults = null } = {}) {
  const body = `<h1>Find what's already built</h1>
    <p class=muted>A quick map to two things people kept losing: Hathor's welcome post on the MELEK chain, and the latest CheetahAdvanced run. Both pull from injected readers — this page does no network of its own.</p>
    ${welcomeSection(welcomePost)}
    ${cheetahSection(cheetahResults)}`;
  return pageShell('MELEK — find the Hathor welcome post & latest Cheetah results', body);
}

function send(res, html, code = 200, extra = {}) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...extra });
  res.end(html);
}

export const handler = async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`);
    }
    if (url.pathname === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(BASE_URL)}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url></urlset>`);
    }
    if (url.pathname === '/api/landing.json') {
      const [welcomePost, cheetahResults] = await Promise.all([safeRead(welcomeReader), safeRead(cheetahReader)]);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120' });
      return res.end(JSON.stringify({ welcomePost, cheetahResults }));
    }
    if (url.pathname !== '/') { res.writeHead(302, { location: '/' }); return res.end(); }
    const [welcomePost, cheetahResults] = await Promise.all([safeRead(welcomeReader), safeRead(cheetahReader)]);
    return send(res, renderLanding({ welcomePost, cheetahResults }), 200, { 'cache-control': 'public, max-age=120' });
  } catch (e) {
    // soft-fail-never-throw: still serve a usable page
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(renderLanding({}));
  }
};

export { esc };

// CLI guard: bind a socket only when run directly, not when imported by a unit test.
if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK landing on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
