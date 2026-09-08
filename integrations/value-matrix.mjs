// value-matrix — what a holder is actually being asked to join, priced across every base.
//
// The operator's framing: the matrix is MELEK / HIVE / STEEM / BLURT against VKBT / CURE / SPS and
// the other Hive tokens. Somebody deciding whether to bridge VKBT to KulaSwap, or to buy CURE on
// TribalDEX, is implicitly pricing a token in a chain currency in a fiat -- three hops -- and
// nowhere in the ecosystem is that arithmetic shown to them in one place.
//
// TWO NUMBERS PER CELL, AND THE SECOND ONE IS THE HONEST ONE.
//
//   markPrice   the top bid. What the book says the holding is "worth".
//   fillPrice   what a real seller of a real size would ACTUALLY get, walking the book down.
//
// On a thin book these diverge violently. VKBT's top bid is 0.00001902 HIVE with 0.358 SWAP.HIVE
// of total depth behind it -- so a holder with 958,842 VKBT has a mark of ~18 HIVE and a fill of
// under 1. Publishing the mark alone is how a token lies to its own holders, so every cell here
// carries `depthHive`, and `illiquid` is set whenever the book cannot absorb the position.
//
// House rules: ESM, injectable fetch, soft-fail-never-throw, read-only. No keys, no orders.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => String(v == null ? '' : v);
const HE = 'https://api.hive-engine.com/rpc/contracts';

// The chain currencies a holder actually thinks in.
export const BASES = Object.freeze([
  { id: 'HIVE', name: 'Hive', kind: 'chain', coingecko: 'hive' },
  { id: 'STEEM', name: 'Steem', kind: 'chain', coingecko: 'steem' },
  { id: 'BLURT', name: 'Blurt', kind: 'chain', coingecko: 'blurt' },
  { id: 'MELEK', name: 'MELEK', kind: 'chain', coingecko: null,
    note: 'testnet — no market price exists, and this module will not invent one' },
  { id: 'USD', name: 'US dollar', kind: 'fiat', coingecko: null },
]);

// Hive-Engine tokens priced against those bases. All Hive-Engine books quote in SWAP.HIVE.
export const TOKENS = Object.freeze([
  'VKBT', 'CURE', 'SPS', 'LEO', 'POB', 'CTP', 'ARCHON', 'PIMP', 'ALIVE', 'LOLZ',
  'BBH', 'VYB', 'LIST', 'PIZZA', 'DEC', 'SWAP.BLURT', 'SWAP.STEEM',
]);

