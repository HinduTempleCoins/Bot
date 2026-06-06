// pool-stats.test.mjs — OFFLINE tests for integrations/pool-stats.mjs (task #291).
// No network: a fake fetch is injected via __setFetch, so pools()/poolStats() are exercised
// against a canned Miningcore /api/pools payload and the soft-fail paths.
//
//   node --test integrations/pool-stats.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pools, poolStats, normalizePool, stratumUrl, __setFetch,
} from './pool-stats.mjs';

// A trimmed but realistic Miningcore /api/pools payload (two pools + ports + fee).
const FAKE_POOLS = {
  pools: [
    {
      id: 'xmr-stagenet',
      coin: { type: 'monero', name: 'Monero', symbol: 'XMR', algorithm: 'RandomX' },
      poolFeePercent: 1.0,
      paymentProcessing: { payoutScheme: 'PPLNS', minimumPayment: 0.01 },
      poolStats: { connectedMiners: 3, poolHashrate: 1234.5 },
      networkStats: { networkHashrate: 999999, blockHeight: 42 },
      ports: {
        '4444': { tls: false, difficulty: 0.02 },
        '4445': { tls: true, difficulty: 5 },
      },
    },
    {
      id: 'prana',
      coin: { type: 'ethereum', name: 'PRANA', symbol: 'PRANA', algorithm: 'Etchash' },
      poolFeePercent: 0.5,
      paymentProcessing: { payoutScheme: 'PROP' },
      poolStats: { connectedMiners: 0, poolHashrate: 0 },
      networkStats: {},
      ports: { '5550': { tls: false } },
    },
  ],
};

function fakeFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}

// ---------------------------------------------------------------------------
// normalizePool (pure)
// ---------------------------------------------------------------------------
test('normalizePool picks the stable subset and sorts ports', () => {
  const p = normalizePool(FAKE_POOLS.pools[0]);
  assert.equal(p.id, 'xmr-stagenet');
  assert.equal(p.coin, 'Monero');
  assert.equal(p.symbol, 'XMR');
  assert.equal(p.algorithm, 'RandomX');
  assert.equal(p.connectedMiners, 3);
  assert.equal(p.hashrate, 1234.5);
  assert.equal(p.feePercent, 1.0);
  assert.equal(p.paymentScheme, 'PPLNS');
  assert.equal(p.ports.length, 2);
  assert.deepEqual(p.ports.map((x) => x.port), [4444, 4445]);
  assert.equal(p.ports[1].tls, true);
});

test('normalizePool soft-fails junk to null', () => {
  assert.equal(normalizePool(null), null);
  assert.equal(normalizePool(42), null);
});

test('normalizePool tolerates missing fields without throwing', () => {
  const p = normalizePool({ id: 'bare' });
  assert.equal(p.id, 'bare');
  assert.equal(p.connectedMiners, 0);
  assert.equal(p.feePercent, null);
  assert.deepEqual(p.ports, []);
});

// ---------------------------------------------------------------------------
// pools() over injected fetch
// ---------------------------------------------------------------------------
test('pools() normalizes the /api/pools payload', async () => {
  __setFetch(fakeFetch(FAKE_POOLS));
  const ps = await pools();
  __setFetch(null);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].id, 'xmr-stagenet');
  assert.equal(ps[1].id, 'prana');
  assert.equal(ps[1].feePercent, 0.5);
});

test('pools() accepts a bare array too', async () => {
  __setFetch(fakeFetch(FAKE_POOLS.pools));
  const ps = await pools();
  __setFetch(null);
  assert.equal(ps.length, 2);
});

test('pools() soft-fails to [] on non-2xx', async () => {
  __setFetch(fakeFetch(FAKE_POOLS, { ok: false }));
  assert.deepEqual(await pools(), []);
  __setFetch(null);
});

test('pools() soft-fails to [] when fetch throws', async () => {
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  assert.deepEqual(await pools(), []);
  __setFetch(null);
});

test('pools() soft-fails to [] on malformed JSON', async () => {
  __setFetch(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }));
  assert.deepEqual(await pools(), []);
  __setFetch(null);
});

// ---------------------------------------------------------------------------
// poolStats(id)
// ---------------------------------------------------------------------------
test('poolStats() reads a single wrapped pool', async () => {
  __setFetch(fakeFetch({ pool: FAKE_POOLS.pools[1] }));
  const p = await poolStats('prana');
  __setFetch(null);
  assert.equal(p.id, 'prana');
  assert.equal(p.algorithm, 'Etchash');
});

test('poolStats() returns null for empty id', async () => {
  assert.equal(await poolStats(''), null);
  assert.equal(await poolStats(null), null);
});

test('poolStats() soft-fails to null when unreachable', async () => {
  __setFetch(async () => { throw new Error('down'); });
  assert.equal(await poolStats('prana'), null);
  __setFetch(null);
});

// ---------------------------------------------------------------------------
// stratumUrl (pure)
// ---------------------------------------------------------------------------
test('stratumUrl builds tcp + ssl connect lines', () => {
  assert.equal(stratumUrl(4444, { host: 'pool.example' }), 'stratum+tcp://pool.example:4444');
  assert.equal(stratumUrl(4445, { tls: true, host: 'pool.example' }), 'stratum+ssl://pool.example:4445');
});
