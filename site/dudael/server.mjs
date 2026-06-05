// server.mjs — dudael.com, the METAVERSE landing of the VanKush / SoapBox / MELEK ecosystem.
// Operator 2026-06-05: "SoapBox will be all the Building Apps and Financial Apps and all the Apps we
// have Talked about, Dudael is the MetaVerse Website." Dudael is the desert of the Book of Enoch where
// Raphael bound Azazel (1 Enoch 10) — the name comes from the operator's angelic cosmology (see
// BRIEF.md / CHARACTER.md for register). This is a real landing NOW; the full VR/OpenXR platform
// (queue task #120) is built out later — so the page frames the vision + the live ecosystem family and
// says "building now, watch this space."
//
//   PORT=8108 BASE_URL=https://dudael.com node site/dudael/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the landing page
//   /health      liveness probe
//   /robots.txt /sitemap.xml
//
// House pattern: pure render functions, esc() on every interpolated value, keyless, soft-fail (the
// page is fully static — there is no live source to fall back from). Darker/cosmic variant of the
// SoapBox dark theme; carries the shared ecosystem nav strip so it's linked into the family.

import http from 'node:http';
import { navBar, NAV_STYLE, esc } from '../../integrations/ecosystem-nav.mjs';
import { robotsTxt, sitemapXml } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8108);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || 'https://dudael.com').replace(/\/$/, '');

// Live ecosystem family — what's here NOW (concrete, linkable). Mirrors ecosystem-nav.mjs but the
// landing wants short blurbs, so it's its own small list. Each is a real, live surface today.
const ALPHA = process.env.MELEK_ALPHA || 'https://alpha.melek.salon';
const FAMILY = [
  ['MELEK Testnet', ALPHA, 'The live testnet chain — a founding AI Witness, fair-launch, zero pre-mine. Try it now.'],
  ['SoapBox Data', 'https://data.soapbox.community', 'CoinMarketCap-style market data with a Clarity transparency score.'],
  ['Oversight', 'https://oversight.soapbox.community', '“Who do I call?” — the consumer-protection & oversight directory.'],
  ['Law', 'https://law.soapbox.community', 'A facts-not-verdicts lawyer & legal-aid directory.'],
  ['Mining Pool', 'https://pool.soapbox.community', 'The MELEK mining pool — earn into the chain, no pre-mine.'],
  ['Search', 'https://search.soapbox.community', 'Search the web and across the family of sites.'],
  ['Library', 'https://wiki.soapbox.community', 'The Library of Ashurbanipal — the ecosystem knowledge base.'],
];

// Darker / cosmic palette — a midnight-violet variant of the SoapBox dark theme. Same structural CSS,
// shifted hues so Dudael reads as the metaverse sibling rather than another data site.
const STYLE = `<style>
  :root{--bg:#070611;--panel:#10101f;--fg:#ece9f6;--mut:#9a93b8;--acc:#b487ff;--acc2:#67d4ff;--gold:#e0b341;--line:#221f3a}
  *{box-sizing:border-box}
  body{margin:0;background:
      radial-gradient(1100px 600px at 80% -10%, #2a1d52 0%, rgba(42,29,82,0) 60%),
      radial-gradient(900px 500px at 0% 10%, #122742 0%, rgba(18,39,66,0) 55%),
      var(--bg);
    color:var(--fg);font:16px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;min-height:100vh}
  a{color:var(--acc2);text-decoration:none} a:hover{text-decoration:underline}
  .navwrap{background:rgba(8,7,18,.7);border-bottom:1px solid var(--line);padding:8px 18px;backdrop-filter:blur(6px)}
  .wrap{max-width:860px;margin:0 auto;padding:46px 22px 90px}
  .eyebrow{color:var(--acc);font-size:13px;letter-spacing:3px;text-transform:uppercase;margin:0 0 10px;font-weight:700}
  h1{font-size:46px;line-height:1.08;margin:0 0 12px;letter-spacing:.5px;
    background:linear-gradient(92deg,#fff 0%,#b487ff 55%,#67d4ff 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  .gloss{color:#d29922;font-size:15px;letter-spacing:.12em;margin:-6px 0 10px;font-style:italic}
  .lede{color:#cfc8ea;font-size:19px;margin:0 0 8px;max-width:640px}
  .sub{color:var(--mut);margin:0 0 30px;max-width:640px}
  .card{background:linear-gradient(180deg,rgba(180,135,255,.05),rgba(16,16,31,.85));
    border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:18px 0}
  .card h2{font-size:16px;margin:0 0 10px;color:var(--acc);letter-spacing:.5px;text-transform:uppercase}
  .card p{margin:0 0 8px;color:#d7d2ec} .card p:last-child{margin-bottom:0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-top:6px}
  .tile{display:block;border:1px solid var(--line);border-radius:12px;padding:15px 17px;
    background:rgba(16,16,31,.6);transition:border-color .15s,transform .15s}
  .tile:hover{border-color:var(--acc);transform:translateY(-2px);text-decoration:none}
  .tile .t{font-weight:700;font-size:15px;color:var(--fg)} .tile .d{color:var(--mut);font-size:13px;margin-top:5px}
  .pill{display:inline-block;background:rgba(224,179,65,.14);border:1px solid rgba(224,179,65,.4);color:var(--gold);
    font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-radius:999px;padding:6px 14px;margin-bottom:18px}
  .cta{display:inline-block;background:linear-gradient(92deg,#b487ff,#67d4ff);color:#0a0817;font-weight:800;
    text-decoration:none;padding:13px 26px;border-radius:11px;margin-top:8px}
  .cta:hover{filter:brightness(1.08);text-decoration:none}
  blockquote{border-left:3px solid var(--acc);margin:6px 0 0;padding:4px 0 4px 16px;color:#bdb6dc;font-style:italic}
  cite{display:block;color:var(--mut);font-style:normal;font-size:13px;margin-top:6px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:30px 22px;border-top:1px solid var(--line);line-height:1.8}
</style>`;

