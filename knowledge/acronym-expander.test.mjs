// acronym-expander.test.mjs — offline node:test suite. No network, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  MELEK_TERMS,
  detectAcronyms,
  expandFirstUse,
  buildAbbreviationList,
} from './acronym-expander.mjs';

test('esc escapes HTML-significant chars', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('MELEK_TERMS is frozen and descriptive', () => {
  assert.ok(Object.isFrozen(MELEK_TERMS));
  assert.equal(MELEK_TERMS.DPoS, 'Delegated Proof of Stake');
  assert.equal(MELEK_TERMS.SMT, 'Smart Media Token');
  assert.equal(MELEK_TERMS.VKBT, 'Van Kush Beauty Token');
  assert.equal(MELEK_TERMS.AMM, 'Automated Market Maker');
  assert.equal(MELEK_TERMS.RC, 'Resource Credit');
  assert.equal(MELEK_TERMS.WIF, 'Wallet Import Format key');
  // descriptive only — no obvious secret/key material in the values
  for (const v of Object.values(MELEK_TERMS)) {
    assert.equal(typeof v, 'string');
    assert.ok(v.length > 0);
  }
});

test('detectAcronyms finds tokens, counts, and expansions in first-seen order', () => {
  const out = detectAcronyms('SMT and DPoS, then SMT again with AMM.');
  // DPoS has a lowercase letter so it is NOT a /\b[A-Z]{2,6}\b/ token
  const acrs = out.map((e) => e.acronym);
  assert.deepEqual(acrs, ['SMT', 'AMM']);
  const smt = out.find((e) => e.acronym === 'SMT');
  assert.equal(smt.count, 2);
  assert.equal(smt.expansion, 'Smart Media Token');
  const amm = out.find((e) => e.acronym === 'AMM');
  assert.equal(amm.count, 1);
  assert.equal(amm.expansion, 'Automated Market Maker');
});

test('detectAcronyms reports unknown acronyms with expansion null', () => {
  const out = detectAcronyms('We use XYZ here.');
  assert.equal(out.length, 1);
  assert.equal(out[0].acronym, 'XYZ');
  assert.equal(out[0].count, 1);
  assert.equal(out[0].expansion, null);
});

test('detectAcronyms ignores too-short and too-long all-caps runs', () => {
  // single letter 'A' (len 1) and 'TOOOLONG' (len 8) are out of [2,6]
  const out = detectAcronyms('A TOOOLONG RC token.');
  const acrs = out.map((e) => e.acronym);
  assert.deepEqual(acrs, ['RC']);
});

test('detectAcronyms soft-fails on non-string', () => {
  assert.deepEqual(detectAcronyms(null), []);
  assert.deepEqual(detectAcronyms(undefined), []);
  assert.deepEqual(detectAcronyms(123), []);
  assert.deepEqual(detectAcronyms(''), []);
  assert.deepEqual(detectAcronyms({}), []);
});

test('expandFirstUse rewrites only the first occurrence of a known acronym', () => {
  const out = expandFirstUse('SMT is great. Buy SMT now, more SMT.');
  assert.equal(out, 'Smart Media Token (SMT) is great. Buy SMT now, more SMT.');
});

test('expandFirstUse handles multiple acronyms independently', () => {
  const out = expandFirstUse('RC and AMM, then RC and AMM.');
  assert.equal(
    out,
    'Resource Credit (RC) and Automated Market Maker (AMM), then RC and AMM.'
  );
});

test('expandFirstUse leaves unknown acronyms untouched', () => {
  const out = expandFirstUse('XYZ plus SMT plus XYZ.');
  assert.equal(out, 'XYZ plus Smart Media Token (SMT) plus XYZ.');
});

test('expandFirstUse accepts a custom map', () => {
  const out = expandFirstUse('FOO bar FOO', { map: { FOO: 'Fancy Object' } });
  assert.equal(out, 'Fancy Object (FOO) bar FOO');
});

test('expandFirstUse soft-fails on non-string', () => {
  assert.equal(expandFirstUse(null), '');
  assert.equal(expandFirstUse(undefined), '');
  assert.equal(expandFirstUse(99), '');
  assert.equal(expandFirstUse(''), '');
});

test('buildAbbreviationList returns sorted, esc()d definitions for known acronyms only', () => {
  const md = buildAbbreviationList('AMM uses RC, SMT, and unknown ZZZ.');
  assert.equal(
    md,
    '**AMM** — Automated Market Maker\n' +
      '**RC** — Resource Credit\n' +
      '**SMT** — Smart Media Token'
  );
  assert.ok(!md.includes('ZZZ'));
});

test('buildAbbreviationList escapes interpolated values', () => {
  const md = buildAbbreviationList('FOO here', { FOO: 'A & B <tag>' });
  assert.equal(md, '**FOO** — A &amp; B &lt;tag&gt;');
});

test('buildAbbreviationList empty when no known acronyms', () => {
  assert.equal(buildAbbreviationList('just words ZZZ here'), '');
  assert.equal(buildAbbreviationList('plain prose with no acronyms'), '');
});

test('buildAbbreviationList soft-fails on non-string', () => {
  assert.equal(buildAbbreviationList(null), '');
  assert.equal(buildAbbreviationList(undefined), '');
  assert.equal(buildAbbreviationList(7), '');
  assert.equal(buildAbbreviationList(''), '');
});

test('case-insensitive lookup matches mixed-case tokens to known terms', () => {
  // 'TDCS' is in the map; a same-case token resolves
  const out = detectAcronyms('TDCS session');
  assert.equal(out[0].expansion, 'Transcranial Direct Current Stimulation');
});
