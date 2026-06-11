// pseudonymize.test.mjs — offline tests for the PII pseudonymizer. node:test, no network, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pseudonymize, buildMap, applyMap } from './pseudonymize.mjs';

test('email -> [PERSON_n]', () => {
  const { text, map } = pseudonymize('contact jo@example.com today');
  assert.equal(text, 'contact [PERSON_1] today');
  assert.equal(map.get('jo@example.com'), '[PERSON_1]');
});

test('phone -> [PHONE_n]', () => {
  const { text } = pseudonymize('call +1 (415) 555-0199 now');
  assert.match(text, /\[PHONE_1\]/);
  assert.doesNotMatch(text, /555/);
});

test('@handle -> [HANDLE_n]', () => {
  const { text, map } = pseudonymize('follow @hathor on chain');
  assert.equal(text, 'follow [HANDLE_1] on chain');
  assert.equal(map.get('@hathor'), '[HANDLE_1]');
});

test('caller names[] -> [NAME_n]', () => {
  const { text, map } = pseudonymize('Ryan met Alice', { names: ['Ryan', 'Alice'] });
  assert.equal(text, '[NAME_1] met [NAME_2]');
  assert.equal(map.get('Ryan'), '[NAME_1]');
  assert.equal(map.get('Alice'), '[NAME_2]');
});

test('consistent placeholder per distinct value within one call', () => {
  const { text, map } = pseudonymize('jo@x.com and jo@x.com again');
  assert.equal(text, '[PERSON_1] and [PERSON_1] again');
  assert.equal(map.size, 1);
});

test('numbering is by first-appearance order across types', () => {
  const { map } = pseudonymize('@a wrote to b@x.com about @c', { names: [] });
  // @a (index 0) first, then b@x.com email, then @c — but emails detected before handles only changes
  // detection order, NOT final numbering, which is by first-appearance index.
  assert.equal(map.get('@a'), '[HANDLE_1]');
  assert.equal(map.get('b@x.com'), '[PERSON_1]');
  assert.equal(map.get('@c'), '[HANDLE_2]');
});

test('email is not fragmented by handle/phone rules', () => {
  const { text } = pseudonymize('a.b+tag@sub.example.co.uk');
  assert.equal(text, '[PERSON_1]');
});

test('reversible via the returned map only', () => {
  const original = 'mail jo@x.com or call 415-555-0199, ask @hathor or Ryan';
  const { text, map } = pseudonymize(original, { names: ['Ryan'] });
  // invert the map: placeholder -> original
  const inverse = new Map([...map].map(([k, v]) => [v, k]));
  const restored = applyMap(text, inverse);
  assert.equal(restored, original);
});

test('buildMap returns mapping without rewriting; applyMap rewrites', () => {
  const m = buildMap('hi @bob', []);
  assert.equal(m.get('@bob'), '[HANDLE_1]');
  assert.equal(applyMap('hi @bob and @bob', m), 'hi [HANDLE_1] and [HANDLE_1]');
});

test('short numeric runs are not treated as phones', () => {
  const { text, map } = pseudonymize('year 2026 count 42');
  assert.equal(text, 'year 2026 count 42');
  assert.equal(map.size, 0);
});

test('longer name applied before substring name (no partial mask)', () => {
  const { text } = pseudonymize('Ann and Annabelle', { names: ['Ann', 'Annabelle'] });
  // Annabelle (longer) replaced wholesale, Ann replaced as its own token.
  assert.match(text, /\[NAME_/);
  assert.doesNotMatch(text, /belle/);
});

test('name not present in text still gets a placeholder', () => {
  const m = buildMap('nobody here', ['Ghost']);
  assert.equal(m.get('Ghost'), '[NAME_1]');
});

test('soft-fail: non-string -> empty text and empty map', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const r = pseudonymize(bad);
    assert.equal(r.text, '');
    assert.ok(r.map instanceof Map);
    assert.equal(r.map.size, 0);
  }
});

test('soft-fail: empty string', () => {
  const r = pseudonymize('');
  assert.equal(r.text, '');
  assert.equal(r.map.size, 0);
});

test('soft-fail: bad opts.names ignored, no throw', () => {
  assert.doesNotThrow(() => pseudonymize('hi @x', { names: 'notarray' }));
  assert.doesNotThrow(() => pseudonymize('hi @x', { names: [null, 7, 'Ok'] }));
  const { map } = pseudonymize('hi Ok @x', { names: [null, 7, 'Ok'] });
  assert.equal(map.get('Ok'), '[NAME_1]');
});

test('applyMap soft-fail: non-string text and non-map', () => {
  assert.equal(applyMap(null, new Map()), '');
  assert.equal(applyMap('text', null), 'text');
  assert.equal(applyMap('text', new Map()), 'text');
});

test('buildMap soft-fail: non-string text', () => {
  assert.equal(buildMap(null, ['A']).size, 0);
});
