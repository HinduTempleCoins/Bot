import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVests,
  extractCurationRewards,
  computeYield,
  readCurationYield,
  __setFetch,
  __resetFetch,
} from './curation-yield.mjs';

// ── fixtures ──────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-06-09T00:00:00Z');
function isoDaysAgo(d) {
  // condenser timestamps have no trailing Z
  return new Date(NOW - d * 86400 * 1000).toISOString().replace(/\.\d+Z$/, '');
}

// condenser_api.get_account_history shape: [[seq, { timestamp, op:[name,payload] }], ...]
const HISTORY = [
  [10, { timestamp: isoDaysAgo(1), op: ['curation_reward', {
    curator: 'hathor', comment_author: 'alice', comment_permlink: 'p1',
    reward: '12000.000000 VESTS',
  }] }],
  [11, { timestamp: isoDaysAgo(5), op: ['curation_reward', {
    curator: 'hathor', comment_author: 'bob', comment_permlink: 'p2',
    reward: '8000.000000 VESTS',
  }] }],
  // a non-curation op that must be ignored
  [12, { timestamp: isoDaysAgo(2), op: ['transfer', { from: 'x', to: 'hathor', amount: '1.000 HIVE' }] }],
  // appbase-shaped op (type/value) — must also be parsed
  [13, { timestamp: isoDaysAgo(40), op: { type: 'curation_reward_operation', value: {
    curator: 'hathor', author: 'carol', permlink: 'p3', reward: '5000.000000 VESTS',
  } } }],
];

test('parseVests handles strings, numbers, and NAI asset objects', () => {
  assert.equal(parseVests('123.456 VESTS'), 123.456);
  assert.equal(parseVests(10), 10);
  assert.equal(parseVests({ amount: '12345678', precision: 6, nai: '@@000000037' }), 12.345678);
  assert.equal(parseVests(null), 0);
  assert.equal(parseVests('garbage'), 0);
});

test('extractCurationRewards pulls only curation_reward ops (both op shapes)', () => {
  const rewards = extractCurationRewards(HISTORY);
  assert.equal(rewards.length, 3); // p1, p2 (array form) + p3 (appbase form), transfer ignored
  assert.equal(rewards[0].author, 'alice');
  assert.equal(rewards[0].rewardVests, 12000);
  assert.equal(rewards[2].author, 'carol'); // appbase-shaped
  assert.equal(rewards[2].rewardVests, 5000);
});

test('extractCurationRewards soft-fails on garbage', () => {
  assert.deepEqual(extractCurationRewards(null), []);
  assert.deepEqual(extractCurationRewards('nope'), []);
  assert.deepEqual(extractCurationRewards([null, 5, [1]]), []);
});

test('computeYield: totals, per-vote, window filter, and APR', () => {
  const rewards = extractCurationRewards(HISTORY);
  // 30-day window excludes the 40-day-old p3 (5000); keeps p1+p2 = 20000 VESTS.
  const y = computeYield(rewards, { stakedVests: 1_000_000, windowDays: 30, nowMs: NOW });
  assert.equal(y.ok, true);
  assert.equal(y.voteCount, 2);
  assert.equal(y.totalVests, 20000);
  assert.equal(y.perVoteVests, 10000);
  // APR: 20000 over 30d → annualized 20000*(365/30)=243333.33 VESTS / 1,000,000 stake * 100
  assert.ok(Math.abs(y.aprPct - 24.3333) < 0.01);
});

test('computeYield: APR is null without stake; power conversion when given', () => {
  const rewards = extractCurationRewards(HISTORY);
  const y = computeYield(rewards, { windowDays: 365, nowMs: NOW });
  assert.equal(y.aprPct, null);          // no stake → no APR
  assert.equal(y.voteCount, 3);          // 365d window keeps all
  assert.equal(y.totalVests, 25000);
  const yp = computeYield(rewards, { windowDays: 365, nowMs: NOW, vestsToPower: 0.0005 });
  assert.equal(yp.totalPower, 25000 * 0.0005);
});

test('computeYield soft-fails on non-array', () => {
  const y = computeYield(null, {});
  assert.equal(y.ok, true);
  assert.equal(y.voteCount, 0);
  assert.equal(y.totalVests, 0);
});

test('readCurationYield: end-to-end with injected fetch (no network)', async () => {
  __setFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'condenser_api.get_account_history') {
      return { json: async () => ({ result: HISTORY }) };
    }
    if (body.method === 'condenser_api.get_accounts') {
      return { json: async () => ({ result: [{ name: 'hathor', vesting_shares: '1000000.000000 VESTS' }] }) };
    }
    return { json: async () => ({ result: null }) };
  });
  try {
    const r = await readCurationYield('hive', 'Hathor', { windowDays: 30, nowMs: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.account, 'hathor');       // lowercased
    assert.equal(r.chain, 'hive');
    assert.equal(r.voteCount, 2);            // 30d window
    assert.equal(r.totalVests, 20000);
    assert.equal(r.stakedVests, 1000000);    // read from get_accounts
    assert.ok(r.aprPct > 0);
    assert.equal(r.sampleSize, 3);           // all curation ops sampled before window filter
  } finally {
    __resetFetch();
  }
});

test('readCurationYield: soft-fails on RPC error, never throws', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  try {
    const r = await readCurationYield('hive', 'hathor', { nowMs: NOW });
    assert.equal(r.ok, false);
    assert.match(r.error, /network down|all chain nodes failed/);
  } finally {
    __resetFetch();
  }
});

test('readCurationYield: rejects empty account / unknown chain', async () => {
  const r1 = await readCurationYield('hive', '   ');
  assert.equal(r1.ok, false);
  const r2 = await readCurationYield('no-such-chain', 'hathor', { rpcs: [] });
  assert.equal(r2.ok, false);
});

test('readCurationYield: uses supplied stake and skips the stake read', async () => {
  let acctCalls = 0;
  __setFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'condenser_api.get_accounts') acctCalls++;
    return { json: async () => ({ result: HISTORY }) };
  });
  try {
    const r = await readCurationYield('hive', 'hathor', {
      windowDays: 30, nowMs: NOW, stakedVests: 500000,
    });
    assert.equal(r.stakedVests, 500000);
    assert.equal(acctCalls, 0); // supplied stake → no get_accounts call
    assert.ok(r.aprPct > 0);
  } finally {
    __resetFetch();
  }
});
