// server.mjs — Weather.SoapBox.Community. A free, clean weather app: your local forecast with no ads,
// no sign-up, no tracking. The SERVER renders only the shell (search box + empty forecast panels). The
// live weather data is fetched 100% CLIENT-SIDE in the browser from the keyless Open-Meteo API
// (open-meteo.com — no API key for non-commercial use): geolocation OR a city search → the Open-Meteo
// geocoding + forecast endpoints, rendered in the browser. No CDN, no tracker, no account required.
//
//   PORT=8215 BASE_URL=https://weather.soapbox.community node site/weather/server.mjs
//   → serves the weather app at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free weather app.
//   MELEK appears ONLY as an understated, OPTIONAL "save your places — free account" line that, when
//   clicked, explains the opt-in client-side and links the ordinary signup flow. No wallet, no token
//   talk, never the opening pitch. The forecast works fully without an account.
//
// ── NETWORK DISCIPLINE ─────────────────────────────────────────────────────────────────────────────
//   The SERVER handler NEVER fetches at request time (soft-fail-never-throw, offline tests). It renders
//   the shell as a pure string. ALL weather/geocoding fetches happen in the BROWSER, to the keyless
//   Open-Meteo API, and degrade gracefully to a friendly "couldn't load the forecast" message.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page weather app (search + geolocate + forecast)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value (the ?q= city prefill is user-controlled → escaped);
//   safeHref() on any user-provided URL. Soft-fail: every route renders even with no data — unknown
//   path → 404, never a 500. No PII intake, no server network.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8215);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Weather';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';
// Keyless Open-Meteo endpoints. Fetched CLIENT-SIDE only. Env-overridable.
const FORECAST_API = process.env.FORECAST_API || 'https://api.open-meteo.com';
const GEOCODE_API = process.env.GEOCODE_API || 'https://geocoding-api.open-meteo.com';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

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
  .wrap{max-width:840px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .muted{color:var(--mut)}
  .search{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  .search input{flex:1 1 240px;min-width:180px;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:10px 12px;font-size:15px}
  .search input:focus{border-color:var(--blue);outline:none}
  .search button{border:1px solid var(--line2);border-radius:8px;padding:10px 15px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer;white-space:nowrap}
  .search button:hover{border-color:var(--blue);color:var(--blue)}
  #matches{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}
  #matches button{text-align:left;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--fg);padding:8px 12px;cursor:pointer;font-size:14px}
  #matches button:hover{border-color:var(--blue);color:var(--blue)}
  .status{font-size:14px;color:var(--mut);margin:8px 0}
  .status.warn{color:var(--gold)}
  .current{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:18px;display:none}
  .current.on{display:block}
  .current .place{font-size:15px;color:var(--mut)}
  .current .now{display:flex;align-items:center;gap:14px;margin-top:6px}
  .current .temp{font-size:44px;font-weight:800;line-height:1}
  .current .icon{font-size:40px}
  .current .desc{font-size:15px}
  .current .stats{display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;font-size:13px;color:var(--mut)}
  .current .stats b{color:var(--fg)}
  .days{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;margin-top:14px}
  .day{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:10px;text-align:center;font-size:13px}
  .day .dow{color:var(--mut)} .day .di{font-size:24px;margin:4px 0} .day .hi{font-weight:700} .day .lo{color:var(--mut)}
  .units{display:flex;gap:8px;margin:12px 0;align-items:center;font-size:13px;color:var(--mut)}
  .units button{border:1px solid var(--line2);border-radius:16px;padding:4px 12px;font-size:13px;font-weight:600;color:var(--fg);background:var(--panel);cursor:pointer}
  .units button.on{border-color:var(--blue);color:var(--blue);background:#58a6ff18}
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
  <b>${esc(SITE_NAME)}</b> — a free, private weather app. Your location is used only in your own browser to
  look up the forecast; nothing is stored on our servers. Weather data by
  <a href="https://open-meteo.com/" rel="noopener" target=_blank>Open-Meteo</a> (free, open weather API).
  No account, no ads, no tracking.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free, clean weather app — your local forecast with current conditions and a 7-day outlook. No ads, no sign-up, no tracking. Runs in your browser; weather data by Open-Meteo.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  // Neutral WebApplication JSON-LD only — a plain weather app (stealth funnel), no crypto branding.
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">⛅ SoapBox <span>Weather</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="/">New</a><button type=button id=nav-save>☁ Save places</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the weather page (shell only — data is fetched client-side) ─────────────────────────────────────
// `q` (optional) prefills the city search box; it is user-controlled → esc()'d before echoing into the
// input value AND into a small visible echo. `ret` (optional) is a Back URL routed through safeHref.
export function weatherPage({ q, ret } = {}) {
  const back = safeHref(ret);
  const initialQ = q ? esc(String(q).slice(0, 120)) : '';
  const echoedRaw = q ? `<span class=muted> · looking up: ${esc(q)}</span>` : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free weather app showing current conditions and a 7-day forecast. Runs in the browser; weather data via the keyless Open-Meteo API.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Weather &amp; 7-day forecast</h1>
<p class=sub>Search a city or use your location for the current conditions and the week ahead. No ads, no
sign-up — the forecast loads right in your browser.${echoedRaw}</p>

<div class=search>
  <input id=q type=text placeholder="Search a city (e.g. London, Tokyo, Austin)" value="${initialQ}"
    aria-label="City search" maxlength=120 autocomplete=off>
  <button type=button id=go>Search</button>
  <button type=button id=geo title="Use my location">📍 My location</button>
</div>
<div id=matches aria-live=polite></div>

<div class=units id=units>
  <span>Units:</span>
  <button type=button data-u=metric class=on>°C · km/h</button>
  <button type=button data-u=imperial>°F · mph</button>
</div>

<div class=status id=status>Search a city or tap <b>My location</b> to see the forecast.</div>

<div class=current id=current aria-live=polite>
  <div class=place id=place></div>
  <div class=now><span class=icon id=icon></span><span class=temp id=temp></span>
    <div><div class=desc id=desc></div><div class=muted id=feels></div></div></div>
  <div class=stats id=stats></div>
  <div class=days id=days></div>
</div>

<div class=save-cta><button type=button id=save-btn>☁ Save your places</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep your favourite places — across every device</h3>
  <p>This weather app is fully free and works right here in your browser, no account needed. To <b>save your
    favourite cities</b> and see them on your phone, tablet and laptop, you can create a free MELEK account.
    It takes a minute and there's nothing to install.</p>
  <p class=muted>Prefer to stay local? That's the default — your searches stay in this browser.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<script>
(function(){
  var FORECAST_API = ${JSON.stringify(FORECAST_API)};
  var GEOCODE_API = ${JSON.stringify(GEOCODE_API)};
  var state = { units: 'metric', lat: null, lon: null, name: '' };

  var q = document.getElementById('q');
  var matches = document.getElementById('matches');
  var status = document.getElementById('status');
  var current = document.getElementById('current');

  // WMO weather-code → { emoji, text } (Open-Meteo uses WMO codes).
  var WMO = {
    0:['☀️','Clear sky'],1:['🌤️','Mainly clear'],2:['⛅','Partly cloudy'],3:['☁️','Overcast'],
    45:['🌫️','Fog'],48:['🌫️','Rime fog'],51:['🌦️','Light drizzle'],53:['🌦️','Drizzle'],55:['🌧️','Dense drizzle'],
    56:['🌧️','Freezing drizzle'],57:['🌧️','Freezing drizzle'],61:['🌦️','Light rain'],63:['🌧️','Rain'],65:['🌧️','Heavy rain'],
    66:['🌧️','Freezing rain'],67:['🌧️','Freezing rain'],71:['🌨️','Light snow'],73:['🌨️','Snow'],75:['❄️','Heavy snow'],
    77:['🌨️','Snow grains'],80:['🌦️','Rain showers'],81:['🌧️','Rain showers'],82:['⛈️','Violent showers'],
    85:['🌨️','Snow showers'],86:['🌨️','Snow showers'],95:['⛈️','Thunderstorm'],96:['⛈️','Thunderstorm w/ hail'],99:['⛈️','Thunderstorm w/ hail']
  };
  function wmo(c){ return WMO[c] || ['❓','—']; }
  function setStatus(msg, warn){ status.innerHTML=''; status.className = warn?'status warn':'status'; status.textContent = msg; }

  function esc2(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];}); }

  function tempUnit(){ return state.units==='imperial'?'°F':'°C'; }
  function windUnit(){ return state.units==='imperial'?'mph':'km/h'; }

  // CLIENT-SIDE geocode — keyless Open-Meteo geocoding. Graceful fallback.
  function geocode(name){
    matches.innerHTML=''; setStatus('Searching for “'+name+'”…');
    var url = GEOCODE_API.replace(/\\/$/,'') + '/v1/search?count=6&language=en&format=json&name=' + encodeURIComponent(name);
    fetch(url).then(function(r){ if(!r.ok) throw new Error('http'); return r.json(); })
      .then(function(j){
        var list = (j && j.results) || [];
        if (!list.length){ setStatus('No place matched “'+name+'”. Try another spelling.', true); return; }
        if (list.length === 1){ pick(list[0]); return; }
        matches.innerHTML='';
        list.forEach(function(p){
          var b = document.createElement('button');
          var label = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
          b.textContent = label;
          b.addEventListener('click', function(){ matches.innerHTML=''; pick(p); });
          matches.appendChild(b);
        });
        setStatus('Pick a place:');
      })
      .catch(function(){ setStatus('Could not search right now. Please try again in a moment.', true); });
  }

  function pick(p){
    var label = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
    state.lat = p.latitude; state.lon = p.longitude; state.name = label;
    loadForecast();
  }

  // CLIENT-SIDE forecast — keyless Open-Meteo. Graceful fallback.
  function loadForecast(){
    if (state.lat == null){ return; }
    setStatus('Loading the forecast for '+state.name+'…');
    var tempU = state.units==='imperial' ? 'fahrenheit' : 'celsius';
    var windU = state.units==='imperial' ? 'mph' : 'kmh';
    var url = FORECAST_API.replace(/\\/$/,'') + '/v1/forecast'
      + '?latitude=' + encodeURIComponent(state.lat) + '&longitude=' + encodeURIComponent(state.lon)
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
      + '&timezone=auto&forecast_days=7'
      + '&temperature_unit=' + tempU + '&wind_speed_unit=' + windU;
    fetch(url).then(function(r){ if(!r.ok) throw new Error('http'); return r.json(); })
      .then(function(j){ render(j); })
      .catch(function(){ setStatus('Sorry — we couldn\\'t load the forecast just now. Please try again.', true); });
  }

  function render(j){
    var cur = j.current || {}; var d = j.daily || {};
    var w = wmo(cur.weather_code);
    document.getElementById('place').textContent = state.name;
    document.getElementById('icon').textContent = w[0];
    document.getElementById('temp').textContent = Math.round(cur.temperature_2m) + tempUnit();
    document.getElementById('desc').textContent = w[1];
    document.getElementById('feels').textContent = 'Feels like ' + Math.round(cur.apparent_temperature) + tempUnit();
    document.getElementById('stats').innerHTML =
      'Humidity <b>'+esc2(cur.relative_humidity_2m)+'%</b>' +
      ' · Wind <b>'+Math.round(cur.wind_speed_10m)+' '+windUnit()+'</b>';
    var days = document.getElementById('days'); days.innerHTML='';
    var times = d.time || [];
    for (var i=0;i<times.length;i++){
      var dw = wmo(d.weather_code[i]);
      var dow = new Date(times[i]+'T00:00').toLocaleDateString(undefined,{weekday:'short'});
      var el = document.createElement('div'); el.className='day';
      el.innerHTML = '<div class=dow>'+esc2(dow)+'</div><div class=di>'+dw[0]+'</div>' +
        '<div class=hi>'+Math.round(d.temperature_2m_max[i])+'°</div>' +
        '<div class=lo>'+Math.round(d.temperature_2m_min[i])+'°</div>';
      days.appendChild(el);
    }
    setStatus('');
    current.classList.add('on');
  }

  document.getElementById('go').addEventListener('click', function(){ var v=q.value.trim(); if(v) geocode(v); });
  q.addEventListener('keydown', function(e){ if(e.key==='Enter'){ var v=q.value.trim(); if(v) geocode(v); } });

  document.getElementById('geo').addEventListener('click', function(){
    if (!navigator.geolocation){ setStatus('Your browser doesn\\'t support location — search a city instead.', true); return; }
    setStatus('Getting your location…');
    navigator.geolocation.getCurrentPosition(function(pos){
      state.lat = pos.coords.latitude; state.lon = pos.coords.longitude; state.name = 'Your location';
      loadForecast();
    }, function(){ setStatus('Couldn\\'t get your location — search a city instead.', true); }, { timeout: 10000 });
  });

  document.querySelectorAll('#units button').forEach(function(b){
    b.addEventListener('click', function(){
      state.units = b.getAttribute('data-u');
      document.querySelectorAll('#units button').forEach(function(x){ x.className = x===b?'on':''; });
      if (state.lat != null) loadForecast();
    });
  });

  // save unlock (client-side explainer only; the app never needs it)
  var panel = document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave = document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  // if a ?q= was provided, kick off a search automatically
  if (q.value.trim()) geocode(q.value.trim());
})();
</script>`;

  return page('Free Weather App — local forecast, no ads, no sign-up', body, { canonical: `${BASE_URL}/`, jsonld });
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
        summary: 'Free browser-based weather app: current conditions + 7-day forecast via the keyless Open-Meteo API. No account, no ads, no tracking. Optional free MELEK account to save favourite places.',
        links: [{ label: 'Weather', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, weatherPage({
        q: url.searchParams.get('q') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Weather', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="/">Open the weather app</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/weather\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Weather on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
