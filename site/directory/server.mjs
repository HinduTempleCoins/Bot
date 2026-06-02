// server.mjs — Directory.SoapBox.Community. The crypto/markets resource directory as its own subdomain
// (operator 2026-06-02), with a "submit your URL for us to crawl" box. Same slim-sticky-bar pattern as
// Data/Search (◈ SoapBox directory + links to Data + Search), but no big category nav. Submissions are
// SSRF-checked, best-effort crawled for a title, and queued to a moderation file — never auto-published.
//
//   PORT=8094 BASE_URL=https://directory.soapbox.community node site/directory/server.mjs

import { createServer } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DIRECTORY } from '../soapbox/directory.mjs';
import { insights, normDomain } from '../../integrations/soapbox/domain-insights.mjs';

const PORT = +(process.env.PORT || 8094);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const SUBMISSIONS = process.env.DIRECTORY_SUBMISSIONS || new URL('../../data/directory-submissions.jsonl', import.meta.url).pathname;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CATS = DIRECTORY.map((g) => g.cat);

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:900px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 8px} .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:16px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px}
  .it{padding:8px 0;border-bottom:1px solid var(--line)} .it:last-child{border-bottom:0}
  .it .n{font-weight:600} .it .b{color:var(--mut);font-size:13px} .star{color:var(--gold)}
  form.sub{display:grid;gap:10px;max-width:560px}
  input,select,textarea{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:10px 12px;font:inherit;width:100%}
  input:focus,select:focus,textarea:focus{outline:none;border-color:var(--blue)}
  button{cursor:pointer;background:var(--blue);border:0;border-radius:8px;color:#06101f;font-weight:700;padding:11px 22px;font-size:15px;justify-self:start}
  .hp{position:absolute;left:-9999px}
  .ok{background:#3fb95022;border:1px solid var(--up);border-radius:8px;padding:14px 16px;color:var(--fg)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:28px;margin-top:24px}
</style>`;

const page = (title, body) => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="SoapBox Directory — a curated directory of crypto, markets, and data resources. Submit your site for review.">
<meta name=robots content="index,follow"><link rel=canonical href="${BASE_URL}/">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">◈ SoapBox <span>directory</span></a>
  <div class=topbar-r><a href="${DATA}" title="SoapBox Data — markets, macro, commodities, forex">Data</a><a href="${SEARCH}" title="SoapBox Search">Search</a></div></header>
<main class=wrap>${body}</main>
<footer>SoapBox Directory · curated resources + community submissions (moderated). <a href="${DATA}">Data</a> · <a href="${SEARCH}">Search</a></footer></body></html>`;

const submitForm = (msg = '') => `<div class=card id=submit>
  <h2>Submit a site for the Directory</h2>
  <p class=muted>Got a useful crypto / markets / data resource? Drop the URL and we'll crawl it and review it for the directory. Nothing is published automatically.</p>
  ${msg}
  <form class=sub method=post action="/submit">
    <input type=url name=url placeholder="https://your-site.com" required autocomplete=off>
    <input type=text name=name placeholder="Site name (optional)" autocomplete=off>
    <select name=category><option value="">Suggest a category…</option>${CATS.map((c) => `<option>${esc(c)}</option>`).join('')}<option>Other / new category</option></select>
    <textarea name=note rows=2 placeholder="One line: what is it? (optional)"></textarea>
    <input type=text name=website class=hp tabindex=-1 autocomplete=off aria-hidden=true>
    <button type=submit>Submit for review</button>
  </form></div>`;

function listing() {
  return DIRECTORY.map((g) => `<div class=card><h2>${esc(g.cat)}</h2><div class=grid>${g.items.map((it) => `<div class=it>
    <div class=n><a href="${esc(it.url)}" rel="noopener" target=_blank>${esc(it.name)}</a>${it.ours ? ' <span class=star title="ecosystem">⭐</span>' : ''}</div>
    <div class=b>${esc(it.blurb)}</div></div>`).join('')}</div></div>`).join('');
}

// Site Insights — the "Alexa rankings" surface: popularity rank + domain age + on-page SEO for any site.
const insightsForm = (domain = '') => `<form method=get action="/" style="display:flex;gap:8px;max-width:560px;margin:6px 0 0">
  <input type=text name=domain value="${esc(domain)}" placeholder="example.com — check rank, age, SEO" autocomplete=off style="flex:1">
  <button type=submit style="background:var(--panel);color:var(--fg);border:1px solid var(--line2)">Check</button></form>`;

function insightsCard(d) {
  if (!d || d.error) return `<div class=card><h2>📊 Site Insights <span class=muted style="font-size:13px;font-weight:400">· rankings &amp; domain data</span></h2>
    <p class=muted>Look up any site's popularity rank, how old the domain is, and an on-page SEO score. ${d?.error ? `<span style="color:var(--gold)">Enter a valid domain.</span>` : ''}</p>${insightsForm()}</div>`;
  const rank = d.rank ? `<b>#${d.rank.rank.toLocaleString()}</b> <span class=muted>Tranco (${d.rank.date})</span>` : '<span class=muted>unranked (outside the top list)</span>';
  const age = d.age?.registered ? `<b>${d.age.ageYears}y</b> <span class=muted>(since ${d.age.registered.slice(0, 10)}${d.age.registrar ? ' · ' + esc(d.age.registrar) : ''})</span>` : '<span class=muted>unknown</span>';
  const seo = d.seo ? `<b style="color:${d.seo.score >= 90 ? 'var(--up)' : d.seo.score >= 70 ? 'var(--gold)' : 'var(--blue)'}">${d.seo.score}/100</b> <span class=muted>(${d.seo.fails} fails, ${d.seo.warns} warns)</span>` : '<span class=muted>n/a</span>';
  return `<div class=card><h2>📊 Site Insights — ${esc(d.domain)}</h2>
    <div class=grid style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div><div class=b>Popularity rank</div>${rank}</div>
      <div><div class=b>Domain age</div>${age}</div>
      <div><div class=b>On-page SEO</div>${seo}</div>
    </div>
    <p class=muted style="font-size:11px;margin-top:8px">Rank: Tranco (manipulation-resistant academic top-list). Age: RDAP registry data. SEO: our on-page audit. All keyless — informational.</p>
    ${insightsForm(d.domain)}</div>`;
}

const homeBody = (msg, insights = '') => `<h1>Crypto Resources Directory</h1>
  <p class=muted>A curated directory of useful crypto, markets, and data resources — plus <b>Site Insights</b> (popularity rank, domain age, SEO) for any domain. Ecosystem items marked ⭐. Outbound links; do your own research.</p>
  ${insights || insightsCard(null)}
  ${submitForm(msg)}
  ${listing()}`;

// SSRF guard: only public http(s) hosts (we crawl what's submitted).
function safeUrl(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|255\.)/.test(h)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  if (h.startsWith('[')) return null; // skip raw IPv6 (incl ::1, fc00::/7)
  return u.toString();
}

// best-effort crawl: grab the page <title> for the moderator (5s cap, SSRF already checked).
async function crawlTitle(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SoapBox-Directory/1.0)' }, redirect: 'follow', signal: AbortSignal.timeout(5000) });
    const html = (await r.text()).slice(0, 20000);
    const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    return { status: r.status, title: m ? m[1].trim() : '' };
  } catch { return { status: 0, title: '' }; }
}

