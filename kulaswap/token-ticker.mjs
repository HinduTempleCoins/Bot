// token-ticker.mjs — EMBEDDABLE token-price ticker for the MELEK ecosystem tokens.
//
// THE TOOL (for people, not for us): a live ticker of our tokens (MELEK, PRANA, KULA, WPRANA, wVKBT,
// wCURE, APIS, …) that anyone can drop onto:
//   • a FORUM that allows IMAGES/BBCode but NOT JavaScript (Bitcointalk, most phpBB/SMF boards) →
//     paste a [img] tag pointing at a dynamically-generated image (SVG, or PNG via an image proxy).
//   • a BLOG that allows HTML (WordPress, Ghost, Blogger) → paste an <img> or a tiny auto-refreshing
//     <script> embed.
//   • anything that can read JSON → the /ticker.json API.
//
// THE ONLY REAL PRICES WE HAVE are the KulaSwap AMM pool reserves on the PRANA chain — the internal
// oracle (see kula-price-tvl.mjs). KULA↔WPRANA is a LIVE seeded pool, so KULA has a real price in
// PRANA. wVKBT/KULA and wCURE/KULA are live too, priced through KULA into PRANA. The MELEK Graphene
// witness price feed is currently dead (0/0), and APIS/mMELEK have no market yet — those honestly show
// "n/a". No invented dollars. The numeraire is PRANA (the chain's native/gas token; WPRANA ≡ PRANA 1:1).
//
// House style: pure + soft-fail-never-throw, injectable fetch (__setFetch) so the whole thing tests
// OFFLINE, esc() ALL interpolation, keyless (public RPC only — no WIF, no signing, no keys), handler
// (req,res) exported for tests, PORT/BASE_URL/RPC_URL/MELEK_RPC env. No new deps.

import { CHAINS } from './kula-config.mjs';

// ── injectable fetch ──────────────────────────────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject a fetch impl; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── esc (every interpolation) ───────────────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

/** Format a price for display: adaptive precision, honest "n/a" for null/undefined. */
export function fmtPrice(v) {
  if (v == null || !Number.isFinite(+v)) return 'n/a';
  const n = +v;
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toFixed(4).replace(/\.?0+$/, '');
  if (abs >= 0.0001) return n.toFixed(6).replace(/\.?0+$/, '');
  return n.toExponential(3);
}

// ── token roster (from the PRANA mainnet config, honest about what has a market) ────────────────────────
// `via` describes how each token gets its price:
//   'numeraire' → PRANA itself (=1 by definition; WPRANA is its wrapped 1:1 twin).
//   { pair:[BASE,QUOTE] } → priced from the BASE/QUOTE AMM pool; QUOTE resolves recursively to PRANA.
//   'melek-feed' → the MELEK Graphene witness feed (dead today → n/a).
//   null → no market yet → n/a.
const PRANA = CHAINS.prana || {};
const T = (sym) => (PRANA.tokens || []).find((t) => t.symbol === sym) || null;

/** The tokens the ticker knows about, in display order. Addresses/decimals come from kula-config. */
export function roster() {
  const kula = T('KULA'), wprana = T('WPRANA'), wvkbt = T('wVKBT'), wcure = T('wCURE');
  return [
    { symbol: 'MELEK', name: 'MELEK (chain)', decimals: 3, via: 'melek-feed', addr: null,
      note: 'Graphene witness feed' },
    { symbol: 'PRANA', name: 'PRANA (native)', decimals: 18, via: 'numeraire',
      addr: wprana && wprana.address, note: 'numeraire' },
    { symbol: 'WPRANA', name: 'Wrapped PRANA', decimals: (wprana && wprana.decimals) || 18,
      via: 'numeraire', addr: wprana && wprana.address, note: '≡ PRANA 1:1' },
    { symbol: 'KULA', name: 'KULA (DeFi)', decimals: (kula && kula.decimals) || 18,
      via: { pair: ['KULA', 'WPRANA'] }, addr: kula && kula.address, note: 'KULA/WPRANA pool' },
    { symbol: 'wVKBT', name: 'wVKBT', decimals: (wvkbt && wvkbt.decimals) || 8,
      via: { pair: ['wVKBT', 'KULA'] }, addr: wvkbt && wvkbt.address, note: 'wVKBT/KULA pool' },
    { symbol: 'wCURE', name: 'wCURE', decimals: (wcure && wcure.decimals) || 8,
      via: { pair: ['wCURE', 'KULA'] }, addr: wcure && wcure.address, note: 'wCURE/KULA pool' },
    { symbol: 'APIS', name: 'APIS (WorkerBee)', decimals: 3, via: null, addr: null,
      note: 'no market yet' },
  ];
}

