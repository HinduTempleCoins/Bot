// scam-detect.test.mjs — OFFLINE tests for the heuristic scam/phish detector.
// node:test + node:assert/strict. No network, no keys, no clock. Run:
//   cd /workspaces/Bot && node --test cheetah/scam-detect.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectScam, esc, FLAG_THRESHOLD,
  __setPatterns, __resetPatterns, __getPatterns,
  __setBrands, __resetBrands, __getBrands,
  __setFetch, _internal,
} from './scam-detect.mjs';

// ── shape / contract ────────────────────────────────────────────────────────
test('returns the {score, signals, flag} shape', () => {
  const r = detectScam('hello, nice post today');
  assert.equal(typeof r.score, 'number');
  assert.ok(Array.isArray(r.signals));
  assert.ok(r.flag === null || (r.flag && r.flag.kind === 'scam'));
});

test('benign text scores 0 and emits no flag', () => {
  const r = detectScam('I just published my notes on temple acoustics. Feedback welcome.');
  assert.equal(r.score, 0);
  assert.deepEqual(r.signals, []);
  assert.equal(r.flag, null);
});

// ── edge inputs (soft-fail, never throw) ─────────────────────────────────────
test('null / undefined / empty / non-string inputs are neutral, never throw', () => {
  for (const v of [null, undefined, '', '   ', 42, {}, [], NaN]) {
    const r = detectScam(v);
    assert.equal(r.flag, null);
    assert.equal(r.score, 0);
    assert.deepEqual(r.signals, []);
  }
});

test('opts.links missing or wrong type is tolerated', () => {
  assert.doesNotThrow(() => detectScam('claim your free airdrop now'));
  assert.doesNotThrow(() => detectScam('claim your free airdrop now', { links: 'not-an-array' }));
  assert.doesNotThrow(() => detectScam('claim your free airdrop now', null));
});

// ── seed-phrase / private-key asks (gravest → severity floor 5) ──────────────
test('seed-phrase request flags scam at severity 5', () => {
  const r = detectScam('To verify your account, please enter your 12 word seed phrase here.');
  assert.ok(r.signals.includes('seed-phrase'));
  assert.ok(r.flag);
  assert.equal(r.flag.kind, 'scam');
  assert.equal(r.flag.severity, 5);
  assert.ok(r.score >= FLAG_THRESHOLD);
});

test('private-key reference flags', () => {
  const r = detectScam('Send me your private key and I will fix the stuck transaction.');
  assert.ok(r.signals.includes('seed-phrase'));
  assert.ok(r.flag);
});

// ── "send X get 2X" doublers (floor 4) ───────────────────────────────────────
test('classic doubler flags at severity >= 4', () => {
  const r = detectScam('Send 1 ETH to my wallet and get 2 ETH back instantly! Double your crypto.');
  assert.ok(r.signals.includes('doubler'));
  assert.ok(r.flag);
  assert.ok(r.flag.severity >= 4);
});

// ── urgent-DM lure ───────────────────────────────────────────────────────────
test('urgent DM lure contributes a signal', () => {
  const r = detectScam('Act now, limited time! DM me on telegram to claim your reward.');
  assert.ok(r.signals.includes('urgent-dm') || r.signals.includes('fake-airdrop'));
  assert.ok(r.flag); // urgency + claim bait combine over threshold
});

// ── fake airdrop / connect-wallet ────────────────────────────────────────────
test('fake airdrop + connect wallet flags', () => {
  const r = detectScam('Claim your free airdrop! Connect your wallet to claim your tokens.');
  assert.ok(r.signals.includes('fake-airdrop'));
  assert.ok(r.flag);
  assert.ok(r.flag.severity >= 4);
});

// ── lookalike domain via links ───────────────────────────────────────────────
test('lookalike domain in links is flagged', () => {
  const r = detectScam('Verify your wallet here', {
    links: ['https://hive-keychainn.com/verify'],
  });
  assert.ok(r.signals.includes('lookalike-domain'));
  assert.ok(r.flag);
  assert.ok(r.flag.severity >= 4);
});

test('exact legitimate brand domain is NOT a lookalike', () => {
  const r = detectScam('Get the extension at metamask.io', {
    links: ['https://metamask.io/download'],
  });
  assert.ok(!r.signals.includes('lookalike-domain'));
});

test('brand-with-extra-token domain is a lookalike', () => {
  const r = detectScam('official support', {
    links: ['http://binance-support.help'],
  });
  assert.ok(r.signals.includes('lookalike-domain'));
});

