// server.mjs — Stocks.SoapBox.Community. The stock-market subdomain (operator 2026-06-02): a Stock Index
// landing (major indices + popular stocks + sector ETFs) + per-symbol profile pages (price, the same
// 1H→All timeframe chart, key stats, scraper-pulled news, research links, and company info from the
// Directory). Yahoo Finance keyless — independent of CoinGecko. Same slim cross-linked top bar as the
// rest of the family (Data · Search · Directory · Wiki).
//
//   PORT=8095 BASE_URL=https://stocks.soapbox.community node site/stocks/server.mjs

import { createServer } from 'node:http';
import { stockSearch, stockQuote, stockChart } from '../../integrations/soapbox/stocks.mjs';
import { search as scraperSearch } from '../../integrations/scraper.mjs';
import { cached, TTL } from '../../integrations/soapbox/cache.mjs';

const PORT = +(process.env.PORT || 8095);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const DIRECTORY = process.env.DIRECTORY_SITE || 'https://directory.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => (n == null || !Number.isFinite(+n) ? '—' : '$' + (+n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const pct = (n) => (n == null || !Number.isFinite(+n) ? '<span class=muted>—</span>' : `<span class="${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '▲' : '▼'} ${Math.abs(+n).toFixed(2)}%</span>`);
const num = (n) => (n == null ? '—' : (+n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

const INDICES = [['^DJI', 'Dow Jones'], ['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^RUT', 'Russell 2000'], ['^VIX', 'VIX']];
const POPULAR = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'JPM', 'V', 'WMT', 'XOM'];
const SECTORS = [['XLK', 'Technology'], ['XLF', 'Financials'], ['XLE', 'Energy'], ['XLV', 'Health Care'], ['XLY', 'Cons. Disc.'], ['XLI', 'Industrials'], ['XLP', 'Cons. Staples'], ['XLU', 'Utilities']];
const CHART_RANGES = [['1h', '1H'], ['1d', '1D'], ['7d', '7D'], ['30d', '1M'], ['365d', '1Y'], ['max', 'All']];

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:960px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px} .muted{color:var(--mut)} .up{color:var(--up)} .down{color:var(--down)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .tile{border:1px solid var(--line);border-radius:8px;padding:11px 13px} .tile .t{font-weight:600} .tile .p{font-size:18px;font-weight:700;margin:2px 0}
  input.q{width:100%;max-width:520px;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px}
  .price{font-size:32px;font-weight:800} table{width:100%;border-collapse:collapse} td,th{padding:8px;border-bottom:1px solid var(--line);text-align:left}
  .tf{display:inline-flex;gap:4px;flex-wrap:wrap;margin-left:10px} .tfb{cursor:pointer;background:transparent;border:1px solid var(--line2);border-radius:6px;color:var(--mut);font-weight:600;font-size:12px;padding:4px 10px}
  .tfb:hover{color:var(--fg);border-color:var(--blue)} .tfb.on{background:var(--blue);color:#06101f;border-color:var(--blue)}
  .msr{max-width:520px;border:1px solid var(--line2);border-radius:8px;background:var(--panel);margin-top:6px} .msr a{display:block;padding:8px 12px;border-bottom:1px solid var(--line);color:var(--fg)} .msr a:last-child{border:0} .msr a:hover{background:var(--bg);text-decoration:none}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:28px;margin-top:24px}
</style>`;

const page = (title, body, desc = 'Live stock prices, charts, and the Stock Index on SoapBox.') => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="${esc(desc)}"><link rel=canonical href="${BASE_URL}/">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">◈ SoapBox <span>stocks</span></a>
  <div class=topbar-r><a href="${DATA}">Data</a><a href="${SEARCH}">Search</a><a href="${DIRECTORY}">Directory</a><a href="${WIKI}">Wiki</a></div></header>
<main class=wrap>${body}</main>
<footer>SoapBox Stocks · data via Yahoo Finance (keyless) · informational only, not investment advice. <a href="${DATA}">Data</a> · <a href="${DIRECTORY}">Directory</a></footer></body></html>`;

const searchBox = `<input class=q id=q placeholder="Search a stock, ETF, or index…" autocomplete=off aria-label="Search stocks"><div id=msr class=msr hidden></div>
  <script>
    var q=document.getElementById('q'),msr=document.getElementById('msr'),t;
    function e(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]})}
    q.addEventListener('input',function(){clearTimeout(t);var v=q.value.trim();if(v.length<2){msr.hidden=true;return}
      t=setTimeout(function(){fetch('/api/search?q='+encodeURIComponent(v)).then(function(r){return r.json()}).then(function(d){
        msr.innerHTML=(d.results||[]).map(function(s){return '<a href="/quote/'+encodeURIComponent(s.symbol)+'">'+e(s.name)+' <span class=muted>'+e(s.symbol)+' · '+e(s.typeLabel)+' · '+e(s.exchange)+'</span></a>'}).join('')||'<a><span class=muted>No matches</span></a>';msr.hidden=false;
      }).catch(function(){})},250)});
    document.addEventListener('click',function(ev){if(ev.target!==q&&!msr.contains(ev.target))msr.hidden=true});
  </script>`;

async function quotesFor(symbols) {
  return cached(`stkpage:${symbols.join(',')}`, TTL.price, async () => {
    const out = await Promise.all(symbols.map(async (s) => { const q = await stockQuote(s).catch(() => null); return q ? { symbol: s, ...q } : null; }));
    return out.filter(Boolean);
  });
}

async function homePage() {
  const [idx, pop, sec] = await Promise.all([quotesFor(INDICES.map((i) => i[0])), quotesFor(POPULAR), quotesFor(SECTORS.map((s) => s[0]))]);
  const label = (sym, map) => (map.find((m) => m[0] === sym) || [, sym])[1];
  const tile = (q, name) => `<a class=tile href="/quote/${encodeURIComponent(q.symbol)}"><div class=t>${esc(name || q.name)}</div><div class=p>${q.symbol.startsWith('^') ? num(q.price) : usd(q.price)}</div><div>${pct(q.change)} <span class=muted style="font-size:12px">${esc(q.symbol)}</span></div></a>`;
  const body = `<h1>SoapBox Stocks <span class=muted style="font-size:14px">· the Stock Index</span></h1>
    <p class=muted>Live stock, ETF &amp; index data — search any symbol, or browse the indices, the most-watched names, and the sectors. Independent of crypto sources.</p>
    ${searchBox}
    <div class=card><h2>Indices</h2><div class=grid>${idx.map((q) => tile(q, label(q.symbol, INDICES))).join('')}</div></div>
    <div class=card><h2>Most watched</h2><div class=grid>${pop.map((q) => tile(q)).join('')}</div></div>
    <div class=card><h2>Sectors (SPDR ETFs)</h2><div class=grid>${sec.map((q) => tile(q, label(q.symbol, SECTORS))).join('')}</div></div>`;
  return page('SoapBox Stocks — the Stock Index', body);
}

function priceChart(series, symbol) {
  const data = series.map((d) => ({ time: d.t, value: d.p }));
  return `<div class=card><div style="display:flex;align-items:center;flex-wrap:wrap"><h2 style="margin:0">Price <span id=tflabel class=muted style="font-weight:400">· 7D</span></h2>
    <div class=tf>${CHART_RANGES.map(([k, l]) => `<button type=button class="tfb${k === '7d' ? ' on' : ''}" data-range="${k}">${l}</button>`).join('')}</div></div>
    <div id=chart style="height:300px;margin-top:10px"></div>
    <script defer src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
    <script>addEventListener('load',function(){if(!window.LightweightCharts)return;var el=document.getElementById('chart');
      var c=LightweightCharts.createChart(el,{width:el.clientWidth,height:300,layout:{background:{color:'transparent'},textColor:'#8b949e'},grid:{vertLines:{color:'#21262d'},horzLines:{color:'#21262d'}},rightPriceScale:{borderColor:'#30363d'},timeScale:{borderColor:'#30363d'}});
      var s=c.addAreaSeries({lineColor:'#58a6ff',topColor:'#58a6ff44',bottomColor:'#58a6ff00',lineWidth:2});s.setData(${JSON.stringify(data)});c.timeScale().fitContent();
      addEventListener('resize',function(){c.applyOptions({width:el.clientWidth})});
      Array.prototype.forEach.call(document.querySelectorAll('.tfb'),function(b){b.addEventListener('click',function(){
        Array.prototype.forEach.call(document.querySelectorAll('.tfb'),function(x){x.classList.remove('on')});b.classList.add('on');
        fetch('/api/chart?symbol='+encodeURIComponent(${JSON.stringify(symbol)})+'&range='+b.getAttribute('data-range')).then(function(r){return r.json()}).then(function(d){
          if(!d.series||d.series.length<2)return;s.setData(d.series.map(function(p){return{time:p.t,value:p.p}}));c.timeScale().fitContent();
          var l=document.getElementById('tflabel');if(l)l.textContent='· '+b.textContent})})});
    });</script>
    <p class=muted style="font-size:11px">Charts: TradingView lightweight-charts (Apache-2.0).</p></div>`;
}

async function stockNews(name) {
  return cached(`stknews:${name.toLowerCase()}`, TTL.clarity, async () => {
    try { return await scraperSearch(`${name} stock news`, { provider: 'duckduckgo', limit: 6 }); } catch { return []; }
  });
}

async function quotePage(symbol) {
  const sym = String(symbol).toUpperCase();
  const [q, series] = await Promise.all([stockQuote(sym).catch(() => null), stockChart(sym, '7d').catch(() => [])]);
  if (!q) return { code: 404, html: page(sym, `<h1>${esc(sym)}</h1><p class=muted>No data for this symbol. <a href="/">Back to the index</a>.</p>`) };
  const news = await stockNews(q.name).catch(() => []);
  const isIdx = sym.startsWith('^');
  const stat = (k, v) => v == null ? '' : `<tr><td class=muted>${esc(k)}</td><td>${v}</td></tr>`;
  const research = [['Yahoo Finance', `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`], ['Google Finance', `https://www.google.com/finance/quote/${encodeURIComponent(sym)}`], ['Google News', `https://news.google.com/search?q=${encodeURIComponent(q.name + ' stock')}`], ['SEC EDGAR', `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(q.name)}&type=10-K`]];
  const body = `<h1>${esc(q.name)} <span class=muted style="font-size:18px">${esc(sym)}</span></h1>
    <div class=muted>${esc(q.typeLabel || 'Stock')} · ${esc(q.exchange)} · <a href="/">← Stock Index</a></div>
    <div class=price style="margin:8px 0">${isIdx ? num(q.price) : usd(q.price)} <span style="font-size:16px">${pct(q.change)}</span> <span class=muted style="font-size:13px">${esc(q.currency)}</span></div>
    ${priceChart(series, sym)}
    <div class=card><h2>Key stats</h2><table>
      ${stat('Day range', q.dayLow && q.dayHigh ? `${num(q.dayLow)} – ${num(q.dayHigh)}` : null)}
      ${stat('52-week range', q.fiftyTwoLow && q.fiftyTwoHigh ? `${num(q.fiftyTwoLow)} – ${num(q.fiftyTwoHigh)}` : null)}
      ${stat('Volume', q.volume ? (+q.volume).toLocaleString() : null)}
      ${stat('Exchange', q.exchange)}</table></div>
    ${news.length ? `<div class=card><h2>Latest news &amp; research</h2>${news.map((n) => `<div style="padding:7px 0;border-bottom:1px solid var(--line)"><a href="${esc(n.url)}" rel=noopener target=_blank>${esc(n.title)}</a>${n.snippet ? `<div class=muted style="font-size:13px">${esc(n.snippet)}</div>` : ''}</div>`).join('')}<p class=muted style="font-size:11px;margin-top:8px">Aggregated via web search — verify with primary sources.</p></div>` : ''}
    <div class=card><h2>Research &amp; profile</h2><div class=muted style="font-size:13px">${research.map(([n, u]) => `<a href="${esc(u)}" rel=noopener target=_blank>${esc(n)}</a>`).join(' · ')}</div>
      <p class=muted style="font-size:12px;margin-top:8px">Company profile + insights: <a href="${DIRECTORY}">SoapBox Directory →</a></p></div>`;
  return { code: 200, html: page(`${q.name} (${sym}) — SoapBox Stocks`, body, `${q.name} (${sym}) stock price, chart, key stats, and news on SoapBox Stocks.`) };
}

function sendHtml(res, html, code = 200) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' }); res.end(html); }
function json(res, obj) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    const p = url.pathname;
    if (p === '/health') { res.writeHead(200); return res.end('ok'); }
    if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
    if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', ...POPULAR.map((s) => '/quote/' + s), ...INDICES.map((i) => '/quote/' + i[0])].map((u) => `<url><loc>${BASE_URL}${u}</loc></url>`).join('')}</urlset>`); }
    if (p === '/api/search') { const r = await stockSearch(url.searchParams.get('q') || '', { limit: 8 }).catch(() => []); return json(res, { results: r }); }
    if (p === '/api/chart') { const s = await stockChart(url.searchParams.get('symbol') || '', url.searchParams.get('range') || '7d').catch(() => []); return json(res, { series: s }); }
    if (p.startsWith('/quote/')) { const r = await quotePage(decodeURIComponent(p.slice(7))); return sendHtml(res, r.html, r.code); }
    if (p !== '/') { res.writeHead(302, { location: '/' }); return res.end(); }
    sendHtml(res, await homePage());
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
}).listen(PORT, HOST, () => console.log(`SoapBox Stocks on ${BASE_URL} (bound ${HOST}:${PORT})`));
