// server.mjs — PRANA Games — the "what is PRANA for" front door (games.soapbox.community).
//
// The strategic gap the operator named: PRANA must not read as mining-only territory. For a MELEK
// blog user the answer to "what is PRANA FOR" is PLAY + EARN — an arcade, a casino, a farm, a daily
// spin, walk-to-earn — all on one account. Mining is how it's *secured*; this hub is what it's *for*.
// It is a directory/landing that links every live play-and-earn surface; each game is its own service.
//
//   PORT=8193 BASE_URL=https://games.soapbox.community node site/games/server.mjs
//
// Routes: /  (the hub) · /health · /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// DISCIPLINE: read-only directory, no keys, soft-fail-never-throw, esc() every interpolation. Surface
// URLs are env-overridable (never hard-code infra); each links out to the live surface.

import { createServer } from 'node:http';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';
import { renderMobileNav } from '../../integrations/soapbox/mobile-nav.mjs';

const PORT = +(process.env.PORT || 8193);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'PRANA Games';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// env-overridable live surface URLs (defaults are the live subdomains; never hard-code infra beyond the public domain).
const U = (k, d) => (process.env[k] || d).replace(/\/$/, '');
const URLS = {
  arcade: U('ARCADE_URL', 'https://arcade.soapbox.community'),
  casino: U('CASINO_URL', 'https://casino.soapbox.community'),
  spin: U('SPIN_URL', 'https://spin.soapbox.community'),
  tribulum: U('TRIBULUM_URL', 'https://tribulum.soapbox.community'),
  shop: U('SHOP_URL', 'https://shop.soapbox.community'),
  move: U('MOVE_URL', 'https://move.soapbox.community'),
  dex: U('DEX_URL', 'https://kula.money'),
  gauge: U('GAUGE_URL', 'https://gauge.soapbox.community'),
  farm: U('FARM_URL', 'https://farm.soapbox.community'),
  school: U('SCHOOL_URL', 'https://witness.melek.salon'),
  chain: U('MELEK_URL', 'https://melek.salon'),
  wallet: U('WALLET_URL', 'https://akasha.alpha.soapbox.community'),
};

// The catalog — grouped by what the user actually gets. Each: name, blurb, url, emoji, tag.
export const SECTIONS = [
  { key: 'play', title: 'Play', lead: 'Games that run on the chain — provably-fair, native-token, no fiat.', items: [
    { name: 'Arcade', emoji: '🕹️', blurb: 'The hub of quick games — raffles, skill boards, more added constantly.', url: URLS.arcade, tag: 'live' },
    { name: 'Casino — Dice', emoji: '🎰', blurb: 'Provably-fair dice you can verify yourself. Native token, entertainment — never real money.', url: URLS.casino, tag: 'live' },
    { name: 'Daily Spin', emoji: '🎡', blurb: 'One free spin a day for PLAY points. No purchase, no cashout — just a daily reason to come back.', url: URLS.spin, tag: 'live' },
    { name: 'Tribulum — Farm', emoji: '🚜', blurb: 'Plant, grow, harvest, sell. A living farm economy; Ranch and beyond are coming.', url: URLS.tribulum, tag: 'live' },
  ] },
  { key: 'earn', title: 'Earn', lead: 'Turn attention, effort, and stake into value — on one account.', items: [
    { name: 'Move — walk to earn', emoji: '🚶', blurb: 'Your steps mine real MELEK. Walk, earn, withdraw. On Android now.', url: URLS.move, tag: 'live' },
    { name: 'Seed Shop', emoji: '🌱', blurb: 'Buy seeds, tools and compost for the farm — the inputs that grow your yield.', url: URLS.shop, tag: 'live' },
    { name: 'Farm KULA', emoji: '🌾', blurb: 'Provide liquidity, farm KULA, and stake for boosts and a share of the pot.', url: URLS.farm, tag: 'live' },
    { name: 'KulaSwap — DEX', emoji: '🔁', blurb: 'Swap the ecosystem\'s tokens, add liquidity, and take part in the market.', url: URLS.dex, tag: 'live' },
    { name: 'veKULA + Gauges', emoji: '🗳️', blurb: 'Lock KULA for voting power and steer where the rewards flow.', url: URLS.gauge, tag: 'alpha' },
  ] },
  { key: 'own', title: 'One account, one wallet', lead: 'Everything above shares the same MELEK account — your coins, your character, your standing, everywhere.', items: [
    { name: 'Your MELEK account', emoji: '👤', blurb: 'Post, curate, play and earn on one identity. New here? It\'s free to join.', url: URLS.chain, tag: 'live' },
    { name: 'Akasha wallet', emoji: '👛', blurb: 'Hold and send your PRANA-side tokens; resolve .melek names.', url: URLS.wallet, tag: 'alpha' },
    { name: 'Witness School', emoji: '🎓', blurb: 'Learn to do any of it — mine, run a pool, make a token, curate — step by step.', url: URLS.school, tag: 'live' },
  ] },
];

