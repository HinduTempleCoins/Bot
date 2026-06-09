// Offline test for trading-knowledge.mjs — reads the committed knowledge/trading/*.json (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strategies, watchlist, watchSymbols, arbitrageCases, recommend, briefBlock, __reset } from './trading-knowledge.mjs';

test('loads the compiled deep-dive JSONs', () => {
  __reset();
  assert.ok(strategies().length >= 5, 'has the intraday playbook');
  assert.ok(watchlist().length >= 3, 'has a volatile-coin watchlist');
  assert.ok(arbitrageCases().length >= 3, 'has arbitrage cases');
});

test('watchlist US filter + symbols', () => {
  const all = watchlist();
  const us = watchlist({ usOnly: true });
  assert.ok(us.length <= all.length);
  assert.ok(us.every((c) => c.usTradeable), 'usOnly returns only US-tradeable');
  assert.ok(watchSymbols().every((s) => typeof s === 'string'));
});

test('arbitrage replicable filter', () => {
  const repl = arbitrageCases({ replicableOnly: true });
  assert.ok(repl.every((c) => c.replicableAtSmallSize), 'replicableOnly is honest');
  assert.ok(repl.length <= arbitrageCases().length);
});

test('recommend(ranging) favors mean-reversion/range and avoids scalping (our thin-book bias)', () => {
  const r = recommend({ regime: 'ranging' });
  assert.equal(r.regime, 'ranging');
  assert.ok(r.fit.length > 0, 'has fit strategies');
  const names = r.fit.map((s) => s.name.toLowerCase()).join(' ');
  assert.ok(/range|mean-reversion|vwap/.test(names), 'range/mean-reversion/vwap surfaced');
  assert.ok(!r.fit.some((s) => /scalp/.test(s.name.toLowerCase())), 'scalping NOT in fit');
  assert.ok(r.avoid.some((n) => /scalp/.test(n.toLowerCase())), 'scalping flagged avoid');
  assert.ok(r.riskRules.length > 0, 'carries the risk rules');
});

test('briefBlock renders advisory-only block with watchlist + default play', () => {
  const b = briefBlock();
  assert.match(b, /Trade knowledge/);
  assert.match(b, /Advisory only/);
  assert.match(b, /Watch/);
});
