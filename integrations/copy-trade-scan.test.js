// copy-trade-scan.test.js — network-free unit tests for the pure logic of the copy-trade scanner
// (#192). Proves the symbol mapping, direction sniffer, mimickable filter/ranking, and the
// standing "skim bucket, not core capital" funding rule, without touching any source site.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTvSymbol, sniffDirection, mimickable, COPY_SOURCES, KEYLESS_SOURCES } from './copy-trade-scan.mjs';

test('COPY_SOURCES catalogues the named copy-trade venues with access tiers', () => {
  const names = COPY_SOURCES.map((s) => s.name).join(' ');
  for (const v of ['TradingView', 'Myfxbook', 'ZuluTrade', 'eToro', '3Commas']) assert.match(names, new RegExp(v));
  for (const s of COPY_SOURCES) assert.ok(['keyless', 'scrape', 'keyed'].includes(s.access), `${s.name} has a valid access tier`);
  assert.ok(KEYLESS_SOURCES.includes('TradingView — symbol ideas'), 'TradingView is keyless-pullable');
});

test('toTvSymbol maps crypto/forex/stock queries to plausible TradingView slugs', () => {
  assert.equal(toTvSymbol('BTC', 'crypto'), 'BTCUSD');
  assert.equal(toTvSymbol('ETHUSDT', 'crypto'), 'ETHUSDT');   // already quoted → unchanged
  assert.equal(toTvSymbol('EURUSD', 'forex'), 'EURUSD');
  assert.equal(toTvSymbol('AAPL', 'stocks'), 'AAPL');         // bare ticker as-is
  assert.equal(toTvSymbol('', 'crypto'), '');
});

test('sniffDirection reads long/short or returns null when neutral', () => {
  assert.equal(sniffDirection('Bullish breakout, going long on BTC'), 'long');
  assert.equal(sniffDirection('bearish, time to short this dump'), 'short');
  assert.equal(sniffDirection('just some neutral commentary about markets'), null);
});

test('mimickable keeps only directional, credible-source ideas and ranks them', () => {
  const ideas = [
    { source: 'TradingView', asset: 'crypto', direction: 'long', entry: 65000, target: 70000, url: 'https://www.tradingview.com/chart/x/' },
    { source: 'random-blog.xyz', asset: 'crypto', direction: 'long', entry: null, target: null, url: 'https://random-blog.xyz/p' }, // not credible → dropped
    { source: 'myfxbook.com', asset: 'forex', direction: 'short', entry: null, target: null, url: 'https://www.myfxbook.com/community/outlook' },
    { source: 'web', asset: 'crypto', direction: null, url: 'https://x.com' },  // no direction → dropped
  ];
  const out = mimickable(ideas);
  assert.equal(out.length, 2, 'only the two credible, directional ideas survive');
  assert.equal(out[0].source, 'TradingView', 'the concrete entry+target TradingView idea ranks first');
  assert.ok(out[0].confidence > out[1].confidence, 'concreteness raises confidence');
});

test('every mimickable candidate carries the skim-bucket funding rule', () => {
  const out = mimickable([{ source: 'TradingView', asset: 'crypto', direction: 'long', entry: 100, url: 'https://www.tradingview.com/chart/x/' }]);
  assert.equal(out[0].funding, 'skim-bucket-only');
  assert.match(out[0].note, /skim bucket|war chest/i);
  assert.match(out[0].note, /never from core capital/i);
});

test('mimickable is safe on empty / junk input', () => {
  assert.deepEqual(mimickable(), []);
  assert.deepEqual(mimickable([null, {}, { direction: 'long' }]), []); // no credible source → dropped
});
