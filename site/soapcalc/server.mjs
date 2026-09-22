// server.mjs — SoapCalc.SoapBox.Community. The flagship free tool: a real soap-making lye/oil
// calculator (SoapCalc / BrambleBerry style). A usable form (pick oils, weights or %, NaOH/KOH,
// superfat, water:lye) → exact lye, water, per-oil breakdown and the fatty-acid quality profile.
// All math is the pure, tested engine in soapcalc.mjs. The page runs entirely in the browser after
// load; the server NEVER fetches at request time and there is a JSON API for programmatic use.
//
//   PORT=8231 BASE_URL=https://soapcalc.soapbox.community node site/soapcalc/server.mjs
//   → serves the calculator at  /   ·   JSON API at  /api/calc?...  and POST /api/calc
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   Reads and works exactly like a normal free soap calculator. MELEK appears only as one understated,
//   OPTIONAL "save your recipes — free account" line. The calculator works fully without an account.
//
// ── NETWORK & SAFETY DISCIPLINE ────────────────────────────────────────────────────────────────────
//   The SERVER handler NEVER fetches (offline tests inject a throwing fetch). Every result surface —
//   the page and the JSON API — carries the caustic-lye SAFETY_NOTE. esc() on every interpolated value;
//   safeHref() on any user-supplied URL. Soft-fail: every route renders; unknown path → 404, never 500.

import { createServer } from 'node:http';
import { calculate, OILS, PROFILE_RANGES, FATTY_ACIDS, SAFETY_NOTE } from './soapcalc.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8231);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Soap Calculator';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// Tools-hub path awareness — own process behind a path-routing proxy at tools.soapbox.community/<app>.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;
const TOOLS_NAV = `<a class=hublink href="${hub('/')}">◧ SoapBox Tools</a>`
  + `<a href="${hub('/converter')}">Converter</a><a href="${hub('/calculator')}">Calculator</a>`;

// ── house-style helpers ──────────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}
const round = (n, dp = 2) => { const f = 10 ** dp; return Math.round((Number(n) + Number.EPSILON) * f) / f; };

