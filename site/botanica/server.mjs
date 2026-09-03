// site/botanica/server.mjs — the Botanica farm SURFACE: the first served UI over the new economy stack
// (plant-catalog + farmville-plants timing + botanica apothecary). The playable loop:
//   plant a Botanica plant → it grows (deterministic on `now`) → harvest → its MATERIALS enter your
//   inventory → craft an apothecary item (talisman/charm/potion/elixir/oil) whose recipe consumes those
//   materials → the item buffs cross-game stats, or sell raw materials for Grain.
//
// The theme is legible on the page: value = VERSATILITY (how many domains a material serves) — grain/oil
// out-value cannabis_flower, straight from plant-catalog.valueOf(). In-game Grain only; no fiat, no
// cash-out, no chain ops. Alpha.
//
// House style: esc() every interpolation; soft-fail (a rejected action re-renders, never 500s);
// handler(req,res) exported for tests; port bound only when run directly; ?now= overrides the clock.

import { createServer } from 'node:http';
import { PLANTS, MATERIALS, materialsForPlant, versatilityOf, valueOf } from '../../integrations/games/plant-catalog.mjs';
import { ITEMS, ITEM_RECIPES, ITEM_VALUE, canCraftItem, craftItem, applyEffect, bazaar } from '../../integrations/games/botanica.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8193);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'Botanica';
const CURRENCY = 'Grain';
const PLOT_COUNT = 6;

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── plant timing (alpha: short, deterministic; grow seconds by category) ────────────────────────
const PLANT_BY_ID = Object.fromEntries(PLANTS.map((p) => [p.id, p]));
const GROW_BY_CATEGORY = { cereal: 120, legume: 180, fiber: 300, oilseed: 300, herb: 150, aromatic: 200,
  spice: 240, dye: 200, resin: 360, oil: 300, beverage: 240, sugar: 300, root: 200, gum: 360, medicinal: 200 };
const growSeconds = (plantId) => GROW_BY_CATEGORY[PLANT_BY_ID[plantId]?.category] || 240;

// Curated starters — cover the apothecary recipes (essential_oil/resin/dye/flower/herb/bean/oil/grain).
export const STARTERS = ['wheat', 'sunflower', 'hemp', 'lavender', 'marigold', 'pine', 'mint', 'coffee', 'sugarcane', 'chamomile', 'cannabis']
  .filter((id) => PLANT_BY_ID[id]);
const BOTANICA_ITEM_IDS = new Set(ITEMS.map((i) => i.id));
const isMaterial = (k) => !BOTANICA_ITEM_IDS.has(k);

// ── per-account in-memory state ─────────────────────────────────────────────────────────────────
const PLOTS = new Map();   // account -> [ {plantId, plantedAt} | null ] length PLOT_COUNT
const INV = new Map();     // account -> { key: qty }  (raw materials AND crafted items)
const BALANCE = new Map(); // account -> Grain

const acctOf = (url) => (String(url.searchParams.get('account') || 'guest').slice(0, 64) || 'guest');
const nowOf = (url) => {
  const q = url.searchParams.get('now');
  return q != null && q !== '' ? Number(q) : Math.floor(Date.now() / 1000);
};
const plotsOf = (a) => PLOTS.get(a) || (PLOTS.set(a, Array(PLOT_COUNT).fill(null)), PLOTS.get(a));
const invOf = (a) => INV.get(a) || (INV.set(a, {}), INV.get(a));
const balOf = (a) => BALANCE.get(a) || 0;

function plotState(plot, now) {
  if (!plot) return { empty: true };
  const p = PLANT_BY_ID[plot.plantId];
  const grow = growSeconds(plot.plantId);
  const elapsed = Math.max(0, now - plot.plantedAt);
  const ready = elapsed >= grow;
  return { empty: false, plantId: plot.plantId, name: p?.name || plot.plantId,
    ready, fraction: Math.min(1, grow ? elapsed / grow : 1), readyIn: Math.max(0, grow - elapsed), yields: materialsForPlant(plot.plantId) };
}