test('unrelated domain is not a lookalike', () => {
  const r = detectScam('check this out', { links: ['https://example.org/post'] });
  assert.ok(!r.signals.includes('lookalike-domain'));
});

// ── severity scales with stacked signals ─────────────────────────────────────
test('multiple signals raise severity', () => {
  const lure = detectScam('Limited time! DM me to claim your free airdrop.');
  const stacked = detectScam(
    'URGENT: enter your seed phrase, send 1 BTC get 2 BTC back, connect your wallet to claim free tokens now!',
    { links: ['https://metamaskk.io'] },
  );
  assert.ok(stacked.flag);
  assert.ok(stacked.score >= (lure.flag ? lure.score : 0));
  assert.equal(stacked.flag.severity, 5); // seed-phrase floor
  assert.ok(stacked.signals.length >= 3);
});

// ── reason is HTML-escaped at the boundary ───────────────────────────────────
test('flag.reason is esc()-escaped (no raw angle brackets)', () => {
  // inject a pattern whose `why` carries HTML to prove escaping at the boundary.
  __setPatterns([{ signal: 'doubler', weight: 0.7, re: /xss/, why: '<b>boom</b>"&\'' }]);
  const r = detectScam('xss');
  __resetPatterns();
  assert.ok(r.flag);
  assert.ok(!r.flag.reason.includes('<b>'));
  assert.ok(r.flag.reason.includes('&lt;b&gt;'));
});

test('esc() handles all five entities and null', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// ── injectable seams behave ──────────────────────────────────────────────────
test('__setPatterns / __resetPatterns swap and restore the rule set', () => {
  const before = __getPatterns();
  __setPatterns([{ signal: 'custom', weight: 0.9, re: /widget/, why: 'custom rule' }]);
  const r = detectScam('buy a widget');
  assert.ok(r.signals.includes('custom'));
  assert.ok(r.flag);
  __resetPatterns();
  assert.equal(__getPatterns(), before);
  // after reset, the custom signal no longer fires
  assert.ok(!detectScam('buy a widget').signals.includes('custom'));
});

test('__setPatterns ignores non-arrays', () => {
  const before = __getPatterns();
  __setPatterns('nope');
  __setPatterns(null);
  assert.equal(__getPatterns(), before);
});

test('__setBrands / __resetBrands swap and restore the brand list', () => {
  __setBrands(['acmebank']);
  const r = detectScam('login', { links: ['https://acmebankk.com'] });
  assert.ok(r.signals.includes('lookalike-domain'));
  __resetBrands();
  assert.ok(__getBrands().includes('metamask'));
});

test('__setFetch accepts a function without affecting offline detection', () => {
  let called = false;
  __setFetch(() => { called = true; });
  const r = detectScam('enter your seed phrase');
  assert.ok(r.flag); // offline path unchanged
  assert.equal(called, false); // fetch seam unused offline
  __setFetch(globalThis.fetch);
});

// ── internal helpers ─────────────────────────────────────────────────────────
test('domainLabel extracts the registrable label from URLs and bare domains', () => {
  const { domainLabel } = _internal;
  assert.equal(domainLabel('https://www.binance.com/path'), 'binance');
  assert.equal(domainLabel('metamask.io'), 'metamask');
  assert.equal(domainLabel('http://sub.hive-keychainn.com:8080'), 'hive-keychainn');
  assert.equal(domainLabel('localhost'), 'localhost');
  assert.equal(domainLabel(''), '');
});

test('editDistance basic cases', () => {
  const { editDistance } = _internal;
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('metamask', 'metamaskk'), 1);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('abc', ''), 3);
});

test('normalize de-obfuscates letter-spaced words', () => {
  const { normalize } = _internal;
  assert.ok(normalize('s e e d   phrase').includes('seed'));
  assert.ok(normalize('S.E.E.D phrase').includes('seed'));
});

test('letter-spaced seed-phrase ask still flags (de-obfuscation)', () => {
  const r = detectScam('please send your s e e d phrase to recover');
  assert.ok(r.signals.includes('seed-phrase'));
  assert.ok(r.flag);
});

// ── determinism ──────────────────────────────────────────────────────────────
test('deterministic: same input → same output', () => {
  const input = 'Send 1 ETH get 2 ETH back, DM me, claim free airdrop';
  const a = detectScam(input, { links: ['https://metamaskk.io'] });
  const b = detectScam(input, { links: ['https://metamaskk.io'] });
  assert.deepEqual(a, b);
});