// ── low-level: one JSON-RPC eth_call, soft-fail to null ─────────────────────────────────────────────────
const SEL_GET_PAIR = '0xe6a43905';     // getPair(address,address)
const SEL_GET_RESERVES = '0x0902f1ac'; // getReserves()
const padAddr = (a) => String(a).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const stripHex = (h) => String(h || '').replace(/^0x/, '');

async function ethCall(rpcUrl, to, data, fetchFn) {
  const f = typeof fetchFn === 'function' ? fetchFn : _fetch;
  if (!rpcUrl || !isAddr(to)) return null;
  try {
    const res = await f(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    if (!res || (typeof res.ok === 'boolean' && !res.ok)) return null;
    const json = typeof res.json === 'function' ? await res.json() : res;
    if (!json || json.error || typeof json.result !== 'string') return null;
    return json.result;
  } catch { return null; } // soft-fail-never-throw
}

/** Parse a 32-byte hex word to a BigInt (0n on garbage). */
function wordToBig(hex) {
  try { return BigInt('0x' + (stripHex(hex).slice(0, 64) || '0')); } catch { return 0n; }
}

/**
 * fetchReserves({ rpcUrl, factory, tokenA, tokenB }, fetch) → { pair, reserveA, reserveB } as BigInts
 * (reserveA is tokenA's reserve, reserveB is tokenB's), read live from the AMM factory→pair→getReserves.
 * Two eth_calls: getPair(tokenA,tokenB) then getReserves(). getReserves stores reserve0/reserve1 by
 * token0()/token1() which are ADDRESS-SORTED, so we map back to A/B by comparing addresses. Soft-fails
 * to null (no config, zero pair, RPC/parse error). Never throws.
 */
export async function fetchReserves({ rpcUrl, factory, tokenA, tokenB } = {}, fetch) {
  if (!rpcUrl || !isAddr(factory) || !isAddr(tokenA) || !isAddr(tokenB)) return null;
  const pairHex = await ethCall(rpcUrl, factory, SEL_GET_PAIR + padAddr(tokenA) + padAddr(tokenB), fetch);
  if (!pairHex) return null;
  const pair = '0x' + stripHex(pairHex).slice(-40);
  if (!isAddr(pair) || /^0x0{40}$/.test(pair)) return null; // no pool for this pair
  const resHex = await ethCall(rpcUrl, pair, SEL_GET_RESERVES, fetch);
  if (!resHex) return null;
  const raw = stripHex(resHex);
  if (raw.length < 128) return null;
  const reserve0 = wordToBig(raw.slice(0, 64));
  const reserve1 = wordToBig(raw.slice(64, 128));
  // token0 is the lower address; map reserves back to A/B.
  const aFirst = BigInt(tokenA.toLowerCase()) < BigInt(tokenB.toLowerCase());
  return { pair, reserveA: aFirst ? reserve0 : reserve1, reserveB: aFirst ? reserve1 : reserve0 };
}

/** price of 1 BASE (human) in QUOTE (human) from reserves, decimal-aware. 0 on empty/garbage. */
export function pairPrice(reserveBaseBig, decBase, reserveQuoteBig, decQuote) {
  const b = Number(reserveBaseBig) / 10 ** nn(decBase);
  const q = Number(reserveQuoteBig) / 10 ** nn(decQuote);
  if (!(b > 0) || !(q >= 0)) return 0;
  const p = q / b;
  return Number.isFinite(p) && p >= 0 ? p : 0;
}

// ── MELEK Graphene witness feed (dead today → n/a) ──────────────────────────────────────────────────────
/**
 * fetchMelekFeed({ melekRpcUrl, account }, fetch) → { available, price, base, quote } for the MELEK
 * witness price feed. Reads condenser_api.get_witness_by_account(account).sbd_exchange_rate. The feed
 * is currently 0.000/0.000 (dead), and no public RPC URL is wired here, so this returns
 * { available:false } unless a URL is supplied AND a non-zero rate comes back. Soft-fails to
 * unavailable on ANY error. Never throws. (No key, read-only.)
 */
export async function fetchMelekFeed({ melekRpcUrl, account = 'hathor' } = {}, fetch) {
  if (!melekRpcUrl) return { available: false, reason: 'no MELEK RPC configured', account };
  const f = typeof fetch === 'function' ? fetch : _fetch;
  try {
    const res = await f(melekRpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_witness_by_account', params: [account] }),
    });
    if (!res || (typeof res.ok === 'boolean' && !res.ok)) return { available: false, reason: 'rpc error', account };
    const json = typeof res.json === 'function' ? await res.json() : res;
    const rate = json && json.result && json.result.sbd_exchange_rate;
    if (!rate) return { available: false, reason: 'no feed', account };
    const base = parseFloat(String(rate.base));   // e.g. "1.000 MBD"
    const quote = parseFloat(String(rate.quote));  // e.g. "1.000 MELEK"
    if (!(base > 0) || !(quote > 0)) return { available: false, reason: 'feed dead (0/0)', base, quote, account };
    return { available: true, price: base / quote, base, quote, account };
  } catch { return { available: false, reason: 'exception', account }; }
}

