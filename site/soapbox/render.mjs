// render.mjs — the SoapBox page factory's render layer. ONE set of components + ONE layout that
// every route reuses (spec §0/§5: "design the page once, mass-generate from the schema"). Pure
// functions, no I/O — they take already-fetched data and return HTML strings. The server (server.mjs)
// does the fetching/routing; this file owns the look. Keeping render pure makes the whole site
// trivially testable and ISR/cache-friendly (same schema in → same HTML out).

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const usd = (n) => (n == null || !Number.isFinite(+n) ? '—' : '$' + (+n).toLocaleString(undefined, { maximumFractionDigits: Math.abs(+n) < 1 ? 6 : 2 }));
export const compactUsd = (n) => {
  n = +n; if (!Number.isFinite(n) || n === 0) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
  return usd(n);
};
export const pct = (n) => (n == null || !Number.isFinite(+n) ? '<span class=muted>—</span>' : `<span class="${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '▲' : '▼'} ${Math.abs(+n).toFixed(2)}%</span>`);

const NAV = [
  ['/', 'Markets'], ['/dapps', 'dApps'], ['/ecosystem', 'Ecosystem'], ['/learn', 'Learn'],
];

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--up:#3fb950;--down:#f85149;--gold:#d29922}
  *{box-sizing:border-box}
  body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.top{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line2);padding:12px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg)}
  .brand span{color:var(--mut);font-weight:400;font-size:13px}
  nav{display:flex;gap:16px;flex-wrap:wrap} nav a{color:var(--mut);font-weight:600;font-size:14px} nav a.active,nav a:hover{color:var(--fg)}
  .wrap{max-width:1100px;margin:0 auto;padding:20px}
  .statsbar{display:flex;gap:22px;flex-wrap:wrap;font-size:13px;color:var(--mut);padding:10px 20px;background:#0b0f14;border-bottom:1px solid var(--line)}
  .statsbar b{color:var(--fg);font-weight:600}
  .up{color:var(--up)} .down{color:var(--down)} .muted{color:var(--mut)} .gold{color:var(--gold)}
  table{width:100%;border-collapse:collapse} th,td{text-align:right;padding:11px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
  th:nth-child(2),td:nth-child(2){text-align:left} th{color:var(--mut);font-weight:600;font-size:12px;cursor:pointer;user-select:none}
  th:first-child,td:first-child{text-align:center;color:var(--mut)} tr:hover{background:var(--panel)}
  a.coin{color:var(--fg);font-weight:600} a.coin .sym{color:var(--mut);font-weight:400;margin-left:5px;font-size:13px}
  .badge{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px;background:#1f6feb33;color:var(--blue);margin-left:6px;vertical-align:middle}
  .badge.ours{background:#d2992233;color:var(--gold)}
  .clarity{display:inline-block;padding:2px 9px;border-radius:10px;font-size:12px;font-weight:600}
  .c-high{background:#3fb95022;color:var(--up)} .c-moderate{background:#d2992222;color:var(--gold)} .c-limited{background:#db6d2822;color:#db6d28} .c-opaque{background:#f8514922;color:var(--down)} .c-unknown{background:var(--line);color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}
  .stat .k{color:var(--mut);font-size:12px} .stat .v{font-size:17px;font-weight:700}
  h1{margin:0 0 4px;font-size:26px} h2{font-size:18px;margin:0 0 10px} .price{font-size:34px;font-weight:800}
  .bar{height:8px;border-radius:5px;background:var(--line);overflow:hidden;margin:6px 0} .bar>i{display:block;height:100%;background:var(--blue)}
  input.search{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:8px 12px;width:100%;max-width:320px;margin:0 0 14px;font-size:14px}
  .spark{vertical-align:middle}
  .pager{display:flex;gap:10px;margin:18px 0;justify-content:center}
  .pager a{padding:7px 14px;border:1px solid var(--line2);border-radius:8px}
  .cmt{border-left:3px solid var(--line2);padding:6px 0 6px 12px;margin:10px 0} .cmt.reply{border-color:var(--up)}
  .cmt .who{font-weight:600} .cmt .when{color:var(--mut);font-size:12px;margin-left:8px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:30px 20px;border-top:1px solid var(--line);margin-top:30px}
  @media(max-width:640px){th:nth-child(6),td:nth-child(6),th:nth-child(7),td:nth-child(7){display:none}.price{font-size:28px}}
</style>`;

const navBar = (active) => `<header class=top>
  <a class=brand href="/">◈ SoapBox <span>markets</span></a>
  <nav>${NAV.map(([h, l]) => `<a href="${h}" class="${active === h ? 'active' : ''}">${l}</a>`).join('')}</nav>
</header>`;

/** The one layout every page renders into. SEO-complete: canonical, description, OpenGraph, JSON-LD. */
export function layout({ title, description = '', canonical = '', active = '/', jsonld = null, body = '' }) {
  const desc = esc(description || `${title} — live prices, market caps, and Clarity transparency ratings on SoapBox.`);
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)} — SoapBox Markets</title>
<meta name=description content="${desc}">
${canonical ? `<link rel=canonical href="${esc(canonical)}">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="SoapBox">
<meta property="og:title" content="${esc(title)} — SoapBox Markets"><meta property="og:description" content="${desc}">
<meta name="twitter:card" content="summary">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
${STYLE}</head><body>${navBar(active)}<div class=wrap>${body}</div>
<footer>SoapBox — a CoinMarketCap-style aggregator with a Clarity transparency score and right-of-reply. Read-only, non-custodial. Data via the condenser (one source of truth).</footer>
</body></html>`;
}

/** Inline SVG sparkline from a price array — no JS, no request, renders in the table cell. */
export function sparkline(points, w = 88, h = 26) {
  const p = (points || []).filter((n) => Number.isFinite(+n));
  if (p.length < 2) return `<svg class=spark width=${w} height=${h}></svg>`;
  const min = Math.min(...p), max = Math.max(...p), span = max - min || 1;
  const step = w / (p.length - 1);
  const d = p.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`).join('');
  const up = p[p.length - 1] >= p[0];
  return `<svg class=spark width=${w} height=${h} viewBox="0 0 ${w} ${h}"><path d="${d}" fill=none stroke="${up ? '#3fb950' : '#f85149'}" stroke-width=1.3/></svg>`;
}

export function clarityBadge(clarity) {
  if (!clarity || clarity.value == null) return `<span class="clarity c-unknown" title="not yet computed">Clarity —</span>`;
  return `<span class="clarity c-${clarity.band}" title="transparency from observable facts; low = opaque, not 'scam'">Clarity ${clarity.value}</span>`;
}

const clarityRow = (label, score, note) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--line)">
  <span><b>${esc(label)}</b> <span class=muted>${esc(note || '')}</span></span><span class=gold>${score ?? '—'}</span></div>`;

export function clarityCard(clarity) {
  if (!clarity || clarity.value == null) {
    return `<div class=card><h2>Clarity Score</h2><p class=muted>Not yet computed for this listing. Deep clarity needs first-party node data — strongest for ecosystem tokens we run.</p></div>`;
  }
  const rows = Object.entries(clarity.inputs || {}).map(([k, v]) => clarityRow(k.replace(/_/g, ' '), v, clarity.notes?.[k])).join('');
  return `<div class=card><h2>Clarity Score <span class="clarity c-${clarity.band}">${clarity.value} · ${clarity.band}</span></h2>
    <p class=muted>How transparent/verifiable this project is, from observable on-chain facts only — never bought or gifted. A low score means <b>opaque</b>, not "scam".</p>
    ${rows}
    <p class=muted style="margin-top:8px">method: ${esc(clarity.method || '')}${clarity.computed_at ? ` · ${esc(clarity.computed_at.slice(0, 16))}Z` : ''}</p></div>`;
}

/** lightweight-charts (Apache-2.0, CDN, attributed) line chart from a {t,p} series. */
export function priceChart(series) {
  if (!series || series.length < 2) return `<div class=card><h2>Price</h2><p class=muted>Chart history coming for this tier.</p></div>`;
  const data = series.map((d) => ({ time: d.t, value: d.p }));
  return `<div class=card><h2>Price <span class=muted style="font-weight:400">· 7d</span></h2>
    <div id=chart style="height:280px"></div>
    <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
    <script>
      (function(){
        if(!window.LightweightCharts){return}
        var c=LightweightCharts.createChart(document.getElementById('chart'),{
          width:document.getElementById('chart').clientWidth,height:280,
          layout:{background:{color:'transparent'},textColor:'#8b949e'},
          grid:{vertLines:{color:'#21262d'},horzLines:{color:'#21262d'}},
          rightPriceScale:{borderColor:'#30363d'},timeScale:{borderColor:'#30363d'}});
        var s=c.addAreaSeries({lineColor:'#58a6ff',topColor:'#58a6ff44',bottomColor:'#58a6ff00',lineWidth:2});
        s.setData(${JSON.stringify(data)});c.timeScale().fitContent();
        addEventListener('resize',function(){c.applyOptions({width:document.getElementById('chart').clientWidth})});
      })();
    </script>
    <p class=muted style="font-size:11px">Charts: TradingView lightweight-charts (Apache-2.0).</p></div>`;
}

export function supplyBar(supply) {
  const { circulating = 0, total = 0, max = 0 } = supply || {};
  const cap = max || total || circulating || 0;
  const frac = cap ? Math.min(1, circulating / cap) : 0;
  const fmt = (n) => (n ? (+n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
  return `<div class=card><h2>Supply</h2>
    <div class=bar><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
    <div class=grid>
      <div class=stat><div class=k>Circulating</div><div class=v>${fmt(circulating)}</div></div>
      <div class=stat><div class=k>Total</div><div class=v>${fmt(total)}</div></div>
      <div class=stat><div class=k>Max</div><div class=v>${max ? fmt(max) : '∞'}</div></div>
    </div></div>`;
}

export const card = (title, inner) => `<div class=card>${title ? `<h2>${esc(title)}</h2>` : ''}${inner}</div>`;

// related / ecosystem coins — spec §6 "ecosystem groupings, not isolated pages".
export function relatedPanel(coins) {
  if (!coins?.length) return '';
  return `<div class=card><h2>Related</h2><div style="display:flex;flex-wrap:wrap;gap:8px">${coins.map((c) =>
    `<a class=coin href="/coins/${esc(c.id)}" style="padding:5px 10px;border:1px solid var(--line2);border-radius:8px">${esc(c.symbol)} <span class=muted>${usd(c.price_usd)}</span></a>`).join('')}</div></div>`;
}

// client-side coin↔USD converter — uses the live price, no request.
export function converter(coin) {
  if (!coin?.price_usd) return '';
  return `<div class=card><h2>Converter</h2>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input id=cv-amt type=number value=1 step=any style="background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:8px;width:120px">
      <b>${esc(coin.symbol)}</b> = <span id=cv-out class=gold>${usd(coin.price_usd)}</span> USD
    </div>
    <script>(function(){var p=${coin.price_usd},a=document.getElementById('cv-amt'),o=document.getElementById('cv-out');
      function f(){var v=parseFloat(a.value)||0,n=v*p;o.textContent='$'+n.toLocaleString(undefined,{maximumFractionDigits:n<1?6:2})}a.addEventListener('input',f)})();</script></div>`;
}

// holder distribution panel (first-party HE data). Shows the issuer/affiliated/real-outside split
// and the top outside holders — the on-chain truth behind the Clarity Score's holder_dist input.
export function holdersPanel(h) {
  if (!h) return '';
  const bar = (label, p, color) => p > 0 ? `<div style="display:flex;justify-content:space-between"><span>${label}</span><span class=muted>${p.toFixed(1)}%</span></div><div class=bar><i style="width:${Math.min(100, p)}%;background:${color}"></i></div>` : '';
  const top = (h.topOutside || []).slice(0, 8).map((o) =>
    `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span>@${esc(o.account)}${o.affiliated ? ' <span class=muted>(affiliated)</span>' : ''}</span><span class=muted>${(+o.pct).toFixed(2)}%</span></div>`).join('');
  return `<div class=card><h2>Holder distribution <span class=muted style="font-weight:400">· first-party on-chain</span></h2>
    ${bar('Issuer', h.issuerPct, '#f85149')}${bar('Affiliated', h.affiliatedPct, '#d29922')}${bar('Real outside', h.realOutsidePct, '#3fb950')}
    <p class=muted style="font-size:12px;margin:8px 0 4px">${h.counts?.realOutside ?? 0} genuine outside holders (≥1 token). "Real outside %" is the only number that means external demand.</p>
    ${top}</div>`;
}

// order-book depth panel (live HE buy/sell walls). Wash-resistant: shows real resting liquidity.
export function depthPanel(extras) {
  const buy = extras?.buyBook || [], sell = extras?.sellBook || [];
  if (!buy.length && !sell.length) return '';
  const side = (rows, cls, label) => `<div style="flex:1"><div class=k style="color:var(--mut);font-size:12px">${label}</div>${rows.map((r) =>
    `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span class="${cls}">${usd(r.priceUsd)}</span><span class=muted>${(+r.qty).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>`).join('') || '<div class=muted>—</div>'}</div>`;
  return `<div class=card><h2>Order book <span class=muted style="font-weight:400">· live, first-party</span></h2>
    <div style="display:flex;gap:18px">${side(buy, 'up', '▲ Bids')}${side(sell, 'down', '▼ Asks')}</div></div>`;
}

// price-change ranges + ATH/ATL + 24h high/low, from the adapter's attached `.market` object.
export function marketStats(m) {
  if (!m) return '';
  const row = (label, val) => `<div class=stat><div class=k>${label}</div><div class=v>${pct(val)}</div></div>`;
  const ranges = [['1h', m.change_1h], ['24h', m.change_24h], ['7d', m.change_7d], ['30d', m.change_30d], ['1y', m.change_1y]]
    .filter(([, v]) => v != null).map(([l, v]) => row(l, v)).join('');
  const athDate = m.ath_date ? ` <span class=muted>(${esc(m.ath_date.slice(0, 10))})</span>` : '';
  const atlDate = m.atl_date ? ` <span class=muted>(${esc(m.atl_date.slice(0, 10))})</span>` : '';
  return `<div class=card><h2>Performance${m.rank ? ` <span class=muted style="font-weight:400">· rank #${m.rank}</span>` : ''}</h2>
    <div class=grid>${ranges}</div>
    <div class=grid style="margin-top:10px">
      ${m.high_24h != null ? `<div class=stat><div class=k>24h high</div><div class=v>${usd(m.high_24h)}</div></div>` : ''}
      ${m.low_24h != null ? `<div class=stat><div class=k>24h low</div><div class=v>${usd(m.low_24h)}</div></div>` : ''}
      ${m.ath != null ? `<div class=stat><div class=k>All-time high${athDate}</div><div class=v>${usd(m.ath)} ${pct(m.ath_change)}</div></div>` : ''}
      ${m.atl != null ? `<div class=stat><div class=k>All-time low${atlDate}</div><div class=v>${usd(m.atl)} ${pct(m.atl_change)}</div></div>` : ''}
    </div></div>`;
}
