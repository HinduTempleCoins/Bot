// server.mjs — Tribulum.SoapBox.Community · the FARM tier, as a standalone zero-dependency HTTP
// service in the SoapBox house style (mirrors site/insurance/server.mjs). It fronts the pure game
// core (integrations/games/tribulum.mjs) — the grow → harvest → sell loop over the existing crop +
// item catalogs — as ONE playable Farm page:
//   - a plot GRID (per-account, in-memory) rendered by the game core,
//   - PLANT: pick a seed from the shop catalog (farm-items.mjs) onto an empty plot,
//   - see GROWTH STAGES tick with time (time-based, from each crop's grow time),
//   - HARVEST a ripe plot → crop units, then SELL to the market → in-game Grain (economy.mjs pricing).
//
//   PORT=8192 BASE_URL=https://tribulum.soapbox.community node site/tribulum/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the Farm — plot grid + seed picker + market + Grain balance
//   /plant             ?account=&plot=&seed=[&now=]  plant a seed on a plot   → back to /
//   /harvest           ?account=&plot=[&now=]        harvest a ripe plot (adds to inventory) → /
//   /sell              ?account=                     sell the whole harvest inventory → Grain → /
//   /api/farm          ?account=[&now=]              GET the account's farm + inventory as JSON (offline)
//   /health            liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   IN-GAME ONLY. Currency is Grain / KULA (an internal unit) — NO fiat, no cash-out here; nothing
//   touches the MELEK Graphene op set. Alpha / testnet framing on every surface. The clock is passed
//   into the pure core (never Date.now() inside game logic). esc() on every interpolated value.
//   Soft-fail: every route renders even when an action is rejected; a bad move never 500s.

import { createServer } from 'node:http';

import {
  openFarm, plant, harvest, sell, growthStage, renderFarm, seedShop, unitPrice, createStore, CURRENCY,
} from '../../integrations/games/tribulum.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8192);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SITE_NAME = 'Tribulum Farm';

// ── per-account game state (in-memory; injectable core store) ───────────────────────────────────
// The farm store is the tribulum core's store; a parallel map holds each account's un-sold harvest.
const STORE = createStore();
const INVENTORY = new Map(); // account -> [ item, … ] harvested-but-unsold
const BALANCE = new Map();   // account -> Grain balance

const acctOf = (url) => String(url.searchParams.get('account') || 'guest').slice(0, 64) || 'guest';
const nowOf = (url) => {
  const raw = url.searchParams.get('now');
  const n = raw == null || raw === '' ? Date.now() : Number(raw);
  return Number.isFinite(n) ? n : Date.now();
};
const invOf = (a) => INVENTORY.get(a) || (INVENTORY.set(a, []), INVENTORY.get(a));

