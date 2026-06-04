// local-business-intel.test.mjs — OFFLINE tests for the Local Business Intelligence page (#232).
// No network: all data sources are injected via __setSources(). Covers the load-bearing legal frame:
// facts-not-verdicts, §230 user-content tagging, windowed-not-stored, right-of-reply-always, and the
// assertNoVerdict safety check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  businessPage, assertNoVerdict, addScamReport, renderPage,
  clarityFromRecords, esc, VERDICT_LABELS, __setSources, __resetSources,
} from './local-business-intel.mjs';

// ── injected fakes ──────────────────────────────────────────────────────────────────────────────
const fakeSources = (over = {}) => ({
  fdaRecalls: async () => [
    { kind: 'fact', source: 'openFDA', sourceUrl: 'https://fda.gov/x', asOf: '2025-01-02',
      title: 'Listeria recall', detail: 'voluntary recall of product lot 42' },
  ],
  cpscRecalls: async () => [
    { kind: 'fact', source: 'CPSC SaferProducts', sourceUrl: 'https://saferproducts.gov/y',
      asOf: '2024-11-01', title: 'Tip-over hazard', detail: 'furniture recall' },
  ],
  cfpbComplaints: async () => [],
  secFilings: async () => [],
  identity: async ({ name }) => ({
    name, displayName: '123 Main St, Austin, TX', lat: 30.27, lon: -97.74,
    source: 'OpenStreetMap', sourceUrl: 'https://osm.org/1',
  }),
  neighborhood: async () => ({ medianIncome: 65000, sourceUrl: 'https://census.gov/acs' }),
  ownReviews: async () => [
    { user: 'alice', text: 'Friendly staff, good coffee.', rating: 5, asOf: '2025-02-01' },
  ],
  windowedReviews: async () => [
    { platform: 'Yelp', url: 'https://yelp.com/biz/acme', snippet: 'great spot', date: '2025-01-15' },
  ],
  scamReports: async () => [],
  ...over,
});

// ── businessPage assembly ──────────────────────────────────────────────────────────────────────
test('businessPage assembles every section from injected fakes', async () => {
  __setSources(fakeSources());
  const page = await businessPage({ name: 'Acme Diner', location: 'Austin, TX', census: { state: '48' } });
  __resetSources();
  assert.equal(page.kind, 'business-page');
  assert.equal(page.identity.name, 'Acme Diner');
  assert.equal(page.officialRecords.length, 2, 'FDA + CPSC facts assembled');
  assert.equal(page.reviews.own.length, 1);
  assert.equal(page.reviews.windowed.length, 1);
  assert.ok(page.neighborhood.census, 'census context present');
  assert.equal(page.rightOfReply.open, true);
});

test('per-section soft-fail: one source throws → its section empty, page still renders', async () => {
  __setSources(fakeSources({
    fdaRecalls: async () => { throw new Error('openFDA down'); },
    cpscRecalls: async () => { throw new Error('CPSC down'); },
    identity: async () => { throw new Error('OSM down'); },
    neighborhood: async () => { throw new Error('census down'); },
  }));
  const page = await businessPage({ name: 'Broken Co', location: 'Nowhere' });
  __resetSources();
  // the throwing sections are empty…
  assert.equal(page.officialRecords.length, 0);
  assert.equal(page.neighborhood.census, null);
  // …but identity still falls back to the descriptor, and the rest of the page assembled.
  assert.equal(page.identity.name, 'Broken Co');
  assert.equal(page.reviews.own.length, 1, 'a healthy section still populated');
  // and the whole thing still renders without throwing.
  const html = renderPage(page);
  assert.match(html, /Broken Co/);
  assert.match(html, /Right of reply/);
});

// ── facts carry source + asOf + kind:'fact' ──────────────────────────────────────────────────────
test('official records carry source + asOf + kind:fact', async () => {
  __setSources(fakeSources());
  const page = await businessPage({ name: 'Acme Diner' });
  __resetSources();
  for (const r of page.officialRecords) {
    assert.equal(r.kind, 'fact');
    assert.ok(r.source, 'fact has a source');
    assert.ok(r.asOf, 'fact has an asOf');
  }
});

// ── windowed review is NEVER stored ──────────────────────────────────────────────────────────────
test('a windowed review carries stored:false (windowed, not hosted)', async () => {
  __setSources(fakeSources());
  const page = await businessPage({ name: 'Acme Diner' });
  __resetSources();
  const w = page.reviews.windowed[0];
  assert.equal(w.stored, false, 'windowed review is not stored');
  assert.equal(w.authoredBy, 'user');
  assert.ok(w.url, 'windowed review links out');
  // own reviews, by contrast, ARE stored
  assert.equal(page.reviews.own[0].stored, true);
});