const STYLE = `<style>
  :root{--bg:#0b0b0f;--panel:#15151c;--line:#26262f;--fg:#e9e9ee;--mut:#9a9aa6;--acc:#8b7cff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--acc);text-decoration:none} a:hover{text-decoration:underline}
  .wrap{max-width:980px;margin:0 auto;padding:24px 18px}
  header.hero{text-align:center;padding:28px 12px 8px}
  header.hero h1{font-size:2rem;margin:0 0 6px} header.hero .sub{color:var(--mut);font-size:1.05rem;max-width:640px;margin:0 auto}
  .badge{display:inline-block;font-size:.7rem;background:#8b7cff22;color:var(--acc);border:1px solid var(--line);border-radius:20px;padding:2px 10px;margin-bottom:10px}
  .whatfor{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:16px 0;color:var(--mut);font-size:.95rem}
  .whatfor b{color:var(--fg)}
  section.grp{margin:26px 0} section.grp h2{font-size:1.25rem;margin:0 0 2px} section.grp .lead{color:var(--mut);margin:0 0 12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
  .card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 16px}
  .card:hover{border-color:var(--acc);text-decoration:none;transform:translateY(-1px)}
  .card .t{font-weight:700;font-size:1.02rem;color:var(--fg)} .card .e{font-size:1.3rem;margin-right:6px}
  .card .b{color:var(--mut);font-size:.88rem;margin-top:6px}
  .tag{float:right;font-size:.62rem;text-transform:uppercase;letter-spacing:.04em;border-radius:10px;padding:1px 7px;border:1px solid var(--line)}
  .tag.live{color:var(--up)} .tag.alpha{color:var(--gold)}
  footer{color:var(--mut);font-size:.8rem;text-align:center;padding:26px 18px;margin-top:20px;border-top:1px solid var(--line);line-height:1.7}
</style>`;

export function homePage() {
  const groups = SECTIONS.map((s) => {
    const cards = s.items.map((it) =>
      `<a class=card href="${esc(it.url)}" rel="noopener"><span class="tag ${esc(it.tag)}">${esc(it.tag)}</span>`
      + `<div class=t><span class=e>${esc(it.emoji)}</span>${esc(it.name)}</div>`
      + `<div class=b>${esc(it.blurb)}</div></a>`).join('');
    return `<section class=grp><h2>${esc(s.title)}</h2><p class=lead>${esc(s.lead)}</p><div class=grid>${cards}</div></section>`;
  }).join('');
  const body = `<header class=hero>
      <div class=badge>Alpha</div>
      <h1>PRANA is where you play &amp; earn</h1>
      <p class=sub>An arcade, a casino, a farm, a daily spin, and walk-to-earn — all on one MELEK account. The mining
        keeps it honest; this is what it's <em>for</em>.</p>
    </header>
    <div class=whatfor><b>New here?</b> PRANA is the ecosystem's compute chain — but you don't have to mine to use it.
      Everything below runs on the same account you post and curate with on <a href="${esc(URLS.chain)}">MELEK</a>.
      Pick anything and start.</div>
    ${groups}`;
  return page(`${SITE_NAME} — play & earn on the MELEK ecosystem`, body, { canonical: `${BASE_URL}/` });
}

function page(title, body, opts = {}) {
  const desc = opts.description || 'PRANA is where you play and earn on the MELEK ecosystem — arcade, provably-fair casino, farming, a free daily spin, and walk-to-earn, all on one account. Mining secures it; this is what it\'s for.';
  const head = headTags({ title, description: desc, canonical: opts.canonical || `${BASE_URL}/`, siteName: SITE_NAME, jsonld: opts.jsonld || null });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
${head}${STYLE}<style>body{padding-bottom:64px}</style>${impactUtt()}</head><body><main class=wrap>${body}</main>
<footer>PRANA Games · one MELEK account across every surface · <a href="${esc(URLS.chain)}">melek.salon</a> · <a href="${esc(URLS.school)}">learn how</a><br>
Native-token entertainment — not real money. Free daily spin is a no-purchase sweepstakes; points are for play.</footer>
${renderMobileNav({ active: 'explore', baseUrls: { explore: `${BASE_URL}/`, profile: URLS.chain, wallet: URLS.wallet } })}
</body></html>`;
}

const ALL_URLS = () => Object.values(URLS);
export const SITEMAP_PATHS = ['/'];

function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, [{ path: '/', lastmod: new Date().toISOString().slice(0, 10), changefreq: 'daily', priority: '1.0' }]));
    }
    if (path === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'PRANA is where you play and earn on the MELEK ecosystem — arcade, provably-fair native-token casino, farming, a free daily-spin sweepstakes, walk-to-earn — all on one account. Mining secures the chain; this hub is what it is for.',
        links: SECTIONS.flatMap((s) => s.items.map((it) => ({ label: `${it.name} — ${s.title}`, path: it.url }))),
      }));
    }
    if (path === '/') return sendHtml(res, homePage());
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

export { siteGraph, jsonLdScript, ALL_URLS };

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/games\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`PRANA Games on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
