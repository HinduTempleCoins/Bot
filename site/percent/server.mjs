// server.mjs — Percent.SoapBox.Community. A free, everyday percentage calculator: "what is X% of Y",
// "X is what % of Y", percentage change, add/subtract a %, and a quick tip splitter. Pure math, runs in
// the browser; the server never fetches. Same house style + stealth funnel as the other SoapBox tools.
//
//   PORT=8232 BASE_URL=https://percent.soapbox.community node site/percent/server.mjs
//   → the calculator at /  ·  JSON API at /api/pct?op=of&a=15&b=200
//
// DISCIPLINE: esc() every interpolation, safeHref() any user URL, soft-fail (unknown path → 404, never
// 500), NO server network at request time (offline tests inject a throwing fetch).

import { createServer } from 'node:http';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8232);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Percentage Calculator';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; }
}
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : NaN; };
const round = (n, dp = 4) => { const f = 10 ** dp; return Math.round((Number(n) + Number.EPSILON) * f) / f; };

// ── the pure engine ────────────────────────────────────────────────────────────────────────────────
// op:
//   of        → a% of b                       (a=15,b=200 → 30)
//   isPctOf   → a is what % of b              (a=30,b=200 → 15)
//   change    → % change from a to b          (a=200,b=250 → 25)
//   addPct    → b increased by a%             (a=10,b=200 → 220)
//   subPct    → b decreased by a%             (a=10,b=200 → 180)
//   tip       → tip of a% on bill b, split c  (a=18,b=60,c=3 → {tip,total,perPerson})
export function compute(op, a, b, c) {
  a = num(a); b = num(b); c = num(c);
  switch (op) {
    case 'of':      return { ok: Number.isFinite(a) && Number.isFinite(b), value: round((a / 100) * b), label: `${a}% of ${b}` };
    case 'isPctOf': return { ok: Number.isFinite(a) && b !== 0 && Number.isFinite(b), value: round((a / b) * 100), unit: '%', label: `${a} is this % of ${b}` };
    case 'change':  return { ok: Number.isFinite(a) && a !== 0 && Number.isFinite(b), value: round(((b - a) / Math.abs(a)) * 100), unit: '%', label: `change from ${a} to ${b}` };
    case 'addPct':  return { ok: Number.isFinite(a) && Number.isFinite(b), value: round(b * (1 + a / 100)), label: `${b} + ${a}%` };
    case 'subPct':  return { ok: Number.isFinite(a) && Number.isFinite(b), value: round(b * (1 - a / 100)), label: `${b} − ${a}%` };
    case 'tip': {
      const people = Number.isFinite(c) && c >= 1 ? c : 1;
      const tip = round((a / 100) * b, 2), total = round(b + tip, 2);
      return { ok: Number.isFinite(a) && Number.isFinite(b), tip, total, perPerson: round(total / people, 2), people, label: `${a}% tip on ${b}` };
    }
    default: return { ok: false, error: 'unknown op' };
  }
}
export const OPS = ['of', 'isPctOf', 'change', 'addPct', 'subPct', 'tip'];

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;gap:14px;align-items:center}
  .brand{font-weight:800;font-size:18px} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap} .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:720px;margin:0 auto;padding:18px 22px 60px} h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .tabs{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0} .tabs button{border:1px solid var(--line2);border-radius:20px;padding:5px 14px;font-size:13px;font-weight:600;color:var(--fg);background:var(--panel);cursor:pointer}
  .tabs button.on{border-color:var(--blue);color:var(--blue);background:#58a6ff18}
  .card{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:18px}
  .q{font-size:17px;display:flex;flex-wrap:wrap;gap:8px;align-items:center} .q input{width:120px;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:8px 10px;font-size:16px;font-weight:700}
  .q input:focus{border-color:var(--blue);outline:none}
  .result{margin-top:16px;font-size:26px;font-weight:800} .result .eq{color:var(--mut);font-size:14px;font-weight:400}
  .muted{color:var(--mut)} .unlock{margin-top:20px;border:1px dashed var(--line2);border-radius:10px;padding:12px 14px;font-size:13.5px;color:var(--mut)} .unlock a{font-weight:700}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line)}
</style>`;

function pageShell(title, body, opts = {}) {
  const desc = opts.description || 'A free percentage calculator: what is X% of Y, X is what % of Y, percentage change, add or subtract a percent, and a tip splitter. Runs in your browser, no sign-up.';
  const head = headTags({ title, description: desc, canonical: opts.canonical || `${BASE_URL}/`, siteName: SITE_NAME, robots: opts.robots || 'index,follow', jsonld: opts.jsonld || null });
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${esc(bp('/'))}">◧ SoapBox <span>Percent</span><span class=alpha>Alpha</span></a>
<div class=topbar-r><a href="${hub('/')}">◧ SoapBox Tools</a><a href="${hub('/calculator')}">Calculator</a></div></header>
<main class=wrap>${body}</main>
<footer><b>${esc(SITE_NAME)}</b> — free, private, runs in your browser. No sign-up.</footer></body></html>`;
}

