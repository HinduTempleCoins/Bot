// pii-redact.test.mjs — offline, node:test. Happy + edge + soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, PATTERNS, redact, findPii, counts, redactRecord, runCli, __setReader,
} from './pii-redact.mjs';

test('esc escapes HTML metachars and soft-fails on null', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('PATTERNS is frozen and exposes named regexes', () => {
  assert.ok(Object.isFrozen(PATTERNS));
  for (const name of ['email', 'phone', 'ssn', 'creditCard', 'ipv4', 'ethAddress', 'btcAddress', 'wifKey', 'longHexKey']) {
    assert.ok(PATTERNS[name] instanceof RegExp, `missing pattern ${name}`);
  }
  // mutating the frozen object is a no-op
  try { PATTERNS.email = /x/; } catch {}
  assert.ok(PATTERNS.email instanceof RegExp);
});

test('redact replaces email with stable token', () => {
  assert.equal(redact('reach me at jo.doe@example.com please'), 'reach me at [EMAIL] please');
});

test('redact handles ssn, ipv4, eth address', () => {
  assert.equal(redact('ssn 123-45-6789 here'), 'ssn [SSN] here');
  assert.equal(redact('host 192.168.1.42 down'), 'host [IP] down');
  assert.equal(
    redact('send to 0xAbC0000000000000000000000000000000000001'),
    'send to [ETH]'
  );
});

test('redact catches a long hex key (scrub-only)', () => {
  const hex = 'a'.repeat(64);
  assert.equal(redact(`leaked ${hex} oops`), 'leaked [KEY] oops');
});

test('redact catches a wif-shaped placeholder', () => {
  // 51-char run total starting with 5, body from the base58 alphabet — shape only.
  const wif = '5' + 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJw'.padEnd(50, 'x');
  assert.equal(wif.length, 51);
  assert.equal(redact(`key ${wif} end`).includes('[KEY]'), true);
});

test('opts.keep skips named categories', () => {
  const out = redact('mail a@b.com ip 10.0.0.1', { keep: ['email'] });
  assert.ok(out.includes('a@b.com'));
  assert.ok(out.includes('[IP]'));
});

test('opts.hashTags appends deterministic distinguishable suffix', () => {
  const a = redact('x@y.com', { hashTags: true });
  const b = redact('z@w.com', { hashTags: true });
  const aAgain = redact('x@y.com', { hashTags: true });
  assert.match(a, /^\[EMAIL_[0-9a-f]{4}\]$/);
  assert.equal(a, aAgain, 'same value -> same tag');
  assert.notEqual(a, b, 'distinct values -> distinct tags');
});

test('findPii is read-only and returns type/match/index', () => {
  const text = 'a@b.com and 1.2.3.4';
  const found = findPii(text);
  assert.equal(found.length, 2);
  const email = found.find((f) => f.type === 'email');
  assert.equal(email.match, 'a@b.com');
  assert.equal(email.index, 0);
  // input unchanged
  assert.equal(text, 'a@b.com and 1.2.3.4');
});

test('counts returns a count per category', () => {
  const c = counts('a@b.com c@d.com 1.2.3.4');
  assert.equal(c.email, 2);
  assert.equal(c.ipv4, 1);
  assert.equal(c.ssn, 0);
});

test('redactRecord deep-clones and redacts string leaves', () => {
  const rec = { name: 'Jo', email: 'jo@x.com', nested: { ip: '8.8.8.8', n: 5 }, tags: ['a@b.com', 'plain'] };
  const out = redactRecord(rec);
  assert.equal(out.email, '[EMAIL]');
  assert.equal(out.nested.ip, '[IP]');
  assert.equal(out.nested.n, 5);
  assert.equal(out.tags[0], '[EMAIL]');
  assert.equal(out.tags[1], 'plain');
  // original untouched (deep clone)
  assert.equal(rec.email, 'jo@x.com');
  assert.equal(rec.nested.ip, '8.8.8.8');
});

test('redactRecord with fields list limits to named top-level fields', () => {
  const rec = { a: 'x@y.com', b: 'z@w.com' };
  const out = redactRecord(rec, ['a']);
  assert.equal(out.a, '[EMAIL]');
  assert.equal(out.b, 'z@w.com');
});

test('soft-fail: non-string / null inputs', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(undefined), '');
  assert.equal(redact(42), '');
  assert.deepEqual(findPii(null), []);
  assert.deepEqual(findPii(123), []);
  assert.deepEqual(redactRecord(null), {});
  assert.deepEqual(redactRecord('not an object'), {});
  // counts still returns full zeroed shape
  assert.equal(counts(null).email, 0);
});

test('clean text passes through unchanged', () => {
  const clean = 'The witness produces blocks deterministically.';
  assert.equal(redact(clean), clean);
  assert.deepEqual(findPii(clean), []);
});

test('runCli reads via injected reader and redacts', () => {
  __setReader(() => 'contact a@b.com');
  assert.equal(runCli(['file.txt']), 'contact [EMAIL]');
  __setReader(null); // restore default
});

test('runCli honors --keep and --hash flags', () => {
  __setReader(() => 'a@b.com 1.2.3.4');
  assert.ok(runCli(['f', '--keep', 'email']).includes('a@b.com'));
  assert.match(runCli(['f', '--hash']), /\[EMAIL_[0-9a-f]{4}\]/);
  __setReader(null);
});