// ── aggregate: all token prices, in PRANA numeraire ─────────────────────────────────────────────────────
/**
 * fetchTokenPrices({ rpcUrl, factory, melekRpcUrl }, fetch) → {
 *   asOf, numeraire:'PRANA', source, tokens:[{ symbol, name, priceInPrana, available, source, note }]
 * }. Reads the LIVE KulaSwap pools for KULA/WPRANA, wVKBT/KULA, wCURE/KULA; PRANA/WPRANA are the
 * numeraire (=1); MELEK via the witness feed (n/a today); APIS null (n/a). Every leg soft-fails to
 * available:false so one dead pool never breaks the ticker. Never throws.
 */
export async function fetchTokenPrices({ rpcUrl, factory, melekRpcUrl } = {}, fetch) {
  const rpc = rpcUrl || PRANA.rpcUrl;
  const fac = factory || PRANA.factory;
  const list = roster();
  const bySym = Object.fromEntries(list.map((t) => [t.symbol, t]));

  // Resolve a token's price in PRANA, memoized, following `via` (pairs resolve their quote recursively).
  const cache = new Map();
  const priceOf = async (sym, seen = new Set()) => {
    if (cache.has(sym)) return cache.get(sym);
    if (seen.has(sym)) return null; // cycle guard
    seen.add(sym);
    const tok = bySym[sym];
    let price = null;
    if (!tok) price = null;
    else if (tok.via === 'numeraire') price = 1;
    else if (tok.via && tok.via.pair) {
      const [baseSym, quoteSym] = tok.via.pair;
      const base = bySym[baseSym], quote = bySym[quoteSym];
      if (base && quote && isAddr(base.addr) && isAddr(quote.addr)) {
        const r = await fetchReserves({ rpcUrl: rpc, factory: fac, tokenA: base.addr, tokenB: quote.addr }, fetch);
        if (r) {
          const inQuote = pairPrice(r.reserveA, base.decimals, r.reserveB, quote.decimals);
          const quoteInPrana = await priceOf(quoteSym, seen);
          if (inQuote > 0 && quoteInPrana != null) price = inQuote * quoteInPrana;
        }
      }
    }
    cache.set(sym, price);
    return price;
  };

  const melek = await fetchMelekFeed({ melekRpcUrl }, fetch);
  const tokens = [];
  for (const t of list) {
    let priceInPrana = null;
    if (t.via === 'melek-feed') priceInPrana = null; // MELEK is quoted in MBD, not PRANA; feed dead anyway
    else priceInPrana = await priceOf(t.symbol);
    tokens.push({
      symbol: t.symbol,
      name: t.name,
      priceInPrana,
      available: priceInPrana != null && Number.isFinite(priceInPrana),
      source: t.via === 'melek-feed'
        ? (melek.available ? 'MELEK witness feed' : 'MELEK witness feed (n/a)')
        : t.via === 'numeraire' ? 'numeraire'
        : t.via && t.via.pair ? `${t.via.pair[0]}/${t.via.pair[1]} pool` : 'no market',
      note: t.note,
    });
  }
  return {
    asOf: new Date().toISOString(),
    numeraire: 'PRANA',
    source: `KulaSwap AMM (PRANA chain) · factory ${fac || 'n/a'}`,
    melekFeed: melek,
    tokens,
  };
}

