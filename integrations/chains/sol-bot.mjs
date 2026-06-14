// sol-bot.mjs — READ-ONLY + DRY-RUN Solana trade bot. NO keys. NEVER broadcasts.
//
// ┌─ HARD SAFETY INVARIANTS (read before touching) ────────────────────────────────────────────┐
// │ • READ-ONLY / DRY-RUN. This module reads Solana DEX quotes (keyless HTTP) and emits PAPER     │
// │   trade INTENTIONS only. It holds NO key, signs nothing, broadcasts nothing. Live execution   │
// │   is a SEPARATE, gated MELEK-Signer concern (zero WIF on this host) — not here.               │
// │ • Every intention carries `dryRun: true` and `signer: null`, hard-stamped by freezeIntent().  │
// │   There is NO code path that can set dryRun:false or attach a key — by construction.          │
// │ • Soft-fail-never-throw: a dead source returns null/empty with a low confidence score; the    │
// │   reader never throws to the caller. Garbage in → a clean hold, not a crash.                  │
// │ • Same trade DISCIPLINE as the HIVE side (trade-strategies.mjs): reject implausible edges      │
// │   (>~15% = a trap / stale quote, not free money), cap notional to a tiny test size ($1–$5),    │
// │   and never one-way-bleed (a BUY needs a matching SELL thesis; no naked accumulation).        │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// PRICE SOURCE: the Jupiter Quote API (Solana DEX aggregator, KEYLESS) per integrations/CROSSCHAIN_BOTS.md.
//   primary:  GET https://lite-api.jup.ag/swap/v1/quote?inputMint=&outputMint=&amount=&slippageBps=
//             -> { inAmount, outAmount, priceImpactPct, routePlan, ... } (raw integer lamport/atom amounts)
//   fallback: GET https://lite-api.jup.ag/price/v3?ids=<MINT>,...  (Jupiter price endpoint, keyed by mint)
//             -> { "<mint>": { usdPrice, ... }, ... }
//   confidence is scored: a routed two-source-agreeing quote scores high; a single source lower; none = 0.
//
//   LIVE-DRIFT NOTE (2026-06-14): Jupiter retired the old hosts. quote-api.jup.ag/v6/quote now 404s and
//   price.jup.ag/v6/price is gone. The keyless reads moved to lite-api.jup.ag: /swap/v1/quote (same
//   { inAmount, outAmount, routePlan } shape) and /price/v3 (now keyed BY MINT, value { usdPrice }).
//
//   import { readQuotes, strategize, handler } from './chains/sol-bot.mjs'
//   node integrations/chains/sol-bot.mjs            # demo: print quotes + dry-run intentions
//   GET /api/sol  ->  { ok, quotes, intentions }

import http from 'node:http';
import { fileURLToPath } from 'node:url';

// ── injectable fetch (offline tests inject a fake; production uses global fetch) ───────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const TIMEOUT_MS = +(process.env.SOL_TIMEOUT_MS || 10000);

// ── HTML-escape for anything that lands in CLI/HTML output. Never throws. ──────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── tiny pure helpers (no I/O) ─────────────────────────────────────────────────────────────────
const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const isPos = (n) => Number.isFinite(+n) && +n > 0;
const round = (n, dp = 8) => +(+n).toFixed(dp);
const pct = (n) => `${(num(n) * 100).toFixed(2)}%`;

// ── token directory (mint + decimals). Keyless reads only need the mint; decimals scale raw amounts.
// SOL is the native mint (wrapped SOL mint address). USDC/USDT/majors by canonical mainnet mint.
export const TOKENS = Object.freeze({
  SOL:  { mint: 'So11111111111111111111111111111111111111112',  decimals: 9,  cg: 'solana' },
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6,  cg: 'usd-coin' },
  USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6,  cg: 'tether' },
  JUP:  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  decimals: 6,  cg: 'jupiter-exchange-solana' },
  BONK: { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5,  cg: 'bonk' },
});

