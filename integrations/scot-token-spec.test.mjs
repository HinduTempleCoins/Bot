// scot-token-spec.test.mjs — offline, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTokenSpec,
  validateTokenSpec,
  renderSpec,
  esc,
  DEFAULT_TAGS,
} from './scot-token-spec.mjs';

test('buildTokenSpec normalizes symbol and derives curator split from author', () => {
  const s = buildTokenSpec({ symbol: 'vkush', name: 'Van Kush', precision: 3, authorPct: 60 });
  assert.equal(s.symbol, 'VKUSH');
  assert.equal(s.authorPct, 60);
  assert.equal(s.curatorPct, 40);
  assert.equal(s.authorPct + s.curatorPct, 100);
});

test('buildTokenSpec defaults split to 50/50 and tags to DEFAULT_TAGS', () => {
  const s = buildTokenSpec({ symbol: 'PUNIC', name: 'Punic Wax' });
  assert.equal(s.authorPct, 50);
  assert.equal(s.curatorPct, 50);
  assert.deepEqual(s.tags, DEFAULT_TAGS);
  assert.notStrictEqual(s.tags, DEFAULT_TAGS); // returns a copy, not the shared array
});

test('buildTokenSpec derives author from curator when only curator given', () => {
  const s = buildTokenSpec({ symbol: 'ABC', name: 'x', curatorPct: 25 });
  assert.equal(s.curatorPct, 25);
  assert.equal(s.authorPct, 75);
});

test('buildTokenSpec strips #, lowercases, and dedupes tags preserving order', () => {
  const s = buildTokenSpec({ symbol: 'ABC', name: 'x', tags: ['#VanKush', 'cryptology', 'vankush'] });
  assert.deepEqual(s.tags, ['vankush', 'cryptology']);
});

test('buildTokenSpec is deterministic', () => {
  const inp = { symbol: 'XYZ', name: 'X', precision: 2, maxSupply: 100, authorPct: 70 };
  assert.deepEqual(buildTokenSpec(inp), buildTokenSpec(inp));
});

test('validateTokenSpec accepts a clean spec', () => {
  const s = buildTokenSpec({ symbol: 'VKUSH', name: 'Van Kush', precision: 3, maxSupply: 1e9, authorPct: 60, stakeApr: 10 });
  const v = validateTokenSpec(s);
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test('validateTokenSpec flags bad symbol, precision, supply, split, and tags', () => {
  const v = validateTokenSpec({
    symbol: '1bad',
    name: '',
    precision: 12,
    maxSupply: -5,
    authorPct: 60,
    curatorPct: 60,        // sum 120, not 100
    stakeApr: -1,
    tags: ['notallowed'],
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /symbol/.test(e)));
  assert.ok(v.errors.some((e) => /name/.test(e)));
  assert.ok(v.errors.some((e) => /precision/.test(e)));
  assert.ok(v.errors.some((e) => /maxSupply/.test(e)));
  assert.ok(v.errors.some((e) => /sum to 100/.test(e)));
  assert.ok(v.errors.some((e) => /stakeApr/.test(e)));
  assert.ok(v.errors.some((e) => /invalid tag/.test(e)));
});

test('validateTokenSpec rejects empty tag list', () => {
  const s = buildTokenSpec({ symbol: 'ABC', name: 'x', tags: [] });
  // build leaves [] as-is (not default, since an array was supplied)
  assert.deepEqual(s.tags, []);
  const v = validateTokenSpec(s);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /non-empty/.test(e)));
});

test('soft-fail: garbage input never throws', () => {
  assert.doesNotThrow(() => buildTokenSpec(null));
  assert.doesNotThrow(() => buildTokenSpec(undefined));
  assert.doesNotThrow(() => buildTokenSpec(42));
  assert.doesNotThrow(() => validateTokenSpec(null));
  assert.doesNotThrow(() => validateTokenSpec('nope'));
  assert.doesNotThrow(() => renderSpec(null));
  assert.doesNotThrow(() => renderSpec({ spec: {} }));
  const v = validateTokenSpec(null);
  assert.equal(v.ok, false);
  assert.ok(Array.isArray(v.errors) && v.errors.length > 0);
});

test('renderSpec html escapes interpolation', () => {
  const s = buildTokenSpec({ symbol: 'ABC', name: '<script>x</script>', precision: 2, maxSupply: 1, authorPct: 50 });
  const html = renderSpec({ spec: s, html: true });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>x'));
});

test('renderSpec text shows errors for invalid spec', () => {
  const out = renderSpec({ spec: { symbol: '1', name: '', precision: 99, maxSupply: -1, authorPct: 10, curatorPct: 10, stakeApr: 0, tags: [] } });
  assert.ok(out.includes('Valid: no'));
  assert.ok(out.includes('Errors:'));
});

test('esc handles nullish', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc('a&b'), 'a&amp;b');
});

test('precision 0 and 8 are valid boundaries', () => {
  assert.equal(validateTokenSpec(buildTokenSpec({ symbol: 'ABC', name: 'x', precision: 0 })).ok, true);
  assert.equal(validateTokenSpec(buildTokenSpec({ symbol: 'ABC', name: 'x', precision: 8 })).ok, true);
});
