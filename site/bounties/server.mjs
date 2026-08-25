// server.mjs — Bounties.melek.salon. The MELEK BOUNTY BOARD growth-funnel vertical, a standalone,
// zero-dependency HTTP service in the SoapBox/MELEK house style (mirrors site/insurance/server.mjs).
//
// THE FUNNEL it fronts (logic in integrations/bounties/bounty-board.mjs):
//   1. LOG IN WITH A SOCIAL (Google/GitHub/Discord) via MELEK-Signer  → the "Login with MELEK" CTA
//      targets authorizeUrl(...) from integrations/melek-signer-oauth.mjs (identity scope).
//   2. DO BOUNTIES — foundational/"prospectoral" onboarding, ambassador outreach, curation/witness/token
//      advanced paths — each completion records HELD/pending earnings.
//   3. CREATE A WALLET TO UNLOCK — a prominent funnel CTA: HELD earnings become CLAIMABLE only once a
//      chain account (MELEK @name / 0x wallet) is linked. This conversion is the whole point.
//   4. GRADUATE — advanced links: make a token (MELEK-Engine), run a curation trail, become a witness.
//
//   PORT=8194 BASE_URL=https://bounties.melek.salon node site/bounties/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /               the board — login CTA, bounties by category, the unlock funnel + graduation links
//   /api/bounties   the bounty registry, grouped by category (JSON)
//   /api/progress   ?social=<id> → a visitor's funnel state: completed, HELD, claimable/locked (JSON)
//   /health         liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   NO keys, no broadcasting, no PII beyond the opaque social id + a linked chain account. Claims are
//   UNSIGNED intents signed client-side by MELEK-Signer. esc() on every interpolated value. Soft-fail:
//   every route renders even when a store returns nothing. Deterministic logic is in bounty-board.mjs.

import { createServer } from 'node:http';

import {
  BOUNTIES, CATEGORIES, bountiesByCategory, makeStore, progress as boardProgress, esc,
} from '../../integrations/bounties/bounty-board.mjs';
import { authorizeUrl } from '../../integrations/melek-signer-oauth.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8194);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'MELEK Bounties';
const CLIENT_ID = process.env.MELEK_BOUNTIES_CLIENT_ID || 'melek-bounties';
// graduation destinations (advanced paths)
const ENGINE_URL = process.env.ENGINE_URL || 'https://engine.alpha.melek.salon';
const VOTE_URL = process.env.VOTE_URL || 'https://vote.melek.salon';
const WITNESS_URL = process.env.WITNESS_URL || 'https://witness.melek.salon';

// A process-level store so /api/progress can reflect a demo session; injectable for tests.
let STORE = makeStore();
export function __setStore(s) { STORE = s || makeStore(); }

const CATEGORY_LABEL = {
  foundational: 'Foundational — start here',
  prospector: 'Prospector — spread the word',
  ambassador: 'Ambassador — bring a friend',
  curation: 'Curation — advanced',
  witness: 'Witness — advanced',
  token: 'Your own token — advanced',
};

