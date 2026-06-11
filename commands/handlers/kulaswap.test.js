/**
 * commands/handlers/kulaswap.test.js — offline tests for the !kulaswap handler.
 *
 * The handler reads integrations/pool-stats.mjs, which exposes `__setFetch` for
 * a fully-offline, injected fetch. We never touch the network: every test wires
 * a fake fetch returning the Miningcore-shaped JSON the reader expects (or a
 * failure), and asserts the formatted reply. Soft-fail-never-throw is covered.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { kulaswap, esc, humanHashrate } from './kulaswap.js';
import { __setFetch } from '../../integrations/pool-stats.mjs';

// Build a fake fetch from a route-table: path-suffix -> { ok, json } | thrower.
function fakeFetch(routes) {
  return async (url) => {
    for (const [suffix, spec] of Object.entries(routes)) {
      if (url.endsWith(suffix)) {
        if (typeof spec === 'function') return spec();
        return { ok: spec.ok !== false, json: async () => spec.json };
      }
    }
    return { ok: false, json: async () => ({}) };
  };
}

const PRANA = {
  id: 'prana',
  coin: { name: 'Prana', symbol: 'PRANA', type: 'prana', algorithm: 'RandomX' },
  poolFeePercent: 1.0,
  poolStats: { connectedMiners: 3, poolHashrate: 1500 },
  networkStats: { networkHashrate: 1e6, blockHeight: 42 },
  paymentProcessing: { payoutScheme: 'PPLNS', minimumPayment: 0.1 },
  ports: { '3333': { tls: false, difficulty: 1000 }, '3334': { tls: true } },
};

test.afterEach(() => __setFetch(null)); // restore global fetch

// ---- helpers ----------------------------------------------------------------

test('esc: escapes HTML-significant characters', () => {
  assert.equal(esc('<a&"\'>'), '&lt;a&amp;&quot;&#39;&gt;');
  assert.equal(esc(null), '');
});

test('humanHashrate: scales units', () => {
  assert.equal(humanHashrate(0), '0 H/s');
  assert.equal(humanHashrate(1500), '1.50 KH/s');
  assert.equal(humanHashrate(2_500_000), '2.50 MH/s');
  assert.equal(humanHashrate('not-a-number'), '0 H/s');
});

// ---- menu view --------------------------------------------------------------

test('!kulaswap (no args): lists pools with hashrate, miners, port', async () => {
  __setFetch(fakeFetch({ '/api/pools': { json: { pools: [PRANA] } } }));
  const r = await kulaswap({ args: [] }, {});
  assert.equal(r.ok, true);
  assert.match(r.reply, /KulaSwap pools/);
  assert.match(r.reply, /Prana/);
  assert.match(r.reply, /1\.50 KH\/s/);
  assert.match(r.reply, /3 miners/);
  assert.match(r.reply, /port 3333/); // lowest non-TLS port
});

test('!kulaswap (no args): empty menu is an honest empty-state, ok:true', async () => {
  __setFetch(fakeFetch({ '/api/pools': { json: { pools: [] } } }));
  const r = await kulaswap({ args: [] }, {});
  assert.equal(r.ok, true);
  assert.match(r.reply, /no pools/i);
});

// ---- single-pool view -------------------------------------------------------

test('!kulaswap prana: single-pool summary + stratum line', async () => {
  __setFetch(fakeFetch({ '/api/pools/prana': { json: { pool: PRANA } } }));
  const r = await kulaswap({ args: ['prana'] }, {});
  assert.equal(r.ok, true);
  assert.match(r.reply, /KulaSwap — Prana/);
  assert.match(r.reply, /Hashrate: 1\.50 KH\/s/);
  assert.match(r.reply, /Miners: 3/);
  assert.match(r.reply, /stratum\+tcp:\/\/.+:3333/);
});

test('!kulaswap @prana: tolerates a leading @ / # / $ sigil', async () => {
  __setFetch(fakeFetch({ '/api/pools/prana': { json: { pool: PRANA } } }));
  const r = await kulaswap({ args: ['@prana'] }, {});
  assert.match(r.reply, /KulaSwap — Prana/);
});

test('!kulaswap unknown: missing pool yields a friendly reply, ok:true', async () => {
  __setFetch(fakeFetch({ '/api/pools/ghost': { ok: false, json: {} } }));
  const r = await kulaswap({ args: ['ghost'] }, {});
  assert.equal(r.ok, true);
  assert.match(r.reply, /no pool "ghost"/);
});

// ---- soft-fail-never-throw --------------------------------------------------

test('!kulaswap: a throwing fetch soft-fails (no throw, ok:true)', async () => {
  // pool-stats getJson swallows fetch errors to null, so pools() returns [].
  __setFetch(() => { throw new Error('network down'); });
  const r = await kulaswap({ args: [] }, {});
  assert.equal(r.ok, true);
  assert.match(r.reply, /no pools|unavailable/i);
});

test('!kulaswap prana: a throwing fetch soft-fails for single pool too', async () => {
  __setFetch(() => { throw new Error('network down'); });
  const r = await kulaswap({ args: ['prana'] }, {});
  assert.equal(r.ok, true);
  assert.match(r.reply, /no pool "prana"|unavailable/i);
});

test('!kulaswap: malformed parsed object does not throw', async () => {
  __setFetch(fakeFetch({ '/api/pools': { json: { pools: [] } } }));
  const r = await kulaswap({}, {});
  assert.equal(r.ok, true);
  assert.ok(typeof r.reply === 'string');
});

test('!kulaswap: hostile coin name is esc()-escaped in the reply', async () => {
  const HOSTILE = { ...PRANA, coin: { name: '<b>x</b>', symbol: 'X', type: 'x' }, id: 'x' };
  __setFetch(fakeFetch({ '/api/pools/x': { json: { pool: HOSTILE } } }));
  const r = await kulaswap({ args: ['x'] }, {});
  assert.match(r.reply, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.ok(!r.reply.includes('<b>'));
});