async function handleSubmit(req, res) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 8000) break; }
  const f = new URLSearchParams(raw);
  if (f.get('website')) { res.writeHead(302, { location: '/#submit' }); return res.end(); } // honeypot tripped → silently drop
  const url = safeUrl(f.get('url'));
  if (!url) return send(res, page('Submit — SoapBox Directory', homeBody('<div class=ok style="border-color:var(--gold)">Please enter a valid public http(s) URL.</div>')), 400);
  const crawl = await crawlTitle(url);
  const entry = { url, name: (f.get('name') || '').slice(0, 120), category: (f.get('category') || '').slice(0, 60), note: (f.get('note') || '').slice(0, 280), crawl_status: crawl.status, crawl_title: crawl.title.slice(0, 200), ip_hash: 'redacted', ts_unix: Math.floor(Date.now() / 1000) };
  try { await mkdir(dirname(SUBMISSIONS), { recursive: true }); await appendFile(SUBMISSIONS, JSON.stringify(entry) + '\n'); } catch (e) { /* never fail the user on a write error */ }
  const okMsg = `<div class=ok>✓ Thanks — <b>${esc(url)}</b> is queued for review${crawl.title ? ` (we found: “${esc(crawl.title)}”)` : ''}. We crawl + check submissions before adding them.</div>`;
  return send(res, page('Submitted — SoapBox Directory', homeBody(okMsg)));
}

function send(res, html, code = 200) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
    if (url.pathname === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BASE_URL}/</loc></url></urlset>`); }
    if (req.method === 'POST' && url.pathname === '/submit') return handleSubmit(req, res);
    if (url.pathname !== '/') { res.writeHead(302, { location: '/' }); return res.end(); }
    const domain = url.searchParams.get('domain');
    const card = domain ? insightsCard(await insights(domain).catch(() => ({ domain: '', error: 'lookup failed' }))) : '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': domain ? 'no-store' : 'public, max-age=300' });
    res.end(page(domain ? `${normDomain(domain) || 'Insights'} — SoapBox Directory` : 'SoapBox Directory — crypto & markets resources', homeBody('', card)));
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
}).listen(PORT, HOST, () => console.log(`SoapBox Directory on ${BASE_URL} (bound ${HOST}:${PORT})`));