// ── addScamReport tags §230 user content ─────────────────────────────────────────────────────────
test('addScamReport tags authoredBy:user (we never author it)', async () => {
  __setSources(fakeSources());
  const page = await businessPage({ name: 'Acme Diner' });
  __resetSources();
  const rec = addScamReport(page, { user: 'bob', text: 'They never delivered my order.' });
  assert.equal(rec.authoredBy, 'user');
  assert.equal(rec.kind, 'user-report');
  assert.equal(rec.reportType, 'scam-report');
  assert.equal(page.scamReports.length, 1);
  assert.equal(page.scamReports[0].user, 'bob');
});

// ── assertNoVerdict: passes on facts-only, throws on injected verdict ─────────────────────────────
test('assertNoVerdict passes on a facts-only page', async () => {
  __setSources(fakeSources());
  const page = await businessPage({ name: 'Acme Diner', census: { state: '48' } });
  __resetSources();
  assert.equal(assertNoVerdict(page), true);
  // a user scam report (full of verdict words) must NOT trip the check — it's §230 user content.
  addScamReport(page, { user: 'carol', text: 'This place is a total scam and the owner is a fraud!' });
  assert.equal(assertNoVerdict(page), true, 'user content is not policed — only platform speech');
});

test('assertNoVerdict THROWS when a verdict label is injected as platform speech', async () => {
  __setSources(fakeSources());
  const base = await businessPage({ name: 'Acme Diner' });
  __resetSources();

  // 1. clarity carrying a verdict label
  const p1 = structuredClone(base);
  p1.clarity.label = 'scam';
  assert.throws(() => assertNoVerdict(p1), /verdict label/);

  // 2. a top-level platform verdict field
  const p2 = structuredClone(base);
  p2.verdict = 'bad business';
  assert.throws(() => assertNoVerdict(p2), /top-level platform verdict/);

  // 3. an "official record" that is not a sourced fact
  const p3 = structuredClone(base);
  p3.officialRecords.push({ kind: 'opinion', source: 'us', title: 'they are a scam' });
  assert.throws(() => assertNoVerdict(p3), /not kind:fact/);

  // 4. identity field that is a bare verdict label
  const p4 = structuredClone(base);
  p4.identity.name = 'scam';
  assert.throws(() => assertNoVerdict(p4), /bare verdict label/);
});

// ── renderPage escapes + always shows right-of-reply ─────────────────────────────────────────────
test('renderPage escapes a malicious business name', async () => {
  __setSources(fakeSources({
    identity: async () => ({
      name: '<script>alert(1)</script>', displayName: '"><img src=x onerror=alert(2)>',
      source: 'OpenStreetMap', sourceUrl: 'https://osm.org/1',
    }),
  }));
  const page = await businessPage({ name: '<script>alert(1)</script>' });
  __resetSources();
  const html = renderPage(page);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'raw script tag must not survive');
  assert.match(html, /&lt;script&gt;/, 'name is HTML-escaped');
});

test('renderPage ALWAYS shows the right-of-reply box', async () => {
  // even an entirely empty page renders the right-of-reply.
  __setSources({
    fdaRecalls: async () => [], cpscRecalls: async () => [], cfpbComplaints: async () => [],
    secFilings: async () => [], identity: async () => null, neighborhood: async () => null,
    ownReviews: async () => [], windowedReviews: async () => [], scamReports: async () => [],
  });
  const page = await businessPage({ name: 'Empty Biz' });
  __resetSources();
  const html = renderPage(page);
  assert.match(html, /Right of reply/);
  assert.match(html, /open for response/);
});

test('renderPage shows Clarity basis as official-records-only (never a verdict)', async () => {
  __setSources(fakeSources());
  const page = await businessPage({ name: 'Acme Diner' });
  __resetSources();
  const html = renderPage(page);
  assert.match(html, /Based on official government records only/);
  assert.match(html, /not a verdict/i);
});

// ── escaped scam-report text in render ───────────────────────────────────────────────────────────
test('renderPage escapes user-report text', async () => {
  __setSources(fakeSources());
  const page = await businessPage({ name: 'Acme Diner' });
  __resetSources();
  addScamReport(page, { user: 'mal', text: '<img src=x onerror=alert(3)>' });
  const html = renderPage(page);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(3\)>/);
  assert.match(html, /&lt;img src=x/);
});

// ── clarityFromRecords summarizes facts only, no label ───────────────────────────────────────────
test('clarityFromRecords summarizes facts only, basis official-records-only, no label', () => {
  const c = clarityFromRecords([
    { kind: 'fact', source: 'openFDA' },
    { kind: 'fact', source: 'CPSC' },
    { kind: 'user-report', authoredBy: 'user', text: 'scam!' }, // must be ignored
  ]);
  assert.equal(c.officialRecordCount, 2, 'user content not counted in clarity');
  assert.equal(c.basis, 'official-records-only');
  assert.equal('label' in c, false, 'no verdict label field');
  assert.equal('verdict' in c, false);
});

// ── esc + VERDICT_LABELS smoke ───────────────────────────────────────────────────────────────────
test('esc escapes the dangerous five characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('VERDICT_LABELS includes scam (the canonical forbidden platform label)', () => {
  assert.ok(VERDICT_LABELS.includes('scam'));
});
