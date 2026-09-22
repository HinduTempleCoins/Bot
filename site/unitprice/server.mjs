// server.mjs — UnitPrice.SoapBox.Community. A free cost-per-unit / "which is cheaper" calculator. Enter
// two or more options (price + size), and it gives the price per unit for each and flags the best value —
// the everyday grocery-aisle question. Optional pack count (price × N items). Pure math, runs in the
// browser; the server never fetches. Same house style + stealth funnel as the other SoapBox tools.
//
//   PORT=8234 BASE_URL=https://unitprice.soapbox.community node site/unitprice/server.mjs
//   → the calculator at /  ·  JSON API at /api/unit?items=3.50@1000,2.10@500
//     (items = comma list of "<price>@<size>" or "<price>@<size>x<packCount>")
//
// DISCIPLINE: esc() everything, safeHref() any user URL, soft-fail (unknown path → 404), NO server net.

import { createServer } from 'node:http';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8234);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Unit Price Calculator';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function safeHref(u) { if (!u || typeof u !== 'string') return ''; try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; } }
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : NaN; };
const round = (n, dp = 4) => { const f = 10 ** dp; return Math.round((Number(n) + Number.EPSILON) * f) / f; };

// ── the pure engine ────────────────────────────────────────────────────────────────────────────────
// items: [{ price, size, pack?, label? }] — price is for the whole pack (price × pack items of `size`).
// Returns each item's unit price (price / (size × pack)), the best index, and how much each is above best.
export function compare(items = []) {
  if (!Array.isArray(items) || !items.length) return { ok: false, error: 'no items' };
  const rows = items.map((it, i) => {
    const price = num(it && it.price), size = num(it && it.size);
    const pack = num(it && it.pack) > 0 ? num(it.pack) : 1;
    const totalQty = size * pack;
    const unit = (price >= 0 && totalQty > 0) ? price / totalQty : NaN;
    return { i, label: (it && it.label) || `Option ${i + 1}`, price: round(price, 2), size: round(size, 4), pack, unitPrice: Number.isFinite(unit) ? round(unit, 6) : null };
  });
  const valid = rows.filter((r) => r.unitPrice != null);
  if (!valid.length) return { ok: false, error: 'no valid item (need price ≥ 0 and size > 0)', rows };
  const best = valid.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a));
  for (const r of rows) {
    if (r.unitPrice == null) { r.best = false; r.pctAboveBest = null; continue; }
    r.best = r.i === best.i;
    r.pctAboveBest = best.unitPrice > 0 ? round(((r.unitPrice - best.unitPrice) / best.unitPrice) * 100, 1) : 0;
  }
  return { ok: true, bestIndex: best.i, bestUnitPrice: best.unitPrice, rows };
}

// Parse the API's compact "price@size" / "price@sizexPack" list.
export function itemsFromParam(s) {
  return String(s || '').split(',').map((t) => t.trim()).filter(Boolean).map((tok) => {
    const [priceStr, rest = ''] = tok.split('@');
    const [sizeStr, packStr] = rest.split(/x/i);
    return { price: parseFloat(priceStr), size: parseFloat(sizeStr), pack: packStr ? parseFloat(packStr) : 1 };
  });
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;gap:14px;align-items:center}
  .brand{font-weight:800;font-size:18px} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap} .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:820px;margin:0 auto;padding:18px 22px 60px} h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px;max-width:64ch}
  .card{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:18px}
  .row{display:grid;grid-template-columns:1fr 1fr 90px 34px;gap:8px;margin-bottom:8px;align-items:center}
  @media(max-width:620px){.row{grid-template-columns:1fr 1fr}}
  input{width:100%;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 11px;font-size:15px;font-weight:600} input:focus{border-color:var(--blue);outline:none}
  .lbl{font-size:11px;color:var(--mut);margin-bottom:4px} .heads{display:grid;grid-template-columns:1fr 1fr 90px 34px;gap:8px;margin-bottom:2px}
  @media(max-width:620px){.heads{display:none}}
  button.act{border:1px solid var(--line2);border-radius:8px;background:var(--panel);color:var(--fg);cursor:pointer;padding:8px 12px;font-weight:700;font-size:14px;margin-top:6px} button.act:hover{border-color:var(--blue);color:var(--blue)}
  .del{border:1px solid var(--line2);border-radius:8px;background:var(--panel);color:var(--down,#f85149);cursor:pointer;font-weight:800}
  .uwrap{margin-top:16px} .u{display:flex;justify-content:space-between;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;margin-bottom:6px;font-size:14px}
  .u.best{border-color:var(--up);background:#3fb95014} .u .p{font-weight:800} .u .tag{color:var(--up);font-weight:700;font-size:12px} .u .over{color:var(--mut);font-size:12px}
  .unit{margin:4px 0 10px} .unit label{font-size:12px;color:var(--mut);margin-right:6px}
  .muted{color:var(--mut)} .unlock{margin-top:20px;border:1px dashed var(--line2);border-radius:10px;padding:12px 14px;font-size:13.5px;color:var(--mut)} .unlock a{font-weight:700}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line)}
</style>`;

function pageShell(title, body, opts = {}) {
  const desc = opts.description || 'A free unit-price calculator — compare price per gram, per litre or per item across products and see which is the best value. Runs in your browser, no sign-up.';
  const head = headTags({ title, description: desc, canonical: opts.canonical || `${BASE_URL}/`, siteName: SITE_NAME, robots: opts.robots || 'index,follow', jsonld: opts.jsonld || null });
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${esc(bp('/'))}">◧ SoapBox <span>Unit Price</span><span class=alpha>Alpha</span></a>
<div class=topbar-r><a href="${hub('/')}">◧ SoapBox Tools</a><a href="${hub('/converter')}">Converter</a></div></header>
<main class=wrap>${body}</main>
<footer><b>${esc(SITE_NAME)}</b> — free, private, runs in your browser. No sign-up.</footer></body></html>`;
}

