/**
 * market.mjs — the MELEK-Engine market pages: every token's KulaSwap market, read live from PRANA.
 *
 * MELEK-Engine is the market front, KulaSwap (a constant-product AMM on PRANA, chainId 712217) is the DEX
 * underneath, and Akasha is the wallet. These pages show how each token's price is actually made: the pool
 * reserves, x × y = k, the 0.3% fee, how far a trade of a given size moves the price, the price history
 * (from the pools' Sync events) and recent swaps. Nothing here signs or holds a key; trading happens on
 * KulaSwap with the visitor's own wallet.
 *
 *   /market            all tokens: price, liquidity, 24h volume, pools
 *   /market/<SYMBOL>   one token: chart, pools, price-impact table, recent swaps, contracts
 *
 * Soft-fail: an unreachable RPC renders the page with "unavailable" rather than an error. Cached 60 s.
 */

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const RPC = () => process.env.PRANA_RPC_URL || 'https://rpc.prana.melek.salon';
const FACTORY = '0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6';
const EXPLORER = 'https://pranascan.soapbox.community';
const WIKI = 'https://wiki.soapbox.community/wiki/';
const BLOCKS_PER_DAY = 8470;   // ~10.2 s blocks
const FEE_BPS = 30;

/** The tokens we list (known, verified contracts). An unlisted pair (e.g. an orphan test token) is ignored. */
export const LISTED = {
  '0x32255d0138f5d645894fa89b5d5b5a68cf9aa631': { symbol: 'KULA', decimals: 18, name: 'KULA' },
  '0xcabcaaebbf7a7312b91a92faa635d7a32af42a34': { symbol: 'WPRANA', decimals: 18, name: 'Wrapped PRANA' },
  '0xd915e757662c4234137aff167bf93d588145f75e': { symbol: 'wVKBT', decimals: 8, name: 'Wrapped VKBT' },
  '0x03d613bdaad82ecd6cf36b0fef88fb6af9d977ff': { symbol: 'wCURE', decimals: 8, name: 'Wrapped CURE' },
  '0xf6d9be2859191b45820df3a3b3b321b1b2589ab9': { symbol: 'wMELEK', decimals: 18, name: 'Wrapped MELEK' },
};
const BY_SYMBOL = Object.fromEntries(Object.entries(LISTED).map(([a, t]) => [t.symbol.toLowerCase(), { ...t, address: a }]));
const TOPIC_SYNC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1';
const TOPIC_SWAP = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (page, what) => `<a class="q" href="${WIKI}${page}" target="_blank" rel="noopener" title="Help: ${esc(what)}">?</a>`;
const fmt = (n, d = 4) => (n == null || !Number.isFinite(n) ? '—' : n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toLocaleString('en-US', { maximumSignificantDigits: d }));

// ── AMM math (pure) ─────────────────────────────────────────────────────────────────────────────────────
/** Output of a constant-product swap with the pool fee (Uniswap V2 formula). Amounts as Numbers. */
export function amountOut(amountIn, reserveIn, reserveOut, feeBps = FEE_BPS) {
  if (!(amountIn > 0) || !(reserveIn > 0) || !(reserveOut > 0)) return 0;
  const inWithFee = amountIn * (10000 - feeBps);
  return (inWithFee * reserveOut) / (reserveIn * 10000 + inWithFee);
}
/** How much worse than the spot price a trade fills, as a fraction (fee included). */
export function priceImpact(amountIn, reserveIn, reserveOut, feeBps = FEE_BPS) {
  const out = amountOut(amountIn, reserveIn, reserveOut, feeBps);
  const spot = reserveOut / reserveIn;
  return out > 0 && spot > 0 ? 1 - (out / amountIn) / spot : 1;
}