async function rpc(body) {
  try {
    const r = await _fetch(HE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return JSON.parse(await r.text()).result || null;
  } catch { return null; }
}

/** Metrics give the mark. They do NOT give what a seller would get, which is why we also walk the book. */
export async function metricsFor(symbols) {
  const out = {};
  const res = await rpc({
    jsonrpc: '2.0', id: 1, method: 'find',
    params: { contract: 'market', table: 'metrics', query: { symbol: { $in: symbols } }, limit: 1000 },
  }) || [];
  for (const m of res) out[m.symbol] = m;
  return out;
}

/**
 * Walk the bid book to find what a seller of `size` really receives, and how deep the book is.
 * This is the number a holder needs and the one nobody publishes.
 */
export async function bidDepth(symbol, size = 0) {
  const bids = await rpc({
    jsonrpc: '2.0', id: 1, method: 'find',
    params: {
      contract: 'market', table: 'buyBook', query: { symbol: str(symbol) }, limit: 500,
      indexes: [{ index: 'priceDec', descending: true }],
    },
  }) || [];
  const rows = bids.map((o) => ({ p: num(o.price), q: num(o.quantity) }))
    .filter((o) => o.p > 1e-8).sort((a, b) => b.p - a.p);
  const totalHive = rows.reduce((s, o) => s + o.p * o.q, 0);
  const totalUnits = rows.reduce((s, o) => s + o.q, 0);
  let left = num(size), got = 0, filled = 0;
  for (const o of rows) {
    if (left <= 0) break;
    const take = Math.min(left, o.q);
    got += take * o.p; filled += take; left -= take;
  }
  return {
    best: rows.length ? rows[0].p : 0,
    depthHive: totalHive, depthUnits: totalUnits, orders: rows.length,
    fillProceedsHive: got, filledUnits: filled, unfilledUnits: Math.max(0, num(size) - filled),
    fillPrice: filled > 0 ? got / filled : 0,
  };
}

/** External chain prices. Missing is reported as missing — never substituted. */
export async function chainPrices() {
  const ids = BASES.filter((b) => b.coingecko).map((b) => b.coingecko).join(',');
  let data = {};
  try {
    const r = await _fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    data = JSON.parse(await r.text());
  } catch { data = {}; }
  const out = {};
  for (const b of BASES) {
    if (b.id === 'USD') { out.USD = 1; continue; }
    out[b.id] = b.coingecko && data[b.coingecko] ? num(data[b.coingecko].usd) : null;
  }
  return out;
}

/**
 * Build the matrix. `positions` maps symbol -> units held, so the fill column answers the only
 * question that matters: if I tried to leave, what would I get?
 */
export async function buildMatrix({ tokens = TOKENS, positions = {} } = {}) {
  const [metrics, prices] = await Promise.all([metricsFor([...tokens]), chainPrices()]);
  const rows = [];
  for (const sym of tokens) {
    const m = metrics[sym] || {};
    const size = num(positions[sym]);
    const d = await bidDepth(sym, size);
    const mark = num(m.highestBid) || d.best;
    const ask = num(m.lowestAsk);
    const spreadRatio = mark > 0 && ask > 0 ? ask / mark : Infinity;

    const inBase = {};
    for (const b of BASES) {
      if (b.id === 'HIVE') { inBase.HIVE = mark; continue; }
      if (b.id === 'USD') { inBase.USD = prices.HIVE != null ? mark * prices.HIVE : null; continue; }
      if (prices[b.id] == null || prices.HIVE == null) { inBase[b.id] = null; continue; }
      inBase[b.id] = (mark * prices.HIVE) / prices[b.id];
    }

    rows.push({
      symbol: sym,
      markHive: mark,
      askHive: ask,
      spreadRatio,
      broken: Number.isFinite(spreadRatio) ? spreadRatio > 3 : true,
      depthHive: d.depthHive,
      depthUnits: d.depthUnits,
      bidOrders: d.orders,
      position: size,
      markValueHive: size * mark,
      fillValueHive: d.fillProceedsHive,
      fillPrice: d.fillPrice,
      unfilledUnits: d.unfilledUnits,
      // the number that tells a holder the truth
      markToFillRatio: size > 0 && d.fillProceedsHive > 0
        ? (size * mark) / d.fillProceedsHive : null,
      illiquid: size > 0 ? d.unfilledUnits > 0 : d.depthHive < 1,
      inBase,
    });
  }
  return { rows, chainPrices: prices, at: new Date().toISOString() };
}

/** Render for a human. Deliberately puts the fill column next to the mark so they are compared. */
export function render(matrix, { showPositions = true } = {}) {
  const p = matrix.chainPrices || {};
  const out = [];
  out.push('CHAIN PRICES (USD)');
  for (const b of BASES) {
    const v = p[b.id];
    out.push(`  ${b.id.padEnd(7)} ${v == null ? 'no market price' : `$${v}`}`
      + (b.note ? `   — ${b.note}` : ''));
  }
  out.push('');
  out.push('TOKEN MATRIX — mark is what the book claims, fill is what a seller would get');
  out.push(`  ${'token'.padEnd(11)}${'mark HIVE'.padStart(13)}${'spread'.padStart(10)}`
    + `${'bid depth'.padStart(12)}${'USD'.padStart(12)}${'BLURT'.padStart(12)}`);
  out.push('  ' + '─'.repeat(68));
  for (const r of matrix.rows) {
    const usd = r.inBase.USD == null ? '—' : `$${r.inBase.USD.toPrecision(3)}`;
    const blurt = r.inBase.BLURT == null ? '—' : r.inBase.BLURT.toPrecision(3);
    const spread = Number.isFinite(r.spreadRatio) ? `${r.spreadRatio.toFixed(1)}x` : 'none';
    out.push(`  ${r.symbol.padEnd(11)}${r.markHive.toPrecision(4).padStart(13)}`
      + `${(r.broken ? '⚠ ' + spread : spread).padStart(10)}`
      + `${r.depthHive.toFixed(2).padStart(12)}${usd.padStart(12)}${blurt.padStart(12)}`);
  }
  if (showPositions && matrix.rows.some((r) => r.position > 0)) {
    out.push('');
    out.push('WHAT A HOLDING IS ACTUALLY WORTH IF SOLD');
    for (const r of matrix.rows.filter((x) => x.position > 0)) {
      out.push(`  ${r.symbol}: ${r.position.toLocaleString()} units`);
      out.push(`     marked at ${r.markValueHive.toFixed(2)} HIVE`);
      out.push(`     would fill for ${r.fillValueHive.toFixed(2)} HIVE`
        + (r.unfilledUnits > 0
          ? `  — and ${r.unfilledUnits.toLocaleString()} units find NO BID AT ALL` : ''));
      if (r.markToFillRatio && r.markToFillRatio > 1.2) {
        out.push(`     the mark overstates the exit by ${r.markToFillRatio.toFixed(1)}x`);
      }
    }
  }
  return out.join('\n');
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  return send(200, {
    ok: true, service: 'value-matrix', bases: BASES, tokens: TOKENS,
    note: 'Every cell carries bid depth. A mark price without depth is not a valuation.',
  });
}

if (process.argv[1] && process.argv[1].endsWith('value-matrix.mjs')) {
  const m = await buildMatrix({
    positions: { VKBT: 958842, CURE: 37038, BBH: 181708, SPS: 20 },
  });
  console.log(render(m));
}
