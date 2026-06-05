// server.mjs — melek.salon, the HOME PAGE OF THE LIVE MELEK CHAIN (mainnet). Operator 2026-06-05:
// "Melek.Salon is the Home Page of the LiveChain" (alpha.melek.salon is the testnet). The live chain
// launches after testnet validation; until then this is the canonical landing — zero-pre-mine, the
// founding AI Witness, and a path to try the testnet now. House style + the shared ecosystem nav.
//
//   PORT=8107 BASE_URL=https://melek.salon node site/melek-home/server.mjs

import http from 'node:http';
import { navBar, NAV_STYLE, esc } from '../../integrations/ecosystem-nav.mjs';
import { robotsTxt, sitemapXml } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8107);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || 'https://melek.salon').replace(/\/$/, '');
const ALPHA = process.env.MELEK_ALPHA || 'https://alpha.melek.salon';

const STYLE = `<style>
  :root{--bg:#0b0d10;--panel:#14181d;--fg:#e8edf2;--mut:#8b97a6;--acc:#d9a441;--line:#222a33;--line2:#222a33}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);
    font:16px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:780px;margin:0 auto;padding:40px 20px 80px}
  h1{font-size:34px;margin:0 0 6px;letter-spacing:.5px} .sub{color:var(--mut);margin:0 0 26px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:16px 0}
  .card h2{font-size:17px;margin:0 0 8px;color:var(--acc)}
  .cta{display:inline-block;background:var(--acc);color:#0b0d10;font-weight:700;text-decoration:none;
    padding:13px 24px;border-radius:10px;margin-top:6px}
  .cta:hover{filter:brightness(1.08)}
  .muted{color:var(--mut);font-size:13px} code{background:#11151a;padding:1px 6px;border-radius:5px;font-size:13px}
  a{color:var(--acc)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
</style>`;

function homePage() {
  const body = `<h1>MELEK</h1>
  <p class=sub>A blockchain with a founding AI Witness — fair-launch, zero pre-mine, built to last.</p>

  <div class=card>
    <h2>The live chain</h2>
    <p>MELEK is a Graphene/Steem-family chain whose liquid currency is <code>MELEK</code>. It launches with
      <strong>zero pre-mine</strong> — enforced in the chain code itself; genesis creates no MELEK in any account, and
      every MELEK in circulation must be <em>earned</em> through block rewards. No insider allocation, no ICO.</p>
  </div>

  <div class=card>
    <h2>The founding AI Witness</h2>
    <p><strong>Hathor</strong> is hardcoded at consensus to hold the 1st witness position for the first year — scoped to
      Hathor alone and time-limited, then reverting to ordinary stake-weighted DPoS like any other witness.</p>
  </div>

  <div class=card>
    <h2>Status — launching after testnet validation</h2>
    <p>The live chain comes online once the public testnet has been exercised. You can try the testnet right now:</p>
    <a class=cta href="${esc(ALPHA)}">Enter the MELEK Testnet →</a>
    <p class=muted style="margin-top:10px">Testnet currency is <code>TESTS</code> (a value-less test token) — not MELEK.</p>
  </div>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>MELEK — the live chain with a founding AI Witness</title>
<meta name=description content="MELEK: a fair-launch, zero-pre-mine blockchain with a founding AI Witness (Hathor). The live chain launches after testnet validation; try the testnet at alpha.melek.salon.">
<meta name=robots content="index,follow">
<link rel=canonical href="${BASE_URL}/">${STYLE}${NAV_STYLE}</head><body>
<div style="background:var(--panel);border-bottom:1px solid var(--line2);padding:7px 18px">${navBar({ current: 'melek' })}</div>
<main class=wrap>${body}</main>
<footer>MELEK — always uppercase, five letters, the full word. Fair-launch, zero pre-mine. The live chain (this site) is launching; the testnet is at <a href="${esc(ALPHA)}">alpha.melek.salon</a>.</footer>
</body></html>`;
}

export { homePage };

export function handler(req, res) {
  try {
    const u = new URL(req.url, BASE_URL);
    if (u.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (u.pathname === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(sitemapXml(BASE_URL, [{ url: BASE_URL + '/' }])); }
    if (u.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(homePage());
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error: ' + (e && e.message));
  }
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs') && process.argv[1].includes('melek-home')) {
  http.createServer(handler).listen(PORT, HOST, () => console.log(`melek.salon home on http://${HOST}:${PORT}`));
}