// ── shared house-style helpers (same dark theme as the other verticals) ─────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:11px;background:#58a6ff22;color:var(--blue);border:1px solid var(--blue);border-radius:8px;padding:1px 7px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:0 0 10px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .bal{font-weight:800;color:var(--gold)}
  .farm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin:12px 0}
  .plot{border:1px solid var(--line2);border-radius:10px;padding:12px;background:#0b0f14;display:flex;flex-direction:column;gap:3px;min-height:96px}
  .plot.empty{opacity:.6} .plot.planted{border-color:var(--line2)} .plot.ripe{border-color:var(--up);box-shadow:0 0 0 1px var(--up) inset}
  .plot .pi{font-size:11px;color:var(--mut)} .plot .crop{font-weight:700} .plot .stage{font-size:12px;color:var(--blue)}
  .plot .pct{font-size:11px;color:var(--mut)} .plot .rarity{font-size:11px;color:var(--mut)}
  .plot .rarity.rare{color:var(--blue)} .plot .rarity.legendary{color:var(--gold)}
  form.act{display:inline-flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0}
  select,input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 12px;font-size:14px}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:9px 16px;font-size:14px}
  button:hover{border-color:var(--blue)}
  table{width:100%;border-collapse:collapse;margin:8px 0;font-size:14px}
  th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)} th{color:var(--mut);font-weight:600;font-size:13px}
  .alpha-note{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Tribulum Farm — grow, harvest, sell.</b> An in-game economy: currency is <b>Grain / KULA</b>, an
  internal unit — <b>no fiat, no cash-out</b>. Entertainment only, alpha / testnet framing, not investment.
  <div style="margin-top:8px"><a href="/">Farm</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Tribulum Farm — plant seeds, watch them grow through their stages, harvest the crop, and sell it to the market for in-game Grain. The grow → harvest → sell core loop. In-game economy only.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/?account={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🌱 Tribulum <span>farm</span></a><span class=alpha>Alpha</span>
  <div class=topbar-r><a href="/">Farm</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the Farm page ────────────────────────────────────────────────────────────────────────────────
export function farmPage(account = 'guest', now = Date.now()) {
  const acct = String(account || 'guest');
  const farm = openFarm(STORE, acct);
  const grid = renderFarm(farm, now);
  const seeds = seedShop();
  const inv = invOf(acct);
  const bal = BALANCE.get(acct) || 0;

  const seedOpts = seeds.map((s) =>
    `<option value="${esc(s.id)}">${esc(s.name)} — ${esc(s.rarity)} (${esc(s.tierLabel || s.growTier || '')})</option>`).join('');
  const plotOpts = farm.plots.map((p, i) =>
    `<option value="${i}">#${i}${p ? ` · ${esc(p.name)}` : ' · empty'}</option>`).join('');

  const invRows = inv.length
    ? inv.map((it) => `<tr><td>${esc(it.name)}</td><td>${esc(it.rarity)}</td><td>${esc(String(it.units))}</td><td>${esc(String(unitPrice(it.rarity)))} ${esc(CURRENCY)}/unit</td></tr>`).join('')
    : `<tr><td colspan=4 class=muted>Nothing harvested yet — plant a seed, let it ripen, then harvest.</td></tr>`;

  const hidden = `<input type=hidden name=account value="${esc(acct)}">`;
  const body = `<h1>Tribulum Farm <span class=muted style="font-size:14px">· grow → harvest → sell</span></h1>
    <p class=muted>Playing as <b>${esc(acct)}</b> · balance <span class=bal>${esc(String(bal))} ${esc(CURRENCY)}</span>
      · <span class=muted>tip: append <code>?account=yourname</code> for your own farm.</span></p>
    <div class="alpha-note" role="note">Alpha — in-game economy only. Currency is Grain / KULA, an internal unit; there is no fiat and no cash-out. Not investment advice.</div>

    <div class=card><h2>Your plots</h2>${grid}</div>

    <div class=card><h2>Plant</h2>
      <form class=act method=get action="/plant">${hidden}
        <label class=muted>Seed <select name=seed>${seedOpts}</select></label>
        <label class=muted>Plot <select name=plot>${plotOpts}</select></label>
        <button type=submit>Plant</button>
      </form>
      <p class=muted style="font-size:13px;margin-top:8px">Seeds come from the shop catalog. Longer-tier crops take longer to ripen but yield far more.</p>
    </div>

    <div class=card><h2>Harvest</h2>
      <form class=act method=get action="/harvest">${hidden}
        <label class=muted>Plot <select name=plot>${plotOpts}</select></label>
        <button type=submit>Harvest</button>
      </form>
      <p class=muted style="font-size:13px;margin-top:8px">A plot must be <b>ripe</b> before you can harvest it.</p>
    </div>

    <div class=card><h2>Market — your harvest</h2>
      <table><thead><tr><th>Crop</th><th>Rarity</th><th>Units</th><th>Price</th></tr></thead><tbody>${invRows}</tbody></table>
      <form class=act method=get action="/sell">${hidden}
        <button type=submit>Sell all → ${esc(CURRENCY)}</button>
      </form>
      <p class=muted style="font-size:13px;margin-top:8px">The market prices each crop by scarcity — rarer crops clear for more Grain.</p>
    </div>`;
  return page(`${SITE_NAME} — grow, harvest, sell`, body, { canonical: `${BASE_URL}/` });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}
function redirect(res, location) { res.writeHead(302, { location }); res.end(); }

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
        summary: 'Tribulum Farm — the grow → harvest → sell core loop over the Tribulum crop + item catalogs. In-game Grain/KULA economy only; no fiat, no cash-out. Alpha.',
        links: [{ label: 'Farm', path: '/' }],
      }));
    }

    const account = acctOf(url);
    const now = nowOf(url);

    if (path === '/api/farm') {
      const farm = openFarm(STORE, account);
      const plots = farm.plots.map((p, i) => {
        if (!p) return { plot: i, empty: true };
        const g = growthStage({ plot: p, now });
        return { plot: i, seedId: p.seedId, symbol: p.symbol, name: p.name, rarity: p.rarity,
          stage: g.ok ? g.stage : null, fraction: g.ok ? g.fraction : 0, ripe: !!(g.ok && g.ripe), readyAt: p.readyAt };
      });
      const data = { account, now, size: farm.size, plots,
        inventory: invOf(account), balance: BALANCE.get(account) || 0, currency: CURRENCY };
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(data, null, 2));
    }

    if (path === '/plant') {
      const farm = openFarm(STORE, account);
      plant({ farm, plotIndex: url.searchParams.get('plot'), seedId: url.searchParams.get('seed'), now });
      return redirect(res, `/?account=${encodeURIComponent(account)}`);
    }

    if (path === '/harvest') {
      const farm = openFarm(STORE, account);
      const r = harvest({ farm, plotIndex: url.searchParams.get('plot'), now });
      if (r.ok && r.item) invOf(account).push(r.item);
      return redirect(res, `/?account=${encodeURIComponent(account)}`);
    }

    if (path === '/sell') {
      const inv = invOf(account);
      const r = sell({ items: inv });
      if (r.ok) {
        BALANCE.set(account, (BALANCE.get(account) || 0) + r.total);
        INVENTORY.set(account, []);
      }
      return redirect(res, `/?account=${encodeURIComponent(account)}`);
    }

    if (path === '/') return sendHtml(res, farmPage(account, now));

    // unknown → home
    return redirect(res, '/');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose for tests
export { siteGraph, jsonLdScript, STORE, INVENTORY, BALANCE };

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/tribulum\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`Tribulum Farm on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