export function calculatorPage() {
  const body = `<h1>Percentage Calculator</h1>
<p class=sub>Every common percentage question in one place. Type the numbers; the answer updates as you go.</p>
<div class=tabs id=tabs>
  <button data-op=of class=on>X% of Y</button>
  <button data-op=isPctOf>X is what % of Y</button>
  <button data-op=change>% change</button>
  <button data-op=addPct>Add %</button>
  <button data-op=subPct>Subtract %</button>
  <button data-op=tip>Tip splitter</button>
</div>
<div class=card><div class=q id=q></div><div class=result id=out></div></div>
<div class=unlock>💾 <b>Keep a history of your calculations?</b> Optional, with a free MELEK account. <a href="${esc(SIGNUP_URL)}" rel="nofollow">Create a free account</a>. This tool works fully without one.</div>
<script>
const $=(id)=>document.getElementById(id);
const rnd=(n,dp=4)=>{const f=10**dp;return Math.round((Number(n)+Number.EPSILON)*f)/f;};
let op='of';
const FORMS={
  of:['What is ','a','% of ','b','?'], isPctOf:['','a',' is what % of ','b','?'],
  change:['Percentage change from ','a',' to ','b',''], addPct:['Increase ','b',' by ','a','%'],
  subPct:['Decrease ','b',' by ','a','%'], tip:['Tip ','a','% on a bill of ','b',' split ','c',' ways'],
};
function inp(name,val){return '<input id=in_'+name+' type=number step=any placeholder="'+name+'" value="'+(val||'')+'">';}
function buildForm(){
  const f=FORMS[op]; let h='';
  for(let i=0;i<f.length;i++){ h+= (f[i]==='a'||f[i]==='b'||f[i]==='c') ? inp(f[i]) : ('<span>'+f[i]+'</span>'); }
  $('q').innerHTML=h;
  ['a','b','c'].forEach(n=>{const el=$('in_'+n); if(el) el.addEventListener('input',run);});
}
function compute(op,a,b,c){
  a=parseFloat(a);b=parseFloat(b);c=parseFloat(c);
  switch(op){
    case 'of': return {v:rnd(a/100*b), t:a+'% of '+b};
    case 'isPctOf': return {v:rnd(a/b*100), u:'%', t:a+' is this % of '+b};
    case 'change': return {v:rnd((b-a)/Math.abs(a)*100), u:'%', t:'from '+a+' to '+b};
    case 'addPct': return {v:rnd(b*(1+a/100)), t:b+' + '+a+'%'};
    case 'subPct': return {v:rnd(b*(1-a/100)), t:b+' − '+a+'%'};
    case 'tip': { const p=(c>=1?c:1), tip=rnd(a/100*b,2), tot=rnd(b+tip,2); return {tip,tot,per:rnd(tot/p,2),p}; }
  }
}
function run(){
  const a=$('in_a')?$('in_a').value:'', b=$('in_b')?$('in_b').value:'', c=$('in_c')?$('in_c').value:'';
  if((a===''&&op!=='tip')||b===''){$('out').innerHTML='<span class=muted style="font-size:15px">Enter the numbers above.</span>';return;}
  const r=compute(op,a,b,c);
  if(op==='tip'){ if(!isFinite(r.tip)){$('out').innerHTML='';return;}
    $('out').innerHTML='Total '+r.tot+' <span class=eq>(tip '+r.tip+')</span><br><span style="font-size:18px">'+r.per+' per person'+(r.p>1?' × '+r.p:'')+'</span>'; return; }
  if(!isFinite(r.v)){$('out').innerHTML='<span class=muted style="font-size:15px">—</span>';return;}
  $('out').innerHTML=r.v+(r.u||'')+' <span class=eq>('+r.t+')</span>';
}
[...document.querySelectorAll('#tabs button')].forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');
  op=btn.dataset.op; buildForm(); run();
}));
buildForm(); run();
</script>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'WebApplication', name: SITE_NAME, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any (web)', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } };
  return pageShell(`${SITE_NAME} — free percent, % change & tip calculator`, body, { canonical: `${BASE_URL}/`, jsonld });
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
    if (p === '/llms.txt') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(llmsTxt({ name: SITE_NAME, baseUrl: BASE_URL, summary: 'A free percentage calculator (X% of Y, % change, add/subtract %, tip splitter) with a JSON API at /api/pct.', links: [{ label: 'Calculator', path: '/', note: 'percentages' }] })); }
    if (p === '/api/pct') {
      const q = url.searchParams;
      return sendJson(res, compute(q.get('op') || 'of', q.get('a'), q.get('b'), q.get('c')));
    }
    if (p === '/' || p === '') return sendHtml(res, calculatorPage());
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(pageShell('Not found — ' + SITE_NAME, '<h1>Not found</h1><p class=muted><a href="' + bp('/') + '">Back to the calculator</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error: ' + (e && e.message ? e.message : 'unknown')); }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/percent\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
