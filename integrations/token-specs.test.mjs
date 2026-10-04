import { test } from 'node:test';
import assert from 'node:assert';
import { TOKEN_SPECS, SPEC_DIMENSIONS, specsTable, tokensOn, sources } from './token-specs.mjs';

test('the specs are the tokenomics dimensions, not chain dimensions', () => {
  const keys = SPEC_DIMENSIONS.map((d) => d.key);
  for (const must of ['supply', 'holders', 'concentration', 'emission']) assert.ok(keys.includes(must), must);
  for (const never of ['consensus', 'vm', 'throughput']) assert.equal(keys.includes(never), false, `${never} describes a chain, not a token`);
});

test("the operator's recorded numbers are carried exactly", () => {
  assert.equal(TOKEN_SPECS.vkbt.supply, '1,900,000');
  assert.equal(TOKEN_SPECS.vkbt.holders, '986');
  assert.match(TOKEN_SPECS.vkbt.concentration, /42%/);
  assert.equal(TOKEN_SPECS.cure.supply, '55,575');
  assert.equal(TOKEN_SPECS.cure.holders, '999');
  assert.match(TOKEN_SPECS.cure.concentration, /58%/);
  assert.equal(TOKEN_SPECS.vkbt.capAtParity, '$579,000');
  assert.equal(TOKEN_SPECS.cure.capAtParity, '$16,700');
});

test('⭐ every recorded figure cites a source — an unsourced spec is never invented', () => {
  for (const [id, t] of Object.entries(TOKEN_SPECS)) {
    assert.ok(t.source && t.source.length > 6, `${id} must cite where its numbers came from`);
  }
  assert.ok(sources().length >= 1);
});

test('a missing figure renders as a dash, not as a guess', () => {
  const t = specsTable(['pob']);
  const supply = t.rows.find((r) => r.dimension === 'supply').values[0];
  assert.equal(supply, '—');
  const holders = t.rows.find((r) => r.dimension === 'holders').values[0];
  assert.equal(holders, '—');
});

test('the table keeps order, skips unknowns, and defaults to everything recorded', () => {
  const t = specsTable(['cure', 'vkbt', 'not-a-token']);
  assert.deepEqual(t.tokens.map((x) => x.id), ['cure', 'vkbt']);
  for (const r of t.rows) assert.equal(r.values.length, 2);
  assert.equal(specsTable().tokens.length, Object.keys(TOKEN_SPECS).length);
});

test('⭐ a purchased position is recorded as purchased, and distribution is recorded too', () => {
  for (const id of ['vkbt', 'cure']) {
    assert.match(TOKEN_SPECS[id].acquired, /Purchased/, `${id} was bought at market, not allocated`);
    assert.match(TOKEN_SPECS[id].distribution, /curation/i, `${id} is given away, not held static`);
  }
  const keys = SPEC_DIMENSIONS.map((d) => d.key);
  assert.ok(keys.includes('acquired'), 'how a position was acquired is a spec in its own right');
  assert.ok(keys.includes('distribution'));
  // the label must not imply a founder allocation
  assert.equal(SPEC_DIMENSIONS.find((d) => d.key === 'concentration').label.includes('Team-held'), false);
});

test('side tokens and chain coins are not conflated', () => {
  assert.match(TOKEN_SPECS.vkbt.layer, /side token/);
  assert.match(TOKEN_SPECS.blurt.layer, /Chain coin/);
  assert.equal(tokensOn('Hive-Engine side token').every((t) => t.layer === 'Hive-Engine side token'), true);
  // fixed-supply vs inflationary is the distinction that matters most for a holder
  assert.match(TOKEN_SPECS.vkbt.emission, /Fixed/);
  assert.match(TOKEN_SPECS.pob.emission, /Inflationary/);
});
