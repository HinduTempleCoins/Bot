// server.mjs — The Frontier (map.soapbox.community / tools hub /map). The persistent-world MAP surface
// for the HUD Game: a small bounded HEX board (axial coords) rendered as SVG <polygon>s, each tile typed
// by resource affinity and individually claimable. This is the Phase-1 playable demo that makes the
// already-built economy VISIBLE on a map (HUD_GAME_DESIGN §2c / GAME_MAP_MECHANICS §4 + §6).
//
//   PORT=8260 BASE_URL=https://map.soapbox.community node site/map/server.mjs
//
// ── What the SERVER does vs the CLIENT ────────────────────────────────────────────────────────────
//   SERVER: ships a static shell — the SVG hex-board scaffold + the board/affinity data + a default
//     player state, serialized into the page. It does ZERO request-time network (pure string build over
//     the tested integrations/games/map.mjs). Crawlers get real SVG hexes server-rendered.
//   CLIENT: all interaction — select a tile, claim it, place/collect an extraction node, staff a node
//     with a creature, and run the "while you were away" check-in accrual. Solo-instanced player state
//     persists to localStorage (try/catch guarded). No realtime tick, no socket.
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated value; safeHref() on any URL. BASE_PATH-aware self-URLs (default '' →
//   standalone unchanged) so it mounts on the Tools/HUD hub. Claim is OFF-CHAIN first — the deed mint is
//   a stubbed call-descriptor labelled "will settle on-chain"; this server holds no key and broadcasts
//   nothing. Deeds are UTILITY (a production-capacity sink), never a return/appreciation promise. Original
//   world/art — procedural SVG only, no canvas, no raster assets, no PvP. Soft-fail: unknown path → 404.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import {
  AFFINITIES, NODE_KINDS, MAX_ACCRUAL_INTERVALS,
  createPlayer, boardFor, mapView, hexCorners, hexKey,
} from '../../integrations/games/map.mjs';

const PORT = +(process.env.PORT || 8260);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'The Frontier';
const DEFAULT_SEED = +(process.env.MAP_SEED || 7);
const DEFAULT_RADIUS = 2;
// Starting kit so a first-time visitor can immediately claim a tile and start producing (demo).
const STARTING_MATERIALS = { stone: 12, wood: 12 };

// ── Tools-hub path awareness (mirrors site/idlegames) ─────────────────────────────────────────────
// A path-routing proxy at tools.soapbox.community/<app> STRIPS the prefix inbound; we PREPEND it to
// every self-URL we EMIT. BASE_PATH defaults to '' → standalone behaviour is byte-for-byte unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;
const SLUG = 'map';
const HUB_SIBLINGS = [['/games', 'Games'], ['/idlegames', 'Arcade'], ['/farm', 'Farm']];
const TOOLS_NAV = `<a class=hublink href="${hub('/')}">◧ SoapBox</a>`
  + HUB_SIBLINGS.filter(([p]) => p !== '/' + SLUG).slice(0, 2).map(([p, l]) => `<a href="${hub(p)}">${esc(l)}</a>`).join('');

