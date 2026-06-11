// token-registry.test.mjs — offline tests for the Van Kush token registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, TOKENS, getToken, list, byChain, byKind, search, renderMarkdown,
} from './token-registry.mjs';

test('esc() escapes HTML-significant chars and coerces null/undefined', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('TOKENS is frozen, non-empty, and well-shaped', () => {
  assert.ok(Object.isFrozen(TOKENS));
  assert.ok(TOKENS.length >= 6);
  const kinds = new Set(['curation', 'burn-mine', 'utility', 'governance']);
  for (const t of TOKENS) {
    assert.ok(Object.isFrozen(t));
    assert.equal(typeof t.symbol, 'string');
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.chain, 'string');
    assert.ok(kinds.has(t.kind), `unexpected kind ${t.kind}`);
    assert.equal(typeof t.summary, 'string');
    assert.equal(typeof t.mechanics, 'string');
    assert.ok(Array.isArray(t.tags));
  }
  // mutation attempt does not throw and does not mutate (frozen)
  assert.throws(() => { 'use strict'; TOKENS.push({}); });
});

test('the core symbols are all present', () => {
  const syms = list();
  for (const s of ['VKBT', 'CURE', 'PUCO', 'PUTI', 'DFB', 'DFC']) {
    assert.ok(syms.includes(s), `missing ${s}`);
  }
});

test('getToken() is case-insensitive and soft-fails to null', () => {
  assert.equal(getToken('CURE').name, 'CURE (Curation Rewards Token)');
  assert.equal(getToken('cure').symbol, 'CURE');
  assert.equal(getToken('  PuCo  ').symbol, 'PUCO');
  assert.equal(getToken('NOPE'), null);
  assert.equal(getToken(''), null);
  assert.equal(getToken(null), null);
  assert.equal(getToken(123), null);
  assert.equal(getToken(undefined), null);
});

test('byChain() filters case-insensitively; [] on miss/bad input', () => {
  const hive = byChain('HIVE-Engine');
  assert.ok(hive.length >= 2);
  assert.ok(hive.every((t) => t.chain === 'HIVE-Engine'));
  assert.equal(byChain('polygon').length, 2); // DFB + DFC
  assert.deepEqual(byChain('Solana'), []);
  assert.deepEqual(byChain(''), []);
  assert.deepEqual(byChain(null), []);
  assert.deepEqual(byChain(99), []);
});

test('byKind() filters case-insensitively; [] on miss/bad input', () => {
  assert.equal(byKind('burn-mine').length, 2);
  assert.ok(byKind('CURATION').length >= 1);
  assert.deepEqual(byKind('nonsense'), []);
  assert.deepEqual(byKind(''), []);
  assert.deepEqual(byKind(undefined), []);
});

test('search() matches symbol/name/summary/tags; "" and bad input -> []', () => {
  assert.ok(search('VKBT').some((t) => t.symbol === 'VKBT'));        // symbol
  assert.ok(search('punic').some((t) => t.symbol === 'PUCO'));        // name + tag
  assert.ok(search('curation').length >= 1);                          // summary
  assert.ok(search('sunswap').some((t) => t.symbol === 'PUCO'));      // tag
});

test('search() empty/bad input returns empty array', () => {
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('   '), []);
  assert.deepEqual(search(null), []);
  assert.deepEqual(search(42), []);
  assert.deepEqual(search('zzzz-no-match'), []);
});

test('renderMarkdown() default renders a header + one row per token', () => {
  const md = renderMarkdown();
  assert.ok(md.startsWith('| Symbol | Name | Chain | Kind | Summary |'));
  const lines = md.split('\n');
  assert.equal(lines.length, 2 + TOKENS.length); // header + separator + rows
  assert.ok(md.includes('CURE'));
  assert.ok(md.includes('Punic Copper'));
});

test('renderMarkdown() escapes/sanitizes and handles empty + bad rows', () => {
  const md = renderMarkdown({ rows: [] });
  assert.ok(md.includes('_(none)_'));
  // bad rows arg -> treated as empty, never throws
  assert.ok(renderMarkdown({ rows: null }).includes('_(none)_'));
  assert.ok(renderMarkdown(null).includes('Symbol')); // default param survives null arg? null -> destructure throws? guard:
});

test('renderMarkdown(undefined) uses default rows', () => {
  const md = renderMarkdown(undefined);
  assert.ok(md.includes('VKBT'));
});

test('renderMarkdown escapes pipes and HTML in custom rows', () => {
  const md = renderMarkdown({
    rows: [{ symbol: 'X|Y', name: '<b>', chain: 'C', kind: 'utility', summary: 'a\nb' }],
  });
  assert.ok(md.includes('X\\|Y'));
  assert.ok(md.includes('&lt;b&gt;'));
  assert.ok(!md.includes('a\nb')); // newline collapsed to space
});