export function calculatorPage() {
  const body = `<h1>Unit Price Calculator</h1>
<p class=sub>Which pack is actually cheaper? Enter each option's price and size — this works out the price
per unit and highlights the best value. Add a pack count for multi-buys.</p>
<div class=card>
  <div class=unit><label for=unitName>Unit label (optional)</label><input id=unitName style="width:160px;display:inline-block" placeholder="g, mL, item…" value="g"></div>
  <div class=heads><div class=lbl>Price</div><div class=lbl>Size (in your unit)</div><div class=lbl>Pack ×</div><div></div></div>
  <div id=rows></div>
  <button class=act id=add type=button>+ Add option</button>
  <div class=uwrap id=out></div>
</div>
<div class=unlock>💾 <b>Save shopping comparisons?</b> Optional, with a free MELEK account. <a href="${esc(SIGNUP_URL)}" rel="nofollow">Create a free account</a>. The tool works fully without one.</div>
<script>
const $=(id)=>document.getElementById(id);
const rnd=(n,dp=4)=>{const f=10**dp;return Math.round((Number(n)+Number.EPSILON)*f)/f;};
function addRow(price='',size='',pack=''){
  const d=document.createElement('div'); d.className='row';
  d.innerHTML='<input class=p type=number step=any placeholder="price" value="'+price+'">'+
    '<input class=s type=number step=any placeholder="size" value="'+size+'">'+
    '<input class=k type=number step=any placeholder="1" value="'+pack+'">'+
    '<button class=del type=button title=Remove>×</button>';
  d.querySelector('.del').addEventListener('click',()=>{d.remove();run();});
  d.querySelectorAll('input').forEach(i=>i.addEventListener('input',run));
  $('rows').appendChild(d);
}
function compare(items){
  const rows=items.map((it,i)=>{const pack=it.pack>0?it.pack:1,tot=it.size*pack;
    return {i,price:it.price,size:it.size,pack,unit:(it.price>=0&&tot>0)?it.price/tot:null};});
  const valid=rows.filter(r=>r.unit!=null); if(!valid.length)return {rows,best:-1};
  const best=valid.reduce((a,b)=>b.unit<a.unit?b:a);
  rows.forEach(r=>{r.best=r.unit!=null&&r.i===best.i; r.over=(r.unit!=null&&best.unit>0)?rnd((r.unit-best.unit)/best.unit*100,1):null;});
  return {rows,best:best.i,bestUnit:best.unit};
}
function run(){
  const u=$('unitName').value||'unit';
  const items=[...document.querySelectorAll('#rows .row')].map(r=>({price:parseFloat(r.querySelector('.p').value),size:parseFloat(r.querySelector('.s').value),pack:parseFloat(r.querySelector('.k').value)}));
  const res=compare(items);
  const out=res.rows.map(r=>{
    if(r.unit==null)return '<div class="u"><span class=muted>Option '+(r.i+1)+' — enter price &amp; size</span></div>';
    return '<div class="u'+(r.best?' best':'')+'"><span><b>Option '+(r.i+1)+'</b> '+
      (r.best?'<span class=tag>✓ best value</span>':'<span class=over>+'+r.over+'% vs best</span>')+'</span>'+
      '<span class=p>'+rnd(r.unit,4)+' / '+u+'</span></div>';
  }).join('');
  $('out').innerHTML=out||'<span class=muted>Add options to compare.</span>';
}
$('add').addEventListener('click',()=>{addRow();run();});
$('unitName').addEventListener('input',run);
addRow('3.50','1000','1'); addRow('2.10','500','1');
run();
</script>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'WebApplication', name: SITE_NAME, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any (web)', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } };
  return pageShell(`${SITE_NAME} — free price-per-unit comparison`, body, { canonical: `${BASE_URL}/`, jsonld });
}

function sendJson(res, o, code = 200) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); }
function sendHtml(res, h, code = 200) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }); res.end(h); }
export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const p = url.pathname;
    if (p === '/health') return sendJson(res, { ok: true });
    if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (p === '/sitemap.xml') { const t = new Date().toISOString().slice(0, 10); res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(sitemapXml(BASE_URL, SITEMAP_PATHS.map((u) => ({ path: u, lastmod: t, changefreq: 'monthly', priority: '1.0' })))); }
    if (p === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (p === '/llms.txt') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(llmsTxt({ name: SITE_NAME, baseUrl: BASE_URL, summary: 'A free unit-price / cost-per-unit comparison calculator with a JSON API at /api/unit.', links: [{ label: 'Calculator', path: '/', note: 'unit price' }] })); }
    if (p === '/api/unit') return sendJson(res, compare(itemsFromParam(url.searchParams.get('items'))));
    if (p === '/' || p === '') return sendHtml(res, calculatorPage());
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(pageShell('Not found — ' + SITE_NAME, '<h1>Not found</h1><p class=muted><a href="' + bp('/') + '">Back to the calculator</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error: ' + (e && e.message ? e.message : 'unknown')); }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/unitprice\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
