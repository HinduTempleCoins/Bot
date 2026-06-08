// widgets.mjs — PURE HTML-string widget helpers for SoapBox deep pages (chain / company / stock).
// (doc 10). NO network, NO DOM access at module scope — every export is a pure function that takes
// already-fetched data and returns a safe HTML string. A later wiring step imports these into the
// page factory; this file owns nothing but markup. Mirrors the style of site/soapbox/render.mjs
// (pure string returns, a small esc() that neutralizes injection on every interpolated input).
//
// All caller-supplied values pass through esc() before they reach the HTML — including values that
// land inside <script> blocks, where they are additionally JSON-serialized so a string like
// `</script>` or `<script>` can never break out of or close the script context.

/** HTML-escape any value. Mirrors render.mjs esc() and adds the single-quote so attributes that use
 * single quotes (and JS string contexts) are also safe. null/undefined → ''. */
export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

// JSON-encode for safe embedding inside a <script> block: serialize, then defang the only two byte
// sequences that can terminate/restart a script context or start an HTML comment. Numbers/strings
// alike go through this when they're written into inline JS.
const jsonForScript = (v) =>
  JSON.stringify(v == null ? '' : v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

// Strict numeric guard: null / undefined / '' / non-numeric → false (so they render as — / unknown,
// never coerce to 0 the way `+null` would). Only a real, finite number passes.
const finite = (n) => n != null && n !== '' && Number.isFinite(+n);
const intFmt = (n) => (finite(n) ? (+n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');

/** TradingView Lightweight Charts (Apache-2.0 OSS, the free standard) embed. Returns the container +
 * the deferred CDN script + an init snippet. `symbol` is shown as the chart title only (this widget
 * draws an empty chart a later wiring step feeds via setData / its own fetch — no network here). The
 * symbol and theme are both escaped AND JSON-encoded into the script so an injected `<script>` symbol
 * is inert. theme is clamped to 'dark'|'light'. A unique element id keeps multiple charts/page apart. */
export function tradingViewChart({ symbol = '', theme = 'dark' } = {}) {
  const t = theme === 'light' ? 'light' : 'dark';
  const dark = t === 'dark';
  // deterministic-but-unique id from the (escaped) symbol so two widgets on a page don't collide.
  const slug = String(symbol).replace(/[^a-zA-Z0-9]+/g, '').slice(0, 24) || 'x';
  const id = `tvchart-${slug}-${Math.random().toString(36).slice(2, 8)}`;
  const text = dark ? '#8b949e' : '#656d76';
  const grid = dark ? '#21262d' : '#e6e8eb';
  const border = dark ? '#30363d' : '#d0d7de';
  const line = '#58a6ff';
  return `<div class="tv-chart card" data-symbol="${esc(symbol)}" data-theme="${esc(t)}">
  <h2>${esc(symbol)} <span class=muted style="font-weight:400">· price</span></h2>
  <div id="${esc(id)}" class="tv-chart-canvas" style="height:280px;margin-top:10px"></div>
  <script defer src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
  <script>
    window.addEventListener('load', function(){
      if(!window.LightweightCharts){return}
      var el=document.getElementById(${jsonForScript(id)}); if(!el){return}
      var sym=${jsonForScript(symbol)}, theme=${jsonForScript(t)};
      var c=LightweightCharts.createChart(el,{
        width:el.clientWidth,height:280,
        layout:{background:{color:'transparent'},textColor:${jsonForScript(text)}},
        grid:{vertLines:{color:${jsonForScript(grid)}},horzLines:{color:${jsonForScript(grid)}}},
        rightPriceScale:{borderColor:${jsonForScript(border)}},timeScale:{borderColor:${jsonForScript(border)}}});
      var s=c.addAreaSeries({lineColor:${jsonForScript(line)},topColor:'#58a6ff44',bottomColor:'#58a6ff00',lineWidth:2});
      el.__tvSeries=s; el.__tvChart=c;
      window.addEventListener('resize',function(){c.applyOptions({width:el.clientWidth})});
    });
  </script>
  <p class=muted style="font-size:11px">Charts: TradingView Lightweight Charts (Apache-2.0).</p></div>`;
}

/** Inline SVG sparkline from a numeric array. Pure markup, no JS, no request — renders anywhere.
 * <2 finite points → an empty (but valid) <svg>. Up/down stroke from first vs last point. */
export function sparklineSvg(points, w = 88, h = 26) {
  const p = (Array.isArray(points) ? points : []).filter((n) => finite(n)).map((n) => +n);
  if (p.length < 2) return `<svg class="spark sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"></svg>`;
  const min = Math.min(...p), max = Math.max(...p), span = max - min || 1;
  const step = w / (p.length - 1);
  const d = p
    .map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`)
    .join('');
  const up = p[p.length - 1] >= p[0];
  return `<svg class="spark sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${up ? '#3fb950' : '#f85149'}" stroke-width="1.3"/></svg>`;
}

/** A row of count stats for a deep page (holders / witnesses / watchers / views). Any missing field
 * renders as — ; zero renders as 0. All labels fixed, all values integer-formatted & escaped. */
export function countersBar({ holders, witnesses, watchers, views } = {}) {
  const cell = (k, v) => `<div class="counter stat"><div class="k">${esc(k)}</div><div class="v">${esc(intFmt(v))}</div></div>`;
  return `<div class="counters-bar grid">
    ${cell('Holders', holders)}${cell('Witnesses', witnesses)}${cell('Watchers', watchers)}${cell('Views', views)}
  </div>`;
}

// Clarity bands mirror render.mjs's c-* classes. We compute the band from the numeric score here so
// this widget is self-contained (callers pass a raw number, not a {value,band} object).
const clarityBand = (n) => (n >= 80 ? 'high' : n >= 60 ? 'moderate' : n >= 40 ? 'limited' : 'opaque');

/** Clarity transparency badge from a raw 0-100 score. null/non-finite → an "unknown" badge. */
export function clarityBadge(score) {
  if (!finite(score)) return `<span class="clarity c-unknown" title="not yet computed">Clarity —</span>`;
  const v = Math.max(0, Math.min(100, Math.round(+score)));
  const band = clarityBand(v);
  return `<span class="clarity c-${band}" title="transparency from observable facts; low = opaque, not 'scam'">Clarity ${esc(v)}</span>`;
}

/** "Last updated" stamp. Accepts an ISO string, ms epoch number, or Date. Invalid/missing → "never".
 * The machine-readable instant goes in a <time datetime> attribute; the visible text is the UTC
 * minute. Everything escaped. */
export function lastUpdated(ts) {
  let d = null;
  if (ts instanceof Date) d = ts;
  else if (typeof ts === 'number' && Number.isFinite(ts)) d = new Date(ts);
  else if (typeof ts === 'string' && ts.trim()) { const parsed = new Date(ts); if (!Number.isNaN(+parsed)) d = parsed; }
  if (!d || Number.isNaN(+d)) return `<span class="last-updated muted">Last updated: never</span>`;
  const iso = d.toISOString();
  const human = iso.slice(0, 16).replace('T', ' ') + 'Z';
  return `<span class="last-updated muted">Last updated: <time datetime="${esc(iso)}">${esc(human)}</time></span>`;
}

/** Sentiment pill from a score. Accepts either -1..1 or 0..100; we normalize to a -100..100 reading.
 * Negative = bearish (red), ~0 = neutral (gold), positive = bullish (green). non-finite → neutral —. */
export function sentimentPill(score) {
  if (!finite(score)) return `<span class="sentiment-pill c-unknown" title="no sentiment data">Sentiment —</span>`;
  let v = +score;
  // Heuristic: a value in (-1,1) is a fraction; a value in [0,100] with no decimals is a percent.
  if (v >= -1 && v <= 1) v = v * 100;          // -1..1 fraction → -100..100
  else if (v >= 0 && v <= 100) v = (v - 50) * 2; // 0..100 → -100..100
  v = Math.max(-100, Math.min(100, Math.round(v)));
  const label = v <= -50 ? 'Very bearish' : v < -10 ? 'Bearish' : v <= 10 ? 'Neutral' : v < 50 ? 'Bullish' : 'Very bullish';
  const tone = v < -10 ? 'down' : v > 10 ? 'up' : 'gold';
  const arrow = v < -10 ? '▼' : v > 10 ? '▲' : '◆';
  return `<span class="sentiment-pill ${tone}" title="market sentiment (−100 bearish … +100 bullish)">${arrow} ${esc(label)} ${esc(v)}</span>`;
}