// ── chain reads ─────────────────────────────────────────────────────────────────────────────────────────
async function rpc(method, params) {
  const r = await _fetch(RPC(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || method);
  return j.result;
}
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const toAddr = (w) => '0x' + String(w).replace(/^0x/, '').slice(-40).toLowerCase();
const hexWords = (h) => String(h || '').replace(/^0x/, '').match(/.{64}/g) || [];

async function loadPools() {
  const n = Number(BigInt(await call(FACTORY, '0x574f2ba3')));
  const pools = [];
  for (let i = 0; i < n; i++) {
    const pair = toAddr(await call(FACTORY, '0x1e3dd18b' + word(i)));
    const [t0, t1] = [toAddr(await call(pair, '0x0dfe1681')), toAddr(await call(pair, '0xd21220a7'))];
    if (!LISTED[t0] || !LISTED[t1]) continue;
    const w = hexWords(await call(pair, '0x0902f1ac'));
    const r0 = Number(BigInt('0x' + w[0])) / 10 ** LISTED[t0].decimals, r1 = Number(BigInt('0x' + w[1])) / 10 ** LISTED[t1].decimals;
    pools.push({ pair, t0, t1, s0: LISTED[t0].symbol, s1: LISTED[t1].symbol, r0, r1 });
  }
  return pools;
}

async function logs(address, topic, fromBlock, toBlock) {
  const out = [];
  for (let f = fromBlock; f <= toBlock; f += 50000) {
    const part = await rpc('eth_getLogs', [{ address, topics: [topic], fromBlock: '0x' + f.toString(16), toBlock: '0x' + Math.min(toBlock, f + 49999).toString(16) }]).catch(() => []);
    out.push(...part);
  }
  return out;
}

let cache = { at: 0, data: null };
/** Everything the pages need, cached 60 s. */
export async function marketData({ now = Date.now() } = {}) {
  if (cache.data && now - cache.at < 60000) return cache.data;
  try {
    const head = Number(BigInt(await rpc('eth_blockNumber', [])));
    const pools = (await loadPools()).filter((p) => p.r0 > 0.000001 && p.r1 > 0.000001);
    for (const p of pools) {
      const d0 = LISTED[p.t0].decimals, d1 = LISTED[p.t1].decimals;
      const syncs = await logs(p.pair, TOPIC_SYNC, Math.max(0, head - 7 * BLOCKS_PER_DAY), head);
      p.history = syncs.map((l) => { const w = hexWords(l.data); const a = Number(BigInt('0x' + w[0])) / 10 ** d0, b = Number(BigInt('0x' + w[1])) / 10 ** d1; return { block: Number(BigInt(l.blockNumber)), price0: a > 0 ? b / a : null }; }).filter((x) => x.price0);
      const swaps = await logs(p.pair, TOPIC_SWAP, Math.max(0, head - BLOCKS_PER_DAY), head);
      p.swaps = swaps.map((l) => {
        const w = hexWords(l.data).map((x) => BigInt('0x' + x));
        return { block: Number(BigInt(l.blockNumber)), tx: l.transactionHash, in0: Number(w[0]) / 10 ** d0, in1: Number(w[1]) / 10 ** d1, out0: Number(w[2]) / 10 ** d0, out1: Number(w[3]) / 10 ** d1 };
      });
      p.vol0 = p.swaps.reduce((s, x) => s + x.in0 + x.out0, 0);
      p.vol1 = p.swaps.reduce((s, x) => s + x.in1 + x.out1, 0);
    }
    cache = { at: now, data: { ok: true, head, pools } };
  } catch (e) {
    cache = { at: now, data: { ok: false, error: String(e && e.message || e), pools: [] } };
  }
  return cache.data;
}

/** Spot price of `sym` in `quote` from a pool holding both, else via KULA. Pure over pools. */
export function priceIn(pools, sym, quote) {
  if (sym === quote) return 1;
  const direct = pools.find((p) => (p.s0 === sym && p.s1 === quote) || (p.s1 === sym && p.s0 === quote));
  if (direct) return direct.s0 === sym ? direct.r1 / direct.r0 : direct.r0 / direct.r1;
  if (sym !== 'KULA' && quote !== 'KULA') { const a = priceIn(pools, sym, 'KULA'), b = priceIn(pools, 'KULA', quote); return a && b ? a * b : null; }
  return null;
}

// ── pages ───────────────────────────────────────────────────────────────────────────────────────────────
const CSS = `body{margin:0;background:#0f0d16;color:#ece8f5;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
a{color:#d9a441}main{max-width:1100px;margin:0 auto;padding:16px}h1{margin:6px 0 4px}.sub{color:#a59fb5;font-size:13px}
.enav{display:flex;flex-wrap:wrap;gap:6px 16px;max-width:1100px;margin:0 auto;padding:12px 16px;border-bottom:1px solid #2a2438}
.enav a{color:#ece8f5;text-decoration:none;font-weight:600;font-size:14px}.enav b{color:#d9a441}
.card{background:#171424;border:1px solid #2a2438;border-radius:12px;padding:14px 16px;margin:14px 0}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:7px 6px;border-bottom:1px solid #2a2438;text-align:left}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.btn{display:inline-block;background:#d9a441;color:#1a1626;font-weight:700;padding:9px 16px;border-radius:8px;text-decoration:none;margin:4px 8px 4px 0}
.btn.ghost{background:transparent;color:#d9a441;border:1px solid #d9a441}
.q{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#d9a441;color:#1a1626!important;font:700 12px/1 system-ui,sans-serif;text-decoration:none;vertical-align:middle;margin-left:4px}
.up{color:#3fb950}.down{color:#f85149}svg{width:100%;height:auto;display:block}
@media(max-width:640px){table{display:block;overflow-x:auto;white-space:nowrap}}`;
const NAV = `<nav class="enav" aria-label="MELEK-Engine"><a href="/">Tokens</a><a href="/market"><b>Market</b></a><a href="/wallet">Wallet</a><a href="/#get-apis">Get APIS</a><a href="/#build">Create a token</a><a href="https://kula.money/">KulaSwap</a><a href="https://kula.money/bridge.html">Bridge</a><a href="https://akasha.soapbox.community/">Akasha wallet</a><a href="https://witness.melek.salon/tokens">Witness School</a><a href="${WIKI}MELEK-Engine">Learn</a></nav>`;
const page = (title, desc, body, canon) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="https://engine.melek.salon${esc(canon)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="https://engine.melek.salon${esc(canon)}"><meta name="twitter:card" content="summary">
<style>${CSS}</style></head><body>${NAV}<main>${body}</main></body></html>`;

function sparkline(points, { w = 760, h = 200 } = {}) {
  const pts = points.filter((p) => p.y > 0);
  if (pts.length < 2) return '<p class="sub">Not enough trades yet to draw a price history.</p>';
  const step = Math.max(1, Math.floor(pts.length / 240)), s = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const xs = s.map((p) => p.x), ys = s.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const X = (x) => (x1 > x0 ? ((x - x0) / (x1 - x0)) * (w - 20) + 10 : w / 2), Y = (y) => (y1 > y0 ? h - 20 - ((y - y0) / (y1 - y0)) * (h - 40) : h / 2);
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Price history"><polyline fill="none" stroke="#d9a441" stroke-width="2" points="${s.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}"/>
<text x="10" y="14" fill="#a59fb5" font-size="12">high ${esc(fmt(y1, 5))}</text><text x="10" y="${h - 4}" fill="#a59fb5" font-size="12">low ${esc(fmt(y0, 5))}</text></svg>`;
}