// A sensible starter recipe so the page is useful the instant it loads (classic three-oil bar).
export const DEFAULT_RECIPE = {
  lyeType: 'NaOH', superfat: 5, waterRatio: 2, mode: 'weight',
  oils: [
    { id: 'olive', weight: 500 },
    { id: 'coconut', weight: 300 },
    { id: 'palm', weight: 200 },
  ],
};

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:960px;margin:0 auto;padding:18px 22px 60px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px;max-width:66ch}
  .muted{color:var(--mut)} h2{font-size:16px;margin:22px 0 10px}
  .safety{border:1px solid var(--gold);background:#d2992216;border-radius:10px;padding:12px 14px;margin:14px 0;font-size:13.5px;color:var(--fg)}
  .safety b{color:var(--gold)}
  .grid2{display:grid;grid-template-columns:1.15fr .85fr;gap:18px}
  @media (max-width:820px){.grid2{grid-template-columns:1fr}}
  .card{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:16px}
  table{border-collapse:collapse;width:100%;font-size:14px} th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right}
  th:first-child,td:first-child{text-align:left}
  thead th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  select,input{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:8px 10px;font-size:14px;font-weight:600}
  select:focus,input:focus{border-color:var(--blue);outline:none}
  .oilrow{display:grid;grid-template-columns:1fr 92px 34px;gap:8px;margin-bottom:8px;align-items:center}
  .opts{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin:12px 0}
  .opts label{display:block;font-size:12px;color:var(--mut);margin-bottom:4px}
  .opts .fld input,.opts .fld select{width:100%}
  button.act{border:1px solid var(--line2);border-radius:8px;background:var(--panel);color:var(--fg);cursor:pointer;padding:8px 12px;font-weight:700;font-size:14px}
  button.act:hover{border-color:var(--blue);color:var(--blue)}
  button.primary{border-color:var(--blue);color:var(--blue);background:#58a6ff14}
  .del{border:1px solid var(--line2);border-radius:8px;background:var(--panel);color:var(--down);cursor:pointer;font-weight:800;font-size:15px;line-height:1}
  .big{font-size:15px} .big td.v{font-weight:800;font-size:16px;color:var(--fg)}
  .bar{height:9px;border-radius:6px;background:#0b0f14;overflow:hidden;margin-top:3px}
  .bar>i{display:block;height:100%;background:var(--blue)}
  .qwrap{display:grid;grid-template-columns:1fr;gap:10px}
  .q .qh{display:flex;justify-content:space-between;font-size:13px} .q .qh b{font-weight:700} .q .rng{color:var(--mut);font-size:11px}
  .q.out .qh b{color:var(--gold)}
  .warn{border:1px solid var(--gold);background:#d2992212;border-radius:8px;padding:8px 12px;margin:8px 0;font-size:13px;color:var(--gold)}
  .unlock{margin:20px 0 0;border:1px dashed var(--line2);border-radius:10px;padding:12px 14px;font-size:13.5px;color:var(--mut)}
  .unlock a{font-weight:700}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  .hublink{font-weight:800}
</style>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'A free soap-making lye calculator. Enter your oils and it gives the exact lye (NaOH or KOH), water, superfat and the fatty-acid quality profile — hardness, cleansing, conditioning, bubbly and creamy. Works offline in your browser.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${esc(bp('/'))}">◧ SoapBox <span>Soap Calculator</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}</div></header>
<main class=wrap>${body}</main>
<footer><b>${esc(SITE_NAME)}</b> — a free, private soap calculator. Everything runs in your browser; no sign-up, no data leaves your device.</footer>
</body></html>`;
}

// The oil <option> list, shared by the form's oil selects (rendered server-side once).
function oilOptions(selected) {
  return Object.entries(OILS).map(([id, o]) =>
    `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
}

// ── the calculator page ────────────────────────────────────────────────────────────────────────────
export function calculatorPage() {
  const optsHtml = oilOptions('');
  // Serialised so the client script can render the starter recipe + re-render on change without a fetch.
  const oilsJson = JSON.stringify(Object.fromEntries(Object.entries(OILS).map(([id, o]) => [id, { name: o.name, sap: o.sap, fa: o.fa }])));
  const rangesJson = JSON.stringify(PROFILE_RANGES);
  const defJson = JSON.stringify(DEFAULT_RECIPE);

  const body = `<h1>Soap Calculator</h1>
<p class=sub>Enter your oils and their weights (or percentages). This gives the exact lye and water for a
safe batch, plus the fatty-acid quality profile of the finished bar. Free, private, and it runs entirely
in your browser.</p>

<div class=safety><b>⚠ Lye safety:</b> ${esc(SAFETY_NOTE)}</div>

<div class=grid2>
  <section class=card>
    <h2 style="margin-top:0">Your oils</h2>
    <div id=oils></div>
    <button class=act id=addOil type=button>+ Add oil</button>

    <div class=opts>
      <div class=fld><label for=mode>Enter oils as</label>
        <select id=mode><option value=weight>Weights</option><option value=percent>Percentages</option></select></div>
      <div class=fld id=batchFld style="display:none"><label for=batch>Total oil weight (g)</label>
        <input id=batch type=number min=0 step=any value=1000></div>
      <div class=fld><label for=lyeType>Lye type</label>
        <select id=lyeType><option value=NaOH>NaOH — hard bar soap</option><option value=KOH>KOH — liquid / soft soap</option></select></div>
      <div class=fld><label for=superfat>Superfat / lye discount (%)</label>
        <input id=superfat type=number min=0 max=100 step=any value=5></div>
      <div class=fld><label for=waterRatio>Water : lye ratio</label>
        <input id=waterRatio type=number min=0 step=any value=2></div>
      <div class=fld id=purityFld style="display:none"><label for=kohPurity>KOH purity (%)</label>
        <input id=kohPurity type=number min=1 max=100 step=any value=90></div>
    </div>
    <template id=oilTpl>
      <div class=oilrow><select class=oilsel>${optsHtml}</select>
        <input class=oilamt type=number min=0 step=any placeholder="g / %" value=0>
        <button class=del type=button title="Remove">×</button></div>
    </template>
  </section>

  <section class=card>
    <h2 style="margin-top:0">Recipe</h2>
    <table class=big><tbody id=totals></tbody></table>
    <h2>Quality profile</h2>
    <div class=qwrap id=profile></div>
    <div id=warnings></div>
  </section>
</div>

<h2>Per-oil breakdown</h2>
<div class=card style="padding:0;overflow:auto">
  <table><thead><tr><th>Oil</th><th>Weight</th><th>%</th><th>SAP</th><th>Lye</th></tr></thead>
  <tbody id=breakdown></tbody></table>
</div>

<div class=unlock>💾 <b>Keep your recipes?</b> You can save and reload your recipes with a free MELEK account —
entirely optional. <a href="${esc(SIGNUP_URL)}" rel="nofollow">Create a free account</a>. The calculator works fully without one.</div>

<p class=muted style="font-size:12px;margin-top:18px">SAP values and fatty-acid figures are standard published reference
data and vary by oil source and refining. Always weigh ingredients and confirm against a tested recipe.</p>

<script>
const OILS = ${oilsJson};
const RANGES = ${rangesJson};
const DEF = ${defJson};
const KOH_FACTOR = ${56.1056 / 39.9971};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const rnd = (n,dp=2)=>{const f=10**dp;return Math.round((Number(n)+Number.EPSILON)*f)/f;};

function addOilRow(id='', amt=0){
  const tpl = $('oilTpl').content.cloneNode(true);
  const sel = tpl.querySelector('.oilsel'); if(id) sel.value=id;
  tpl.querySelector('.oilamt').value = amt;
  tpl.querySelector('.del').addEventListener('click',(e)=>{e.target.closest('.oilrow').remove();recalc();});
  sel.addEventListener('change',recalc); tpl.querySelector('.oilamt').addEventListener('input',recalc);
  $('oils').appendChild(tpl);
}

function readRecipe(){
  const mode = $('mode').value;
  const oils = [...document.querySelectorAll('.oilrow')].map(r=>{
    const id=r.querySelector('.oilsel').value, amt=parseFloat(r.querySelector('.oilamt').value)||0;
    return mode==='percent'?{id,percent:amt}:{id,weight:amt};
  });
  return {oils,mode,lyeType:$('lyeType').value,superfat:parseFloat($('superfat').value)||0,
    waterRatio:parseFloat($('waterRatio').value)||0,kohPurity:parseFloat($('kohPurity').value)||90,
    batchWeight:parseFloat($('batch').value)||0};
}

// The SAME math as the server engine (soapcalc.mjs) — kept in sync deliberately; the server /api/calc
// is authoritative for programmatic callers.
function calc(r){
  const koh = r.lyeType==='KOH', f = koh?KOH_FACTOR:1, sf=Math.max(0,Math.min(100,r.superfat));
  const rows=r.oils.map(o=>{const db=OILS[o.id]; if(!db) return null;
    const w = r.mode==='percent' ? (r.batchWeight>0?(o.percent/100)*r.batchWeight:0) : o.weight;
    return {id:o.id,name:db.name,sap:db.sap,fa:db.fa,weight:w||0};}).filter(Boolean);
  const total=rows.reduce((s,o)=>s+o.weight,0);
  const pure=rows.reduce((s,o)=>s+o.weight*o.sap*f,0), lye=pure*(1-sf/100);
  const toWeigh = koh ? lye/((Math.max(1,Math.min(100,r.kohPurity)))/100) : lye;
  const water=lye*Math.max(0,r.waterRatio);
  const acid={lauric:0,myristic:0,palmitic:0,stearic:0,oleic:0,linoleic:0,linolenic:0,ricinoleic:0};
  for(const o of rows){const sh=total>0?o.weight/total:0;for(const a in acid)acid[a]+=sh*(o.fa[a]||0);}
  for(const a in acid)acid[a]=rnd(acid[a],1);
  const profile={hardness:Math.round(acid.lauric+acid.myristic+acid.palmitic+acid.stearic),
    cleansing:Math.round(acid.lauric+acid.myristic),
    conditioning:Math.round(acid.oleic+acid.linoleic+acid.linolenic+acid.ricinoleic),
    bubbly:Math.round(acid.lauric+acid.myristic+acid.ricinoleic),
    creamy:Math.round(acid.palmitic+acid.stearic+acid.ricinoleic)};
  const warnings=[];
  if(r.mode==='percent'){const ps=rnd(r.oils.reduce((s,o)=>s+(o.percent||0),0),1);
    if(rows.length&&Math.abs(ps-100)>0.5)warnings.push('Oil percentages add up to '+ps+'%, not 100%.');
    if(!(r.batchWeight>0))warnings.push('Set a total batch weight to turn percentages into grams.');}
  if(sf===0)warnings.push('0% superfat leaves no safety margin — most recipes use 5–8%.');
  if(sf>20)warnings.push('Very high superfat (>20%) — soft bar, faster rancidity.');
  const perOil=rows.map(o=>({name:o.name,weight:rnd(o.weight,2),percent:total>0?rnd(o.weight/total*100,1):0,sap:o.sap,lye:rnd(o.weight*o.sap*f,2)}));
  return {lyeType:r.lyeType,superfat:sf,total:rnd(total,2),lye:rnd(lye,2),toWeigh:rnd(toWeigh,2),
    water:rnd(water,2),totalBatch:rnd(total+toWeigh+water,2),perOil,profile,warnings,koh};
}

function render(o){
  const u='g';
  $('totals').innerHTML =
    '<tr><td>Total oils</td><td class=v>'+o.total+' '+u+'</td></tr>'+
    '<tr><td>'+esc(o.lyeType)+' (lye)'+(o.koh?' — pure':'')+'</td><td class=v>'+o.lye+' '+u+'</td></tr>'+
    (o.koh?'<tr><td>'+esc(o.lyeType)+' to weigh (purity-adj.)</td><td class=v>'+o.toWeigh+' '+u+'</td></tr>':'')+
    '<tr><td>Water</td><td class=v>'+o.water+' '+u+'</td></tr>'+
    '<tr><td>Superfat</td><td class=v>'+o.superfat+' %</td></tr>'+
    '<tr><td>Total batch</td><td class=v>'+o.totalBatch+' '+u+'</td></tr>';
  $('profile').innerHTML = Object.entries(RANGES).map(([k,r])=>{
    const v=o.profile[k]||0, out=v<r.min||v>r.max, pct=Math.max(0,Math.min(100,v));
    return '<div class="q'+(out?' out':'')+'"><div class=qh><span>'+esc(r.label)+'</span><b>'+v+'</b></div>'+
      '<div class=bar><i style="width:'+pct+'%"></i></div>'+
      '<div class=rng>usual range '+r.min+'–'+r.max+'</div></div>';
  }).join('');
  $('warnings').innerHTML = o.warnings.map(w=>'<div class=warn>'+esc(w)+'</div>').join('');
  $('breakdown').innerHTML = o.perOil.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+p.weight+'</td><td>'+p.percent+'</td><td>'+p.sap+'</td><td>'+p.lye+'</td></tr>').join('')
    || '<tr><td colspan=5 class=muted style="text-align:left">Add an oil to see the breakdown.</td></tr>';
}

function recalc(){ try{ render(calc(readRecipe())); }catch(e){} }

$('mode').addEventListener('change',()=>{ $('batchFld').style.display = $('mode').value==='percent'?'block':'none'; recalc(); });
$('lyeType').addEventListener('change',()=>{ $('purityFld').style.display = $('lyeType').value==='KOH'?'block':'none'; recalc(); });
['superfat','waterRatio','kohPurity','batch'].forEach(id=>$(id).addEventListener('input',recalc));
$('addOil').addEventListener('click',()=>{addOilRow('coconut',0);recalc();});

// seed the starter recipe
DEF.oils.forEach(o=>addOilRow(o.id,o.weight));
$('lyeType').value=DEF.lyeType; $('superfat').value=DEF.superfat; $('waterRatio').value=DEF.waterRatio;
recalc();
</script>`;

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any (web)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: 'A free soap-making lye and oil calculator with a fatty-acid quality profile.',
  };
  return page(`${SITE_NAME} — free lye & oil calculator`, body, { canonical: `${BASE_URL}/`, jsonld });
}

// ── JSON API ─────────────────────────────────────────────────────────────────────────────────────────
// GET /api/calc?oils=coconut:300,olive:500&lyeType=NaOH&superfat=5&waterRatio=2
//   oils = comma list of "<id>:<weight>"  (or "<id>:<pct>" with mode=percent&batch=1000)
// POST /api/calc  with a JSON body { oils:[{id,weight}], lyeType, superfat, waterRatio, ... }
export function recipeFromQuery(params) {
  const mode = params.get('mode') === 'percent' ? 'percent' : 'weight';
  const oils = (params.get('oils') || '').split(',').map((s) => s.trim()).filter(Boolean).map((tok) => {
    const [id, amt] = tok.split(':');
    const v = parseFloat(amt) || 0;
    return mode === 'percent' ? { id: id.trim(), percent: v } : { id: id.trim(), weight: v };
  });
  return {
    oils, mode,
    lyeType: params.get('lyeType') === 'KOH' ? 'KOH' : 'NaOH',
    superfat: params.get('superfat') != null ? parseFloat(params.get('superfat')) : 5,
    waterRatio: params.get('waterRatio') != null ? parseFloat(params.get('waterRatio')) : 2,
    kohPurity: params.get('kohPurity') != null ? parseFloat(params.get('kohPurity')) : 90,
    batchWeight: params.get('batch') != null ? parseFloat(params.get('batch')) : 0,
  };
}

function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
}
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/'];

