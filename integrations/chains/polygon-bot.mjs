// polygon-bot.mjs — READ-ONLY / DRY-RUN Polygon (MATIC/POL) trade bot. NO keys, NO orders, NEVER broadcasts.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
//  DRY-RUN ONLY.  THE BOT READS; A SEPARATE SIGNER (gated, elsewhere) WOULD EXECUTE.
//  This module is READ-ONLY by construction. It reads top Polygon DEX prices via KEYLESS HTTP
//  (0x aggregated quote + DexScreener fallback), confidence-scores them, and emits DRY-RUN
//  trade INTENTIONS only. Every intention is { ..., dryRun:true, signer:null } by construction.
//  It holds NO key, makes NO write call, and there is NO code path that signs or broadcasts
//  (zero-WIF rule, BRIEF.md §7). Live execution is a separate, gated system that is NOT here.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//  Mirrors the discipline of the HIVE side (bot-picker / trade-proposer):
//    - reject implausible edges (>~15% = a trap / poisoned pair, not free money),
//    - cap notional to a tiny test size ($1–$5 equiv),
//    - no one-way bleed (an intention must have a plausible round-trip, not bleed fees one way).
//
//  Price sources (per integrations/CROSSCHAIN_BOTS.md), keyless HTTP, injectable fetch:
//    1. DefiLlama coins API — keyless aggregated on-chain price oracle (coins.llama.fi), per token+chain
//    2. DexScreener         — keyless DEX pair snapshot (also a cross-check / confidence input)
//
//  LIVE-DRIFT NOTE (2026-06-14): 0x retired its keyless v1 Swap "price" endpoint — api.0x.org/swap/v1
//  now returns "no Route matched" / requires a 0x-api-key header (v2). We swapped it for DefiLlama's
//  keyless coins.llama.fi/prices/current/<chain>:<addr> oracle, which needs no key and returns a
//  confidence-scored USD price per token. The exported source name stays '0x'-shaped only where it
//  must for back-compat; the live source is reported as 'defillama'.
//
//   node integrations/chains/polygon-bot.mjs            # dry-run dashboard (no network in tests)
//   node integrations/chains/polygon-bot.mjs --serve    # GET /api/polygon
//   import { polygonQuotes, dryRunIntentions, handler, __setFetch } from './chains/polygon-bot.mjs'

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// injectable fetch seam (house pattern) — offline tests drive the reader without a network.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── discipline constants (mirror the HIVE side) ─────────────────────────────────────────────
// An "edge" above this is implausible on a liquid major — almost always a poisoned/look-alike pair
// or a stale quote, never free money. Reject, never act.
export const MAX_PLAUSIBLE_EDGE = +(process.env.POLY_MAX_EDGE || 0.15); // 15%
// An edge below this isn't worth the round-trip (gas + DEX fee + slippage) — no intention.
export const MIN_EDGE = +(process.env.POLY_MIN_EDGE || 0.005);          // 0.5%
// Tiny test-size cap. Notional is clamped into this band so a dry-run never models a real position.
export const MAX_NOTIONAL_USD = +(process.env.POLY_MAX_NOTIONAL || 5);  // $5
export const MIN_NOTIONAL_USD = +(process.env.POLY_MIN_NOTIONAL || 1);  // $1
// Round-trip cost floor we net the edge against (gas + ~0.3% DEX fee per side on Polygon).
const ROUNDTRIP_COST = +(process.env.POLY_ROUNDTRIP_COST || 0.006);     // ~0.6%