export async function renderMarket() {
  const d = await marketData();
  const syms = Object.values(LISTED).map((t) => t.symbol);
  const rows = syms.map((sym) => {
    const ps = d.pools.filter((p) => p.s0 === sym || p.s1 === sym);
    const liq = ps.reduce((s, p) => s + (p.s0 === sym ? p.r0 : p.r1), 0);
    const vol = ps.reduce((s, p) => s + (p.s0 === sym ? p.vol0 : p.vol1), 0);
    const kula = priceIn(d.pools, sym, 'KULA'), wp = priceIn(d.pools, sym, 'WPRANA');
    return `<tr><td><a href="/market/${esc(sym)}"><b>${esc(sym)}</b></a></td><td class="n">${esc(fmt(kula))}</td><td class="n">${esc(fmt(wp))}</td><td class="n">${esc(fmt(liq))}</td><td class="n">${esc(fmt(vol))}</td><td class="n">${ps.length}</td></tr>`;
  }).join('');
  return page('Market — MELEK-Engine', 'Every MELEK-Engine market on KulaSwap: price, liquidity, 24-hour volume and pools, read live from PRANA.', `
<h1>Market ${q('KulaSwap_Price_Mechanics', 'how prices are made')}</h1>
<p class="sub">Every token's market on KulaSwap, the DEX on PRANA, read live from the pools${d.ok ? ` at block ${esc(d.head)}` : ' (PRANA is unreachable right now)'}. Click a token to see how its price is made.</p>
<div class="card"><table><thead><tr><th>Token</th><th class="n">Price in KULA</th><th class="n">Price in WPRANA</th><th class="n">In pools</th><th class="n">24h volume</th><th class="n">Pools</th></tr></thead><tbody>${rows}</tbody></table>
<p class="sub">Volumes and pool amounts are in each token's own units. These are game tokens with no USD or BTC market; prices are only what the pools show.</p></div>
<p><a class="btn" href="https://kula.money/">Trade on KulaSwap</a><a class="btn ghost" href="https://akasha.soapbox.community/">Open the Akasha wallet</a></p>`, '/market');
}

