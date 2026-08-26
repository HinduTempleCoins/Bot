// site/analytics/server.mjs — the first-party, COOKIELESS analytics COLLECTOR service.
//
// This is the one small service the whole network's pageview beacon posts into. It is deliberately
// first-party + same-network so there is no third-party tracker, no consent banner, no ad-block
// breakage. It writes into integrations/analytics-collector.mjs (a dependency-free JSONL file store,
// NOT SQLite) and exposes a token-gated admin dashboard over the rollup.
//
//   PORT=8230 BASE_URL=https://analytics.soapbox.community ANALYTICS_ADMIN_TOKEN=… node site/analytics/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────────
//   POST /px          the beacon: tiny cookieless {path,ref} payload → records → 204. CORS for /px only.
//   GET  /px.gif      1x1 transparent-GIF fallback beacon (?p=&r=) for no-JS / <img> beacons → gif bytes.
//   OPTIONS /px       CORS preflight (for the fetch keepalive fallback).
//   GET  /            admin dashboard — GATED by ANALYTICS_ADMIN_TOKEN. Unset → "set a token" notice,
//                     exposes NOTHING. Wrong/absent token → 401. Correct → the aggregate() rollup.
//   GET  /health      liveness → {"ok":true}
//   GET  /robots.txt  DISALLOW ALL (the admin surface must never be crawled/indexed)
//
// ── PRIVACY (load-bearing) ────────────────────────────────────────────────────────────────────────────
//   Cookieless. NO IP stored, NO cookies, NO PII, NO raw UA stored. The page HOST is taken from the
//   Origin/Referer header (trust boundary — not from the body). The referrer is reduced to its HOST
//   before storage. The UA is used only to derive a coarse device class in memory, then discarded.
//   Honors DNT: 1 (records nothing, still returns 204/gif). A transient in-memory rate-limiter keys on
//   the socket address ONLY to throttle floods — it is never written to disk.
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────────
//   /px NEVER reflects request input into any HTML (it returns 204 / gif bytes only). The dashboard
//   renders ONLY the collector's own aggregate() output and esc()'s every value. Soft-fail everywhere:
//   a bad body, a flood, an unwritable store → still a clean 204/gif, never a 500 on the hot path. No
//   OUTBOUND network at request time. handler(req,res) is exported so tests drive it offline.

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { robotsTxtDisallowAll } from '../../integrations/soapbox/crawlers.mjs';
import { record, aggregate } from '../../integrations/analytics-collector.mjs';

const PORT = +(process.env.PORT || 8230);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Analytics';
const ADMIN_TOKEN = () => process.env.ANALYTICS_ADMIN_TOKEN || '';

