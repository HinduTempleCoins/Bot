// impersonation-detect.test.mjs — OFFLINE tests for the heuristic impersonation detector.
// node --test cheetah/impersonation-detect.test.mjs   (no network, no keys)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectImpersonation,
  esc,
  FLAG_THRESHOLD,
  NEAR_DUP_THRESHOLD,
  BRAND_NEW_DAYS,
  __setReader,
  __setFetch,
  __setStore,
  __setClient,
  __setCrypto,
  __resetSeams,
} from './impersonation-detect.mjs';

const KNOWN = [{ account: 'hathor', displayName: 'Hathor', verified: true }];

test('esc escapes HTML-significant characters', () => {
  assert.equal(esc('<b>"x"&\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('an unrelated handle scores 0 and emits no flag', () => {
  const r = detectImpersonation('cryptokannon', { knownAccounts: KNOWN });
  assert.equal(r.score, 0);
  assert.deepEqual(r.signals, []);
  assert.equal(r.flag, null);
});

test('empty / null / undefined account is neutral and never throws', () => {
  for (const v of ['', '   ', null, undefined, 0, {}, []]) {
    const r = detectImpersonation(v, { knownAccounts: KNOWN });
    assert.equal(r.score, 0);
    assert.deepEqual(r.signals, []);
    assert.equal(r.flag, null);
  }
});

test('the exact verified account itself is never flagged against itself', () => {
  const r = detectImpersonation('hathor', { knownAccounts: KNOWN });
  assert.equal(r.flag, null);
  assert.equal(r.score, 0);
});

test('leetspeak near-duplicate of a verified handle fires and flags', () => {
  const r = detectImpersonation('hath0r', { knownAccounts: KNOWN });
  assert.ok(r.signals.includes('near-duplicate-name'));
  assert.ok(r.signals.includes('targets-verified-account'));
  assert.ok(r.score >= FLAG_THRESHOLD);
  assert.ok(r.flag);
  assert.equal(r.flag.kind, 'impersonation');
});

test('Cyrillic homoglyph copy of a handle is caught (visual skeleton match)', () => {
  // 'hаthоr' uses Cyrillic 'а' (U+0430) and 'о' (U+043E)
  const sneaky = 'hаthоr';
  const r = detectImpersonation(sneaky, { knownAccounts: KNOWN });
  assert.ok(r.signals.includes('homoglyph'));
  assert.ok(r.score >= FLAG_THRESHOLD);
  assert.ok(r.flag);
  assert.equal(r.flag.kind, 'impersonation');
  assert.ok(r.flag.severity >= 4, 'an exact-skeleton homoglyph copy of a verified account is grave');
});

test('zero-width character spliced into a known name is caught', () => {
  // ZWSP (U+200B) inserted between 'hat' and 'hor'
  const sneaky = 'hat​hor';
  const r = detectImpersonation(sneaky, { knownAccounts: KNOWN });
  assert.ok(r.signals.includes('zero-width-trick'));
  assert.ok(r.flag);
  assert.equal(r.flag.kind, 'impersonation');
});

test('brand-new account looking like an established identity amplifies the score', () => {
  const old = detectImpersonation('hath0r', { knownAccounts: KNOWN, accountAgeDays: 400 });
  const fresh = detectImpersonation('hath0r', { knownAccounts: KNOWN, accountAgeDays: 0 });
  assert.ok(fresh.signals.includes('brand-new-account'));
  assert.ok(!old.signals.includes('brand-new-account'));
  assert.ok(fresh.score >= old.score);
});

test('BRAND_NEW_DAYS boundary: at the threshold counts as brand-new, just over does not', () => {
  const at = detectImpersonation('hath0r', { knownAccounts: KNOWN, accountAgeDays: BRAND_NEW_DAYS });
  const over = detectImpersonation('hath0r', { knownAccounts: KNOWN, accountAgeDays: BRAND_NEW_DAYS + 1 });
  assert.ok(at.signals.includes('brand-new-account'));
  assert.ok(!over.signals.includes('brand-new-account'));
});

test('bio claiming to be the official identity adds the claims signal', () => {
  const r = detectImpersonation('hath0r', {
    knownAccounts: KNOWN,
    bio: 'This is the official Hathor witness account',
  });
  assert.ok(r.signals.includes('claims-established-identity'));
  assert.ok(r.flag);
});

test('display name colliding with a known handle is caught even if the handle differs', () => {
  const r = detectImpersonation('totally-new-guy', {
    knownAccounts: KNOWN,
    displayName: 'Hathor',
  });
  assert.ok(r.signals.includes('near-duplicate-display-name'));
  assert.ok(r.flag);
});

test('string-form roster entries are accepted', () => {
  const r = detectImpersonation('hath0r', { knownAccounts: ['hathor'] });
  assert.ok(r.signals.includes('near-duplicate-name'));
  // unverified (string form) → no targets-verified-account signal
  assert.ok(!r.signals.includes('targets-verified-account'));
});

test('flag shape exactly matches flag-pipe fileFlag expectation', () => {
  const r = detectImpersonation('hath0r', { knownAccounts: KNOWN, accountAgeDays: 0 });
  assert.ok(r.flag);
  const keys = Object.keys(r.flag).sort();
  assert.deepEqual(keys, ['kind', 'reason', 'severity']);
  assert.equal(r.flag.kind, 'impersonation');
  assert.ok(Number.isInteger(r.flag.severity));
  assert.ok(r.flag.severity >= 1 && r.flag.severity <= 5);
});

test('deterministic: same input yields identical output', () => {
  const opts = { knownAccounts: KNOWN, displayName: 'Hathor', bio: 'official', accountAgeDays: 1 };
  const a = detectImpersonation('hath0r', opts);
  const b = detectImpersonation('hath0r', opts);
  assert.deepEqual(a, b);
});

test('reason is HTML-escaped (no raw angle brackets leak through)', () => {
  const r = detectImpersonation('hath0r', {
    knownAccounts: [{ account: '<script>hathor', displayName: 'x', verified: true }],
  });
  if (r.flag) assert.ok(!/[<>]/.test(r.flag.reason));
});

test('score is clamped to 0..1 even with every signal firing', () => {
  const r = detectImpersonation('hаth​0r', {
    knownAccounts: KNOWN,
    displayName: 'Hathor',
    bio: 'the real official Hathor, verified',
    accountAgeDays: 0,
  });
  assert.ok(r.score <= 1);
  assert.ok(r.score >= 0);
});

test('lone zero-width trick with no name collision is suspicious but below flag threshold', () => {
  const r = detectImpersonation('some​randomname', { knownAccounts: KNOWN });
  assert.ok(r.signals.includes('zero-width-trick'));
  assert.ok(r.score > 0);
  assert.ok(r.score < FLAG_THRESHOLD);
  assert.equal(r.flag, null);
});

test('empty roster: nothing to impersonate, no name signals', () => {
  const r = detectImpersonation('hathor', { knownAccounts: [] });
  assert.ok(!r.signals.includes('near-duplicate-name'));
});

test('NEAR_DUP_THRESHOLD is a sensible fraction', () => {
  assert.ok(NEAR_DUP_THRESHOLD > 0 && NEAR_DUP_THRESHOLD <= 1);
});

test('opts omitted entirely does not throw and is neutral', () => {
  const r = detectImpersonation('hathor');
  assert.equal(r.flag, null);
  assert.deepEqual(r.signals, []);
});

test('injectable seams accept functions/objects and do not throw; __resetSeams restores', () => {
  assert.doesNotThrow(() => __setReader(async () => []));
  assert.doesNotThrow(() => __setFetch(async () => ({ ok: true })));
  assert.doesNotThrow(() => __setStore({ get() {}, set() {} }));
  assert.doesNotThrow(() => __setClient({ call() {} }));
  assert.doesNotThrow(() => __setCrypto({ hash() {} }));
  // bad inputs are ignored, never throw
  assert.doesNotThrow(() => __setReader(null));
  assert.doesNotThrow(() => __setStore(undefined));
  // detection still works purely offline regardless of injected seams
  const r = detectImpersonation('hath0r', { knownAccounts: KNOWN });
  assert.ok(r.flag);
  __resetSeams();
});
