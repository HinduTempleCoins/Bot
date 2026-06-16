// kula-price-tvl.test.mjs — offline tests for the AMM-relative pricing + TVL layer.
// node:test, NO network (fetch is injected), no deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  poolPrice, fetchPoolPrice, tvl, externalRef, renderTvlBadge, __setFetch,
} from './kula-price-tvl.mjs';

// ── poolPrice (the internal oracle) ────────────────────────────────────────────────────────────────
test('poolPrice: ratio + inverse — 1,000,000 KULA / 50,000 wMELEK → 1 KULA = 0.05 wMELEK', () => {
  const p = poolPrice(1_000_000, 50_000);
  assert.equal(p.priceKulaInWmelek, 0.05);
  assert.equal(p.priceWmelekInKula, 20);
  assert.equal(p.ok, true);
});

test('poolPrice: inverse is the reciprocal', () => {
  const p = poolPrice(40, 10); // 1 KULA = 0.25 wMELEK; 1 wMELEK = 4 KULA
  assert.equal(p.priceKulaInWmelek, 0.25);
  assert.equal(p.priceWmelekInKula, 4);
  assert.equal(round8(p.priceKulaInWmelek * p.priceWmelekInKula), 1);
});

test('poolPrice: empty/garbage reserves soft-fail to zeros + ok:false', () => {
  assert.deepEqual(pick(poolPrice(0, 100)), { priceKulaInWmelek: 0, priceWmelekInKula: 0, ok: false });
  assert.deepEqual(pick(poolPrice(100, 0)), { priceKulaInWmelek: 0, priceWmelekInKula: 0, ok: false });
  assert.deepEqual(pick(poolPrice('x', 'y')), { priceKulaInWmelek: 0, priceWmelekInKula: 0, ok: false });
  assert.deepEqual(pick(poolPrice()), { priceKulaInWmelek: 0, priceWmelekInKula: 0, ok: false });
  assert.equal(poolPrice(-5, 5).ok, false);
});

// ── fetchPoolPrice (injected fetch — no network) ────────────────────────────────────────────────────
// getReserves() returns (uint112 reserve0, uint112 reserve1, uint32 ts) = three 32-byte words.
function reservesResult(reserve0, reserve1, ts = 1234) {
  const w = (n) => BigInt(n).toString(16).padStart(64, '0');
  return '0x' + w(reserve0) + w(reserve1) + w(ts);
}
const okResponse = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });

test('fetchPoolPrice: reads getReserves() and returns the ratio (kulaIsToken0 default)', async () => {
  __setFetch(async (url, opts) => {
    assert.match(url, /rpc/);
    const body = JSON.parse(opts.body);
    assert.equal(body.method, 'eth_call');
    assert.equal(body.params[0].data, '0x0902f1ac'); // getReserves() selector
    return okResponse(reservesResult(1_000_000, 50_000)); // reserve0=KULA, reserve1=wMELEK
  });
  const p = await fetchPoolPrice({ rpcUrl: 'https://rpc.prana.example', pairAddr: '0xpair' });
  assert.equal(p.priceKulaInWmelek, 0.05);
  assert.equal(p.priceWmelekInKula, 20);
  assert.equal(p.ok, true);
  __setFetch(null);
});

test('fetchPoolPrice: kulaIsToken0:false swaps the slots', async () => {
  __setFetch(async () => okResponse(reservesResult(50_000, 1_000_000))); // now reserve0=wMELEK
  const p = await fetchPoolPrice({ rpcUrl: 'https://rpc', pairAddr: '0xpair', kulaIsToken0: false });
  assert.equal(p.priceKulaInWmelek, 0.05); // KULA is reserve1 = 1,000,000
  __setFetch(null);
});

test('fetchPoolPrice: soft-fails to null on missing args', async () => {
  assert.equal(await fetchPoolPrice({}), null);
  assert.equal(await fetchPoolPrice({ rpcUrl: 'x' }), null);
  assert.equal(await fetchPoolPrice({ pairAddr: 'x' }), null);
  assert.equal(await fetchPoolPrice(), null);
});

test('fetchPoolPrice: soft-fails to null on network throw, HTTP !ok, RPC error, garbage', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  assert.equal(await fetchPoolPrice({ rpcUrl: 'x', pairAddr: 'y' }), null);

  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  assert.equal(await fetchPoolPrice({ rpcUrl: 'x', pairAddr: 'y' }), null);

  __setFetch(async () => ({ ok: true, json: async () => ({ error: { message: 'revert' } }) }));
  assert.equal(await fetchPoolPrice({ rpcUrl: 'x', pairAddr: 'y' }), null);

  __setFetch(async () => ({ ok: true, json: async () => ({ result: '0xabc' }) })); // too short
  assert.equal(await fetchPoolPrice({ rpcUrl: 'x', pairAddr: 'y' }), null);

  __setFetch(null);
});

