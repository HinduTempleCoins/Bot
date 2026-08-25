// server.mjs — Convert.SoapBox.Community. A free unit & currency converter. Everyday units (length,
// mass, temperature, volume, area, speed, data) convert 100% OFFLINE from static conversion tables
// baked into the page — no network needed at all. Live CURRENCY rates are fetched CLIENT-SIDE in the
// browser from the keyless, open-source Frankfurter API (api.frankfurter.app, ECB reference rates),
// with a graceful "rates unavailable" fallback if that browser fetch fails. Everything else runs in
// your browser; no CDN, no tracker, no account required.
//
//   PORT=8214 BASE_URL=https://convert.soapbox.community node site/converter/server.mjs
//   → serves the converter at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free converter.
//   MELEK appears ONLY as an understated, OPTIONAL "save your conversions — free account" line that,
//   when clicked, explains the opt-in client-side and links the ordinary signup flow. No wallet, no
//   token talk, never the opening pitch. The converter works fully without an account.
//
// ── NETWORK DISCIPLINE ─────────────────────────────────────────────────────────────────────────────
//   The SERVER handler NEVER fetches at request time (soft-fail-never-throw, offline tests). It renders
//   the tool + the static unit tables as pure strings. The live-currency fetch happens ONLY in the
//   browser, to the keyless Frankfurter API, and degrades gracefully to "rates unavailable".
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page converter (unit + currency tabs)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. Soft-fail: every
//   route renders even with no data — unknown path → 404, never a 500. No PII intake, no server network.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8214);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Converter';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── Tools-hub path awareness (mundane-app-suite-stealth-funnel) ────────────────
// This app runs as its own process behind a path-routing proxy at tools.soapbox.community/<app>.
// The proxy STRIPS the prefix inbound (our routes stay on '/', '/health', '/www/…'); we PREPEND it to
// every self-URL we EMIT. BASE_PATH defaults to '' → standalone behaviour is byte-for-byte unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
// The Tools hub sits at the domain root (default '/'); sibling links point at the hub, not this app.
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;
const SLUG = 'converter';
const HUB_SIBLINGS = [['/calculator', 'Calculator'], ['/notes', 'Notes'], ['/qr', 'QR'], ['/timer', 'Timer'], ['/converter', 'Converter'], ['/diagram', 'Diagram']];
const TOOLS_NAV = `<a class=hublink href="${hub('/')}">◧ SoapBox Tools</a>`
  + HUB_SIBLINGS.filter(([p]) => p !== '/' + SLUG).slice(0, 2).map(([p, l]) => `<a href="${hub(p)}">${l}</a>`).join('');

