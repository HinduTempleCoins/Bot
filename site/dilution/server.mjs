// server.mjs — Dilution.SoapBox.Community. A free dilution & ratio calculator — on-brand for soap,
// skincare, cleaning solutions and the lab bench. Three modes:
//   1. C1V1 = C2V2  — how much stock + solvent to hit a target concentration & volume.
//   2. Ratio mix    — a "1:N" dilution (e.g. 1:10 cleaner): parts of concentrate and water for a volume.
//   3. Essential-oil dilution — target % in a carrier → grams of EO and drops (≈20 drops/mL, ~0.92 g/mL).
// Pure math, runs in the browser; the server never fetches. Same house style + stealth funnel.
//
//   PORT=8233 BASE_URL=https://dilution.soapbox.community node site/dilution/server.mjs
//   → the calculator at /  ·  JSON API at /api/dilute?mode=c1v1&c1=70&c2=50&v2=500
//
// DISCIPLINE: esc() everything, safeHref() any user URL, soft-fail (unknown path → 404), NO server net.

import { createServer } from 'node:http';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8233);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Dilution Calculator';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function safeHref(u) { if (!u || typeof u !== 'string') return ''; try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; } }
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : NaN; };
const round = (n, dp = 3) => { const f = 10 ** dp; return Math.round((Number(n) + Number.EPSILON) * f) / f; };

// Common rule-of-thumb constants for the EO mode (documented, overridable in the API).
export const DROPS_PER_ML = 20;   // ~20 drops per mL is the standard essential-oil estimate
export const EO_DENSITY = 0.92;   // g/mL, a typical essential-oil density midpoint

// ── the pure engine ────────────────────────────────────────────────────────────────────────────────
export function dilute(mode, p = {}) {
  const c1 = num(p.c1), c2 = num(p.c2), v2 = num(p.v2);
  switch (mode) {
    case 'c1v1': {
      // Need target concentration below stock, positive target volume.
      if (!(c1 > 0) || !(c2 >= 0) || !(v2 > 0) || c2 > c1) return { ok: false, error: 'need 0 < c2 ≤ c1 and v2 > 0' };
      const stock = round((c2 * v2) / c1);
      return { ok: true, mode, stock, solvent: round(v2 - stock), targetVolume: round(v2), note: `${round(stock)} of stock + ${round(v2 - stock)} solvent → ${v2} at ${c2}%` };
    }
    case 'ratio': {
      // 1:N ratio (1 part concentrate to N parts water), for a target total volume.
      const n = num(p.n), vol = num(p.v2 ?? p.vol);
      if (!(n >= 0) || !(vol > 0)) return { ok: false, error: 'need n ≥ 0 and a target volume' };
      const parts = 1 + n;
      const concentrate = round(vol / parts), water = round(vol - vol / parts);
      return { ok: true, mode, ratio: `1:${round(n)}`, concentrate, water, targetVolume: round(vol), note: `${concentrate} concentrate + ${water} water = ${round(vol)}` };
    }
    case 'eo': {
      // Essential-oil dilution: target % in a carrier volume (mL) → grams of EO and approx drops.
      const pct = num(p.pct), carrierMl = num(p.carrierMl ?? p.v2);
      const dropsPerMl = num(p.dropsPerMl) > 0 ? num(p.dropsPerMl) : DROPS_PER_ML;
      const density = num(p.density) > 0 ? num(p.density) : EO_DENSITY;
      if (!(pct >= 0) || !(carrierMl > 0)) return { ok: false, error: 'need pct ≥ 0 and carrier volume > 0' };
      // % here is volume of EO relative to carrier volume (the common skincare convention).
      const eoMl = (pct / 100) * carrierMl;
      return { ok: true, mode, eoMl: round(eoMl, 3), eoGrams: round(eoMl * density, 3), drops: Math.round(eoMl * dropsPerMl), carrierMl: round(carrierMl), pct: round(pct, 3), note: `${round(pct, 2)}% of ${round(carrierMl)} mL carrier` };
    }
    default: return { ok: false, error: 'unknown mode' };
  }
}
export const MODES = ['c1v1', 'ratio', 'eo'];

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;gap:14px;align-items:center}
  .brand{font-weight:800;font-size:18px} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap} .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:760px;margin:0 auto;padding:18px 22px 60px} h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px;max-width:64ch}
  .tabs{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0} .tabs button{border:1px solid var(--line2);border-radius:20px;padding:5px 14px;font-size:13px;font-weight:600;color:var(--fg);background:var(--panel);cursor:pointer}
  .tabs button.on{border-color:var(--blue);color:var(--blue);background:#58a6ff18}
  .card{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:18px}
  .flds{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px} @media(max-width:560px){.flds{grid-template-columns:1fr}}
  label{display:block;font-size:12px;color:var(--mut);margin-bottom:4px} input{width:100%;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 11px;font-size:16px;font-weight:600}
  input:focus{border-color:var(--blue);outline:none}
  .result{margin-top:16px;font-size:20px;font-weight:800} .result .eq{color:var(--mut);font-size:14px;font-weight:400;display:block;margin-top:4px}
  .muted{color:var(--mut)} .note{font-size:12px;color:var(--mut);margin-top:10px}
  .unlock{margin-top:20px;border:1px dashed var(--line2);border-radius:10px;padding:12px 14px;font-size:13.5px;color:var(--mut)} .unlock a{font-weight:700}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line)}