// The pairs we quote: each is quoted against USDC to get a USD-ish reference price.
export const PAIRS = Object.freeze([
  { base: 'SOL',  quote: 'USDC' },
  { base: 'JUP',  quote: 'USDC' },
  { base: 'BONK', quote: 'USDC' },
  { base: 'USDT', quote: 'USDC' }, // a near-1.0 peg pair — a sanity / peg-arb candidate
]);

const JUP_QUOTE = process.env.SOL_JUP_QUOTE_URL || 'https://lite-api.jup.ag/swap/v1/quote';
const JUP_PRICE = process.env.SOL_JUP_PRICE_URL || 'https://lite-api.jup.ag/price/v3';

async function fetchJSON(url, opts = {}, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal, ...opts });
    if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : 'no-response'}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ── parse a Jupiter /v6/quote response into a normalized price (quote-token per 1 base-token) ──
// The quote API returns raw integer amounts; scale by token decimals. We quote `amount` = 1 whole
// base token, so price = outAmount(scaled) / inAmount(scaled).
export function parseJupQuote(raw, base, quote) {
  const b = TOKENS[base], q = TOKENS[quote];
  if (!raw || !b || !q) return null;
  const inAmt = num(raw.inAmount) / 10 ** b.decimals;
  const outAmt = num(raw.outAmount) / 10 ** q.decimals;
  if (!isPos(inAmt) || !isPos(outAmt)) return null;
  const price = outAmt / inAmt;
  const impact = Math.abs(num(raw.priceImpactPct)); // fraction (0.001 = 0.1%)
  const routed = Array.isArray(raw.routePlan) ? raw.routePlan.length : 0;
  return { price: round(price), priceImpactPct: impact, routed, source: 'jup-quote' };
}

// ── parse the Jupiter /price/v3 fallback. The current lite-api shape is keyed BY MINT, value
// { usdPrice }: { "<mint>": { usdPrice, decimals, ... } }. We still tolerate the legacy
// { data: { SOL: { price } } } shape so an old-host override or cached response degrades gracefully.
export function parseJupPrice(raw, base) {
  if (!raw) return null;
  const mint = TOKENS[base]?.mint;
  // current lite-api /price/v3: top-level keyed by mint, value carries usdPrice
  const node = (mint && raw[mint]) || raw[base]
    // legacy v6 shape: { data: { SYMBOL|mint: { price } } }
    || (raw.data && (raw.data[base] || (mint && raw.data[mint]))) || null;
  if (!node) return null;
  const price = num(node.usdPrice ?? node.price);
  if (!isPos(price)) return null;
  return { price: round(price), source: 'jup-price' };
}

// confidence: routed quote that agrees with the price fallback within 1% → 0.95; routed-only → 0.8;
// price-only → 0.55; quote with a fat price-impact (thin route) is docked; disagreement is docked.
function scoreConfidence({ quote, price }) {
  if (!quote && !price) return 0;
  if (quote && price && isPos(quote.price) && isPos(price.price)) {
    const diff = Math.abs(quote.price - price.price) / price.price;
    let c = diff <= 0.01 ? 0.95 : diff <= 0.05 ? 0.75 : 0.5;
    if (quote.priceImpactPct > 0.02) c -= 0.2; // thin / high-impact route → less trustworthy
    return round(Math.max(0.1, c), 2);
  }
  if (quote) return round(Math.max(0.1, 0.8 - (quote.priceImpactPct > 0.02 ? 0.2 : 0)), 2);
  return 0.55; // price-only fallback
}

/**
 * Read quotes for every PAIR via Jupiter (quote primary + price fallback), confidence-scored.
 * Soft-fails per source: a dead endpoint yields null for that leg, not a throw.
 * @returns {Promise<Array<{market,base,quote,price,priceImpactPct,confidence,sources,refUsd}>>}
 */