// ── top Polygon tokens (verified mainnet addresses, 6/18 decimals) ───────────────────────────
// Quoting each against USDC gives a USD-ish reference price. USDC itself is the unit (price ~1).
const USDC = { symbol: 'USDC', address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', decimals: 6 };
export const TOKENS = {
  // POL (ex-MATIC) native gas token, ERC-20 alias 0x..1010 — the 0x455e… contract is illiquid/absent
  // on Polygon DEX feeds (DexScreener returns 0 polygon pairs), so we use the canonical native alias.
  POL:  { symbol: 'POL',  address: '0x0000000000000000000000000000000000001010', decimals: 18 },
  WMATIC:{ symbol:'WMATIC',address:'0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', decimals: 18 }, // wrapped gas token
  WETH: { symbol: 'WETH', address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', decimals: 18 },
  WBTC: { symbol: 'WBTC', address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', decimals: 8 },
  USDC: USDC,
};
// 0x chain id for Polygon mainnet.
const POLYGON_CHAIN_ID = 137;

// ── source 1: DefiLlama coins oracle (keyless HTTP) ──────────────────────────────────────────
// coins.llama.fi/prices/current/<chain>:<address> returns an aggregated, confidence-scored USD price
// per token. Keyless, no signup. Soft-fails to null on any error. Endpoint overridable via env.
const LLAMA_BASE = process.env.POLY_LLAMA_BASE || 'https://coins.llama.fi/prices/current';
async function defillamaPrice(token) {
  if (token.symbol === 'USDC') return { source: 'defillama', priceUsd: 1, raw: null };
  try {
    const coinId = `polygon:${token.address}`;
    const url = `${LLAMA_BASE}/${coinId}`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
    let j;
    try {
      const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      j = await r.json();
    } finally { clearTimeout(t); }
    const node = j && j.coins && j.coins[coinId];
    const px = node && Number(node.price);
    if (px > 0 && Number.isFinite(px)) return { source: 'defillama', priceUsd: px, conf: node.confidence ?? null, raw: { confidence: node.confidence } };
    return null;
  } catch { return null; }
}

// ── source 2: DexScreener pair snapshot (keyless, no signup) ─────────────────────────────────
// Filters to Polygon pairs for the token; returns the most-liquid pair's USD price. Cross-checks 0x.
async function dexscreenerPrice(token) {
  if (token.symbol === 'USDC') return { source: 'dexscreener', priceUsd: 1, raw: null };
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    let pairs;
    try {
      const r = await _fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(token.address)}`, { headers: { 'user-agent': UA }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pairs = (await r.json()).pairs || [];
    } finally { clearTimeout(t); }
    const poly = pairs
      .filter((p) => (p.chainId === 'polygon') && +(p.priceUsd) > 0 && +(p.liquidity?.usd || 0) > 0)
      .sort((a, b) => +(b.liquidity?.usd || 0) - +(a.liquidity?.usd || 0));
    if (!poly.length) return null;
    const best = poly[0];
    return { source: 'dexscreener', priceUsd: +best.priceUsd, liqUsd: +(best.liquidity?.usd || 0), dex: best.dexId, raw: { pair: `${best.baseToken?.symbol}/${best.quoteToken?.symbol}` } };
  } catch { return null; }
}

// ── PURE: confidence score from the two sources ──────────────────────────────────────────────
// two agreeing sources -> high; one source -> low; disagree wildly -> low + flagged.
// Returns { priceUsd, confidence, sources:[...], agreePct|null }.
export function scoreQuote(zerox, dex) {
  const have = [zerox, dex].filter((s) => s && +s.priceUsd > 0);
  if (!have.length) return { priceUsd: null, confidence: 'none', sources: [] };
  if (have.length === 1) {
    return { priceUsd: have[0].priceUsd, confidence: 'low', sources: have.map((s) => s.source), agreePct: null };
  }
  const [a, b] = have.map((s) => s.priceUsd);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const agree = (hi - lo) / lo; // relative gap between the two sources
  const priceUsd = (a + b) / 2; // midpoint reference
  // sources within ~2% of each other -> high confidence; wider -> medium; >MAX_PLAUSIBLE_EDGE -> low
  let confidence = 'high';
  if (agree > MAX_PLAUSIBLE_EDGE) confidence = 'low';
  else if (agree > 0.02) confidence = 'medium';
  return { priceUsd, confidence, sources: have.map((s) => s.source), agreePct: +(agree * 100).toFixed(2) };
}

// ── read top Polygon token prices, confidence-scored ─────────────────────────────────────────
// Returns { ts, chain:'polygon', quotes:[{symbol, priceUsd, confidence, sources, agreePct, perSource}] }.
// Never throws: a dead source soft-fails to null and is simply absent from `sources`.
export async function polygonQuotes(opts = {}) {
  const syms = (opts.tokens && opts.tokens.length ? opts.tokens : Object.keys(TOKENS)).filter((s) => TOKENS[s]);
  const quotes = [];
  for (const sym of syms) {
    const token = TOKENS[sym];
    const [llama, dex] = await Promise.all([
      defillamaPrice(token).catch(() => null),
      dexscreenerPrice(token).catch(() => null),
    ]);
    const scored = scoreQuote(llama, dex);
    quotes.push({
      symbol: sym,
      priceUsd: scored.priceUsd,
      confidence: scored.confidence,
      sources: scored.sources,
      agreePct: scored.agreePct ?? null,
      perSource: {
        defillama: llama ? llama.priceUsd : null,
        dexscreener: dex ? dex.priceUsd : null,
      },
    });
  }
  return { ts: new Date().toISOString(), chain: 'polygon', quotes };
}

// ── PURE: clamp a notional into the tiny test-size band ──────────────────────────────────────
export function capNotional(usd) {
  const n = +usd;
  if (!Number.isFinite(n) || n <= 0) return MIN_NOTIONAL_USD;
  return Math.min(MAX_NOTIONAL_USD, Math.max(MIN_NOTIONAL_USD, n));
}

// ── PURE: build ONE dry-run intention from a confidence-scored quote ─────────────────────────
// The "strategy step" — same discipline as HIVE. The edge here is the disagreement between the two
// price sources (a real, if tiny, executable mispricing): buy on the cheaper source's venue, sell on
// the dearer. Discipline gates, in order:
//   - need 2 sources (a single source has no measurable edge) -> null
//   - implausible edge (> MAX_PLAUSIBLE_EDGE) -> REJECTED (trap), no intention
//   - edge below MIN_EDGE, or net-of-round-trip <= 0 (one-way bleed) -> no intention
//   - else: a capped, tiny-notional dry-run intention, dryRun:true / signer:null by construction.
// Returns { intention|null, rejected? } — never throws, never signs.
export function intentionFromQuote(q) {
  if (!q || q.priceUsd == null) return { intention: null, reason: 'no price' };
  if (q.symbol === 'USDC') return { intention: null, reason: 'unit token — no self-trade' };
  const pxLlama = q.perSource?.defillama;
  const pxDex = q.perSource?.dexscreener;
  if (!(+pxLlama > 0) || !(+pxDex > 0)) return { intention: null, reason: 'need two sources for an edge' };

  const lo = Math.min(+pxLlama, +pxDex), hi = Math.max(+pxLlama, +pxDex);
  const edge = (hi - lo) / lo;

  // implausible edge = trap. Reject loudly; do NOT model a trade on it.
  if (edge > MAX_PLAUSIBLE_EDGE) {
    return { intention: null, rejected: true, reason: `implausible ${(edge * 100).toFixed(1)}% edge > ${(MAX_PLAUSIBLE_EDGE * 100).toFixed(0)}% cap — treated as a trap/poisoned quote, not free money`, edgePct: +(edge * 100).toFixed(2) };
  }
  // too small to clear the round-trip = one-way bleed. No intention.
  if (edge < MIN_EDGE) return { intention: null, reason: `edge ${(edge * 100).toFixed(2)}% below ${(MIN_EDGE * 100).toFixed(1)}% floor`, edgePct: +(edge * 100).toFixed(2) };
  const netEdge = edge - ROUNDTRIP_COST;
  if (netEdge <= 0) return { intention: null, reason: `edge ${(edge * 100).toFixed(2)}% does not clear ~${(ROUNDTRIP_COST * 100).toFixed(1)}% round-trip cost (one-way bleed)`, edgePct: +(edge * 100).toFixed(2) };

  // BUY on the cheaper source, SELL on the dearer. Tiny capped notional.
  const buySource = (+pxLlama <= +pxDex) ? 'defillama' : 'dexscreener';
  const sellSource = (buySource === 'defillama') ? 'dexscreener' : 'defillama';
  const notionalUsd = capNotional(MAX_NOTIONAL_USD);
  const size = +(notionalUsd / lo).toFixed(8); // token units at the buy (cheaper) price

  return {
    intention: {
      coin: 'polygon',
      market: `${q.symbol}/USDC`,
      side: 'buy',                 // the opening leg (buy cheap, sell dear) — a round trip, not one-way
      size,                        // token units
      price: lo,                   // buy (entry) price USD
      notionalUsd,                 // capped to the $1–$5 test band
      edgePct: +(edge * 100).toFixed(2),
      netEdgePct: +(netEdge * 100).toFixed(2),
      buyOn: buySource,
      sellOn: sellSource,
      confidence: q.confidence,
      dryRun: true,
      signer: null,
      note: 'DRY-RUN intention only — no key, no order, never broadcast. Live execution is a separate gated signer.',
    },
  };
}

// ── build all dry-run intentions from a quotes payload ───────────────────────────────────────
// Returns { intentions:[...], rejected:[...] }. POISON-SAFE: every returned intention is asserted
// dryRun:true / signer:null and carries no key field; anything else is dropped (defense in depth).
export function dryRunIntentions(quotesPayload) {
  const out = [], rejected = [];
  for (const q of (quotesPayload?.quotes || [])) {
    const r = intentionFromQuote(q);
    if (r.rejected) { rejected.push({ market: `${q.symbol}/USDC`, reason: r.reason, edgePct: r.edgePct }); continue; }
    const it = r.intention;
    if (!it) continue;
    // defense-in-depth: a valid intention MUST be dry-run with a null signer and carry no key material.
    if (it.dryRun !== true || it.signer !== null || 'wif' in it || 'key' in it || 'privateKey' in it) continue;
    out.push(it);
  }
  return { intentions: out, rejected };
}

// ── HTTP surface: GET /api/polygon -> { quotes, intentions } ─────────────────────────────────
export async function handler(req, res) {
  try {
    const payload = await polygonQuotes();
    const { intentions, rejected } = dryRunIntentions(payload);
    const body = JSON.stringify({
      chain: 'polygon', ts: payload.ts, dryRun: true, signer: null,
      quotes: payload.quotes, intentions, rejected,
      note: 'READ-ONLY / DRY-RUN. No keys, no orders, never broadcasts.',
    });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(200, { 'content-type': 'application/json' }); // soft-fail: never 500 the caller
    res.end(JSON.stringify({ chain: 'polygon', dryRun: true, signer: null, quotes: [], intentions: [], error: esc(e.message) }));
  }
}

export default { polygonQuotes, dryRunIntentions, intentionFromQuote, scoreQuote, capNotional, handler, __setFetch, TOKENS };

// ── CLI: dry-run dashboard / --serve ─────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('polygon-bot.mjs')) {
  if (process.argv.includes('--serve')) {
    const http = await import('node:http');
    const PORT = +(process.env.PORT || 8093);
    http.createServer((req, res) => {
      if (req.url && req.url.startsWith('/api/polygon')) return handler(req, res);
      res.writeHead(404); res.end('not found');
    }).listen(PORT, () => console.log(`polygon-bot dry-run surface on :${PORT}/api/polygon`));
  } else {
    const payload = await polygonQuotes().catch((e) => ({ ts: '', chain: 'polygon', quotes: [], error: e.message }));
    const { intentions, rejected } = dryRunIntentions(payload);
    console.log('Polygon DRY-RUN trade bot — READ-ONLY, keyless (DefiLlama + DexScreener)\n' + '─'.repeat(74));
    console.log('token    price USD     confidence   sources           agree%');
    for (const q of payload.quotes) {
      const px = q.priceUsd != null ? `$${q.priceUsd < 1 ? q.priceUsd.toPrecision(4) : q.priceUsd.toFixed(2)}` : '—';
      console.log(`${q.symbol.padEnd(8)} ${px.padStart(11)}   ${(q.confidence || '').padEnd(10)}  ${(q.sources.join('+') || '—').padEnd(16)}  ${q.agreePct ?? '—'}`);
    }
    console.log('─'.repeat(74));
    if (intentions.length) {
      console.log('\nDRY-RUN intentions (dryRun:true, signer:null — NOTHING broadcasts):');
      for (const it of intentions) console.log(`  ${it.side.toUpperCase()} ${it.size} ${it.market} @ $${it.price} — edge ${it.edgePct}% (net ${it.netEdgePct}%), buy ${it.buyOn}/sell ${it.sellOn}, $${it.notionalUsd} dryRun=${it.dryRun} signer=${it.signer}`);
    } else console.log('\nNo dry-run intentions: no plausible, fee-clearing edge on any pair right now.');
    for (const r of rejected) console.log(`  ⛔ REJECTED ${r.market}: ${r.reason}`);
    console.log('\nEvery intention is dryRun:true / signer:null by construction. Live execution is a separate gated signer.');
  }
}
