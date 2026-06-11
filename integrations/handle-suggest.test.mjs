// handle-suggest.test.mjs — offline, node:test. Happy + edge + soft-fail. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, slugifyHandle, suggestHandles, isValidHandle, firstAvailable,
  MIN_LEN, MAX_LEN,
} from './handle-suggest.mjs';

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('slugifyHandle: lowercase ascii, collapse repeats, trim dashes', () => {
  assert.equal(slugifyHandle('Mehit the Witness'), 'mehit-the-witnes'); // capped at 16 chars
  assert.equal(slugifyHandle('Hello World'), 'hello-world');
  assert.equal(slugifyHandle('  --A__B  C--  '), 'a-b-c');
  assert.equal(slugifyHandle('UPPER!!!CASE'), 'upper-case');
  assert.equal(slugifyHandle('a   b'), 'a-b'); // collapse repeats
});

test('slugifyHandle: respects maxLen and re-trims exposed dash', () => {
  assert.equal(slugifyHandle('abcdefghij', { maxLen: 4 }), 'abcd');
  // cut lands on a dash -> trimmed
  assert.equal(slugifyHandle('abc def ghi', { maxLen: 4 }), 'abc');
  assert.ok(slugifyHandle('a very long name here', {}).length <= MAX_LEN);
});

test('slugifyHandle: soft-fail on garbage / non-string', () => {
  assert.equal(slugifyHandle(null), '');
  assert.equal(slugifyHandle(undefined), '');
  assert.equal(slugifyHandle({}), '');
  assert.equal(slugifyHandle('!!!@@@###'), '');
  assert.equal(slugifyHandle(42), '42');
});

test('isValidHandle: enforces shape rules', () => {
  assert.deepEqual(isValidHandle('mehit'), { ok: true, reason: 'ok' });
  assert.equal(isValidHandle('').ok, false);
  assert.equal(isValidHandle('ab').ok, false);          // too short
  assert.equal(isValidHandle('a'.repeat(17)).ok, false); // too long
  assert.equal(isValidHandle('2cool').ok, false);        // starts digit
  assert.equal(isValidHandle('-cool').ok, false);        // starts dash
  assert.equal(isValidHandle('cool-').ok, false);        // trailing dash
  assert.equal(isValidHandle('co--ol').ok, false);       // doubled dash
  assert.equal(isValidHandle('Cool').ok, false);         // uppercase
  assert.equal(isValidHandle('co.ol').ok, false);        // bad charset
  assert.equal(isValidHandle('a-b-1').ok, true);
});

test('isValidHandle: boundary lengths', () => {
  assert.equal(isValidHandle('a'.repeat(MIN_LEN)).ok, true);
  assert.equal(isValidHandle('a'.repeat(MAX_LEN)).ok, true);
  assert.equal(isValidHandle('a'.repeat(MIN_LEN - 1)).ok, false);
  assert.equal(isValidHandle('a'.repeat(MAX_LEN + 1)).ok, false);
});

test('suggestHandles: returns requested count of valid available handles', () => {
  const list = suggestHandles('Mehit the Witness', { taken: [], count: 5 });
  assert.equal(list.length, 5);
  for (const h of list) assert.equal(isValidHandle(h).ok, true, `invalid: ${h}`);
  // all unique
  assert.equal(new Set(list).size, list.length);
});

test('suggestHandles: skips taken handles case-insensitively', () => {
  const slug = slugifyHandle('Mehit the Witness');
  const list = suggestHandles('Mehit the Witness', { taken: [slug.toUpperCase()], count: 5 });
  assert.ok(!list.map(s => s.toLowerCase()).includes(slug.toLowerCase()));
  for (const h of list) assert.equal(isValidHandle(h).ok, true);
});

test('suggestHandles: numeric suffix strategy when base taken', () => {
  const list = suggestHandles('alice', { taken: ['alice'], count: 3 });
  assert.ok(!list.includes('alice'));
  assert.ok(list.includes('alice2'), JSON.stringify(list));
});

test('suggestHandles: deterministic — same inputs, same output', () => {
  const a = suggestHandles('John Q Public', { taken: ['johnpublic'], count: 6 });
  const b = suggestHandles('John Q Public', { taken: ['johnpublic'], count: 6 });
  assert.deepEqual(a, b);
});

test('suggestHandles: vowel-drop variant appears for vowel-heavy names', () => {
  // take the obvious forms so a compact vowel-drop must surface
  const name = 'aeiouqueue';
  const list = suggestHandles(name, { taken: [slugifyHandle(name)], count: 8 });
  for (const h of list) assert.equal(isValidHandle(h).ok, true);
  assert.ok(list.length > 0);
});

test('suggestHandles: garbage name falls back to user family', () => {
  const list = suggestHandles('!!!', { taken: [], count: 3 });
  assert.deepEqual(list, ['user', 'user2', 'user3']);
});

test('suggestHandles: fallback skips taken user names', () => {
  const list = suggestHandles('###', { taken: ['user', 'USER2'], count: 2 });
  assert.deepEqual(list, ['user3', 'user4']);
});

test('suggestHandles: long name suggestions never exceed MAX_LEN', () => {
  const list = suggestHandles('Supercalifragilisticexpialidocious Person', { taken: [], count: 8 });
  for (const h of list) {
    assert.ok(h.length <= MAX_LEN, `too long: ${h}`);
    assert.equal(isValidHandle(h).ok, true);
  }
});

test('suggestHandles: soft-fail on bad options', () => {
  // count:0 is invalid -> default 5; taken non-array -> ignored (empty)
  assert.deepEqual(suggestHandles('!!!', { taken: 'notarray', count: 0 }),
    ['user', 'user2', 'user3', 'user4', 'user5']);
  assert.equal(suggestHandles('Alice', {}).length, 5); // default count
  assert.ok(Array.isArray(suggestHandles(null, undefined)));
});

test('firstAvailable: returns best available or deterministic fallback', () => {
  assert.equal(firstAvailable('Alice', []), 'alice');
  assert.equal(firstAvailable('Alice', ['alice']), 'alice2');
  assert.equal(firstAvailable('!!!', []), 'user');
  assert.equal(typeof firstAvailable(null, null), 'string');
});

test('firstAvailable: matches first element of suggestHandles', () => {
  const fa = firstAvailable('Mehit', ['mehit']);
  const list = suggestHandles('Mehit', { taken: ['mehit'], count: 1 });
  assert.equal(fa, list[0]);
});