test('fetchPoolPrice: zero reserves come back as ok:false (not null — RPC succeeded)', async () => {
  __setFetch(async () => okResponse(reservesResult(0, 0)));
  const p = await fetchPoolPrice({ rpcUrl: 'x', pairAddr: 'y' });
  assert.equal(p.ok, false);
  __setFetch(null);
});

// ── tvl (native units + numeraire roll-up) ──────────────────────────────────────────────────────────
test('tvl: sums native amounts + values KULA in wMELEK via the pool ratio', () => {
  // 200,000 KULA @ 0.05 wMELEK/KULA = 10,000 wMELEK; + 12,000 wMELEK locked = 22,000 wMELEK total.
  const t = tvl({ lockedKula: 200_000, lockedWmelek: 12_000, priceKulaInWmelek: 0.05 });
  assert.equal(t.lockedKula, 200_000);
  assert.equal(t.lockedWmelek, 12_000);
  assert.equal(t.kulaValueInWmelek, 10_000);
  assert.equal(t.totalValueInWmelek, 22_000);
  assert.equal(t.numeraire, 'wMELEK');
  assert.equal(t.priced, true);
});

test('tvl: no pool price → only the wMELEK leg counts, priced:false', () => {
  const t = tvl({ lockedKula: 200_000, lockedWmelek: 12_000 });
  assert.equal(t.kulaValueInWmelek, 0);
  assert.equal(t.totalValueInWmelek, 12_000);
  assert.equal(t.priced, false);
});

test('tvl: carries apisHashTotal in native units, never folds it into value', () => {
  const t = tvl({ lockedKula: 100, lockedWmelek: 0, apisHashTotal: 5000, priceKulaInWmelek: 2 });
  assert.equal(t.apisHashTotal, 5000);
  assert.equal(t.totalValueInWmelek, 200); // 100 KULA * 2, APIS-Hash excluded
});

test('tvl: garbage/missing soft-fails to zeros, never throws', () => {
  assert.doesNotThrow(() => tvl());
  const t = tvl({ lockedKula: 'x', lockedWmelek: -3, priceKulaInWmelek: 'y' });
  assert.equal(t.lockedKula, 0);
  assert.equal(t.lockedWmelek, 0);
  assert.equal(t.totalValueInWmelek, 0);
});

// ── externalRef (the seam — off today) ──────────────────────────────────────────────────────────────
test('externalRef: USD/BTC/STEEM/BLURT all unavailable today', () => {
  for (const sym of ['USD', 'BTC', 'STEEM', 'BLURT']) {
    const r = externalRef(sym);
    assert.equal(r.available, false, `${sym} should be unavailable`);
    assert.equal(r.reason, 'no external market yet');
    assert.equal(r.symbol, sym);
    assert.ok(typeof r.source === 'string' && r.source.length > 0, `${sym} documents a future source`);
  }
});

test('externalRef: lowercase + unknown symbol soft-fail to unavailable', () => {
  assert.equal(externalRef('usd').available, false);
  assert.equal(externalRef('usd').symbol, 'USD');
  const unknown = externalRef('DOGE');
  assert.equal(unknown.available, false);
  assert.equal(unknown.source, 'unknown symbol');
  assert.doesNotThrow(() => externalRef());
});

// ── renderTvlBadge (HTML, esc'd, native units) ──────────────────────────────────────────────────────
test('renderTvlBadge: renders native units, wMELEK approx, positions, USD-soon note', () => {
  const html = renderTvlBadge({ lockedKula: 200_000, lockedWmelek: 12_000, positions: 7, priceKulaInWmelek: 0.05 });
  assert.match(html, /Total Value Locked/);
  assert.match(html, /12000 wMELEK/);
  assert.match(html, /200000 KULA/);
  assert.match(html, /≈ 22000 wMELEK/);
  assert.match(html, /7 positions/);
  assert.match(html, /USD coming soon/);
  assert.doesNotThrow(() => renderTvlBadge());
});

test('renderTvlBadge: no pool price shows an honest "—", not a fake number', () => {
  const html = renderTvlBadge({ lockedKula: 200_000, lockedWmelek: 12_000, positions: 3 });
  assert.match(html, /pool price unavailable/);
  assert.ok(!/≈ \d+ wMELEK\)/.test(html), 'must not show a numeric approx without a pool price');
});

test('renderTvlBadge: esc()s its values (no raw HTML injection)', () => {
  // positions is coerced to an integer, but ensure the structure itself is escaped/clean.
  const html = renderTvlBadge({ lockedKula: 0, lockedWmelek: 0, positions: '5"><img src=x>', priceKulaInWmelek: 0 });
  assert.ok(!html.includes('<img src=x>'), 'must not contain a raw injected tag');
  assert.match(html, /0 positions/); // non-numeric positions coerces to 0 — rendered safely, no injection
});

// ── tiny helpers ────────────────────────────────────────────────────────────────────────────────────
function round8(x) { return +(+x).toFixed(8); }
function pick(p) { return { priceKulaInWmelek: p.priceKulaInWmelek, priceWmelekInKula: p.priceWmelekInKula, ok: p.ok }; }