// ── HTML ────────────────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#0d130d;color:#dfe8df}
a{color:#8fd08f}header{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#10180f;border-bottom:1px solid #1f2a1c}
.alpha{position:fixed;top:8px;left:8px;background:#3a2f0a;color:#ffd766;font-size:11px;padding:2px 7px;border-radius:4px;border:1px solid #6b551a;z-index:9}
main{max-width:960px;margin:0 auto;padding:16px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.plot{background:#11190f;border:1px solid #23331e;border-radius:8px;padding:10px;min-height:76px}
.bar{height:6px;background:#20301c;border-radius:3px;overflow:hidden;margin:6px 0}.bar>i{display:block;height:100%;background:#5fbf5f}
.ripe{color:#9be89b;font-weight:600}table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{border-bottom:1px solid #1f2a1c;padding:5px 8px;text-align:left;font-size:14px}
button,select{font:inherit;background:#1c2a18;color:#dfe8df;border:1px solid #33472c;border-radius:6px;padding:5px 9px}
button:hover{background:#24371f;cursor:pointer}.card{background:#11190f;border:1px solid #23331e;border-radius:8px;padding:12px;margin:12px 0}
.muted{color:#89988a;font-size:13px}.bal{color:#ffd766;font-weight:600}h2{font-size:17px;margin:.4em 0}
</style>`;

function optionList(items, fmt) { return items.map(fmt).join(''); }

function page(account, now) {
  const plots = plotsOf(account);
  const inv = invOf(account);
  const bal = balOf(account);
  const hidden = `<input type=hidden name=account value="${esc(account)}"><input type=hidden name=now value="${esc(String(now))}">`;

  const plotCards = plots.map((plot, i) => {
    const s = plotState(plot, now);
    if (s.empty) {
      return `<div class=plot><div class=muted>Plot ${i} · empty</div>
        <form action=/plant method=get>${hidden}<input type=hidden name=plot value="${i}">
        <select name=plant>${optionList(STARTERS, (id) => `<option value="${esc(id)}">${esc(PLANT_BY_ID[id].name)}</option>`)}</select>
        <button>Plant</button></form></div>`;
    }
    const pct = Math.round(s.fraction * 100);
    const action = s.ready
      ? `<form action=/harvest method=get style=display:inline>${hidden}<input type=hidden name=plot value="${i}"><button>Harvest → ${esc(s.yields.join(', '))}</button></form>`
      : `<span class=muted>ready in ${esc(String(s.readyIn))}s</span>`;
    return `<div class=plot><div><b>${esc(s.name)}</b> ${s.ready ? '<span class=ripe>ripe</span>' : ''}</div>
      <div class=bar><i style="width:${pct}%"></i></div>${action}</div>`;
  }).join('');

  const matRows = Object.entries(inv).filter(([k]) => isMaterial(k)).map(([k, q]) =>
    `<tr><td>${esc(k)}</td><td>${esc(String(q))}</td><td>${esc(String(versatilityOf(k)))}</td><td>${esc(String(valueOf(k)))} ${CURRENCY}</td></tr>`).join('')
    || `<tr><td colspan=4 class=muted>No materials yet — plant and harvest.</td></tr>`;

  const craftedRows = Object.entries(inv).filter(([k]) => !isMaterial(k)).map(([k, q]) => {
    const it = ITEMS.find((x) => x.id === k);
    return `<tr><td>${esc(it?.name || k)} ×${esc(String(q))}</td><td>${esc(it?.effect.stat || '')} +${esc(String(it?.effect.pct || 0))}%</td><td>${esc(String(ITEM_VALUE[k] || 0))} ${CURRENCY}</td></tr>`;
  }).join('') || `<tr><td colspan=3 class=muted>Nothing crafted yet.</td></tr>`;

  const benchRows = ITEMS.map((it) => {
    const can = canCraftItem(it.id, inv);
    const need = it.recipe.map((r) => `${r.qty}×${r.item}`).join(' + ');
    const btn = can ? `<form action=/craft method=get style=display:inline>${hidden}<input type=hidden name=item value="${esc(it.id)}"><button>Craft</button></form>` : '<span class=muted>need materials</span>';
    return `<tr><td>${esc(it.name)}</td><td class=muted>${esc(need)}</td><td>${esc(it.effect.stat)} +${esc(String(it.effect.pct))}%</td><td>${btn}</td></tr>`;
  }).join('');

  const body = `<div class=alpha>Alpha</div>
  <header><b>🌿 ${SITE_NAME}</b><span class=muted>Playing as <b>${esc(account)}</b> · balance <span class=bal>${esc(String(bal))} ${CURRENCY}</span></span></header>
  <main>
    <p class=muted>The Botanica farm. Plant → grow → harvest materials → craft apothecary items. <b>Value = versatility</b>: a material's worth is how many domains it serves.</p>
    <div class=grid>${plotCards}</div>

    <div class=card><h2>Materials</h2>
      <table><tr><th>material</th><th>qty</th><th>versatility</th><th>value</th></tr>${matRows}</table>
      <form action=/sell method=get style=display:inline>${hidden}<button>Sell all materials → ${CURRENCY}</button></form></div>

    <div class=card><h2>Apothecary bench</h2>
      <table><tr><th>item</th><th>recipe</th><th>effect</th><th></th></tr>${benchRows}</table></div>

    <div class=card><h2>Crafted (your talismans & potions)</h2>
      <table><tr><th>item</th><th>effect</th><th>value</th></tr>${craftedRows}</table></div>

    <p class=muted>In-game ${CURRENCY} only — no fiat, no cash-out. <a href="/api/state?account=${esc(account)}">state JSON</a></p>
  </main>`;
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(SITE_NAME)} — farm</title>${STYLE}</head><body>${body}</body></html>`;
}

function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}
const redirect = (res, loc) => { res.writeHead(302, { location: loc }); res.end(); };

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'daily', priority: '1.0' }))));
    }
    if (path === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({ name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'Botanica — plant → grow → harvest materials → craft apothecary items over the plant-catalog + botanica economy. Value = versatility. In-game Grain only; no fiat. Alpha.',
        links: [{ label: 'Farm', path: '/' }] }));
    }

    const account = acctOf(url);
    const now = nowOf(url);
    const back = `/?account=${encodeURIComponent(account)}&now=${now}`;

    if (path === '/api/state') {
      const plots = plotsOf(account).map((p, i) => ({ plot: i, ...plotState(p, now) }));
      const data = { account, now, currency: CURRENCY, balance: balOf(account),
        inventory: invOf(account), plots, bazaar: bazaar() };
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(data, null, 2));
    }

    if (path === '/plant') {
      const plots = plotsOf(account);
      const idx = Number(url.searchParams.get('plot'));
      const plantId = String(url.searchParams.get('plant') || '');
      if (Number.isInteger(idx) && idx >= 0 && idx < PLOT_COUNT && !plots[idx] && PLANT_BY_ID[plantId]) {
        plots[idx] = { plantId, plantedAt: now };
      }
      return redirect(res, back);
    }

    if (path === '/harvest') {
      const plots = plotsOf(account);
      const idx = Number(url.searchParams.get('plot'));
      const plot = Number.isInteger(idx) ? plots[idx] : null;
      const s = plotState(plot, now);
      if (!s.empty && s.ready) {
        const inv = invOf(account);
        for (const m of s.yields) inv[m] = (inv[m] || 0) + 1; // one unit of each yielded material
        plots[idx] = null;
      }
      return redirect(res, back);
    }

    if (path === '/craft') {
      const itemId = String(url.searchParams.get('item') || '');
      const inv = invOf(account);
      if (canCraftItem(itemId, inv)) INV.set(account, craftItem(itemId, inv)); // consumes materials, mints item
      return redirect(res, back);
    }

    if (path === '/sell') {
      const inv = invOf(account);
      let total = 0;
      for (const [k, q] of Object.entries(inv)) {
        if (isMaterial(k)) { total += (valueOf(k) || 0) * q; delete inv[k]; }
      }
      if (total > 0) BALANCE.set(account, balOf(account) + total);
      return redirect(res, back);
    }

    if (path === '/') return sendHtml(res, page(account, now));
    return redirect(res, back);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose for tests
export { PLOTS, INV, BALANCE, plotState, growSeconds };

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/botanica\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`Botanica on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