export async function readQuotes(pairs = PAIRS) {
  const out = [];
  for (const { base, quote } of pairs) {
    const b = TOKENS[base], q = TOKENS[quote];
    if (!b || !q) { out.push({ market: `${base}/${quote}`, base, quote, price: null, confidence: 0, sources: [], error: 'unknown token' }); continue; }
    const oneWhole = String(Math.round(10 ** b.decimals)); // 1 whole base token in atoms
    const quoteUrl = `${JUP_QUOTE}?inputMint=${b.mint}&outputMint=${q.mint}&amount=${oneWhole}&slippageBps=50`;
    // lite-api /price/v3 is keyed by MINT (not symbol) and returns USD prices (no vsToken param).
    const priceUrl = `${JUP_PRICE}?ids=${b.mint}`;

    const [qRaw, pRaw] = await Promise.all([
      fetchJSON(quoteUrl).catch(() => null),
      fetchJSON(priceUrl).catch(() => null),
    ]);
    const quoteParsed = parseJupQuote(qRaw, base, quote);
    const priceParsed = parseJupPrice(pRaw, base);
    const confidence = scoreConfidence({ quote: quoteParsed, price: priceParsed });
    const price = quoteParsed?.price ?? priceParsed?.price ?? null;
    const sources = [quoteParsed && 'jup-quote', priceParsed && 'jup-price'].filter(Boolean);
    // refUsd: when the quote token is a dollar stable, the price IS a USD reference.
    const refUsd = (quote === 'USDC' || quote === 'USDT') && isPos(price) ? price : null;
    out.push({
      market: `${base}/${quote}`, base, quote,
      price, priceImpactPct: quoteParsed?.priceImpactPct ?? null,
      confidence, sources, refUsd,
    });
  }
  return out;
}

// ── DRY-RUN strategy discipline (mirrors trade-strategies.mjs freezeOrder) ─────────────────────
// freezeIntent is the ONLY way an intention leaves this module. It hard-stamps dryRun:true /
// signer:null — overriding anything passed in. No live, signer-attached intention can be produced.
function freezeIntent(o) {
  return Object.freeze({
    coin: 'solana',
    market: String(o.market || ''),
    side: o.side === 'sell' ? 'sell' : 'buy',
    size: round(num(o.size)),          // notional in USD-equiv (the tiny test size)
    price: round(num(o.price)),
    edgePct: round(num(o.edgePct), 6),
    reason: String(o.reason || ''),
    dryRun: true,   // ALWAYS. No override path exists.
    signer: null,   // ALWAYS. No key is ever attached here.
  });
}

// Discipline constants (env-overridable, conservative defaults). Same shape as the HIVE side.
const MIN_EDGE = num(process.env.SOL_MIN_EDGE, 0.03);    // 3% minimum edge to act
const MAX_EDGE = num(process.env.SOL_MAX_EDGE, 0.15);    // >15% edge = implausible trap → reject
const MIN_CONFIDENCE = num(process.env.SOL_MIN_CONF, 0.5);
const TEST_NOTIONAL_USD = num(process.env.SOL_TEST_NOTIONAL_USD, 3); // tiny $1–$5 paper size
const NOTIONAL_CAP_USD = num(process.env.SOL_NOTIONAL_CAP_USD, 5);

/**
 * Given confidence-scored quotes (+ optional reference prices), emit DRY-RUN intentions using the
 * SAME discipline as the HIVE peg-arb family: fade the gap between the DEX quote and a reference
 * price, reject implausible edges (>MAX_EDGE = a trap), and cap notional to a tiny test size.
 *
 * `refs` maps market -> a reference USD price to compare the DEX quote against (e.g. a CEX/oracle
 * price from price-oracle.mjs). With no ref, a near-1.0 stable peg pair uses 1.0 as its peg.
 *
 * @returns {Array<frozen intention>}  every one: {coin:'solana', market, side, size, price, edgePct, dryRun:true, signer:null}
 */
