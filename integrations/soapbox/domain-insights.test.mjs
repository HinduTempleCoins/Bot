// domain-insights.test.mjs — offline coverage for the pure helpers (normDomain, guessCategory).
// The network fetchers (Tranco/RDAP/SEO) are best-effort and excluded here; these two are the
// deterministic logic the Directory relies on. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normDomain, guessCategory } from './domain-insights.mjs';

test('normDomain: strips scheme, path, and www', () => {
  assert.equal(normDomain('https://www.GitHub.com/HinduTempleCoins/Bot'), 'github.com');
  assert.equal(normDomain('Example.COM'), 'example.com');
  assert.equal(normDomain('http://sub.example.co.uk/page?x=1'), 'sub.example.co.uk');
});

test('normDomain: rejects non-domains and empties', () => {
  assert.equal(normDomain(''), '');
  assert.equal(normDomain(null), '');
  assert.equal(normDomain('not a domain'), '');
  assert.equal(normDomain('localhost'), '');     // no TLD
  assert.equal(normDomain('123'), '');
});

test('normDomain: malformed scheme falls back to host split without throwing', () => {
  assert.equal(normDomain('https://example.org'), 'example.org');
});

test('guessCategory: maps known domains to their category', () => {
  assert.equal(guessCategory('google.com'), 'Search');
  assert.equal(guessCategory('https://www.youtube.com/watch?v=1'), 'Video');
  assert.equal(guessCategory('coinbase.com'), 'Crypto');
  assert.equal(guessCategory('github.com'), 'Developer');
  assert.equal(guessCategory('en.wikipedia.org'), 'Reference');
});

test('guessCategory: returns null for unknown or invalid domains', () => {
  assert.equal(guessCategory('some-random-startup.io'), null);
  assert.equal(guessCategory('not a domain'), null);
  assert.equal(guessCategory(''), null);
});
