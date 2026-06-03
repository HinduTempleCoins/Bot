// trade-analyzer.test.mjs — covers the pure categorization/filter/group/rank layer added on
// top of the flat-string `findings`. The analyze() pipeline itself hits the chain/market and
// is exercised by tradebot-forensics tests + live runs; here we prove the deterministic
// helpers (CATEGORIES, categorizeFinding, filterFindings, groupFindings, rankFindings) so the
// bleed (SWAP.LTC) reads as 'bleed' and the wins (SWAP.BLURT/DOGE arbitrage) read as
// 'win'/'arbitrage' — the legibility this task is about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, categorizeFinding, filterFindings, groupFindings, rankFindings,
} from './trade-analyzer.mjs';

// Fixtures shaped like the structured findings analyze() now emits.
const bleed = { text: 'SINK: SWAP.LTC lost 6424 HIVE …', kind: 'sink', token: 'SWAP.LTC', net: -6424, severity: 'high', impact: 6424 };
const win   = { text: 'WORKS: SWAP.BLURT netted +900 HIVE …', kind: 'works', token: 'SWAP.BLURT', net: 900, severity: 'medium', impact: 900 };
const arb   = { text: 'LIVE ARB: SWAP.DOGE — 7% edge …', kind: 'arb', token: 'SWAP.DOGE', edgePct: 7, realUsd: 0.12, severity: 'high', impact: 7 };
const stuck = { text: 'STUCK: KALI held 1e6 but <1 HIVE …', kind: 'stuck', token: 'KALI', held: 1e6, heldHive: 0.4, spread: 0.8, severity: 'low', impact: 0.4 };
const conc  = { text: 'OWNERSHIP: KALI is 98% self-held …', kind: 'ownership', token: 'KALI', issuerPct: 98, outsideHolders: 2, severity: 'high', impact: 98 };

test('CATEGORIES is a frozen, non-empty taxonomy with the key categories', () => {
  assert.ok(Array.isArray(CATEGORIES) && CATEGORIES.length > 0);
  assert.ok(Object.isFrozen(CATEGORIES));
  for (const c of ['bleed', 'win', 'arbitrage', 'concentration-risk', 'idle-capital', 'opportunity'])
    assert.ok(CATEGORIES.includes(c), `missing ${c}`);
});

test('categorizeFinding tags a loss as bleed', () => {
  const cats = categorizeFinding(bleed);
  assert.ok(cats.includes('bleed'), 'loss should be bleed');
  assert.ok(!cats.includes('win'), 'a loss is not a win');
});

test('categorizeFinding tags a recurring profitable pair as arbitrage/win', () => {
  assert.deepEqual(categorizeFinding(win).sort(), ['arbitrage', 'win']);
  const a = categorizeFinding(arb);
  assert.ok(a.includes('arbitrage'), 'arb edge is arbitrage');
  assert.ok(a.includes('opportunity'), 'arb edge is an opportunity');
});

test('categorizeFinding reads numeric signals: spread→slippage, self-held→concentration, frozen→idle', () => {
  const s = categorizeFinding(stuck);
  assert.ok(s.includes('slippage'), 'wide spread is slippage');
  assert.ok(s.includes('idle-capital'), 'frozen bag is idle-capital');
  assert.ok(categorizeFinding(conc).includes('concentration-risk'), 'self-held is concentration-risk');
});

test('categorizeFinding accepts a plain string (parses the TAG: prefix) and is pure', () => {
  assert.ok(categorizeFinding('SINK: SWAP.LTC lost 6424 HIVE — pure bleed.').includes('bleed'));
  assert.ok(categorizeFinding('LIVE ARB: SWAP.DOGE — 7% edge').includes('arbitrage'));
  // pure: does not mutate the input object
  const input = { ...win };
  const before = JSON.stringify(input);
  categorizeFinding(input);
  assert.equal(JSON.stringify(input), before, 'input must not be mutated');
});