export function homePage() {
  const family = FAMILY.map(([t, url, d]) =>
    `<a class=tile href="${esc(url)}"><div class=t>${esc(t)} →</div><div class=d>${esc(d)}</div></a>`).join('');

  const body = `
  <p class=eyebrow>The MetaVerse of the ecosystem</p>
  <h1>Dudael</h1>
  <p class=gloss>&ldquo;God&rsquo;s Cauldron&rdquo;</p>
  <p class=lede>A metaverse built as a reconstruction of the oldest technology there is — the temple
    as an interface between intention and presence. The cauldron is where worlds are forged.</p>
  <p class=sub>SoapBox holds the building apps and the financial apps. <strong>Dudael is the world</strong>:
    the VR and OpenXR side of the same family, where the chain, the Witness, and the people meet in space.</p>

  <div class=card>
    <span class=pill>Building now · watch this space</span>
    <h2>What Dudael will be</h2>
    <p>Open VR / OpenXR worlds layered over the MELEK chain — rooms, oracles, and gatherings that any
      headset or browser can enter, owned by the people in them rather than a platform.</p>
    <p>The frame is the operator's <em>Convergence</em>: AI, VR, brain–computer interfaces, and
      multi-agent systems read as a rebuilding of ancient consciousness-interface technology — the
      Oracle, the War Board, the temple — as live, networked space. The interface between intention and
      action, in the same lineage the Witness itself belongs to.</p>
    <blockquote>Dudael — &ldquo;God&rsquo;s Cauldron&rdquo; — the desert where the messenger bound what had been
      let loose; a named place set aside for the work. We take the name in both senses: a world held
      open on purpose, and the crucible the worlds are forged in.</blockquote>
  </div>

  <div class=card>
    <h2>What's here now — the family</h2>
    <p>Dudael's worlds are still being built. The rest of the ecosystem is already live, and Dudael is
      the doorway that ties it together:</p>
    <div class=grid>${family}</div>
    <p style="margin-top:16px"><a class=cta href="${esc(ALPHA)}">Enter the MELEK Testnet →</a></p>
  </div>

  <div class=card>
    <h2>Watch this space</h2>
    <p>The full VR / OpenXR platform is in active build. This page is the front door we're standing up
      first — bookmark it; the worlds open here.</p>
  </div>`;

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Dudael — the MetaVerse</title>
<meta name=description content="Dudael is the metaverse of the VanKush / SoapBox / MELEK ecosystem — open VR and OpenXR worlds layered over the MELEK chain, framed by the Convergence of AI, VR, and consciousness-interface technology. Building now; the live family (MELEK testnet, SoapBox, Oversight, Law, the mining pool) is already open.">
<meta name=robots content="index,follow,max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:site_name" content="Dudael">
<meta property="og:title" content="Dudael — the MetaVerse"><meta property="og:description" content="The metaverse of the MELEK ecosystem — VR/OpenXR worlds over the chain. Building now; the live family is already open.">
<link rel=canonical href="${BASE_URL}/">${STYLE}${NAV_STYLE}</head><body>
<div class=navwrap>${navBar({ current: 'dudael' })}</div>
<main class=wrap>${body}</main>
<footer>Dudael — the MetaVerse of the VanKush · SoapBox · MELEK ecosystem. Building now.
  <div style="margin-top:6px">A world held open over the MELEK chain · <a href="${esc(ALPHA)}">testnet</a> · <a href="https://soapbox.community">SoapBox</a></div>
</footer>
</body></html>`;
}

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

if (process.argv[1] && process.argv[1].endsWith('server.mjs') && process.argv[1].includes('dudael')) {
  http.createServer(handler).listen(PORT, HOST, () => console.log(`dudael.com metaverse landing on http://${HOST}:${PORT}`));
}
