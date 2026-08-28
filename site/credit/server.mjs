// site/credit/server.mjs — the SoapBox Credit-Score Help center (credit.soapbox.community).
//
// Free, honest education on how credit scores work and how to improve and defend yours — pointing only to
// the FREE official tools and nonprofit help. EDUCATION ONLY: not financial or legal advice, no "credit
// repair," nothing for sale. Pairs with the grants + credentials aggregators. Pure render, esc() every
// interpolation, handler(req,res) exported, CLI guarded, no network, no keys.
//
//   PORT=8144 BASE_URL=https://credit.soapbox.community node site/credit/server.mjs

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';
import {
  SCORE_FACTORS, SCORE_RANGES, BUILD_STEPS, DISPUTE_STEPS, BUREAUS, RESOURCES, DISCLAIMER,
} from '../../integrations/soapbox/credit-score.mjs';

const PORT = +(process.env.PORT || 8144);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://credit.soapbox.community').replace(/\/$/, '');
const GRANTS = process.env.GRANTS_URL || 'https://grants.soapbox.community';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:900px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:28px} h2{font-size:18px;margin:20px 0 10px}
  .lead{font-size:16px;color:var(--mut);max-width:76ch;margin:6px 0 4px}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:16px 18px;margin:12px 0}
  .band{background:#d2992215;border:1px solid #d2992240;border-radius:10px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  .bar{height:12px;border-radius:6px;background:linear-gradient(90deg,var(--blue),var(--up));margin-top:6px}
  .factor{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
  .factor .w{font-weight:800;color:var(--blue)}
  table{width:100%;border-collapse:collapse;font-size:14px} td,th{border-bottom:1px solid var(--line);padding:8px;text-align:left}
  .steps{counter-reset:s;list-style:none;padding:0} .steps li{counter-increment:s;position:relative;padding:10px 0 10px 40px;border-bottom:1px solid var(--line)}
  .steps li::before{content:counter(s);position:absolute;left:0;top:10px;width:26px;height:26px;border-radius:50%;background:#1f6feb33;color:var(--blue);font-weight:800;text-align:center;line-height:26px}
  .steps b{color:var(--fg)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:24px 22px;margin-top:22px;border-top:1px solid var(--line);line-height:1.7}
</style>`;

const DISC = `<div class=band>${esc(DISCLAIMER)}</div>`;
const FOOTER = `<footer><b>Education only.</b> ${esc(DISCLAIMER)}
  <div style="margin-top:8px"><a href="/">Credit Basics</a> · <a href="/build">Build Credit</a> ·
    <a href="/disputes">Fix Errors</a> · <a href="/resources">Free Tools</a> ·
    <a href="${esc(GRANTS)}">Grants</a></div></footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Free, honest credit-score education: how scores work, how to build credit, how to dispute errors (your FCRA rights), and the free official tools. Education only — nothing for sale.';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="${esc(desc)}"><meta name=robots content="index,follow,max-image-preview:large">
<link rel=canonical href="${esc(opts.canonical || `${BASE_URL}/`)}">${STYLE}${NAV_STYLE}</head><body>
<div class=enav-strip style="background:var(--panel,#14181d);border-bottom:1px solid var(--line2,#222a33);padding:7px 18px">${navBar({ current: 'credit' })}</div>
<header class=topbar><a class=brand href="/">💳 Credit Help <span>· SoapBox</span></a>
  <div class=topbar-r><a href="/">Basics</a><a href="/build">Build</a><a href="/disputes">Fix Errors</a><a href="/resources">Free Tools</a></div></header>
<main class=wrap>${body}</main>${FOOTER}</body></html>`;
}

export function homePage() {
  const factors = SCORE_FACTORS.map((f) => `<div class=card><div class=factor><b>${esc(f.name)}</b><span class=w>${esc(f.weight)}%</span></div>
    <div class=bar style="width:${esc(f.weight * 2)}%"></div><div class=lead style="margin-top:8px">${esc(f.desc)}</div></div>`).join('');
  const ranges = `<table><tr><th>Range</th><th>Score</th><th>What it means</th></tr>${SCORE_RANGES.map((r) => `
    <tr><td><b>${esc(r.label)}</b></td><td>${esc(r.min)}–${esc(r.max)}</td><td>${esc(r.note)}</td></tr>`).join('')}</table>`;
  return page('Credit Basics — how your score works', `<h1>How your credit score works</h1>
    <p class=lead>A credit score is a number (300–850 on the FICO scale) that predicts how likely you are to
      repay. Understanding what moves it is the whole game — and it costs nothing to work on.</p>
    ${DISC}
    <h2>What the score is made of</h2>${factors}
    <h2>The ranges</h2><div class=card>${ranges}</div>
    <p class=lead style="margin-top:12px">Next: <a href="/build">build and improve it →</a> · <a href="/disputes">fix an error →</a></p>`,
  { canonical: `${BASE_URL}/` });
}

function stepList(steps) {
  return `<ol class=steps>${steps.map((s) => `<li><b>${esc(s.title)}.</b> ${esc(s.desc)}</li>`).join('')}</ol>`;
}

export function buildPage() {
  return page('Build Credit — concrete free steps', `<h1>Build &amp; improve your credit</h1>
    <p class=lead>Concrete, free moves — in rough order of impact. None of this requires paying anyone.</p>
    ${DISC}<div class=card>${stepList(BUILD_STEPS)}</div>
    <p class=lead>Found something wrong on your report? <a href="/disputes">Dispute it →</a></p>`, { canonical: `${BASE_URL}/build` });
}

export function disputesPage() {
  const bureaus = `<div class=card><h2 style="margin-top:0">The three nationwide bureaus</h2><table>${BUREAUS.map((b) => `
    <tr><td><b>${esc(b.name)}</b></td><td><a href="${esc(b.url)}" rel=nofollow>${esc(b.url.replace(/^https?:\/\//, ''))}</a></td></tr>`).join('')}</table></div>`;
  return page('Fix Errors — dispute the wrong stuff', `<h1>Fix errors on your report</h1>
    <p class=lead>Report errors are common and cost you points. Under the <b>Fair Credit Reporting Act</b> you
      can dispute them for free, and the bureau must investigate.</p>
    ${DISC}<div class=card>${stepList(DISPUTE_STEPS)}</div>${bureaus}`, { canonical: `${BASE_URL}/disputes` });
}

export function resourcesPage() {
  const rows = RESOURCES.map((r) => `<div class=card><b><a href="${esc(r.url)}" rel=nofollow>${esc(r.name)}</a></b>
    <div class=lead style="margin-top:4px">${esc(r.note)}</div></div>`).join('');
  return page('Free Tools — the legitimate resources', `<h1>Free tools &amp; help</h1>
    <p class=lead>Everything you need is free and official. Be wary of anyone charging to “repair” your credit —
      they mostly do what you can do yourself here.</p>
    ${DISC}${rows}`, { canonical: `${BASE_URL}/resources` });
}

function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}
const SITEMAP_PATHS = ['/', '/build', '/disputes', '/resources'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'monthly', priority: u === '/' ? '1.0' : '0.7' }))));
    }
    if (path === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({ name: 'SoapBox Credit-Score Help', baseUrl: BASE_URL, summary: 'Free, honest credit-score education (education only, nothing for sale): how scores work, building credit, disputing errors under the FCRA, and the free official tools.', links: SITEMAP_PATHS.map((p) => ({ label: p, path: p })) }));
    }
    if (path === '/') return sendHtml(res, homePage());
    if (path === '/build') return sendHtml(res, buildPage());
    if (path === '/disputes') return sendHtml(res, disputesPage());
    if (path === '/resources') return sendHtml(res, resourcesPage());
    res.writeHead(302, { location: '/' }); return res.end();
  } catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error: ' + (e && e.message ? e.message : 'unknown')); }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/credit\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`Credit Help on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
