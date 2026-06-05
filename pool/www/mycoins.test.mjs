// Tests for the My Coins data layer (pool/www/mycoins.mjs).
// Run: node --test pool/www/mycoins.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MyCoinsStore, POOL_IDS, defaultPoolId, normalizeMinerStats,
  fetchCoinStats, buildMyCoinsView,
} from './mycoins.mjs';

// In-memory localStorage stub.
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

// Fake fetch driven by a route table { url-substring -> {ok,status,json} }.
function fakeFetch(routes) {
  return async (url) => {
    for (const [needle, resp] of Object.entries(routes)) {
      if (url.includes(needle)) {
        return {
          ok: resp.ok !== false,
          status: resp.status || 200,
          json: async () => resp.json,
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('defaultPoolId maps coins to Miningcore pool ids', () => {
  assert.equal(defaultPoolId('monero', 'mainnet'), 'xmr-mainnet');
  assert.equal(defaultPoolId('monero', 'stagenet'), 'xmr-stagenet');
  assert.equal(defaultPoolId('ethereum_classic', 'testnet'), 'etc-mordor');
  assert.equal(defaultPoolId('nope'), null);
  assert.ok(POOL_IDS.zephyr); // ZEPH slot present for when the pool entry lands
});

test('store add/list/remove dedupes on (poolId,address)', () => {
  const s = new MyCoinsStore(memStorage());
  s.add({ coin: 'monero', address: 'ADDR1', network: 'stagenet' });
  s.add({ coin: 'monero', address: 'ADDR1', network: 'stagenet', label: 'rig' }); // dup -> label update
  s.add({ coin: 'ethereum_classic', address: '0xabc', network: 'testnet' });
  const list = s.list();
  assert.equal(list.length, 2);
  assert.equal(list.find((r) => r.address === 'ADDR1').label, 'rig');
  assert.equal(list.find((r) => r.address === 'ADDR1').poolId, 'xmr-stagenet');
  s.remove({ poolId: 'xmr-stagenet', address: 'ADDR1' });
  assert.equal(s.list().length, 1);
});

test('store rejects missing coin/address and unknown pool', () => {
  const s = new MyCoinsStore(memStorage());
  assert.throws(() => s.add({ address: 'x' }), /coin required/);
  assert.throws(() => s.add({ coin: 'monero' }), /address required/);
  assert.throws(() => s.add({ coin: 'unknowncoin', address: 'x' }), /no pool id/);
});

test('normalizeMinerStats tolerates nested and flat shapes', () => {
  const nested = normalizeMinerStats({
    pendingBalance: 1.5, totalPaid: 4,
    performance: { workers: { rig1: { hashrate: 100, sharesPerSecond: 2 }, rig2: { hashrate: 50 } } },
  });
  assert.equal(nested.pendingBalance, 1.5);
  assert.equal(nested.hashrate, 150);
  assert.equal(nested.workerCount, 2);
  const flat = normalizeMinerStats({ hashrate: 42, workerCount: 1 });
  assert.equal(flat.hashrate, 42);
  assert.equal(normalizeMinerStats(null).hashrate, 0); // never throws
});

test('fetchCoinStats merges stats + payments and never throws on a dead pool', async () => {
  const rec = { coin: 'monero', poolId: 'xmr-stagenet', address: 'ADDR1' };
  const f = fakeFetch({
    '/miners/ADDR1/payments': { json: [{ amount: 0.1, created: '2026-06-05' }] },
    '/miners/ADDR1': { json: { pendingBalance: 2.0, totalPaid: 0.1, hashrate: 30 } },
  });
  const view = await fetchCoinStats(rec, { fetchImpl: f, apiBase: '/api' });
  assert.equal(view.ok, true);
  assert.equal(view.stats.pendingBalance, 2.0);
  assert.equal(view.payments.length, 1);

  // Dead pool -> ok:false, zeroed stats, no throw.
  const dead = await fetchCoinStats(rec, { fetchImpl: fakeFetch({}), apiBase: '/api' });
  assert.equal(dead.ok, false);
  assert.equal(dead.stats.pendingBalance, 0);
  assert.ok(dead.error);
});

test('buildMyCoinsView groups by coin and sums totals', async () => {
  const s = new MyCoinsStore(memStorage());
  s.add({ coin: 'monero', address: 'A', network: 'stagenet' });
  s.add({ coin: 'monero', address: 'B', network: 'stagenet' });
  s.add({ coin: 'ethereum_classic', address: '0xc', network: 'testnet' });
  const f = fakeFetch({
    '/miners/A': { json: { pendingBalance: 1, totalPaid: 2, hashrate: 10 } },
    '/miners/B': { json: { pendingBalance: 3, totalPaid: 0, hashrate: 5 } },
    '/miners/0xc': { json: { pendingBalance: 0, totalPaid: 0, hashrate: 0 } },
  });
  const view = await buildMyCoinsView(s, { fetchImpl: f, apiBase: '/api' });
  assert.equal(view.empty, false);
  const xmr = view.coins.find((c) => c.coin === 'monero');
  assert.equal(xmr.addresses.length, 2);
  assert.equal(xmr.totals.pendingBalance, 4);
  assert.equal(xmr.totals.hashrate, 15);
  assert.equal(view.coins.length, 2);
});

test('buildMyCoinsView reports empty when nothing is saved', async () => {
  const s = new MyCoinsStore(memStorage());
  const view = await buildMyCoinsView(s, { fetchImpl: fakeFetch({}) });
  assert.equal(view.empty, true);
  assert.equal(view.coins.length, 0);
});