</style>`;

function pageShell(title, body, opts = {}) {
  const desc = opts.description || 'A free dilution and ratio calculator: C1V1=C2V2, 1:N ratio mixes, and essential-oil dilution to grams and drops. For soap, skincare, cleaning and the lab. Runs in your browser.';
  const head = headTags({ title, description: desc, canonical: opts.canonical || `${BASE_URL}/`, siteName: SITE_NAME, robots: opts.robots || 'index,follow', jsonld: opts.jsonld || null });
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${esc(bp('/'))}">◧ SoapBox <span>Dilution</span><span class=alpha>Alpha</span></a>
<div class=topbar-r><a href="${hub('/')}">◧ SoapBox Tools</a><a href="${hub('/soapcalc')}">Soap Calculator</a></div></header>
<main class=wrap>${body}</main>
<footer><b>${esc(SITE_NAME)}</b> — free, private, runs in your browser. No sign-up.</footer></body></html>`;
}

export function calculatorPage() {
  const body = `<h1>Dilution &amp; Ratio Calculator</h1>
<p class=sub>Work out how much stock and solvent to mix — for a target concentration, a 1:N ratio, or an
essential-oil dilution. Handy for soap, skincare, cleaning solutions and the lab.</p>
<div class=tabs id=tabs>
  <button data-mode=c1v1 class=on>Concentration (C₁V₁=C₂V₂)</button>
  <button data-mode=ratio>Ratio (1:N)</button>
  <button data-mode=eo>Essential-oil %</button>
</div>
<div class=card><div class=flds id=flds></div><div class=result id=out></div><div class=note id=note></div></div>
<div class=unlock>💾 <b>Save your mixes?</b> Optional, with a free MELEK account. <a href="${esc(SIGNUP_URL)}" rel="nofollow">Create a free account</a>. The tool works fully without one.</div>
<script>
const $=(id)=>document.getElementById(id);
const rnd=(n,dp=3)=>{const f=10**dp;return Math.round((Number(n)+Number.EPSILON)*f)/f;};
const DROPS_PER_ML=${DROPS_PER_ML}, EO_DENSITY=${EO_DENSITY};
let mode='c1v1';
const FIELDS={
  c1v1:[['c1','Stock concentration % (C₁)','70'],['c2','Target concentration % (C₂)','50'],['v2','Target volume (V₂)','500']],
  ratio:[['n','Dilution ratio 1 : N','10'],['v2','Target total volume','1000']],
  eo:[['pct','Target dilution %','2'],['carrierMl','Carrier volume (mL)','100']],
};
function buildForm(){
  $('flds').innerHTML=FIELDS[mode].map(([k,l,v])=>'<div><label for=f_'+k+'>'+l+'</label><input id=f_'+k+' type=number step=any value="'+v+'"></div>').join('');
  FIELDS[mode].forEach(([k])=>$('f_'+k).addEventListener('input',run));
}
function val(k){const el=$('f_'+k);return el?parseFloat(el.value):NaN;}
function run(){
  let out='',note='';
  if(mode==='c1v1'){
    const c1=val('c1'),c2=val('c2'),v2=val('v2');
    if(!(c1>0)||!(c2>=0)||!(v2>0)||c2>c1){$('out').innerHTML='<span class=muted style="font-size:15px">Need 0 &lt; C₂ ≤ C₁ and a positive volume.</span>';$('note').textContent='';return;}
    const stock=rnd(c2*v2/c1),solvent=rnd(v2-stock);
    out='Use '+stock+' of stock <span class=eq>+ '+solvent+' solvent → '+v2+' at '+c2+'%</span>';
    note='C₁V₁ = C₂V₂ → V₁ = C₂·V₂ / C₁';
  } else if(mode==='ratio'){
    const n=val('n'),vol=val('v2');
    if(!(n>=0)||!(vol>0)){$('out').innerHTML='<span class=muted style="font-size:15px">Enter a ratio and a volume.</span>';$('note').textContent='';return;}
    const conc=rnd(vol/(1+n)),water=rnd(vol-vol/(1+n));
    out=conc+' concentrate <span class=eq>+ '+water+' water = '+rnd(vol)+' (1:'+rnd(n)+')</span>';
    note='1 part concentrate to '+rnd(n)+' parts water = '+(1+n)+' parts total';
  } else {
    const pct=val('pct'),ml=val('carrierMl');
    if(!(pct>=0)||!(ml>0)){$('out').innerHTML='<span class=muted style="font-size:15px">Enter a % and a carrier volume.</span>';$('note').textContent='';return;}
    const eoMl=pct/100*ml;
    out=rnd(eoMl,3)+' mL essential oil <span class=eq>≈ '+Math.round(eoMl*DROPS_PER_ML)+' drops · '+rnd(eoMl*EO_DENSITY,3)+' g</span>';
    note='≈'+DROPS_PER_ML+' drops/mL, EO density ≈'+EO_DENSITY+' g/mL — estimates; verify for your oil.';
  }
  $('out').innerHTML=out; $('note').textContent=note;
}
[...document.querySelectorAll('#tabs button')].forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');
  mode=btn.dataset.mode; buildForm(); run();
}));
buildForm(); run();
</script>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'WebApplication', name: SITE_NAME, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any (web)', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } };
  return pageShell(`${SITE_NAME} — free dilution, ratio & essential-oil calculator`, body, { canonical: `${BASE_URL}/`, jsonld });
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
    if (p === '/llms.txt') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(llmsTxt({ name: SITE_NAME, baseUrl: BASE_URL, summary: 'A free dilution & ratio calculator (C1V1=C2V2, 1:N ratio, essential-oil %) with a JSON API at /api/dilute.', links: [{ label: 'Calculator', path: '/', note: 'dilution' }] })); }
    if (p === '/api/dilute') {
      const q = url.searchParams;
      const params = Object.fromEntries([...q.entries()]);
      return sendJson(res, dilute(q.get('mode') || 'c1v1', params));
    }
    if (p === '/' || p === '') return sendHtml(res, calculatorPage());
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(pageShell('Not found — ' + SITE_NAME, '<h1>Not found</h1><p class=muted><a href="' + bp('/') + '">Back to the calculator</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error: ' + (e && e.message ? e.message : 'unknown')); }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/dilution\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
