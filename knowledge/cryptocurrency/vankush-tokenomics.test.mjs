import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  TOKENS,
  bySymbol,
  byChain,
  list,
  search,
  renderTable,
} from './vankush-tokenomics.mjs';

test('TOKENS covers the six Van Kush tokens', () => {
  assert.deepEqual(list().sort(), ['CURE', 'DFB', 'DFC', 'PUCO', 'PUTI', 'VKBT']);
  assert.equal(TOKENS.length, 6);
});

test('bySymbol hit (exact)', () => {
  const r = bySymbol('PUCO');
  assert.ok(r);
  assert.equal(r.name, 'Punic Copper');
  assert.equal(r.chain, 'TRON');
  assert.match(r.supplyNote, /350M|350,?000,?000/);
});

test('bySymbol case-insensitive + whitespace', () => {
  assert.equal(bySymbol('puti').symbol, 'PUTI');
  assert.equal(bySymbol('  Cure  ').symbol, 'CURE');
});

test('bySymbol miss and soft-fail inputs return null', () => {
  assert.equal(bySymbol('NOPE'), null);
  assert.equal(bySymbol(null), null);
  assert.equal(bySymbol(undefined), null);
  assert.equal(bySymbol(''), null);
  assert.equal(bySymbol('   '), null);
});

test('byChain filters case-insensitively', () => {
  const hive = byChain('HIVE-Engine');
  assert.deepEqual(hive.map((t) => t.symbol).sort(), ['CURE', 'VKBT']);
  assert.equal(byChain('polygon').length, 2);
  assert.equal(byChain('tron')[0].symbol, 'PUCO');
});

test('byChain soft-fail', () => {
  assert.deepEqual(byChain('atlantis'), []);
  assert.deepEqual(byChain(null), []);
  assert.deepEqual(byChain(''), []);
});

test('search matches across fields, soft-fails on empty', () => {
  assert.ok(search('burn').some((t) => t.symbol === 'DFB'));
  assert.ok(search('1 token per minute').some((t) => t.symbol === 'PUTI'));
  assert.deepEqual(search('zzzznomatch'), []);
  assert.deepEqual(search(null), []);
  assert.deepEqual(search(''), []);
});

test('renderTable markdown branch is deterministic', () => {
  const md = renderTable();
  assert.equal(md, renderTable({ html: false }));
  assert.match(md, /^\| Symbol \| Name \| Chain \| Mechanism \| Supply \|/);
  assert.ok(md.includes('PUCO'));
  assert.ok(md.includes('TRON'));
  // 1 header + 1 separator + 6 rows
  assert.equal(md.split('\n').length, 8);
});

test('renderTable HTML branch escapes interpolation', () => {
  const html = renderTable({ html: true });
  assert.ok(html.startsWith('<table>'));
  assert.ok(html.includes('<th>Symbol</th>'));
  assert.ok(html.includes('<td>PUCO</td>'));
  // no raw unescaped angle brackets from data leaking structure
  assert.ok(!html.includes('<script'));
});

test('esc neutralizes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('records are deeply immutable', () => {
  assert.ok(Object.isFrozen(TOKENS));
  assert.ok(TOKENS.every((t) => Object.isFrozen(t)));
  const r = bySymbol('VKBT');
  assert.throws(() => {
    'use strict';
    r.chain = 'tampered';
  }, TypeError);
  assert.equal(bySymbol('VKBT').chain, 'HIVE-Engine');
});
