// server.mjs — Spin.SoapBox.Community. The free daily-spin vertical as a standalone, zero-dependency
// HTTP service in the SoapBox house style (mirrors site/insurance/server.mjs). It fronts the pure
// daily-spin engine (integrations/games/daily-spin.mjs): a free once-a-day wheel that awards
// NON-CASHABLE, fixed-value internal PLAY points.
//
//   PORT=8189 BASE_URL=https://spin.soapbox.community node site/spin/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /             the wheel UI — spin button, prize segments, today's result, streak, PLAY balance
//   /api/spin     GET ?account=<a>&day=<YYYY-MM-DD>[&seed=][&nonce=] → JSON claim (offline-friendly)
//   /health       liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── COMPLIANCE (baked in, per .local/RESEARCH_ATTENTION_ECONOMY.md) ───────────────────────────────
//   The FREE daily spin is AMOE / sweepstakes: no purchase, no wager, ONE free spin per UTC day.
//   The prize is NON-CASHABLE internal PLAY points — fixed value, never redeemable for cash, and
//   there is NO withdraw path anywhere in this service. The draw is provably-fair (deterministic HMAC
//   over account+day, verifiable by the player). Every page carries the "points are for play, not
//   cash" note. esc() on every interpolated value. Soft-fail: every route renders / returns even when
//   the engine returns nothing.

import { createServer } from 'node:http';

import * as spin from '../../integrations/games/daily-spin.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8189);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SITE_NAME = 'SoapBox Daily Spin';

