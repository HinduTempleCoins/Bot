// chain-compare.test.mjs — offline tests for the TRON-vs-Ethereum honest comparison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAINS, DIMENSIONS, esc, getChain, compare, table, renderCompare,
} from './chain-compare.mjs';

test('CHAINS holds static facts for TRON and Ethereum', () => {
  assert.ok(CHAINS.tron && CHAINS.ethereum);
  assert.match(CHAINS.tron.tokenStandards, /TRC-20/);
  assert.match(CHAINS.tron.tokenStandards, /TRC-10/);
  assert.match(CHAINS.ethereum.tokenStandards, /ERC-20/);
  assert.match(CHAINS.tron.consensus, /Delegated Proof-of-Stake/);
  assert.match(CHAINS.ethereum.consensus, /Proof-of-Stake/);
  assert.match(CHAINS.tron.vm, /TVM/);
  assert.match(CHAINS.ethereum.vm, /EVM/);
});

test('DIMENSIONS covers the required axes', () => {
  const keys = DIMENSIONS.map((d) => d.key);
  for (const k of ['consensus', 'throughput', 'feeTier', 'tokenStandards', 'vm', 'governance']) {
    assert.ok(keys.includes(k), `missing dimension ${k}`);
  }
});

test('getChain resolves by id and by name, case-insensitively', () => {
  assert.equal(getChain('tron'), CHAINS.tron);
  assert.equal(getChain('Ethereum'), CHAINS.ethereum);
  assert.equal(getChain('  TRON '), CHAINS.tron);
  assert.equal(getChain('nope'), null);
  assert.equal(getChain(null), null);
});

test('compare returns aligned rows for each dimension', () => {
  const cmp = compare('tron', 'ethereum');
  assert.equal(cmp.a, 'TRON');
  assert.equal(cmp.b, 'Ethereum');
  assert.equal(cmp.knownA, true);
  assert.equal(cmp.knownB, true);
  assert.equal(cmp.rows.length, DIMENSIONS.length);
  const tokenRow = cmp.rows.find((r) => r.dimension === 'tokenStandards');
  assert.match(tokenRow.a, /TRC-20/);
  assert.match(tokenRow.b, /ERC-20/);
  for (const r of cmp.rows) {
    assert.equal(typeof r.dimension, 'string');
    assert.equal(typeof r.label, 'string');
    assert.equal(typeof r.a, 'string');
    assert.equal(typeof r.b, 'string');
  }
});

test('compare soft-fails on unknown chains to n/a (never throws)', () => {
  const cmp = compare('tron', 'bogus-chain');
  assert.equal(cmp.knownA, true);
  assert.equal(cmp.knownB, false);
  assert.equal(cmp.b, 'bogus-chain');
  for (const r of cmp.rows) assert.equal(r.b, 'n/a');
  // both unknown / null inputs
  const cmp2 = compare(null, undefined);
  assert.equal(cmp2.rows.length, DIMENSIONS.length);
  for (const r of cmp2.rows) {
    assert.equal(r.a, 'n/a');
    assert.equal(r.b, 'n/a');
  }
});

test('table builds a matrix over all chains by default', () => {
  const t = table();
  assert.deepEqual(t.chains.map((c) => c.id).sort(), ['ethereum', 'tron']);
  assert.equal(t.rows.length, DIMENSIONS.length);
  for (const r of t.rows) assert.equal(r.values.length, t.chains.length);
});

test('table accepts an explicit chain list and skips unknowns', () => {
  const t = table(['tron', 'nope']);
  assert.deepEqual(t.chains.map((c) => c.id), ['tron']);
  assert.equal(t.rows[0].values.length, 1);
});

test('renderCompare text default is TRON vs Ethereum and contains facts', () => {
  const out = renderCompare();
  assert.match(out, /TRON vs Ethereum/);
  assert.match(out, /TRC-20/);
  assert.match(out, /ERC-20/);
  assert.ok(!out.includes('<table'));
});

test('renderCompare html escapes interpolation and yields a table', () => {
  const out = renderCompare({ html: true });
  assert.match(out, /<table class="chain-compare">/);
  assert.match(out, /<th>TRON<\/th>/);
  assert.match(out, /<th>Ethereum<\/th>/);
  // unknown chain name with HTML metachars must be escaped, not raw
  const evil = renderCompare({ html: true, a: '<x>"&', b: 'ethereum' });
  assert.ok(!evil.includes('<x>'));
  assert.match(evil, /&lt;x&gt;&quot;&amp;/);
});

test('esc handles nullish and metacharacters', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});