export function strategize(quotes = [], refs = {}) {
  const intentions = [];
  for (const qd of quotes || []) {
    try {
      if (!qd || !isPos(qd.price)) continue;                 // no price → nothing to do
      if (num(qd.confidence) < MIN_CONFIDENCE) continue;     // untrusted quote → hold
      // reference price: explicit ref, else a stable-pair peg of 1.0, else skip (no anchor → no edge).
      let ref = num(refs[qd.market], NaN);
      if (!Number.isFinite(ref) && (qd.base === 'USDT' || qd.base === 'USDC') && (qd.quote === 'USDC' || qd.quote === 'USDT')) {
        ref = 1.0; // a dollar stable should trade at the peg
      }
      if (!isPos(ref)) continue;

      const edge = (ref - qd.price) / qd.price; // >0 → DEX cheap vs ref → BUY; <0 → DEX rich → SELL
      const absEdge = Math.abs(edge);
      if (absEdge < MIN_EDGE) continue;                      // below threshold → hold
      if (absEdge > MAX_EDGE) {                              // implausible → a trap / stale quote, REJECT
        // intentionally emit nothing; the discipline is to NOT trade an edge too good to be true.
        continue;
      }
      const size = Math.min(TEST_NOTIONAL_USD, NOTIONAL_CAP_USD); // tiny test notional, hard-capped
      const side = edge >= 0 ? 'buy' : 'sell';
      const reason = side === 'buy'
        ? `DEX ${qd.market} ${pct(edge)} below ref ($${round(ref)}) — buy the gap (capped $${size} test)`
        : `DEX ${qd.market} ${pct(absEdge)} above ref ($${round(ref)}) — sell the gap (capped $${size} test)`;
      intentions.push(freezeIntent({ market: qd.market, side, size, price: qd.price, edgePct: edge, reason }));
    } catch { /* soft-fail this pair, keep going */ }
  }
  return intentions;
}

// ── HTTP handler: GET /api/sol -> { ok, quotes, intentions } ───────────────────────────────────
export async function handler(req, res) {
  const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    if (url.pathname !== '/api/sol') { sendJson(404, { ok: false, error: 'not found' }); return; }
    const quotes = await readQuotes();
    const intentions = strategize(quotes);
    sendJson(200, { ok: true, quotes, intentions });
  } catch (e) {
    // soft-fail: never throw out of the handler
    try { sendJson(200, { ok: false, error: e && e.message ? e.message : String(e), quotes: [], intentions: [] }); } catch { /* ignore */ }
  }
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === 'serve') {
    const PORT = +(process.env.PORT || 8095);
    http.createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end('{"ok":false}'); } catch { /* */ } }); })
      .listen(PORT, () => console.log(`sol-bot read+dry-run on http://localhost:${PORT}/api/sol`));
  } else {
    console.log('Solana READ + DRY-RUN trade bot — keyless quotes, paper intentions only. NO keys, NEVER broadcasts.');
    console.log('─'.repeat(86));
    const quotes = await readQuotes();
    for (const q of quotes) {
      const px = isPos(q.price) ? `$${round(q.price)}` : '—';
      console.log(`${esc(q.market).padEnd(12)} ${px.padStart(12)}  conf=${q.confidence}  impact=${q.priceImpactPct != null ? pct(q.priceImpactPct) : '—'}  src=${q.sources.join('+') || 'none'}`);
    }
    const intentions = strategize(quotes);
    console.log('\nDRY-RUN intentions:');
    if (!intentions.length) console.log('  (none — no pair cleared the edge/confidence discipline)');
    for (const i of intentions) {
      console.log(`  → ${i.side.toUpperCase()} ${esc(i.market)} @ ${i.price}  edge=${pct(i.edgePct)}  size=$${i.size}  dryRun=${i.dryRun} signer=${i.signer}`);
    }
    console.log('\nEvery intention is dryRun:true / signer:null by construction. Live execution is a');
    console.log('separate, gated, MELEK-Signer-only concern (zero WIF on this host). This layer only READS + DECIDES.');
  }
}