async function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > 1e6) { req.destroy(); resolve(''); } else d += c; });
    req.on('end', () => resolve(d));
    req.on('error', () => resolve(''));
  });
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') return sendJson(res, { ok: true });
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'monthly', priority: u === '/' ? '1.0' : '0.6' }))));
    }
    if (path === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'A free soap-making lye/oil calculator (NaOH or KOH, superfat, water:lye) with a fatty-acid quality profile. Runs in the browser; a JSON API is at /api/calc. No account required.',
        links: [{ label: 'Calculator', path: '/', note: 'the soap calculator' }, { label: 'JSON API', path: '/api/calc', note: 'programmatic calc' }],
      }));
    }

    if (path === '/api/calc') {
      let recipe;
      if ((req.method || 'GET').toUpperCase() === 'POST') {
        const raw = await readBody(req);
        try { recipe = JSON.parse(raw || '{}'); } catch { return sendJson(res, { ok: false, error: 'invalid JSON body' }, 400); }
      } else {
        recipe = recipeFromQuery(url.searchParams);
      }
      const result = calculate(recipe);
      return sendJson(res, { ...result, safety: SAFETY_NOTE });
    }

    // A small oils reference endpoint (public reference data) — handy for building the picker elsewhere.
    if (path === '/api/oils') return sendJson(res, { oils: OILS, fattyAcids: FATTY_ACIDS });

    if (path === '/' || path === '') return sendHtml(res, calculatorPage());

    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Soap Calculator', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Back to the calculator</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/soapcalc\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
