// cross-platform.test.mjs — per-chain karma + the cross-platform composite. OFFLINE: injected read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineKarma, karmaOnChain, crossPlatformKarma } from './cross-platform.mjs';

test('combineKarma is noisy-OR: aggregates standing across platforms, bounded 0..100', () => {
  assert.equal(combineKarma([]), 0);
  assert.equal(combineKarma([50]), 50);                 // one platform → itself
  assert.equal(combineKarma([50, 50]), 75);             // two at 50 → 75 (1 - .5·.5)
  assert.equal(combineKarma([100, 30]), 100);           // maxed anywhere → 100
  assert.ok(combineKarma([40, 40, 40]) > combineKarma([40, 40])); // more places → higher
  assert.equal(combineKarma([0, 0]), 0);
  assert.ok(combineKarma([120, -5]) === 100 || combineKarma([120, -5]) <= 100); // clamps junk
});

test('karmaOnChain scores an account on a given chain via the injected reader', async () => {
  const read = async (acc) => ({ account: acc, postCount: 50, commentCount: 200, upvotesGiven: 100, selfVotes: 0, accountAgeDays: 400, reputation: 60 });
  const k = await karmaOnChain({ account: 'Sol', rpcUrl: 'http://hive' }, { read });
  assert.equal(k.account, 'sol');
  assert.ok(k.score > 0 && k.score <= 100);
  assert.ok(typeof k.components.teaches === 'number');
});

test('crossPlatformKarma scores each linked chain and composites them onto one identity', async () => {
  const per = {
    'sol@hive': { postCount: 100, commentCount: 400, upvotesGiven: 200, accountAgeDays: 800, reputation: 70 },
    'sol@melek': { postCount: 10, commentCount: 30, upvotesGiven: 20, accountAgeDays: 30, reputation: 25 },
  };
  const read = async (acc, { rpcUrl }) => ({ account: acc, ...(per[`${acc}@${rpcUrl.includes('hive') ? 'hive' : 'melek'}`] || {}) });
  const r = await crossPlatformKarma([
    { chain: 'hive', account: 'sol', rpcUrl: 'http://hive' },
    { chain: 'melek', account: 'sol', rpcUrl: 'http://melek' },
  ], { read });
  assert.equal(r.platforms.length, 2);
  const hive = r.platforms.find((p) => p.chain === 'hive');
  const melek = r.platforms.find((p) => p.chain === 'melek');
  assert.ok(hive.score > melek.score, 'more activity on hive → higher there');
  assert.ok(r.composite >= hive.score, 'composite aggregates ≥ the best platform');
});

test('a dead/unknown link contributes 0, never throws', async () => {
  const read = async () => { throw new Error('rpc down'); };
  const r = await crossPlatformKarma([{ chain: 'steem', account: 'ghost', rpcUrl: 'http://x' }], { read });
  assert.equal(r.platforms[0].score, 0);
  assert.equal(r.composite, 0);
});
