// site/kush-farm/server.mjs — the Kush Farm play page (Pot-Farm / RS3-style). Surfaces the kush-farm model:
// the live REAL season (with the Fall Harvest Festival banner), what's plantable RIGHT NOW, and the strain
// catalog by grow tier — the two axes (grow time × season), inverse-inflation (seeds-back), multi-harvest,
// volunteers. Pure server-render from integrations/games/kush-farm.mjs (deterministic; the on-chain
// plant/harvest is the SeasonalFarm contract, wired later). House style: ESM, esc(), handler(req,res), Alpha.
//
//   PORT=8160 node site/kush-farm/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { catalog, currentSeason, SEASONS, TIERS } from '../../integrations/games/kush-farm.mjs';

const PORT = +(process.env.PORT || 8160);
const HOST = process.env.HOST || '127.0.0.1';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

const RARITY = { common: '#93a1b3', uncommon: '#36c08a', rare: '#4c8dff', legendary: '#d9a441' };
const TIER_ORDER = ['day', 'week', 'month', 'season', 'year'];

function strainCard(s) {
  const flags = [];
  if (s.season === 'year-round') flags.push('<span class="tag yr">year-round</span>');
  else flags.push(`<span class="tag se">${esc(s.season)}-only</span>`);
  if (s.multiHarvest > 1) flags.push(`<span class=tag>🍎 ×${esc(s.multiHarvest)} harvests</span>`);
  if (s.volunteer) flags.push('<span class=tag>🌱 volunteers</span>');
  if (s.flower) flags.push('<span class=tag>🌷 flower</span>');
  if (s.festival) flags.push('<span class=tag>🍂 festival</span>');
  return `<div class="strain${s.plantableNow ? ' on' : ''}">
    <div class=sh><b style="color:${RARITY[s.rarity] || '#e9eef5'}">${esc(s.name)}</b>${s.plantableNow ? '<span class=plant>plant now</span>' : ''}</div>
    <div class=meta>${flags.join(' ')}</div>
    <div class=stat>yield <b>${esc(s.yield)} KULA</b> · seeds back <b>${esc(s.seedsBack)}</b></div>
  </div>`;
}

function page() {
  const cat = catalog();
  const se = SEASONS[cat.season] || { label: cat.season, emoji: '🌿' };
  const byTier = (t) => cat.strains.filter((s) => s.tier === t);
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Kush Farm — MELEK</title>
<meta name=description content="The MELEK Kush Farm — grow strains across the real seasons, harvest for KULA.">
<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
 .wrap{max-width:920px;margin:0 auto}
 header{display:flex;align-items:center;gap:10px;margin:6px 0 4px}.brand{font-size:24px;font-weight:800}.brand b{color:var(--green)}
 .alpha{font-size:10px;font-weight:700;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
 .lead{color:var(--mut);font-size:14px;margin:2px 0 14px}
 .season{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:12px 16px;margin-bottom:14px}
 .season .big{font-size:18px;font-weight:800}.season.fest{border-color:var(--gold);background:linear-gradient(90deg,rgba(217,164,65,.12),transparent)}
 .season .fb{margin-left:auto;color:var(--gold);font-weight:700;font-size:13px}
 h2{font-size:15px;margin:16px 0 8px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}
 .tier{margin-bottom:6px}.tier .tl{font-weight:800;color:var(--fg)}.tier .tb{color:var(--mut);font-size:12px;margin:2px 0 8px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
 .strain{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:11px}.strain.on{border-color:var(--green)}
 .sh{display:flex;align-items:center;gap:8px}.plant{margin-left:auto;font-size:10px;font-weight:700;color:#062018;background:var(--green);border-radius:6px;padding:2px 6px}
 .meta{margin:7px 0;display:flex;gap:5px;flex-wrap:wrap}.tag{font-size:10px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:2px 6px}
 .tag.yr{color:var(--green);border-color:var(--green)}.tag.se{color:var(--blue);border-color:var(--blue)}
 .stat{font-size:12px;color:var(--mut)}.stat b{color:var(--fg)}
 footer{color:var(--mut);font-size:12px;text-align:center;margin:22px 0 8px}a{color:var(--gold)}
</style></head><body><div class=wrap>
<header><span class=brand>🌿 <b>Kush</b> Farm</span><span class=alpha>Alpha</span></header>
<p class=lead>Grow your own — strains across the <b>real seasons</b>. Dailies pour out like water (the milk that feeds the games); year grows are the gold. Harvest for <b>KULA</b>.</p>
<div class="season${cat.festival ? ' fest' : ''}"><span class=big>${esc(se.emoji)} ${esc(se.label)}</span>
  <span class=mut style="color:var(--mut)">— this season's exclusive strains are plantable now</span>
  ${cat.festival ? '<span class=fb>🍂 Harvest Festival!</span>' : ''}</div>
<h2>The grow tiers</h2>
${TIER_ORDER.map((t) => TIERS[t] ? `<div class=tier><span class=tl>${esc(TIERS[t].label)}</span> <span class=tb>${esc(TIERS[t].blurb)}</span></div>` : '').join('')}
<h2>Strains</h2>
${TIER_ORDER.map((t) => { const list = byTier(t); return list.length ? `<h2 style="color:var(--green)">${esc(TIERS[t] ? TIERS[t].label : t)}</h2><div class=grid>${list.map(strainCard).join('')}</div>` : ''; }).join('')}
<footer>Market first, growing is the fallback — essentials grow fast so a dry market never blocks you; rare strains take a season or a year (the wait is the value). Compost burns the overflow. <a href="/api/catalog">api</a> · <a href="https://arcade.soapbox.community">← GTArcade</a></footer>
</div></body></html>`;
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://kush.local');
    if (url.pathname === '/health') return json(res, 200, { ok: true, season: currentSeason() });
    if (url.pathname === '/api/catalog') return json(res, 200, { ok: true, ...catalog() });
    if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`Kush Farm on http://${HOST}:${PORT} — ${currentSeason()}`));
}