// ── render: JSON ────────────────────────────────────────────────────────────────────────────────────
export function renderJSON(data) {
  return {
    numeraire: data.numeraire,
    asOf: data.asOf,
    source: data.source,
    tokens: (data.tokens || []).map((t) => ({
      symbol: t.symbol,
      name: t.name,
      price_in_prana: t.available ? t.priceInPrana : null,
      display: t.available ? fmtPrice(t.priceInPrana) : 'n/a',
      available: !!t.available,
      source: t.source,
    })),
  };
}

// ── render: SVG image (works in blogs, signatures; PNG via proxy for Bitcointalk — see bbcode()) ───────
const THEMES = {
  dark:  { bg: '#12100c', card: '#1b1710', text: '#f4ecd8', dim: '#b7a980', gold: '#e8b923', line: '#33302a', na: '#8a7f66' },
  light: { bg: '#faf6ea', card: '#ffffff', text: '#2a2519', dim: '#6f6650', gold: '#a67c00', line: '#e3dcc7', na: '#9a8f76' },
};

/**
 * renderSVG(data, { theme, title, width }) → a self-contained SVG string (no external refs, no scripts),
 * safe as a forum/blog image. esc() on every dynamic value. Rows: symbol · name · price (PRANA) or n/a.
 */
export function renderSVG(data, { theme = 'dark', title = 'MELEK ecosystem prices', width = 460 } = {}) {
  const c = THEMES[theme] || THEMES.dark;
  const toks = (data && data.tokens) || [];
  const rowH = 30, headH = 58, footH = 34;
  const H = headH + toks.length * rowH + footH;
  const W = nn(width) || 460;
  const asOf = data && data.asOf ? String(data.asOf).replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '';
  const rows = toks.map((t, i) => {
    const y = headH + i * rowH;
    const price = t.available ? `${fmtPrice(t.priceInPrana)} PRANA` : 'n/a';
    const priceColor = t.available ? c.text : c.na;
    return [
      `<g>`,
      i % 2 ? `<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="${c.card}"/>` : '',
      `<text x="16" y="${y + 20}" fill="${c.gold}" font-weight="700" font-size="14">${esc(t.symbol)}</text>`,
      `<text x="86" y="${y + 20}" fill="${c.dim}" font-size="11">${esc(t.name)}</text>`,
      `<text x="${W - 16}" y="${y + 20}" fill="${priceColor}" font-size="13" text-anchor="end" font-family="ui-monospace,Menlo,Consolas,monospace">${esc(price)}</text>`,
      `</g>`,
    ].join('');
  }).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`,
    `<rect width="${W}" height="${H}" rx="12" fill="${c.bg}"/>`,
    `<rect x="0" y="0" width="${W}" height="4" fill="${c.gold}"/>`,
    `<text x="16" y="34" fill="${c.text}" font-size="17" font-weight="800" font-family="Georgia,serif">${esc(title)}</text>`,
    `<text x="${W - 16}" y="34" fill="${c.dim}" font-size="10" text-anchor="end">priced in PRANA</text>`,
    `<line x1="0" y1="${headH - 6}" x2="${W}" y2="${headH - 6}" stroke="${c.line}"/>`,
    rows,
    `<line x1="0" y1="${H - footH + 8}" x2="${W}" y2="${H - footH + 8}" stroke="${c.line}"/>`,
    `<text x="16" y="${H - 10}" fill="${c.na}" font-size="9.5" font-family="system-ui,sans-serif">KulaSwap AMM · ${esc(asOf)}</text>`,
    `<text x="${W - 16}" y="${H - 10}" fill="${c.na}" font-size="9.5" text-anchor="end" font-family="system-ui,sans-serif">data.soapbox.community</text>`,
    `</svg>`,
  ].join('');
}

// ── paste-ready embeds ──────────────────────────────────────────────────────────────────────────────
const trimBase = (b) => String(b || '').replace(/\/$/, '');

/** The canonical image URL for the ticker (SVG). */
export function imageUrl(baseUrl, { theme = 'dark' } = {}) {
  return `${trimBase(baseUrl)}/ticker.svg${theme && theme !== 'dark' ? `?theme=${encodeURIComponent(theme)}` : ''}`;
}

/**
 * pngProxyUrl — Bitcointalk and many boards will NOT render an SVG in [img]. We route the SVG through a
 * public image-resizing proxy (images.weserv.nl) that outputs PNG, so a single [img] tag works on the
 * strictest forums. Keyless, no signup. (Override the proxy via the `proxy` arg if desired.)
 */
export function pngProxyUrl(baseUrl, { theme = 'dark', proxy = 'https://images.weserv.nl/' } = {}) {
  const src = imageUrl(baseUrl, { theme }).replace(/^https?:\/\//, '');
  const p = /\/$/.test(proxy) ? proxy : proxy + '/';
  return `${p}?url=${encodeURIComponent(src)}&output=png`;
}

/** BBCode for a forum post/signature (Bitcointalk-safe: PNG via proxy, linked to the data hub). */
export function bbcode(baseUrl, { theme = 'dark', link } = {}) {
  const img = pngProxyUrl(baseUrl, { theme });
  const href = link || trimBase(baseUrl);
  return `[url=${href}][img]${img}[/img][/url]`;
}

/** BBCode using the SVG directly (for boards that DO render SVG — smaller/sharper). */
export function bbcodeSvg(baseUrl, { theme = 'dark', link } = {}) {
  const href = link || trimBase(baseUrl);
  return `[url=${href}][img]${imageUrl(baseUrl, { theme })}[/img][/url]`;
}

/** Plain HTML <img> embed for blogs (WordPress/Ghost/Blogger). */
export function htmlEmbed(baseUrl, { theme = 'dark', link } = {}) {
  const href = esc(link || trimBase(baseUrl));
  return `<a href="${href}"><img src="${esc(imageUrl(baseUrl, { theme }))}" alt="MELEK ecosystem token prices" width="460" style="max-width:100%;border-radius:12px"/></a>`;
}

/**
 * jsEmbed — a self-contained <script> that fetches /ticker.json and renders a live, auto-refreshing
 * table into <div id="melek-ticker">. For blogs/sites that allow JS. esc() is inlined so the injected
 * markup can't break out. Refresh every `refreshMs` (default 5 min).
 */
export function jsEmbed(baseUrl, { refreshMs = 300000, elId = 'melek-ticker' } = {}) {
  const api = `${trimBase(baseUrl)}/ticker.json`;
  return [
    `<div id="${esc(elId)}">MELEK prices loading…</div>`,
    `<script>(function(){`,
    `var API=${JSON.stringify(api)},EL=${JSON.stringify(elId)};`,
    `function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}`,
    `function draw(d){var el=document.getElementById(EL);if(!el)return;var rows=(d.tokens||[]).map(function(t){return '<tr><td style="font-weight:700;color:#a67c00">'+esc(t.symbol)+'</td><td style="color:#777">'+esc(t.name)+'</td><td style="text-align:right;font-family:monospace">'+(t.available?esc(t.display)+' PRANA':'n/a')+'</td></tr>';}).join('');`,
    `el.innerHTML='<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px"><caption style="text-align:left;font-weight:800;padding:4px 0">MELEK ecosystem prices</caption>'+rows+'</table><div style="font-size:10px;color:#999">KulaSwap AMM · '+esc(d.asOf||'')+' · data.soapbox.community</div>';}`,
    `function load(){fetch(API).then(function(r){return r.json();}).then(draw).catch(function(){});}`,
    `load();setInterval(load,${nn(refreshMs) || 300000});`,
    `})();</script>`,
  ].join('\n');
}

/** All the paste-ready snippets in one object (used by the /embed help page + the wiki). */
export function embeds(baseUrl, { theme = 'dark' } = {}) {
  return {
    bbcode: bbcode(baseUrl, { theme }),
    bbcodeSvg: bbcodeSvg(baseUrl, { theme }),
    htmlImg: htmlEmbed(baseUrl, { theme }),
    jsWidget: jsEmbed(baseUrl),
    imageUrl: imageUrl(baseUrl, { theme }),
    pngUrl: pngProxyUrl(baseUrl, { theme }),
    jsonUrl: `${trimBase(baseUrl)}/ticker.json`,
  };
}

// ── HTTP handler ────────────────────────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL || (CHAINS.prana && CHAINS.prana.rpcUrl);
const FACTORY = process.env.FACTORY || (CHAINS.prana && CHAINS.prana.factory);
const MELEK_RPC = process.env.MELEK_RPC || ''; // unset → MELEK price honestly n/a
const BASE_URL = (process.env.BASE_URL || 'https://data.soapbox.community/tools/ticker').replace(/\/$/, '');
const PORT = +(process.env.PORT || process.env.TICKER_PORT || 8140);

/**
 * handler(req,res) — routes:
 *   GET /ticker.svg[?theme=dark|light]   → image/svg+xml (the forum/signature image)
 *   GET /ticker.png[?theme=]             → 302 to the PNG proxy (Bitcointalk-safe raster)
 *   GET /ticker.json                     → application/json (the API)
 *   GET / or /embed                      → an HTML page with copy-paste BBCode/HTML/JSON snippets
 * Everything soft-fails; a dead RPC yields an all-"n/a" ticker, never a 500. Exported for tests.
 */
export async function handler(req, res) {
  const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'public, max-age=60', ...extra }); res.end(body); };
  let url;
  try { url = new URL(req.url, BASE_URL); } catch { url = { pathname: '/', searchParams: new Map() }; }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const theme = (url.searchParams.get && url.searchParams.get('theme')) === 'light' ? 'light' : 'dark';

  try {
    if (path === '/ticker.json') {
      const data = await fetchTokenPrices({ rpcUrl: RPC_URL, factory: FACTORY, melekRpcUrl: MELEK_RPC });
      return send(200, 'application/json; charset=utf-8', JSON.stringify(renderJSON(data)), { 'access-control-allow-origin': '*' });
    }
    if (path === '/ticker.svg') {
      const data = await fetchTokenPrices({ rpcUrl: RPC_URL, factory: FACTORY, melekRpcUrl: MELEK_RPC });
      return send(200, 'image/svg+xml; charset=utf-8', renderSVG(data, { theme }), { 'access-control-allow-origin': '*' });
    }
    if (path === '/ticker.png') {
      res.writeHead(302, { location: pngProxyUrl(BASE_URL, { theme }) });
      return res.end();
    }
    if (path === '/' || path === '/embed') {
      return send(200, 'text/html; charset=utf-8', embedPage(BASE_URL, { theme }));
    }
    return send(404, 'text/plain; charset=utf-8', 'not found');
  } catch {
    // never 500 — degrade to an all-n/a ticker or a short message
    if (path === '/ticker.svg') return send(200, 'image/svg+xml; charset=utf-8', renderSVG({ asOf: new Date().toISOString(), tokens: roster().map((t) => ({ symbol: t.symbol, name: t.name, available: false })) }, { theme }));
    return send(200, 'application/json; charset=utf-8', JSON.stringify({ error: 'temporary', tokens: [] }));
  }
}

/** The /embed help page: live preview + every paste-ready snippet, esc()'d. */
export function embedPage(baseUrl, { theme = 'dark' } = {}) {
  const e = embeds(baseUrl, { theme });
  const box = (label, code) => [
    `<h3>${esc(label)}</h3>`,
    `<textarea readonly rows="3" onclick="this.select()" style="width:100%;font-family:ui-monospace,monospace;font-size:12px;padding:8px;border-radius:8px;border:1px solid #ccc">${esc(code)}</textarea>`,
  ].join('');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>MELEK Token Price Ticker — embed</title>',
    '<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px;line-height:1.5;color:#2a2519;background:#faf6ea}h1{font-family:Georgia,serif}a{color:#a67c00}img{max-width:100%}</style>',
    '</head><body>',
    '<h1>MELEK ecosystem price ticker</h1>',
    '<p>A live ticker of our tokens you can drop onto a forum signature, a Bitcointalk post, or a blog. Prices come from the live KulaSwap AMM pools on the PRANA chain, priced in PRANA. Tokens with no market yet show <b>n/a</b> honestly.</p>',
    '<h2>Live preview</h2>',
    `<img src="${esc(imageUrl(baseUrl, { theme }))}" alt="MELEK ecosystem token prices">`,
    '<h2>Paste-ready</h2>',
    box('Forum / Bitcointalk (BBCode, PNG — works where JS is banned)', e.bbcode),
    box('Forum BBCode (SVG direct — sharper, boards that render SVG)', e.bbcodeSvg),
    box('Blog / HTML (image)', e.htmlImg),
    box('Blog / site (live auto-refreshing widget, needs JS)', e.jsWidget),
    box('JSON API', e.jsonUrl),
    '<p style="color:#999;font-size:13px">Source: KulaSwap AMM (PRANA chain). The MELEK Graphene witness feed is not live yet, so MELEK shows n/a until it publishes.</p>',
    '</body></html>',
  ].join('\n');
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('token-ticker.mjs')) {
  const arg = process.argv[2] || 'embeds';
  if (arg === 'serve') {
    const http = await import('node:http');
    http.createServer(handler).listen(PORT, () => process.stdout.write(`token-ticker on :${PORT} (rpc ${RPC_URL})\n`));
  } else if (arg === 'json' || arg === 'svg') {
    const data = await fetchTokenPrices({ rpcUrl: RPC_URL, factory: FACTORY, melekRpcUrl: MELEK_RPC });
    process.stdout.write((arg === 'svg' ? renderSVG(data) : JSON.stringify(renderJSON(data), null, 2)) + '\n');
  } else {
    const e = embeds(BASE_URL);
    process.stdout.write('MELEK ticker embeds (base ' + BASE_URL + '):\n\n');
    for (const [k, v] of Object.entries(e)) process.stdout.write(`# ${k}\n${v}\n\n`);
  }
}