// ── house-style helpers ───────────────────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
// safeHref: only real http(s) URLs pass; everything else (javascript:, data:, junk) → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── styling (dark; theme = SoapBox game surfaces). Affinity colors as CSS vars. ────────────────────
const STYLE = `<style>
  :root{--bg:#0c0e14;--panel:#151823;--line:#232838;--line2:#333a50;--fg:#e8ecf5;--mut:#8b93a7;--acc:#6ea8ff;--gold:#e0a92e;--up:#54c96a;--down:#f8595a;
    --a-home:#6ea8ff;--a-fertile:#54c96a;--a-ore:#c98b54;--a-timber:#8a6a3e;--a-water:#4fc3d4;--a-wild:#a06ed4;--a-fog:#1a1f2b}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--acc);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--acc);color:var(--acc);text-decoration:none}
  .wrap{max-width:1080px;margin:0 auto;padding:20px 20px 60px}
  h1{margin:0 0 4px;font-size:26px} .sub{color:var(--mut);margin:0 0 14px;font-size:15px}
  .muted{color:var(--mut)}
  .layout{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;align-items:start} @media(max-width:780px){.layout{grid-template-columns:1fr}}
  .board-wrap{background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:10px;overflow-x:auto}
  svg.board{display:block;width:100%;height:auto;max-width:100%;touch-action:manipulation}
  polygon.hex{stroke:#0c0e14;stroke-width:1.4;cursor:pointer;transition:opacity .1s}
  polygon.hex:hover{opacity:.82}
  polygon.hex[data-affinity=home]{fill:var(--a-home)} polygon.hex[data-affinity=fertile]{fill:var(--a-fertile)}
  polygon.hex[data-affinity=ore]{fill:var(--a-ore)} polygon.hex[data-affinity=timber]{fill:var(--a-timber)}
  polygon.hex[data-affinity=water]{fill:var(--a-water)} polygon.hex[data-affinity=wild]{fill:var(--a-wild)}
  polygon.hex[data-affinity=fog]{fill:var(--a-fog)}
  polygon.hex[data-owned="1"]{stroke:var(--gold);stroke-width:2.6}
  polygon.hex.sel{stroke:#fff;stroke-width:3}
  text.tlabel{fill:#0c0e14;font-size:9px;font-weight:800;pointer-events:none;text-anchor:middle}
  text.tnode{fill:#0c0e14;font-size:12px;pointer-events:none;text-anchor:middle}
  .panel{background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:16px 18px}
  .panel h2{font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}
  .res{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}
  .res .box{background:var(--bg);border:1px solid var(--line2);border-radius:9px;padding:5px 11px;font-size:14px}
  .res .box b{color:var(--gold);font-variant-numeric:tabular-nums}
  .tile-info{min-height:60px}
  .kv{color:var(--mut);font-size:13px;margin:2px 0}
  .btn{border:1px solid var(--line2);border-radius:9px;padding:8px 14px;font-weight:700;font-size:14px;color:var(--fg);background:var(--bg);cursor:pointer;margin:4px 6px 0 0}
  .btn:hover:not(:disabled){border-color:var(--acc);color:var(--acc)} .btn:disabled{opacity:.45;cursor:not-allowed}
  .btn.primary{background:#1f6feb;border-color:#1f6feb;color:#fff} .btn.primary:hover:not(:disabled){color:#fff;border-color:#3f8bff}
  .legend{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;font-size:12px;color:var(--mut)}
  .legend .sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-1px}
  .deed{background:var(--bg);border:1px solid var(--line2);border-radius:8px;padding:10px 12px;font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--mut);white-space:pre-wrap;word-break:break-word;margin-top:8px;display:none}
  .deed.on{display:block}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;background:var(--acc);color:#04101f;padding:10px 18px;border-radius:999px;font-weight:700;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}
  .toast.show{opacity:1}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:26px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--acc)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — the persistent-world map of the MELEK HUD Game. Claim tiles, place farms/mines/timber/wellsprings,
  staff them with creatures, and collect while you're away. Tile claims are <b>utility deeds</b> — a production-capacity sink,
  <b>not</b> a return or appreciation promise. Claim settles <b>off-chain first</b>; the deed mint is stubbed and
  <b>will settle on-chain</b> via the edge / MELEK-Signer. This site holds no keys. Alpha · testnet.
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'The Frontier — a claimable hex-tile map for the MELEK HUD Game. Typed tiles (fertile/ore/timber/water/wild), extraction nodes, creature staffing, and offline check-in accrual. Original world, procedural SVG.';
  const canonical = opts.canonical || `${BASE_URL}${bp('/')}`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    site: { url: BASE_URL, name: SITE_NAME },
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${bp('/')}">⬡ ${esc(SITE_NAME)}<span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}<a href="${bp('/')}">Map</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}<div class=toast id=toast></div></body></html>`;
}

// ── SVG board (server-rendered scaffold) ────────────────────────────────────────────────────────────
// Renders the default player's mapView as <polygon> hexes. The client re-renders from localStorage.
const HEX_SIZE = 34;