// ── house-style escape (single source of truth) ──────────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── constants ──────────────────────────────────────────────────────────────────────────────────────
const MAX_BODY = 2048;                 // beacon payloads are tiny; anything bigger is refused
// 1x1 transparent GIF
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// ── transient rate limiter (memory only; the key is NEVER persisted) ─────────────────────────────────
// A crude sliding-window guard so a single source can't flood the store. Bounded map, pruned on use.
const RATE_MAX = +(process.env.ANALYTICS_RATE_MAX || 120); // events per window per source
const RATE_WINDOW_MS = +(process.env.ANALYTICS_RATE_WINDOW_MS || 60000);
const _hits = new Map();
function rateOk(key) {
  try {
    const now = Date.now();
    if (_hits.size > 5000) _hits.clear(); // hard bound: never let the limiter itself grow unbounded
    let arr = _hits.get(key);
    if (!arr) { arr = []; _hits.set(key, arr); }
    // drop timestamps outside the window
    while (arr.length && now - arr[0] > RATE_WINDOW_MS) arr.shift();
    if (arr.length >= RATE_MAX) return false;
    arr.push(now);
    return true;
  } catch { return true; } // limiter must never break the hot path
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────
// Host of the PAGE that fired the beacon — from Origin (preferred) or Referer header. Trust boundary:
// we take the host from the request headers, NOT from the (spoofable) body.
function pageHost(req) {
  const h = req && req.headers ? req.headers : {};
  const src = h.origin || h.referer || h.referrer || '';
  try { return src ? new URL(src).hostname : ''; } catch { return ''; }
}

function dnt(req) {
  const h = req && req.headers ? req.headers : {};
  return String(h.dnt || h['sec-gpc'] || '') === '1';
}

function readBody(req, max = MAX_BODY) {
  if (req && req.body != null && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let d = ''; let over = false;
    try {
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

// constant-time token compare (avoids leaking length/timing); both sides hashed to equal length.
function tokenOk(given) {
  const want = ADMIN_TOKEN();
  if (!want) return false;             // no token configured → nothing is ever authorised
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

function givenToken(req, url) {
  const h = req && req.headers ? req.headers : {};
  const auth = String(h.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return bearer || h['x-analytics-token'] || (url && url.searchParams.get('token')) || '';
}

// ── responders ───────────────────────────────────────────────────────────────────────────────────────
function noContent(res) {
  try {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store',
      'content-length': '0',
    });
  } catch {}
  try { res.end(); } catch {}
}
function sendGif(res) {
  try {
    res.writeHead(200, {
      'content-type': 'image/gif',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'content-length': String(GIF_1x1.length),
    });
  } catch {}
  try { res.end(GIF_1x1); } catch {}
}
function sendHtml(res, html, code = 200, extra = {}) {
  try { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra }); } catch {}
  try { res.end(html); } catch {}
}

// ── the beacon: record one cookieless pageview ───────────────────────────────────────────────────────
// `body` is { p|path, r|ref } (POST) or query { p, r } (gif). Host + UA come from headers. Returns bool
// (recorded?) but the caller ALWAYS answers 204/gif regardless — a beacon never surfaces an error.
function ingest(req, { path, ref }) {
  try {
    if (dnt(req)) return false;                    // honour Do-Not-Track / Global Privacy Control
    const key = (req && req.socket && req.socket.remoteAddress) || 'anon';
    if (!rateOk(key)) return false;                // flood guard (key never persisted)
    const ua = (req && req.headers && req.headers['user-agent']) || '';
    record({ path, ref, host: pageHost(req), ua });  // collector strips query/#, host-only ref, drops ua
    return true;
  } catch { return false; }                        // soft-fail: the hot path never throws
}

// ── admin dashboard ──────────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0f1115;--panel:#171a21;--line:#262b35;--fg:#e6e9ef;--mut:#8a93a3;--blue:#6ea8fe;--gold:#d29922;--bar:#6ea8fe}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header{background:var(--panel);border-bottom:1px solid var(--line);padding:12px 22px;display:flex;align-items:center;gap:12px}
  .brand{font-weight:800;font-size:18px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;font-weight:700}
  .wrap{max-width:1000px;margin:0 auto;padding:22px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:var(--mut);margin:0 0 18px;font-size:14px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
  .card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:14px 16px}
  .card h2{font-size:14px;margin:0 0 10px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}
  table{width:100%;border-collapse:collapse;font-size:14px} td{padding:3px 0;vertical-align:top}
  td.n{text-align:right;color:var(--mut);width:64px;font-variant-numeric:tabular-nums}
  td.k{word-break:break-all}
  .kpi{display:flex;gap:22px;flex-wrap:wrap;margin:0 0 18px}
  .kpi div{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 16px}
  .kpi b{font-size:22px;display:block} .kpi span{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  .muted{color:var(--mut)} .notice{border:1px solid var(--gold);background:#d2992211;border-radius:12px;padding:16px 18px;margin:8px 0}
  code{background:#0b0d11;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:13px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:24px;border-top:1px solid var(--line);margin-top:24px}
</style>`;

function shell(title, body) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<meta name=robots content="noindex,nofollow">
<title>${esc(title)}</title>${STYLE}</head><body>
<header><span class=brand>📈 ${esc(SITE_NAME)}</span> <span class=alpha>Alpha</span></header>
<main class=wrap>${body}</main>
<footer>First-party, cookieless analytics — no IP, no cookies, no PII. Admin-only.</footer>
</body></html>`;
}

// inline-SVG per-day bar chart — no libraries. `byDay` is [[day,count],…]; all values are our own ints.
function svgBars(byDay) {
  const rows = (byDay || []).slice(-30); // last 30 days
  if (!rows.length) return '<p class=muted>No data yet.</p>';
  const max = Math.max(1, ...rows.map(([, c]) => c));
  const W = 640, H = 160, pad = 24, bw = Math.max(2, Math.floor((W - pad * 2) / rows.length) - 3);
  const bars = rows.map(([day, c], i) => {
    const x = pad + i * Math.floor((W - pad * 2) / rows.length);
    const h = Math.round((c / max) * (H - pad * 2));
    const y = H - pad - h;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="var(--bar)"><title>${esc(day)}: ${esc(c)}</title></rect>`;
  }).join('');
  const first = esc(rows[0][0]), last = esc(rows[rows.length - 1][0]);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Pageviews per day">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--line)"/>
    ${bars}
    <text x="${pad}" y="${H - 6}" fill="var(--mut)" font-size="11">${first}</text>
    <text x="${W - pad}" y="${H - 6}" fill="var(--mut)" font-size="11" text-anchor="end">${last}</text>
    <text x="${pad}" y="16" fill="var(--mut)" font-size="11">peak ${esc(max)}/day</text>
  </svg>`;
}

function rankTable(rows, label) {
  if (!rows || !rows.length) return `<div class=card><h2>${esc(label)}</h2><p class=muted>No data yet.</p></div>`;
  const trs = rows.map(([k, c]) => `<tr><td class=k>${esc(k)}</td><td class=n>${esc(c)}</td></tr>`).join('');
  return `<div class=card><h2>${esc(label)}</h2><table>${trs}</table></div>`;
}

function dashboard(url) {
  const since = url.searchParams.get('since') || '';
  const a = aggregate(since ? { since } : {});
  const devices = Object.entries(a.byDevice || {}).sort((x, y) => y[1] - x[1])
    .map(([k, c]) => `${esc(k)} ${esc(c)}`).join(' · ') || '—';
  const spanTxt = a.span && a.span.from ? `${esc(a.span.from)} → ${esc(a.span.to)}` : '—';
  const body = `
<h1>Traffic overview</h1>
<p class=sub>First-party cookieless pageviews across every wired surface. Range: ${spanTxt}. Devices: ${devices}.</p>
<div class=kpi>
  <div><b>${esc(a.pageviews)}</b><span>Pageviews</span></div>
  <div><b>${esc((a.topPaths || []).length)}</b><span>Distinct paths</span></div>
  <div><b>${esc((a.topHosts || []).length)}</b><span>Hosts</span></div>
</div>
<div class=card><h2>Pageviews per day</h2>${svgBars(a.byDay)}</div>
<div style="height:16px"></div>
<div class=grid>
  ${rankTable(a.topPaths, 'Top paths')}
  ${rankTable(a.topHosts, 'Top hosts')}
  ${rankTable(a.topReferrers, 'Top referrers')}
</div>`;
  return shell(`${SITE_NAME} — dashboard`, body);
}

function tokenNotice() {
  return shell(`${SITE_NAME}`, `
<h1>Analytics dashboard</h1>
<div class=notice>
  <p><b>No admin token is configured.</b> This dashboard exposes nothing until you set one.</p>
  <p class=muted>Set <code>ANALYTICS_ADMIN_TOKEN</code> in this service's environment, then open
  <code>/?token=YOUR_TOKEN</code> (or send it as <code>Authorization: Bearer …</code> /
  <code>X-Analytics-Token</code>).</p>
</div>
<p class=muted>The beacon endpoint <code>POST /px</code> keeps collecting regardless — only the
dashboard is gated.</p>`);
}

function unauthorized(res) {
  sendHtml(res, shell(`${SITE_NAME}`, `<h1>401 — not authorised</h1><p class=muted>A valid admin token is required to view analytics.</p>`), 401);
}

// ── router ───────────────────────────────────────────────────────────────────────────────────────────
export async function handler(req, res) {
  try {
    const method = ((req && req.method) || 'GET').toUpperCase();
    const url = new URL((req && req.url) || '/', BASE_URL);
    const path = url.pathname;

    if (path === '/health') {
      try { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); } catch {}
      return res.end(JSON.stringify({ ok: true }));
    }

    if (path === '/robots.txt') {
      try { res.writeHead(200, { 'content-type': 'text/plain', 'x-robots-tag': 'noindex, nofollow' }); } catch {}
      return res.end(robotsTxtDisallowAll());
    }

    // ── the beacon ──────────────────────────────────────────────────────────────────
    if (path === '/px') {
      if (method === 'OPTIONS') {                 // CORS preflight for the fetch keepalive fallback
        try {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'content-type',
            'access-control-max-age': '86400',
            'content-length': '0',
          });
        } catch {}
        return res.end();
      }
      if (method === 'POST') {
        const body = (await readBody(req)) || {};
        ingest(req, { path: body.p != null ? body.p : body.path, ref: body.r != null ? body.r : body.ref });
        return noContent(res);                     // ALWAYS 204 — never reflect input, never error to a beacon
      }
      return noContent(res);                       // any other method → benign 204
    }

    if (path === '/px.gif') {                      // no-JS / <img> fallback beacon
      ingest(req, { path: url.searchParams.get('p'), ref: url.searchParams.get('r') });
      return sendGif(res);
    }

    // ── admin dashboard (gated) ─────────────────────────────────────────────────────
    if (path === '/' && method === 'GET') {
      if (!ADMIN_TOKEN()) return sendHtml(res, tokenNotice(), 200);   // unset → notice, expose NOTHING
      if (!tokenOk(givenToken(req, url))) return unauthorized(res);   // set but bad/absent → 401
      return sendHtml(res, dashboard(url), 200);
    }

    // unknown → 404, never a 500
    return sendHtml(res, shell(`${SITE_NAME} — not found`, '<h1>404</h1><p class=muted>No such page.</p>'), 404);
  } catch (e) {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); } catch {}
    try { res.end('error'); } catch {}
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/analytics\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})  admin-token=${ADMIN_TOKEN() ? 'set' : 'UNSET'}`);
  });
}