// ── in-process ledger. A real deployment swaps this for a shared store; the logic is identical and
// the store is injectable into every pure function, so tests never touch this instance.
const STORE = spin.makeStore();

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .alpha-badge{position:fixed;top:6px;left:6px;z-index:20;background:#d2992233;color:var(--gold);border:1px solid var(--gold);border-radius:7px;font-size:11px;font-weight:700;padding:1px 7px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:720px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:0 0 10px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  form.spinform{margin:0} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0}
  input.acct{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 200px;min-width:160px;max-width:360px}
  input.acct:focus{border-color:var(--blue);outline:none}
  button.spin-btn{cursor:pointer;background:var(--gold);border:1px solid var(--gold);border-radius:999px;color:#0d1117;font-weight:800;padding:13px 26px;font-size:16px;margin-top:8px}
  button.spin-btn[disabled]{background:var(--panel);color:var(--mut);border-color:var(--line2);cursor:not-allowed}
  .wheel-wrap{text-align:center}
  .wheel{position:relative;width:260px;height:260px;margin:10px auto;border-radius:50%;border:6px solid var(--gold);background:conic-gradient(#161b22,#21262d 50%,#161b22);display:flex;align-items:center;justify-content:center;flex-wrap:wrap;overflow:hidden}
  .wheel-seg{flex:1 1 33%;min-width:70px;padding:6px 2px;font-size:11px;color:var(--fg);border:1px solid var(--line)}
  .wheel-seg.active{background:#d2992233;color:var(--gold);font-weight:800}
  .seg-label{display:block;font-weight:700} .seg-pts{display:block;color:var(--mut)} .wheel-seg.active .seg-pts{color:var(--gold)}
  .wheel-hub{position:absolute;width:70px;height:70px;border-radius:50%;background:var(--panel);border:2px solid var(--gold);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--gold);font-size:13px}
  .spin-result{margin:12px 0;font-size:16px} .spin-result.muted{color:var(--mut)}
  .wheel-stats{display:flex;gap:18px;justify-content:center;margin:10px 0;color:var(--mut);font-size:14px} .wheel-stats b{color:var(--fg)}
  .play-note{color:var(--gold);background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:9px 13px;font-size:13px;margin:14px 0}
  .fair-note{color:var(--mut);font-size:12px;margin-top:8px;word-break:break-all}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// Responsible-play help — present on every page, per the compliance line (memory `gambling-education-center`):
// even a free, non-cashable spin carries the helpline + a link to the education center's self-exclusion tools.
const GAMBLING_EDU_URL = (process.env.GAMBLING_EDU_URL || 'https://gambling.soapbox.community').replace(/\/$/, '');
const FOOTER = `<footer>
  <b>Free daily spin — points are for play, not cash.</b> PLAY points are a non-cashable, fixed-value
  internal reward: they can't be withdrawn, sold, or exchanged for money. The spin is free (no purchase),
  once per UTC day, and the draw is provably fair — you can recompute it yourself. This is entertainment,
  not gambling and not an investment.
  <div style="margin-top:8px">Gambling a problem? Call or text <a href="tel:18005224700"><b>1-800-522-4700</b></a>
   (1-800-GAMBLER) — free, confidential, 24/7 · <a href="${esc(GAMBLING_EDU_URL)}/help" target=_blank rel=noopener>help &amp; self-exclusion tools</a></div>
  <div style="margin-top:8px"><a href="/">Daily Spin</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

// ── page shell ──────────────────────────────────────────────────────────────────────────────────
function pageShell(title, body, opts = {}) {
  const desc = opts.description || 'A free daily spin for non-cashable PLAY points — one free spin per day, provably fair. Points are for play, not cash; no purchase, not gambling.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<div class="alpha-badge">Alpha</div>
<header class=topbar><a class=brand href="/">🎡 SoapBox <span>daily spin</span></a>
  <div class=topbar-r><a href="/">Spin</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// today's UTC date — the ONLY clock use lives here in the server (the engine stays pure).
function utcToday() { return new Date().toISOString().slice(0, 10); }

// ── home / wheel ──────────────────────────────────────────────────────────────────────────────────
// If ?account=&spin=1 is present we perform the day's claim; otherwise we render the idle wheel.
// account comes from the query so the page works with no login (a real deploy binds the session acct).
export function homePage({ account = '', doSpin = false, today = utcToday() } = {}) {
  const acct = String(account || '').trim();
  let result = null;
  let claimRes = null;
  const existing = acct ? STORE.get(acct) : null;
  let balance = existing ? existing.points : 0;
  let streak = existing ? existing.streak : 0;
  let canSpinToday = acct ? spin.canSpin({ account: acct, lastSpinDay: existing ? existing.lastSpinDay : null, today }) : true;

  if (acct && doSpin) {
    claimRes = spin.claim({ account: acct, today, store: STORE });
    balance = claimRes.balance;
    if (claimRes.ok) {
      result = { segment: claimRes.segment, points: claimRes.base, bonus: claimRes.bonus };
      streak = claimRes.streak;
      canSpinToday = false;
    } else {
      // soft-fail path: already-spun or missing account — show why, keep the wheel rendered.
      const after = STORE.get(acct);
      streak = after ? after.streak : streak;
      canSpinToday = false;
    }
  }

  const wheel = spin.renderWheel({ result, balance, streak, canSpinToday });
  const rejectNote = claimRes && !claimRes.ok
    ? `<div class="spin-result muted" role="status">${esc(claimRes.reason)}</div>` : '';
  const fair = result
    ? `<p class="fair-note">Provably fair — verify: HMAC(serverSeed, "${esc(acct)}:${esc(today)}:0"). Segment ${esc(result.segment)}.</p>` : '';

  const body = `<h1>Daily Spin <span class=muted style="font-size:14px">· free PLAY points</span></h1>
    <p class=muted>One <b>free</b> spin per day. Win non-cashable <b>PLAY points</b> — for play, not cash.</p>
    <div class="card">
      <form class=spinform method=get action="/">
        <div class=row>
          <input class=acct name="account" value="${esc(acct)}" placeholder="your MELEK account (e.g. hathor)" autocomplete=off aria-label="account">
          <input type=hidden name="spin" value="1">
        </div>
        ${wheel}
      </form>
      ${rejectNote}
      ${fair}
    </div>
    <div class="card">
      <h2>How it stays on the right side of the line</h2>
      <p class=muted style="font-size:14px">This is a sweepstakes-style <b>AMOE</b> (Alternative Means Of Entry):
      the spin is always free, there's no purchase or wager, and you get one per UTC day. The prize is
      <b>non-cashable internal PLAY points</b> at a fixed value — they are never redeemable for cash and
      there is no withdraw path. The draw is deterministic (provably fair), so you can recompute your own
      result. Play points, not money.</p>
    </div>`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: SITE_NAME, applicationCategory: 'GameApplication',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: 'Free daily spin awarding non-cashable internal PLAY points. No purchase; not gambling.',
  };
  return pageShell(`${SITE_NAME} — free daily spin for PLAY points`, body, { canonical: `${BASE_URL}/`, jsonld });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}
function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'daily', priority: '1.0' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'A free daily spin awarding non-cashable, fixed-value internal PLAY points. Sweepstakes/AMOE: no purchase, one free spin per UTC day, provably-fair draw. Points are for play, not cash — no withdraw path.',
        links: [{ label: 'Daily Spin', path: '/' }],
      }));
    }

    // JSON claim — offline-friendly (account + day passed in, deterministic result).
    if (path === '/api/spin') {
      const account = url.searchParams.get('account') || '';
      const day = url.searchParams.get('day') || new Date().toISOString().slice(0, 10);
      const seed = url.searchParams.get('seed');
      const nonce = +(url.searchParams.get('nonce') || 0) || 0;
      const r = spin.claim({ account, today: day, store: STORE, daySeed: seed || undefined, nonce });
      return sendJson(res, { cashable: false, currency: 'PLAY', ...r }, r.ok ? 200 : 200);
    }

    if (path === '/') {
      const account = url.searchParams.get('account') || '';
      const doSpin = url.searchParams.get('spin') === '1' && !!account;
      return sendHtml(res, homePage({ account, doSpin }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose for tests
export { siteGraph, jsonLdScript, STORE };

// Only bind the port when run directly from site/spin/, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/spin\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Daily Spin on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