function buildBoardSvg(view) {
  // pixel bounds → viewBox with padding.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of view.tiles) {
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
    minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
  }
  const pad = HEX_SIZE + 6;
  const vbX = (minX - pad).toFixed(1), vbY = (minY - pad).toFixed(1);
  const vbW = (maxX - minX + pad * 2).toFixed(1), vbH = (maxY - minY + pad * 2).toFixed(1);
  const polys = view.tiles.map((t) => {
    const pts = hexCorners(t.x, t.y, HEX_SIZE);
    const nodeGlyph = t.node ? `<text class=tnode x="${t.x.toFixed(1)}" y="${(t.y + 5).toFixed(1)}">${esc(nodeEmoji(t.node))}</text>` : '';
    const label = t.affinity === 'fog' ? '' : `<text class=tlabel x="${t.x.toFixed(1)}" y="${(t.y - 12).toFixed(1)}">${esc(affinityShort(t.affinity))}</text>`;
    return `<polygon class=hex data-key="${esc(t.key)}" data-affinity="${esc(t.affinity)}" data-owned="${t.owned ? 1 : 0}" points="${pts}"><title>${esc(t.key)} · ${esc(t.affinity)}</title></polygon>${label}${nodeGlyph}`;
  }).join('\n');
  return `<svg class=board viewBox="${vbX} ${vbY} ${vbW} ${vbH}" role=img aria-label="Frontier hex map" id=board xmlns="http://www.w3.org/2000/svg">${polys}</svg>`;
}

function affinityShort(a) {
  return ({ home: 'HOME', fertile: 'FARM', ore: 'ORE', timber: 'WOOD', water: 'H₂O', wild: 'WILD', fog: '' })[a] || '';
}
function nodeEmoji(kind) {
  return ({ farm: '🌾', mine: '⛏️', timber: '🪵', water: '💧', expedition: '🧭' })[kind] || '•';
}

// ── legend + resources + tile panel (client fills the dynamic parts) ────────────────────────────────
function legendHtml() {
  const rows = Object.entries(AFFINITIES).map(([k, a]) =>
    `<span><span class=sw style="background:var(--a-${esc(k)})"></span>${esc(a.label)}</span>`).join('');
  return `<div class=legend>${rows}<span><span class=sw style="background:var(--a-fog)"></span>Fog</span></div>`;
}

// ── home page ───────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const player = createPlayer({ owner: 'frontier', seed: DEFAULT_SEED, radius: DEFAULT_RADIUS });
  const board = boardFor(player);
  const view = mapView(player, board);
  // full board affinities (true values) shipped to the client so it can lift fog locally (solo-instanced;
  // no anti-cheat needed off-chain — only the on-chain settle points are re-validated server-side, §4g).
  const boardData = Object.values(board.hexes).map((h) => ({ key: hexKey(h), affinity: h.affinity }));
  const cfg = {
    seed: DEFAULT_SEED, radius: DEFAULT_RADIUS, hexSize: HEX_SIZE,
    home: hexKey(board.home),
    starting: STARTING_MATERIALS,
    maxAccrual: MAX_ACCRUAL_INTERVALS,
    nodeKinds: NODE_KINDS,
    affinities: Object.fromEntries(Object.entries(AFFINITIES).map(([k, a]) => [k, { label: a.label, node: a.node, blurb: a.blurb }])),
    tiles: view.tiles.map((t) => ({ key: t.key, x: t.x, y: t.y })),
    board: boardData,
    basePath: BASE_PATH,
  };
  const body = `<h1>The Frontier <span class=muted style="font-size:14px">· claim the map, work the land</span></h1>
    <p class=sub>A bounded <b>hex board</b> (axial coords). Each tile is <b>typed</b> — fertile, ore, timber, water or wild —
      and individually <b>claimable</b>. Claim outward from your Home, place an extraction node that matches the tile,
      staff it with a creature, and collect what it made while you were away. <span class=muted>Deeds are utility, not an investment.</span></p>
    <div class=layout>
      <div>
        <div class=board-wrap>${buildBoardSvg(view)}</div>
        ${legendHtml()}
      </div>
      <div class=panel>
        <h2>Stores</h2>
        <div class=res id=resbar></div>
        <h2 style="margin-top:14px">Selected tile</h2>
        <div class=tile-info id=tileinfo><p class=muted>Tap a tile on the map to inspect it.</p></div>
        <div class=deed id=deed></div>
        <p class=muted style="font-size:12px;margin-top:14px">Your Frontier saves in this browser only. Nothing here needs an account.</p>
        <button class=btn id=resetbtn type=button style="font-size:12px">Reset Frontier</button>
      </div>
    </div>
    <script id=cfg type="application/json">${jsonScript(cfg)}</script>
    ${clientScript()}`;
  return page(`${SITE_NAME} — claim the HUD Game map`, body, { canonical: `${BASE_URL}${bp('/')}` });
}

// JSON safe to embed inside a <script> element (guard the closing-tag sequence).
function jsonScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