test('categorizeFinding returns only known categories, in stable order, for junk input', () => {
  assert.deepEqual(categorizeFinding({}), []);
  assert.deepEqual(categorizeFinding(null), []);
  const cats = categorizeFinding(arb);
  assert.deepEqual(cats, CATEGORIES.filter((c) => cats.includes(c)), 'order matches CATEGORIES');
});

const all = [bleed, win, arb, stuck, conc];

test('filterFindings filters by category', () => {
  const bleeds = filterFindings(all, { category: 'bleed' });
  assert.deepEqual(bleeds.map((f) => f.token), ['SWAP.LTC']);
  const wins = filterFindings(all, { category: 'win' });
  assert.ok(wins.every((f) => categorizeFinding(f).includes('win')));
  assert.ok(wins.some((f) => f.token === 'SWAP.BLURT'));
  // array of categories = OR match (SWAP.BLURT is a 'works' win → also tagged arbitrage)
  const either = filterFindings(all, { category: ['bleed', 'idle-capital'] });
  assert.deepEqual(either.map((f) => f.token).sort(), ['KALI', 'SWAP.LTC']);
});

test('filterFindings filters by token', () => {
  const kali = filterFindings(all, { token: 'KALI' });
  assert.equal(kali.length, 2);
  assert.ok(kali.every((f) => f.token === 'KALI'));
});

test('filterFindings filters by minSeverity and sinceTs', () => {
  const hi = filterFindings(all, { minSeverity: 'high' });
  assert.ok(hi.every((f) => f.severity === 'high'));
  assert.ok(hi.some((f) => f.token === 'SWAP.LTC'));
  const tsd = [{ token: 'A', ts: 100 }, { token: 'B', ts: 300 }];
  assert.deepEqual(filterFindings(tsd, { sinceTs: 200 }).map((f) => f.token), ['B']);
});

test('filterFindings soft-fails on non-array input', () => {
  assert.deepEqual(filterFindings(null, { category: 'bleed' }), []);
  assert.deepEqual(filterFindings(undefined), []);
});

test('groupFindings nets bleed vs win and groups by category + token', () => {
  const g = groupFindings(all);
  assert.equal(g.summary.bleed, 6424);
  assert.equal(g.summary.win, 900);
  assert.equal(g.summary.net, 900 - 6424);
  assert.ok(g.byCategory.bleed.some((f) => f.token === 'SWAP.LTC'));
  assert.ok(g.byCategory.arbitrage.some((f) => f.token === 'SWAP.DOGE'));
  assert.equal(g.byToken['KALI'].length, 2);
});

test('groupFindings soft-fails on non-array input', () => {
  const g = groupFindings(undefined);
  assert.deepEqual(g.summary, { bleed: 0, win: 0, net: 0 });
  assert.deepEqual(g.byCategory, {});
  assert.deepEqual(g.byToken, {});
});

test('rankFindings orders by severity then impact, descending, without mutating input', () => {
  const input = [stuck, win, bleed, conc, arb];
  const snapshot = input.map((f) => f.token);
  const ranked = rankFindings(input);
  // highest severity (high) first; among highs, biggest impact (LTC 6424) leads
  assert.equal(ranked[0].token, 'SWAP.LTC');
  assert.equal(ranked[ranked.length - 1].token, 'KALI'); // 'low' severity, tiny impact
  // severity is non-increasing across the ranking
  const rank = { high: 3, medium: 2, low: 1 };
  for (let i = 1; i < ranked.length; i++)
    assert.ok(rank[ranked[i - 1].severity] >= rank[ranked[i].severity], 'severity non-increasing');
  assert.deepEqual(input.map((f) => f.token), snapshot, 'rankFindings must not mutate input');
});

test('helpers are deterministic — identical output across repeated calls', () => {
  assert.deepEqual(categorizeFinding(arb), categorizeFinding(arb));
  assert.deepEqual(filterFindings(all, { category: 'win' }), filterFindings(all, { category: 'win' }));
  assert.deepEqual(groupFindings(all), groupFindings(all));
  assert.deepEqual(rankFindings(all).map((f) => f.token), rankFindings(all).map((f) => f.token));
});