// ── house-style shell (same dark theme as the other SoapBox verticals) ──────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{position:fixed;top:6px;left:8px;z-index:9;background:#d2992222;color:var(--gold);border:1px solid var(--gold);border-radius:6px;font-size:11px;font-weight:700;padding:1px 7px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:0 0 10px} h3{font-size:15px;margin:14px 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .btn{display:inline-block;background:var(--blue);color:#04121f;font-weight:800;border-radius:8px;padding:11px 20px;font-size:15px}
  .btn:hover{text-decoration:none;filter:brightness(1.08)}
  .btn.gold{background:var(--gold);color:#0d0a02}
  .unlock{background:#d2992211;border:1px solid var(--gold);border-radius:10px;padding:16px 20px;margin:14px 0}
  .unlock h2{color:var(--gold)}
  .bounty{border:1px solid var(--line2);border-radius:9px;padding:12px 15px;background:var(--panel);margin:8px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .bounty .t{font-weight:700} .bounty .reward{margin-left:auto;color:var(--up);font-weight:700;white-space:nowrap}
  .bounty .v{font-size:11px;color:var(--mut);border:1px solid var(--line2);border-radius:6px;padding:1px 6px}
  .cat{margin:18px 0 4px;font-size:13px;color:var(--gold);text-transform:uppercase;letter-spacing:.04em}
  .grad{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .grad a{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .grad a:hover{border-color:var(--blue);text-decoration:none} .grad .gt{font-weight:700;color:var(--fg)} .grad .gd{color:var(--mut);font-size:13px;margin-top:4px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

export function loginUrl(state) {
  return authorizeUrl({
    clientId: CLIENT_ID, scope: 'identity',
    redirectUri: `${BASE_URL}/melek-signer/callback`, state: state || 'bounties',
  });
}

const FOOTER = `<footer>
  <b>Earn while you learn MELEK.</b> Log in with a social, complete bounties, and your rewards accrue —
  <b>held</b> until you create a wallet on our chains to claim them. Claims are signed by you through
  MELEK-Signer; this site holds no keys and never asks for a private key.
  <div style="margin-top:8px"><a href="/">Bounties</a> · <a href="${esc(WITNESS_URL)}">Witness School</a> · <a href="${esc(ENGINE_URL)}">Engine</a></div>
</footer>`;

function pageShell(title, body, opts = {}) {
  const desc = opts.description || 'Log in with a social, complete MELEK bounties, and earn — held rewards you unlock by creating a wallet on the MELEK/PRANA chains. Onboarding, ambassador, curation, and witness paths.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    site: { url: BASE_URL, name: SITE_NAME },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<div class=alpha>Alpha</div>
<header class=topbar><a class=brand href="/">🎯 MELEK <span>bounties</span></a>
  <div class=topbar-r><a href="/">Board</a><a href="${esc(WITNESS_URL)}">Witness</a><a href="${esc(ENGINE_URL)}">Engine</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function bountyRow(b) {
  return `<div class=bounty><span class=t>${esc(b.title)}</span> <span class=v>${esc(b.verify)}</span>
    <span class=reward>+${esc(b.rewardUnits)} ${esc(b.rewardToken)}</span></div>`;
}

function boardBody(prog) {
  const grouped = bountiesByCategory();
  const cats = CATEGORIES.map((c) => {
    const rows = (grouped[c] || []).map(bountyRow).join('');
    if (!rows) return '';
    return `<div class=cat>${esc(CATEGORY_LABEL[c] || c)}</div>${rows}`;
  }).join('');

  const locked = prog ? prog.locked : null;
  const held = prog ? prog.held : null;
  // The unlock funnel CTA — always prominent; shows the concrete locked balance when we have a session.
  const unlockLine = (locked && locked > 0)
    ? `You have <b>${esc(held)}</b> tokens <b>held</b> — <b>${esc(locked)}</b> still locked.`
    : `Complete bounties and your rewards are <b>held</b> for you.`;
  const unlock = `<div class="unlock"><h2>Create your wallet to unlock</h2>
    <p class=muted>${unlockLine} To <b>claim</b> them you create an account with a wallet on the MELEK
      (or PRANA) chain and link it — that conversion is how held rewards become claimable. Your keys are
      generated in your browser; we never see them.</p>
    <p><a class="btn gold" href="${esc(WITNESS_URL)}/signup">Create your MELEK wallet →</a></p></div>`;

  const graduate = `<div class=card><h2>Graduate to the advanced paths</h2>
    <div class=grad>
      <a href="${esc(ENGINE_URL)}"><div class=gt>Make your own token</div><div class=gd>Launch a side-token on MELEK-Engine.</div></a>
      <a href="${esc(VOTE_URL)}"><div class=gt>Run a curation trail</div><div class=gd>Curate posts and earn on the curation leg.</div></a>
      <a href="${esc(WITNESS_URL)}"><div class=gt>Become a witness</div><div class=gd>Produce blocks — the top of the funnel.</div></a>
    </div></div>`;

  return `<h1>MELEK Bounties <span class=muted style="font-size:14px">· earn while you learn</span></h1>
    <p class=muted>Log in with a social account, do bounties, and start earning. Convert to a chain
      account to unlock and claim your rewards.</p>
    <p><a class="btn" href="${esc(loginUrl())}">Log in with MELEK-Signer →</a>
       <span class=muted style="font-size:13px">Google · GitHub · Discord</span></p>
    ${unlock}
    <div class=card><h2>Bounties</h2>${cats}</div>
    ${graduate}`;
}

export function homePage(prog) {
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `${SITE_NAME} — bounty board`,
    itemListElement: BOUNTIES.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.title })),
  };
  return pageShell(`${SITE_NAME} — earn while you learn MELEK`, boardBody(prog), { canonical: `${BASE_URL}/`, jsonld });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
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
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
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
        summary: 'Social-login bounty funnel for MELEK: do onboarding/ambassador/curation/witness bounties, earn held rewards, unlock by creating a chain wallet. No keys held; claims signed client-side by MELEK-Signer.',
        links: [{ label: 'Bounty board', path: '/' }, { label: 'Bounties (JSON)', path: '/api/bounties' }],
      }));
    }

    if (path === '/api/bounties') {
      return sendJson(res, { ok: true, categories: CATEGORIES, bounties: bountiesByCategory() });
    }
    if (path === '/api/progress') {
      const social = url.searchParams.get('social') || '';
      const p = boardProgress({ socialId: social }, STORE);
      return sendJson(res, p, p.ok ? 200 : 400);
    }

    if (path === '/') {
      const social = url.searchParams.get('social') || '';
      const prog = social ? boardProgress({ socialId: social }, STORE) : null;
      return sendHtml(res, homePage(prog && prog.ok ? prog : null));
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
export { siteGraph, jsonLdScript };

// Only bind the port when run directly from site/bounties/, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/bounties\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`MELEK Bounties on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