// The keyless, open-source Frankfurter API (ECB reference rates). Fetched CLIENT-SIDE only. Env-overridable.
const RATES_API = process.env.RATES_API || 'https://api.frankfurter.app';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── static unit-conversion tables (fully offline) ───────────────────────────────────────────────────
// Each linear category defines a base unit and a `factor` = "how many base units in one of this unit".
// Convert: value_in_base = value * factor; value_in_target = value_in_base / target.factor.
// Temperature is non-linear (offset scales) → handled specially in the client with explicit formulas.
export const UNITS = {
  length: {
    label: 'Length', base: 'm',
    units: {
      mm: { label: 'Millimetre (mm)', factor: 0.001 },
      cm: { label: 'Centimetre (cm)', factor: 0.01 },
      m: { label: 'Metre (m)', factor: 1 },
      km: { label: 'Kilometre (km)', factor: 1000 },
      in: { label: 'Inch (in)', factor: 0.0254 },
      ft: { label: 'Foot (ft)', factor: 0.3048 },
      yd: { label: 'Yard (yd)', factor: 0.9144 },
      mi: { label: 'Mile (mi)', factor: 1609.344 },
      nmi: { label: 'Nautical mile', factor: 1852 },
    },
  },
  mass: {
    label: 'Mass / Weight', base: 'kg',
    units: {
      mg: { label: 'Milligram (mg)', factor: 0.000001 },
      g: { label: 'Gram (g)', factor: 0.001 },
      kg: { label: 'Kilogram (kg)', factor: 1 },
      t: { label: 'Tonne (t)', factor: 1000 },
      oz: { label: 'Ounce (oz)', factor: 0.028349523125 },
      lb: { label: 'Pound (lb)', factor: 0.45359237 },
      st: { label: 'Stone (st)', factor: 6.35029318 },
    },
  },
  temp: {
    label: 'Temperature', base: 'C', nonlinear: true,
    units: {
      C: { label: 'Celsius (°C)' },
      F: { label: 'Fahrenheit (°F)' },
      K: { label: 'Kelvin (K)' },
    },
  },
  volume: {
    label: 'Volume', base: 'L',
    units: {
      ml: { label: 'Millilitre (ml)', factor: 0.001 },
      L: { label: 'Litre (L)', factor: 1 },
      m3: { label: 'Cubic metre (m³)', factor: 1000 },
      tsp: { label: 'Teaspoon (US)', factor: 0.00492892159375 },
      tbsp: { label: 'Tablespoon (US)', factor: 0.01478676478125 },
      cup: { label: 'Cup (US)', factor: 0.2365882365 },
      pt: { label: 'Pint (US)', factor: 0.473176473 },
      qt: { label: 'Quart (US)', factor: 0.946352946 },
      gal: { label: 'Gallon (US)', factor: 3.785411784 },
      galuk: { label: 'Gallon (UK)', factor: 4.54609 },
    },
  },
  area: {
    label: 'Area', base: 'm2',
    units: {
      cm2: { label: 'Square centimetre (cm²)', factor: 0.0001 },
      m2: { label: 'Square metre (m²)', factor: 1 },
      ha: { label: 'Hectare (ha)', factor: 10000 },
      km2: { label: 'Square kilometre (km²)', factor: 1000000 },
      ft2: { label: 'Square foot (ft²)', factor: 0.09290304 },
      yd2: { label: 'Square yard (yd²)', factor: 0.83612736 },
      ac: { label: 'Acre', factor: 4046.8564224 },
      mi2: { label: 'Square mile (mi²)', factor: 2589988.110336 },
    },
  },
  speed: {
    label: 'Speed', base: 'mps',
    units: {
      mps: { label: 'Metre/second (m/s)', factor: 1 },
      kph: { label: 'Kilometre/hour (km/h)', factor: 0.2777777777777778 },
      mph: { label: 'Mile/hour (mph)', factor: 0.44704 },
      fps: { label: 'Foot/second (ft/s)', factor: 0.3048 },
      kn: { label: 'Knot (kn)', factor: 0.5144444444444445 },
    },
  },
  data: {
    label: 'Data', base: 'B',
    units: {
      b: { label: 'Bit (b)', factor: 0.125 },
      B: { label: 'Byte (B)', factor: 1 },
      KB: { label: 'Kilobyte (KB, 1000)', factor: 1000 },
      KiB: { label: 'Kibibyte (KiB, 1024)', factor: 1024 },
      MB: { label: 'Megabyte (MB)', factor: 1000000 },
      MiB: { label: 'Mebibyte (MiB)', factor: 1048576 },
      GB: { label: 'Gigabyte (GB)', factor: 1000000000 },
      GiB: { label: 'Gibibyte (GiB)', factor: 1073741824 },
      TB: { label: 'Terabyte (TB)', factor: 1000000000000 },
    },
  },
};
export const CATEGORY_KEYS = Object.keys(UNITS);

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a,.topbar-r button{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel);cursor:pointer}
  .topbar-r a:hover,.topbar-r button:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:900px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .muted{color:var(--mut)}
  .tabs{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 16px}
  .tabs button{border:1px solid var(--line2);border-radius:20px;padding:5px 14px;font-size:13px;font-weight:600;color:var(--fg);background:var(--panel);cursor:pointer}
  .tabs button:hover{border-color:var(--blue);color:var(--blue)}
  .tabs button.on{border-color:var(--blue);color:var(--blue);background:#58a6ff18}
  .card{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:18px}
  .row{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:end}
  @media (max-width:640px){.row{grid-template-columns:1fr}}
  .fld label{display:block;font-size:12px;color:var(--mut);margin-bottom:5px}
  .fld input,.fld select{width:100%;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:10px 12px;font-size:16px;font-weight:600}
  .fld input:focus,.fld select:focus{border-color:var(--blue);outline:none}
  .swap{align-self:center}
  .swap button{border:1px solid var(--line2);border-radius:10px;background:var(--panel);color:var(--fg);cursor:pointer;padding:9px 12px;font-size:16px;font-weight:700}
  .swap button:hover{border-color:var(--blue);color:var(--blue)}
  .result{margin-top:14px;font-size:20px;font-weight:700}
  .result .eq{color:var(--mut);font-weight:400;font-size:14px}
  .note{font-size:13px;color:var(--mut);margin-top:8px}
  .note.warn{color:var(--gold)}
  table.ref{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  table.ref th,table.ref td{border:1px solid var(--line);padding:6px 9px;text-align:left}
  table.ref th{color:var(--mut);font-weight:600;background:#0b0f14}
  details.tables{margin:18px 0;color:var(--mut)} details.tables summary{cursor:pointer;font-weight:600;color:var(--fg)}
  .save-cta{margin:16px 0}
  .save-cta button{border:1px solid var(--line2);border-radius:8px;padding:9px 16px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .save-cta button:hover{border-color:var(--gold);color:var(--gold)}
  .panel{display:none;border:1px solid var(--gold);background:#d2992211;border-radius:10px;padding:16px 18px;margin:12px 0;color:var(--fg)}
  .panel.on{display:block}
  .panel h3{margin:0 0 6px;font-size:16px} .panel p{margin:6px 0;font-size:14px;color:var(--fg)}
  .panel a.cta{display:inline-block;margin-top:8px;border:1px solid var(--gold);color:var(--gold);border-radius:8px;padding:8px 15px;font-weight:700}
  .panel a.cta:hover{background:var(--gold);color:#0d1117;text-decoration:none}
  .backlink{font-size:13px;margin-bottom:10px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a free unit &amp; currency converter. Unit conversions run entirely offline in
  your browser; live currency rates come from the open-source
  <a href="https://www.frankfurter.app/" rel="noopener" target=_blank>Frankfurter</a> API (European Central
  Bank reference rates). No account, no install, no tracking.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free online unit & currency converter — length, weight, temperature, volume, area, speed and data convert instantly offline, plus live exchange rates. No sign-up, no install, runs in your browser.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  // Neutral SoftwareApplication JSON-LD only — this is a plain converter (stealth funnel), no crypto branding.
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${bp('/')}">🔁 SoapBox <span>Converter</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}<a href="${bp('/')}">New</a><button type=button id=nav-save>☁ Save conversions</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── static reference tables (rendered server-side, no fetch) ─────────────────────────────────────────
function refTables() {
  const parts = [];
  for (const key of CATEGORY_KEYS) {
    const cat = UNITS[key];
    const rows = Object.entries(cat.units).map(([u, meta]) => {
      const cell = cat.nonlinear ? '—' : esc(String(meta.factor));
      return `<tr><td>${esc(meta.label)}</td><td>${cell}</td></tr>`;
    }).join('');
    const head = cat.nonlinear
      ? `<tr><th>Unit</th><th>Scale</th></tr>`
      : `<tr><th>Unit</th><th>In 1 ${esc(cat.base)}</th></tr>`;
    parts.push(`<h4>${esc(cat.label)}</h4><table class=ref><thead>${head}</thead><tbody>${rows}</tbody></table>`);
  }
  return parts.join('');
}

// ── the converter page ──────────────────────────────────────────────────────────────────────────────
// `cat` (optional) preselects a category tab; `ret` (optional) is a Back URL routed through safeHref.
// Both are user-controlled → cat is validated against CATEGORY_KEYS and esc()'d; ret via safeHref.
export function converterPage({ cat, ret } = {}) {
  const catKey = CATEGORY_KEYS.includes(cat) ? cat : 'length';
  const back = safeHref(ret);
  const echoedCat = cat ? `<span class=muted> · ${esc(cat)}</span>` : '';

  // Currency tab is a distinct pseudo-category; unit tabs come from UNITS.
  const unitTabs = CATEGORY_KEYS.map((k) =>
    `<button type=button data-cat="${esc(k)}"${k === catKey ? ' class=on' : ''}>${esc(UNITS[k].label)}</button>`).join('');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free unit and currency converter. Units convert offline in the browser; live currency rates via the keyless Frankfurter API.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Unit &amp; currency converter</h1>
<p class=sub>Convert length, weight, temperature, volume, area, speed and data instantly — it all runs
offline in your browser. Live currency rates are fetched fresh when you open the Currency tab.${echoedCat}</p>

<div class=tabs id=tabs>${unitTabs}
  <button type=button data-cat="currency">Currency</button></div>

<div class=card>
  <div class=row>
    <div class=fld>
      <label for=inval id=fromLabel>From</label>
      <input id=inval type=text inputmode=decimal value="1" aria-label="Value to convert">
      <select id=fromUnit aria-label="Convert from"></select>
    </div>
    <div class="fld swap"><button type=button id=swap title="Swap units" aria-label="Swap units">⇄</button></div>
    <div class=fld>
      <label for=outval>To</label>
      <input id=outval type=text value="" readonly aria-label="Converted value">
      <select id=toUnit aria-label="Convert to"></select>
    </div>
  </div>
  <div class=result id=result aria-live=polite><span class=muted>—</span></div>
  <div class=note id=note></div>
</div>

<details class=tables><summary>Conversion reference tables (offline)</summary>
  ${refTables()}
</details>

<div class=save-cta><button type=button id=save-btn>☁ Save your conversions</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep your conversions &amp; favourite units — across devices</h3>
  <p>This converter is fully free and works right here in your browser, no account needed. To <b>save your
    frequent conversions</b> and sync your favourite units across your phone, tablet and laptop, you can
    create a free MELEK account. It takes a minute and there's nothing to install.</p>
  <p class=muted>Prefer to stay local? That's the default — nothing you type here is sent anywhere except the
    currency rate lookup.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<script>
(function(){
  var UNITS = ${JSON.stringify(UNITS)};
  var RATES_API = ${JSON.stringify(RATES_API)};
  var CATS = ${JSON.stringify(CATEGORY_KEYS)};
  var state = { cat: ${JSON.stringify(catKey)}, rates: null, base: 'USD', currencies: null };

  var inval = document.getElementById('inval');
  var outval = document.getElementById('outval');
  var fromUnit = document.getElementById('fromUnit');
  var toUnit = document.getElementById('toUnit');
  var result = document.getElementById('result');
  var note = document.getElementById('note');
  var fromLabel = document.getElementById('fromLabel');

  // Common ISO currencies to seed the Currency tab (Frankfurter covers the ECB set).
  var CURRENCIES = ['USD','EUR','GBP','JPY','CHF','CAD','AUD','CNY','INR','BRL','MXN','ZAR','SEK','NOK','DKK','PLN','TRY','SGD','HKD','NZD','KRW'];

  function fmt(n){
    if (!isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a !== 0 && (a < 0.0001 || a >= 1e12)) return n.toExponential(6);
    var s = n.toPrecision(10);
    return String(parseFloat(s));
  }

  function tempConvert(v, from, to){
    var c; // to Celsius
    if (from === 'C') c = v; else if (from === 'F') c = (v - 32) * 5/9; else c = v - 273.15;
    if (to === 'C') return c; if (to === 'F') return c * 9/5 + 32; return c + 273.15;
  }

  function fillUnitOptions(catKey){
    var cat = UNITS[catKey];
    var keys = Object.keys(cat.units);
    function opts(sel){ return keys.map(function(u){ return '<option value="'+u+'">'+cat.units[u].label+'</option>'; }).join(''); }
    fromUnit.innerHTML = opts(); toUnit.innerHTML = opts();
    fromUnit.selectedIndex = 0; toUnit.selectedIndex = keys.length > 1 ? 1 : 0;
    fromLabel.textContent = 'From';
  }

  function fillCurrencyOptions(){
    function opts(){ return CURRENCIES.map(function(c){ return '<option value="'+c+'">'+c+'</option>'; }).join(''); }
    fromUnit.innerHTML = opts(); toUnit.innerHTML = opts();
    fromUnit.value = 'USD'; toUnit.value = 'EUR';
    fromLabel.textContent = 'From';
  }

  function convertUnits(){
    var cat = UNITS[state.cat];
    var v = parseFloat(inval.value);
    if (isNaN(v)){ outval.value=''; result.innerHTML='<span class="muted">Enter a number</span>'; note.textContent=''; return; }
    var f = fromUnit.value, t = toUnit.value, out;
    if (cat.nonlinear){ out = tempConvert(v, f, t); }
    else { out = v * cat.units[f].factor / cat.units[t].factor; }
    outval.value = fmt(out);
    result.innerHTML = fmt(v)+' '+cat.units[f].label+' <span class="eq">=</span> <b>'+fmt(out)+'</b> '+cat.units[t].label;
    note.className='note'; note.textContent='';
  }

  function renderCurrency(){
    var v = parseFloat(inval.value);
    var f = fromUnit.value, t = toUnit.value;
    if (isNaN(v)){ outval.value=''; result.innerHTML='<span class="muted">Enter an amount</span>'; return; }
    if (!state.rates){ result.innerHTML='<span class="muted">Loading rates…</span>'; return; }
    // rates are keyed to state.base; cross-rate = (v / rate[f]) * rate[t], with base itself = 1.
    function rate(cur){ return cur === state.base ? 1 : state.rates[cur]; }
    var rf = rate(f), rt = rate(t);
    if (rf == null || rt == null){ note.className='note warn'; note.textContent='One of those currencies is not in the current rate set.'; result.innerHTML='<span class="muted">—</span>'; return; }
    var out = v / rf * rt;
    outval.value = out.toFixed(4);
    result.innerHTML = fmt(v)+' '+f+' <span class="eq">=</span> <b>'+out.toFixed(4)+'</b> '+t;
    note.className='note'; note.textContent='Rates: European Central Bank via Frankfurter · '+(state.date||'');
  }

  // CLIENT-SIDE fetch to the keyless Frankfurter API — graceful fallback if it fails.
  function loadRates(){
    note.className='note'; note.textContent='Fetching live rates…';
    var url = RATES_API.replace(/\\/$/,'') + '/latest?from=' + encodeURIComponent(state.base);
    fetch(url).then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
      .then(function(j){
        state.rates = j && j.rates ? j.rates : null;
        state.date = j && j.date ? j.date : '';
        if (!state.rates) throw new Error('no rates');
        renderCurrency();
      })
      .catch(function(){
        state.rates = null;
        note.className='note warn';
        note.textContent='Live currency rates are unavailable right now. Unit conversions still work offline — try another tab.';
        result.innerHTML='<span class="muted">Rates unavailable</span>';
        outval.value='';
      });
  }

  function recompute(){ if (state.cat === 'currency') renderCurrency(); else convertUnits(); }

  function selectCat(catKey){
    state.cat = catKey;
    var btns = document.querySelectorAll('#tabs button');
    for (var i=0;i<btns.length;i++){ btns[i].className = (btns[i].getAttribute('data-cat')===catKey)?'on':''; }
    if (catKey === 'currency'){ fillCurrencyOptions(); loadRates(); }
    else { fillUnitOptions(catKey); convertUnits(); }
  }

  document.querySelectorAll('#tabs button').forEach(function(b){
    b.addEventListener('click', function(){ selectCat(b.getAttribute('data-cat')); });
  });
  inval.addEventListener('input', recompute);
  fromUnit.addEventListener('change', recompute);
  toUnit.addEventListener('change', recompute);
  document.getElementById('swap').addEventListener('click', function(){
    var a = fromUnit.value; fromUnit.value = toUnit.value; toUnit.value = a; recompute();
  });

  // save unlock (client-side explainer only; the converter never needs it)
  var panel = document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave = document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  selectCat(state.cat);
})();
</script>`;

  return page('Free Unit & Currency Converter — offline units, live rates', body, { canonical: `${BASE_URL}/`, jsonld });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
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
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.6' }));
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
        summary: 'Free browser-based unit & currency converter. Units convert offline; live currency rates via the keyless Frankfurter API. No account, no install, no tracking. Optional free MELEK account to save conversions.',
        links: [{ label: 'Converter', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, converterPage({
        cat: url.searchParams.get('cat') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Converter', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Open the converter</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/converter\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Converter on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