// ── client engine (self-contained; mirrors integrations/games/map.mjs rules for interaction) ────────
function clientScript() {
  return `<script>
(function(){
  var CFG; try{ CFG=JSON.parse(document.getElementById('cfg').textContent); }catch(e){ return; }
  var SVG=document.getElementById('board'); if(!SVG) return;
  var STORE='frontier_'+CFG.seed;
  var DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  function key(q,r){return q+','+r;}
  function parse(k){var m=/^(-?\\d+),(-?\\d+)$/.exec(k||'');return m?{q:+m[1],r:+m[2]}:null;}
  function neigh(k){var c=parse(k);if(!c)return [];return DIRS.map(function(d){return key(c.q+d[0],c.r+d[1]);});}
  function dist(a,b){var x=parse(a),y=parse(b);if(!x||!y)return 1e9;return (Math.abs(x.q-y.q)+Math.abs(x.q+x.r-y.q-y.r)+Math.abs(x.r-y.r))/2;}
  var AFF={}; CFG.board.forEach(function(h){AFF[h.key]=h.affinity;});
  var TILEPOS={}; CFG.tiles.forEach(function(t){TILEPOS[t.key]=t;});

  function fresh(){
    var home=CFG.home; var rev={}; rev[home]=1;
    neigh(home).forEach(function(k){ if(AFF[k]!=null) rev[k]=1; });
    var owned={}; owned[home]=1;
    return {owned:owned,revealed:rev,nodes:{},staff:{},resources:Object.assign({},CFG.starting)};
  }
  var S; try{ S=JSON.parse(localStorage.getItem(STORE)); }catch(e){}
  if(!S||typeof S!=='object'){ S=fresh(); }
  function save(){ try{ localStorage.setItem(STORE, JSON.stringify(S)); }catch(e){} }

  function toast(t){var el=document.getElementById('toast');if(!el)return;el.textContent=t;el.classList.add('show');setTimeout(function(){el.classList.remove('show');},2200);}
  function claimCost(k){ var owned=Object.keys(S.owned).length; var d=dist(CFG.home,k); return {stone:2*owned+d, wood:1+d}; }
  function afford(cost){ return Object.keys(cost).every(function(m){ return (+(S.resources[m]||0))>=cost[m]; }); }

  // ── offline accrual (mirrors map.mjs accrue) ──
  function accrue(k, now){
    var n=S.nodes[k]; if(!n) return {amount:0};
    var def=CFG.nodeKinds[n.kind]; if(!def||!def.resource||!(def.intervalMs>0)) return {amount:0};
    var since=+(n.lastCollectedAt!=null?n.lastCollectedAt:n.placedAt);
    var intervals=Math.min(CFG.maxAccrual, Math.floor(Math.max(0,now-since)/def.intervalMs));
    var mult=(S.staff[k]&&+S.staff[k].multiplier)||1;
    return {amount:Math.floor(intervals*def.baseYield*mult), resource:def.resource, intervals:intervals, mult:mult, def:def};
  }
  function collect(k){
    var now=Date.now(); var a=accrue(k,now); if(!(a.intervals>0)){ toast('Nothing ready yet'); return; }
    S.resources[a.resource]=(+(S.resources[a.resource]||0))+a.amount;
    S.nodes[k].lastCollectedAt=(+(S.nodes[k].lastCollectedAt!=null?S.nodes[k].lastCollectedAt:now))+a.intervals*a.def.intervalMs;
    save(); toast('Collected +'+a.amount+' '+a.resource); render(); select(k);
  }

  // ── check-in on load: bank everything that matured while away ──
  function checkIn(){
    var now=Date.now(), total=0, lines={};
    Object.keys(S.nodes).forEach(function(k){ var a=accrue(k,now); if(a.intervals>0){ S.resources[a.resource]=(+(S.resources[a.resource]||0))+a.amount; S.nodes[k].lastCollectedAt=(+(S.nodes[k].lastCollectedAt!=null?S.nodes[k].lastCollectedAt:now))+a.intervals*a.def.intervalMs; total+=a.amount; lines[a.resource]=(lines[a.resource]||0)+a.amount; }});
    if(total>0){ save(); var parts=Object.keys(lines).map(function(r){return '+'+lines[r]+' '+r;}); toast('While you were away: '+parts.join(', ')); }
  }

  function nodeEmoji(kind){ return ({farm:'🌾',mine:'⛏️',timber:'🪵',water:'💧',expedition:'🧭'})[kind]||'•'; }
  function affShort(a){ return ({home:'HOME',fertile:'FARM',ore:'ORE',timber:'WOOD',water:'H₂O',wild:'WILD',fog:''})[a]||''; }

  function render(){
    // resources
    var rb=document.getElementById('resbar');
    var order=['stone','wood','crop','ore','water']; var seen={};
    var html=order.concat(Object.keys(S.resources)).filter(function(r){ if(seen[r])return false; seen[r]=1; return true; })
      .map(function(r){ return '<div class=box>'+r+' <b>'+(+(S.resources[r]||0))+'</b></div>'; }).join('');
    rb.innerHTML=html||'<span class=muted>empty</span>';
    // tiles
    var polys=SVG.querySelectorAll('polygon.hex');
    polys.forEach(function(p){
      var k=p.getAttribute('data-key');
      var revealed=!!S.revealed[k];
      var aff=revealed?AFF[k]:'fog';
      p.setAttribute('data-affinity', aff);
      p.setAttribute('data-owned', S.owned[k]?1:0);
    });
    // labels + node glyphs: redraw text layer
    SVG.querySelectorAll('text.tlabel,text.tnode').forEach(function(t){t.remove();});
    Object.keys(TILEPOS).forEach(function(k){
      var t=TILEPOS[k]; var revealed=!!S.revealed[k]; var aff=revealed?AFF[k]:'fog';
      if(aff!=='fog'){ addText('tlabel', t.x, t.y-12, affShort(aff)); }
      if(S.nodes[k]){ addText('tnode', t.x, t.y+5, nodeEmoji(S.nodes[k].kind)); }
    });
  }
  function addText(cls,x,y,txt){ var el=document.createElementNS('http://www.w3.org/2000/svg','text'); el.setAttribute('class',cls); el.setAttribute('x',x); el.setAttribute('y',y); el.textContent=txt; SVG.appendChild(el); }

  var selKey=null;
  function select(k){
    selKey=k;
    SVG.querySelectorAll('polygon.hex').forEach(function(p){ p.classList.toggle('sel', p.getAttribute('data-key')===k); });
    var info=document.getElementById('tileinfo'); var deedEl=document.getElementById('deed'); deedEl.classList.remove('on');
    var revealed=!!S.revealed[k]; var aff=revealed?AFF[k]:'fog';
    var owned=!!S.owned[k]; var affMeta=CFG.affinities[aff]||{};
    var h='<div class=kv>Tile <b>'+esc(k)+'</b></div>';
    if(!revealed){ h+='<div class=kv>Fogged — reveal it by claiming a neighbour or an expedition.</div>'; info.innerHTML=h; return; }
    h+='<div class=kv>'+esc(affMeta.label||aff)+' — '+esc(affMeta.blurb||'')+'</div>';
    var btns='';
    if(!owned){
      var adj=neigh(k).some(function(n){return S.owned[n];});
      var cost=claimCost(k);
      h+='<div class=kv>Claim cost: '+cost.stone+' stone, '+cost.wood+' wood</div>';
      btns+='<button class="btn primary" data-act=claim '+((adj&&afford(cost))?'':'disabled')+'>Claim tile</button>';
      if(!adj) h+='<div class=kv>Must be adjacent to your territory.</div>';
      else if(!afford(cost)) h+='<div class=kv>Not enough materials.</div>';
      if(aff==='wild') btns+='<button class=btn data-act=expedition>Expedition (reveal)</button>';
    } else {
      var node=S.nodes[k]; var wantKind=affMeta.node;
      if(!node && wantKind){ btns+='<button class="btn primary" data-act=place>Place '+esc(CFG.nodeKinds[wantKind].label)+'</button>'; }
      if(node){
        var a=accrue(k,Date.now());
        h+='<div class=kv>'+esc(CFG.nodeKinds[node.kind].label)+' node'+(S.staff[k]?' · staffed ×'+S.staff[k].multiplier:'')+'</div>';
        h+='<div class=kv>Ready to collect: <b>'+a.amount+' '+(a.resource||'')+'</b></div>';
        btns+='<button class="btn primary" data-act=collect>Collect</button>';
        if(!S.staff[k]) btns+='<button class=btn data-act=staff>Staff a creature</button>';
      }
      if(aff==='wild') btns+='<button class=btn data-act=expedition>Expedition</button>';
    }
    info.innerHTML=h+'<div>'+btns+'</div>';
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];}); }

  // ── actions ──
  function doClaim(k){
    var adj=neigh(k).some(function(n){return S.owned[n];}); if(!adj){toast('Not adjacent to your territory');return;}
    var cost=claimCost(k); if(!afford(cost)){toast('Not enough materials');return;}
    Object.keys(cost).forEach(function(m){ S.resources[m]=(+(S.resources[m]||0))-cost[m]; });
    S.owned[k]=1; S.revealed[k]=1; neigh(k).forEach(function(n){ if(AFF[n]!=null) S.revealed[n]=1; });
    save();
    // OFF-CHAIN first: show the stubbed deed descriptor (never broadcast).
    var deed={contract:(CFG.deedAddress||''),fn:'mintDeed',args:[(S.owner||'you'),k,AFF[k]],broadcast:false,note:'will settle on-chain — the edge re-validates and mints the Tile-Deed (utility deed, a production-capacity sink, not a price bet)'};
    var deedEl=document.getElementById('deed'); deedEl.textContent='Deed mint (stubbed — will settle on-chain):\\n'+JSON.stringify(deed,null,2); deedEl.classList.add('on');
    toast('✓ Claimed '+k); render(); select(k);
  }
  function doPlace(k){
    var aff=AFF[k]; var kind=(CFG.affinities[aff]||{}).node; if(!kind){toast('Nothing to place here');return;}
    S.nodes[k]={kind:kind, placedAt:Date.now(), lastCollectedAt:Date.now()}; save();
    toast('Placed '+CFG.nodeKinds[kind].label); render(); select(k);
  }
  function doStaff(k){
    if(!S.nodes[k]){toast('No node to staff');return;}
    // demo staffing: a modest worker multiplier (real staffing binds an on-chain creature server-side).
    S.staff[k]={species:'unit', multiplier:1.3}; save(); toast('Creature staffed ×1.3'); render(); select(k);
  }
  function doExpedition(k){
    // deterministic-ish demo resolve; real rewards are server-seeded at settle (anti-cheat §4g).
    S.revealed[k]=1; neigh(k).forEach(function(n){ if(AFF[n]!=null) S.revealed[n]=1; });
    var roll=Math.random(); var msg;
    if(roll<0.5){ var wood=1+Math.floor(Math.random()*4); S.resources.wood=(+(S.resources.wood||0))+wood; msg='Found +'+wood+' wood'; }
    else if(roll<0.75){ msg='Found a rare seed (settles on-chain)'; }
    else { msg='A wild creature appeared! (encounter)'; }
    save(); toast(msg); render(); select(k);
  }

  SVG.addEventListener('click', function(e){ var p=e.target.closest&&e.target.closest('polygon.hex'); if(!p)return; select(p.getAttribute('data-key')); });
  document.getElementById('tileinfo').addEventListener('click', function(e){
    var b=e.target.closest&&e.target.closest('button[data-act]'); if(!b||!selKey)return;
    var act=b.getAttribute('data-act');
    if(act==='claim') doClaim(selKey);
    else if(act==='place') doPlace(selKey);
    else if(act==='collect') collect(selKey);
    else if(act==='staff') doStaff(selKey);
    else if(act==='expedition') doExpedition(selKey);
  });
  var rb=document.getElementById('resetbtn'); if(rb) rb.addEventListener('click', function(){ S=fresh(); save(); selKey=null; document.getElementById('deed').classList.remove('on'); document.getElementById('tileinfo').innerHTML='<p class=muted>Tap a tile on the map to inspect it.</p>'; render(); toast('Frontier reset'); });

  checkIn(); render();
})();
</script>`;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
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
        summary: 'The Frontier — the persistent-world map layer of the MELEK HUD Game. A small bounded hex board (axial coords) of typed tiles you claim outward from Home; place farm/mine/timber/wellspring extraction nodes, staff them with creatures, and collect offline (check-in) yield. Tile claims are utility deeds (a production sink), never an investment; the deed mint settles on-chain via the edge. Original world, procedural SVG, no PvP.',
        links: [{ label: 'The map', path: '/' }],
      }));
    }

    if (path === '/' || path === '') return sendHtml(res, homePage());

    // unknown → 404, never a 500. The requested path is echoed back ESCAPED.
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — ' + SITE_NAME,
      `<h1>Not found</h1><p class=muted>There's nothing at <code>${esc(path)}</code>. <a href="${bp('/')}">Back to the map</a>.</p>`,
      { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/map\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
