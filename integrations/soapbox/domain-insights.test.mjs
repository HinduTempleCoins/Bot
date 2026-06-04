// domain-insights.test.mjs — offline coverage for the pure helpers (normDomain, guessCategory).
// The network fetchers (Tranco/RDAP/SEO) are best-effort and excluded here; these two are the
// deterministic logic the Directory relies on. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normDomain, guessCategory,
  __setFetch, trancoRank, trancoTrend, domainAge, insights,
} from './domain-insights.mjs';

// ── Offline coverage of the Tranco/RDAP fetchers + insights aggregation via the injected seam. ──
function fakeResponse({ ok = true, status = 200, json } = {}) {
  return { ok, status, async json() { if (json === undefined) throw new Error('no json'); return json; } };
}
const throwingFetch = () => { throw new Error('network down'); };

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

test('trancoRank: parses the first ranked point (injected fetch)', async () => {
  __setFetch(async () => fakeResponse({ ok: true, json: { ranks: [
    { date: '2026-06-01', rank: null }, { date: '2026-05-31', rank: 42 }, { date: '2026-05-30', rank: 50 },
  ] } }));
  try {
    const r = await trancoRank('example.com');
    assert.deepEqual(r, { rank: 42, date: '2026-05-31' });
  } finally { __setFetch(null); }
});

test('trancoRank: non-ok → null; network error → null (soft-fail)', async () => {
  __setFetch(async () => fakeResponse({ ok: false, status: 404 }));
  assert.equal(await trancoRank('x.com'), null);
  __setFetch(throwingFetch);
  try { assert.equal(await trancoRank('x.com'), null); } finally { __setFetch(null); }
});

test('trancoTrend: reverses newest-first → oldest→newest + computes delta (injected fetch)', async () => {
  // API gives newest-first; delta = first(oldest) − latest. Climbing = positive delta.
  __setFetch(async () => fakeResponse({ ok: true, json: { ranks: [
    { date: '2026-06-03', rank: 10 },   // latest
    { date: '2026-06-02', rank: 20 },
    { date: '2026-06-01', rank: 30 },   // oldest
  ] } }));
  try {
    const t = await trancoTrend('example.com');
    assert.equal(t.points.length, 3);
    assert.equal(t.points[0].rank, 30);   // oldest first after reverse
    assert.equal(t.points[2].rank, 10);   // newest last
    assert.equal(t.latest, 10);
    assert.equal(t.first, 30);
    assert.equal(t.delta, 20);            // 30 − 10, climbing
  } finally { __setFetch(null); }
});

test('domainAge: parses RDAP registration event → ageYears + registrar (injected fetch)', async () => {
  __setFetch(async () => fakeResponse({ ok: true, json: {
    events: [{ eventAction: 'registration', eventDate: '2020-06-04T00:00:00Z' }],
    entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar Inc']]] }],
  } }));
  try {
    const a = await domainAge('example.com');
    assert.equal(a.registered, '2020-06-04T00:00:00Z');
    assert.ok(a.ageYears >= 5 && a.ageYears <= 7);   // ~6y as of 2026
    assert.equal(a.registrar, 'Example Registrar Inc');
  } finally { __setFetch(null); }
});

test('domainAge: soft-fails to null on network error (never throws)', async () => {
  __setFetch(throwingFetch);
  try { assert.equal(await domainAge('example.com'), null); } finally { __setFetch(null); }
});

test('insights: aggregates rank + age, soft-fails seo/trend independently (injected fetch)', async () => {
  // seo:false skips the on-page audit (which has its own fetch path); trend stays on.
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('tranco')) return fakeResponse({ ok: true, json: { ranks: [{ date: '2026-06-03', rank: 7 }] } });
    if (u.includes('rdap')) return fakeResponse({ ok: true, json: { events: [{ eventAction: 'registration', eventDate: '2010-01-01T00:00:00Z' }], entities: [] } });
    return fakeResponse({ ok: false, status: 404 });
  });
  try {
    const r = await insights('https://www.example.com/', { seo: false });
    assert.equal(r.domain, 'example.com');
    assert.equal(r.rank.rank, 7);
    assert.ok(r.age.ageYears >= 15);
    assert.equal(r.seo, null);              // skipped cleanly
  } finally { __setFetch(null); }
});

test('insights: invalid domain returns an error object without any fetch', async () => {
  __setFetch(() => { throw new Error('should not be called'); });
  try {
    const r = await insights('not a domain', { seo: false, trend: false });
    assert.deepEqual(r, { domain: '', error: 'invalid domain' });
  } finally { __setFetch(null); }
});