export async function renderToken(symbol) {
  const t = BY_SYMBOL[String(symbol || '').toLowerCase()];
  if (!t) return null;
  const sym = t.symbol, d = await marketData();
  const ps = d.pools.filter((p) => p.s0 === sym || p.s1 === sym);
  const main = ps.slice().sort((a, b) => (b.s0 === sym ? b.r0 : b.r1) - (a.s0 === sym ? a.r0 : a.r1))[0];
  const quote = main ? (main.s0 === sym ? main.s1 : main.s0) : 'KULA';
  const chart = main ? sparkline(main.history.map((h) => ({ x: h.block, y: main.s0 === sym ? h.price0 : 1 / h.price0 }))) : '<p class="sub">No pool yet.</p>';
  const first = main && main.history[0], last = main && main.history[main.history.length - 1];
  const p7 = first && last ? ((main.s0 === sym ? last.price0 / first.price0 : first.price0 / last.price0) - 1) : null;
  const poolRows = ps.map((p) => {
    const [rs, rq, qs] = p.s0 === sym ? [p.r0, p.r1, p.s1] : [p.r1, p.r0, p.s0];
    return `<tr><td>${esc(sym)} / ${esc(qs)}</td><td class="n">${esc(fmt(rs))} ${esc(sym)}</td><td class="n">${esc(fmt(rq))} ${esc(qs)}</td><td class="n">${esc(fmt(rq / rs, 5))} ${esc(qs)}</td><td class="n">${esc(fmt(rs * rq, 6))}</td><td><a href="${EXPLORER}/address/${esc(p.pair)}">pool</a></td></tr>`;
  }).join('');
  let impact = '';
  if (main) {
    const [rs, rq] = main.s0 === sym ? [main.r0, main.r1] : [main.r1, main.r0];
    const sizes = [0.001, 0.01, 0.05, 0.1, 0.25].map((f) => rs * f);
    impact = sizes.map((amt) => {
      const sellOut = amountOut(amt, rs, rq), sellImp = priceImpact(amt, rs, rq);
      const buyIn = amt * (rq / rs), buyOut = amountOut(buyIn, rq, rs), buyImp = priceImpact(buyIn, rq, rs);
      return `<tr><td class="n">${esc(fmt(amt))} ${esc(sym)}</td><td class="n">${esc(fmt(sellOut))} ${esc(quote)}</td><td class="n">${esc((sellImp * 100).toFixed(2))}%</td><td class="n">${esc(fmt(buyIn))} ${esc(quote)} → ${esc(fmt(buyOut))} ${esc(sym)}</td><td class="n">${esc((buyImp * 100).toFixed(2))}%</td></tr>`;
    }).join('');
  }
  const swaps = ps.flatMap((p) => p.swaps.map((s) => {
    const [inS, outS, inQ, outQ, qs] = p.s0 === sym ? [s.in0, s.out0, s.in1, s.out1, p.s1] : [s.in1, s.out1, s.in0, s.out0, p.s0];
    const side = outS > 0 ? 'Buy' : 'Sell';
    return { block: s.block, tx: s.tx, row: `<tr><td class="${side === 'Buy' ? 'up' : 'down'}">${side}</td><td class="n">${esc(fmt(side === 'Buy' ? outS : inS))} ${esc(sym)}</td><td class="n">${esc(fmt(side === 'Buy' ? inQ : outQ))} ${esc(qs)}</td><td class="n">${esc(s.block)}</td><td><a href="${EXPLORER}/tx/${esc(s.tx)}">tx</a></td></tr>` };
  })).sort((a, b) => b.block - a.block).slice(0, 25).map((x) => x.row).join('');
  const spot = priceIn(d.pools, sym, quote);
  return page(`${sym} market — MELEK-Engine`, `${t.name} on KulaSwap: price, pools, price impact and recent trades, live from PRANA.`, `
<h1>${esc(t.name)} <span class="sub">${esc(sym)}</span></h1>
<p class="sub">Price ${esc(fmt(spot, 6))} ${esc(quote)}${p7 != null ? ` · 7 days <span class="${p7 >= 0 ? 'up' : 'down'}">${p7 >= 0 ? '+' : ''}${esc((p7 * 100).toFixed(1))}%</span>` : ''} · contract <a href="${EXPLORER}/address/${esc(t.address)}">${esc(t.address.slice(0, 10))}…</a></p>
<p><a class="btn" href="https://kula.money/?in=${esc(quote)}&amp;out=${esc(sym)}">Buy ${esc(sym)} on KulaSwap</a><a class="btn ghost" href="https://kula.money/?in=${esc(sym)}&amp;out=${esc(quote)}">Sell ${esc(sym)}</a><a class="btn ghost" href="https://akasha.soapbox.community/">Open the Akasha wallet</a></p>
<div class="card"><h2>Trade ${esc(sym)} ${q('KulaSwap', 'trading on KulaSwap')}</h2><p class="sub">KulaSwap, right here. Connect your wallet inside the box to trade; nothing passes through this page.</p>
<iframe src="https://kula.money/?in=${esc(quote)}&amp;out=${esc(sym)}" title="KulaSwap: ${esc(sym)}" loading="lazy" style="width:100%;height:720px;border:0;border-radius:10px;background:#0b0a12" allow="clipboard-write"></iframe></div>
<div class="card"><h2>Price, last 7 days ${q('KulaSwap_Price_Mechanics#price-history', 'price history')}</h2>${chart}<p class="sub">From every change to the ${esc(sym)}/${esc(quote)} pool's reserves (its Sync events).</p></div>
<div class="card"><h2>Pools ${q('KulaSwap_Price_Mechanics#pools-and-reserves', 'pools and reserves')}</h2>
<p class="sub">The price is just the ratio of the two reserves. Every trade keeps reserve × reserve (k) the same, less the 0.3% fee that stays in the pool.</p>
${ps.length ? `<table><thead><tr><th>Pool</th><th class="n">${esc(sym)} in pool</th><th class="n">Other side</th><th class="n">Price</th><th class="n">k</th><th></th></tr></thead><tbody>${poolRows}</tbody></table>` : '<p class="sub">No pool with liquidity yet.</p>'}</div>
${main ? `<div class="card"><h2>What a trade does to the price ${q('KulaSwap_Price_Mechanics#price-impact', 'price impact')}</h2>
<p class="sub">Bigger trades fill at worse prices, because each unit moves the reserves further. Shown for the ${esc(sym)}/${esc(quote)} pool, fee included.</p>
<table><thead><tr><th class="n">Sell</th><th class="n">You get</th><th class="n">Impact</th><th class="n">Buy (spend → get)</th><th class="n">Impact</th></tr></thead><tbody>${impact}</tbody></table></div>` : ''}
<div class="card"><h2>Recent trades, last 24 hours ${q('KulaSwap_Price_Mechanics#recent-trades', 'recent trades')}</h2>${swaps ? `<table><thead><tr><th>Side</th><th class="n">${esc(sym)}</th><th class="n">For</th><th class="n">Block</th><th></th></tr></thead><tbody>${swaps}</tbody></table>` : '<p class="sub">No trades in the last 24 hours.</p>'}</div>
<p class="sub"><a href="/market">← All markets</a> · ${esc(sym)} is a game token with no USD or BTC market; its price is only what the pools show.</p>`, `/market/${sym}`);
}
