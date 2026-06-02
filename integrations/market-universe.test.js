// market-universe.test.js — proves the universe builder pages the whole table, ranks by volume,
// and the snapshot totals/movers are correct. The he-client `find` is injected (setFind), so
// NO network and no experimental module-mock flag is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// configure BEFORE importing the module under test
process.env.HE_UNIVERSE_PAGE = '2';        // force pagination at 2 rows/page
process.env.HE_UNIVERSE_MEMO_TTL_MS = '0'; // disable the in-process memo so each test pulls fresh

const { allTokens, allMarketMetrics, topByVolume, marketSnapshot, setFind } =
  await import('./market-universe.mjs');

// fake tables keyed by _id
const TOKENS = [
  { _id: 1, symbol: 'AAA', name: 'Alpha', issuer: 'me', precision: 8, supply: '1000', circulatingSupply: '800', maxSupply: '5000', stakingEnabled: true },
  { _id: 2, symbol: 'BBB', name: 'Beta', issuer: 'you', precision: 3, supply: '50', circulatingSupply: '50', maxSupply: '100' },
  { _id: 3, symbol: 'CCC', name: 'Gamma', issuer: 'them', precision: 0, supply: '10', circulatingSupply: '10', maxSupply: '10' },
];
const METRICS = [
  { _id: 1, symbol: 'AAA', volume: '100.5', lastPrice: '2.0', lowestAsk: '2.1', highestBid: '1.9', lastDayPrice: '1.8', priceChangePercent: '11.1%', priceChangeHive: '0.2' },
  { _id: 2, symbol: 'BBB', volume: '500.0', lastPrice: '0.10', lowestAsk: '0.11', highestBid: '0.09', lastDayPrice: '0.20', priceChangePercent: '-50.0%', priceChangeHive: '-0.1' },
  { _id: 3, symbol: 'CCC', volume: '0', lastPrice: '5.0', lowestAsk: '0', highestBid: '0', lastDayPrice: '5.0', priceChangePercent: '0%', priceChangeHive: '0' },
];

// cursor-aware fake find: honours { _id: { $gt: n } } + limit, ignores other queries
function fakeFind(contract, table, query = {}, limit = 1000) {
  const src = table === 'tokens' ? TOKENS : table === 'metrics' ? METRICS : [];
  const gt = query && query._id && typeof query._id.$gt === 'number' ? query._id.$gt : 0;
  return Promise.resolve(src.filter(r => r._id > gt).slice(0, limit));
}

test('allTokens pages the full table and normalises numbers', async () => {
  setFind(fakeFind);
  const t = await allTokens();
  assert.equal(t.length, 3, 'all 3 tokens despite 2-row pages');
  const aaa = t.find(x => x.symbol === 'AAA');
  assert.equal(aaa.supply, 1000);
  assert.equal(aaa.circulatingSupply, 800);
  assert.equal(aaa.stakingEnabled, true);
  assert.equal(t.find(x => x.symbol === 'BBB').stakingEnabled, false);
});

test('allMarketMetrics joins token + parses %chg + ranks by volume', async () => {
  setFind(fakeFind);
  const m = await allMarketMetrics();
  assert.equal(m.length, 3);
  assert.equal(m[0].symbol, 'BBB', 'highest volume first');
  assert.equal(m[0].volume, 500);
  assert.equal(m[0].priceChangePercent, -50, '"-50.0%" parsed to number');
  // marketCap = circulatingSupply * lastPrice : AAA 800 * 2.0
  const aaa = m.find(x => x.symbol === 'AAA');
  assert.equal(aaa.marketCap, 1600);
  assert.equal(aaa.name, 'Alpha', 'name joined from token table');
});

test('topByVolume drops zero-volume markets and respects N', async () => {
  setFind(fakeFind);
  const top = await topByVolume(5);
  assert.equal(top.length, 2, 'CCC has 0 volume, excluded');
  assert.deepEqual(top.map(r => r.symbol), ['BBB', 'AAA']);
  const one = await topByVolume(1);
  assert.equal(one.length, 1);
  assert.equal(one[0].symbol, 'BBB');
});

test('marketSnapshot totals + movers are correct', async () => {
  setFind(fakeFind);
  const s = await marketSnapshot({ topN: 10 });
  assert.equal(s.totalTokens, 3);
  assert.equal(s.totalMarkets, 3);
  assert.equal(s.activeMarkets, 2, 'only volume>0 markets are "active"');
  assert.equal(s.totalVolumeHive, 600.5, '100.5 + 500');
  assert.equal(s.topVolume[0].symbol, 'BBB');
  assert.equal(s.topGainers[0].symbol, 'AAA', 'AAA +11.1% is top gainer');
  assert.equal(s.topLosers[0].symbol, 'BBB', 'BBB -50% is top loser');
});

test('best-effort: a throwing find yields empty shapes, never throws', async () => {
  setFind(async () => { throw new Error('node down'); });
  assert.deepEqual(await allTokens(), []);
  assert.deepEqual(await allMarketMetrics(), []);
  const s = await marketSnapshot();
  assert.equal(s.totalTokens, 0);
  assert.equal(s.totalVolumeHive, 0);
  setFind(fakeFind); // restore for any later test
});
