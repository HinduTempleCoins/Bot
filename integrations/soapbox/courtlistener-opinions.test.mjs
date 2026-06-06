// courtlistener-opinions.test.mjs — offline tests for the CourtListener v4 opinions/clusters reader.
// Network stubbed via __setFetch; no live calls. Works keyless. Run:
//   node --test integrations/soapbox/courtlistener-opinions.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchCases, opinionSnippet, opinionText, citationCount, clusterDetail,
  normalizeCase, plainText, snippetOf, idFromUrl, slugFromUrl,
  renderPage, dataNote, __setFetch,
  COURTS, courtName, searchDockets, normalizeDocket, docketUrl,
} from './courtlistener-opinions.mjs';

const RAW_HIT = {
  cluster_id: 118144, caseName: 'Brown v. Board of Education', court: 'scotus',
  dateFiled: '1954-05-17', citeCount: 25000, status: 'Published',
  citation: ['347 U.S. 483'], docketNumber: '1',
};

function envelopeFetch(payload, { ok = true } = {}) { return async () => ({ ok, json: async () => payload }); }
function captureFetch(sink, payload) { return async (u) => { sink.url = String(u); return { ok: true, json: async () => payload }; }; }
function throwingFetch() { return async () => { throw new Error('network down'); }; }

test('idFromUrl / slugFromUrl pull the id and slug from resource URLs', () => {
  assert.equal(idFromUrl('https://www.courtlistener.com/api/rest/v4/clusters/118144/'), '118144');
  assert.equal(idFromUrl(''), '');
  assert.equal(slugFromUrl('.../courts/scotus/'), 'scotus');
});

test('plainText prefers plain_text then strips html, collapses whitespace', () => {
  assert.equal(plainText({ plain_text: '  hello\n\nworld  ' }), 'hello world');
  assert.equal(plainText({ html: '<p>Equal <b>protection</b></p>' }), 'Equal protection');
  assert.equal(plainText(null), '');
});

test('snippetOf is bounded and word-safe with an ellipsis', () => {
  assert.equal(snippetOf('short text', 280), 'short text');
  const long = 'word '.repeat(100).trim();
  const s = snippetOf(long, 40);
  assert.ok(s.length <= 42);
  assert.ok(s.endsWith('…'));
  assert.ok(!s.slice(0, -1).includes('  '));
});

test('normalizeCase flattens a search hit with public-domain provenance', () => {
  const c = normalizeCase(RAW_HIT);
  assert.equal(c.clusterId, '118144');
  assert.equal(c.caseName, 'Brown v. Board of Education');
  assert.equal(c.court, 'scotus');
  assert.equal(c.citationCount, 25000);
  assert.equal(c.precedentialStatus, 'Published');
  assert.deepEqual(c.citations, ['347 U.S. 483']);
  assert.match(c.url, /\/opinion\/118144\/$/);
  assert.equal(c.license, 'public-domain');
  assert.match(c.source, /Free Law Project/);
  assert.equal(normalizeCase(null), null);
  assert.equal(normalizeCase({}), null);
});

test('normalizeCase captures the search-result snippet excerpt and strips highlight tags', () => {
  const withSnippet = normalizeCase({ ...RAW_HIT, snippet: 'Separate <mark>educational</mark> facilities are inherently unequal.' });
  assert.equal(withSnippet.snippet, 'Separate educational facilities are inherently unequal.', 'snippet captured, <mark> stripped');
  // nested opinions[].snippet fallback
  const nested = normalizeCase({ ...RAW_HIT, snippet: '', opinions: [{ snippet: 'a relevant excerpt' }] });
  assert.equal(nested.snippet, 'a relevant excerpt');
  // absent → empty string, never undefined
  assert.equal(normalizeCase(RAW_HIT).snippet, '');
});

test('searchCases queries the search endpoint and normalizes; court/date narrow it', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { results: [RAW_HIT] }));
  const rows = await searchCases({ q: 'segregation', court: 'scotus', filedAfter: '1950-01-01' });
  __setFetch(null);
  assert.match(sink.url, /\/search\/\?/);
  assert.match(sink.url, /type=o/);
  assert.match(sink.url, /court=scotus/);
  assert.match(sink.url, /filed_after=1950-01-01/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].caseName, 'Brown v. Board of Education');
});

test('searchCases soft-fails to [] on empty query, network error, bad shape', async () => {
  assert.deepEqual(await searchCases({ q: '' }), []);
  __setFetch(throwingFetch());
  assert.deepEqual(await searchCases({ q: 'x' }), []);
  __setFetch(envelopeFetch({ nope: true }));
  assert.deepEqual(await searchCases({ q: 'x' }), []);
  __setFetch(null);
});

test('searchCases surfaces pagination total/hasMore without breaking the array shape', async () => {
  // API reports 4231 total matches + a next page; we return one page but must not hide that.
  __setFetch(envelopeFetch({ count: 4231, next: 'https://.../search/?page=2', results: [RAW_HIT] }));
  const rows = await searchCases({ q: 'segregation' });
  __setFetch(null);
  assert.equal(rows.length, 1);          // still a normal array of cards
  assert.equal(rows.totalCount, 4231);   // the REAL match count (was dropped)
  assert.equal(rows.hasMore, true);      // there are more pages
  // non-enumerable: spreading/JSON still see only the rows, so existing callers are unaffected.
  assert.deepEqual([...rows].length, 1);
  assert.equal(Object.keys(JSON.parse(JSON.stringify(rows))).length, 1);
});

test('searchCases court-only BROWSE: no early [], honors orderBy, lists the court', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { results: [RAW_HIT] }));
  const rows = await searchCases({ q: '', court: 'scotus', orderBy: 'dateFiled desc' });
  __setFetch(null);
  // empty q + court → did NOT early-return [], queried the court ordered by date.
  assert.equal(rows.length, 1);
  assert.match(sink.url, /court=scotus/);
  assert.match(sink.url, /order_by=dateFiled\+desc/);
  // no q param sent when q is empty
  assert.ok(!/(\?|&)q=/.test(sink.url), 'no q= param on a bare court browse');
});

test('searchCases honors a custom orderBy on a normal search; defaults to score desc', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { results: [RAW_HIT] }));
  await searchCases({ q: 'segregation' });
  assert.match(sink.url, /order_by=score\+desc/);
  await searchCases({ q: 'segregation', orderBy: 'dateFiled desc' });
  __setFetch(null);
  assert.match(sink.url, /order_by=dateFiled\+desc/);
});

test('searchCases STILL returns [] when q empty AND no court/filedAfter', async () => {
  assert.deepEqual(await searchCases({ q: '' }), []);
  assert.deepEqual(await searchCases({}), []);
});

test('COURTS lists SCOTUS + the 13 Courts of Appeals; courtName resolves a slug', () => {
  assert.equal(COURTS.supreme.slug, 'scotus');
  assert.equal(COURTS.circuits.length, 13);
  const slugs = COURTS.circuits.map((c) => c.slug);
  for (const s of ['ca1', 'ca11', 'cadc', 'cafc']) assert.ok(slugs.includes(s), `has ${s}`);
  assert.match(courtName('scotus'), /Supreme Court/);
  assert.equal(courtName('zzz'), 'zzz');
});

const RAW_DOCKET = {
  docket_id: 65432, caseName: 'United States v. Acme Corp.', docketNumber: '1:21-cv-01234',
  court: 'nysd', dateFiled: '2021-02-12', dateTerminated: '2022-09-01',
  nature_of_suit: 'Antitrust', assigned_to_str: 'Hon. Jane Roe',
  absolute_url: '/docket/65432/united-states-v-acme/',
};

test('normalizeDocket flattens a RECAP docket row; docketUrl builds the web link', () => {
  const d = normalizeDocket(RAW_DOCKET);
  assert.equal(d.docketId, '65432');
  assert.equal(d.caseName, 'United States v. Acme Corp.');
  assert.equal(d.docketNumber, '1:21-cv-01234');
  assert.equal(d.court, 'nysd');
  assert.equal(d.dateFiled, '2021-02-12');
  assert.equal(d.dateTerminated, '2022-09-01');
  assert.equal(d.natureOfSuit, 'Antitrust');
  assert.equal(d.assignedTo, 'Hon. Jane Roe');
  assert.match(d.url, /\/docket\/65432\//);
  assert.equal(normalizeDocket(null), null);
  assert.equal(normalizeDocket({}), null);
  // docketUrl falls back to /docket/<id>/ when no absolute_url
  assert.match(docketUrl({ docket_id: 9 }), /\/docket\/9\/$/);
});

test('searchDockets queries RECAP (type=r) and normalizes; soft-fails to []', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { results: [RAW_DOCKET] }));
  const rows = await searchDockets({ q: 'acme', court: 'nysd' });
  assert.match(sink.url, /type=r/);
  assert.match(sink.url, /court=nysd/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].caseName, 'United States v. Acme Corp.');
  // empty q AND no court → []
  assert.deepEqual(await searchDockets({ q: '' }), []);
  __setFetch(throwingFetch());
  assert.deepEqual(await searchDockets({ q: 'x' }), []);
  __setFetch(null);
});

test('opinionSnippet returns a bounded snippet + opinion url, or null', async () => {
  __setFetch(envelopeFetch({ type: 'lead', plain_text: 'We hold that ' + 'reasoning '.repeat(80), cluster: '.../clusters/118144/' }));
  const s = await opinionSnippet(11, { max: 50 });
  __setFetch(null);
  assert.equal(s.opinionId, '11');
  assert.ok(s.snippet.length <= 52);
  assert.match(s.url, /\/opinion\/118144\/$/);
  assert.equal(s.license, 'public-domain');
  assert.equal(await opinionSnippet(''), null);
});

test('opinionText returns the FULL untruncated opinion body + cluster metadata', async () => {
  // a body well over the 280-char snippet limit, with inlined cluster metadata.
  const fullBody = 'We hold that ' + 'the reasoning is detailed and long. '.repeat(40);
  __setFetch(envelopeFetch({
    type: 'lead', plain_text: fullBody, absolute_url: '/opinion/118144/brown-v-board/',
    cluster: {
      id: 118144, case_name: 'Brown v. Board of Education', court: '.../courts/scotus/',
      date_filed: '1954-05-17', absolute_url: '/opinion/118144/brown/',
      citations: [{ volume: '347', reporter: 'U.S.', page: '483' }],
    },
  }));
  const o = await opinionText(11);
  __setFetch(null);
  assert.equal(o.opinionId, '11');
  // the WHOLE decision — not a 280-char snippet.
  assert.ok(o.text.length > 280, 'full text exceeds the snippet cap');
  assert.equal(o.text, plainText({ plain_text: fullBody }), 'text is the full plainText, untruncated');
  assert.equal(o.caseName, 'Brown v. Board of Education');
  assert.equal(o.court, 'scotus');
  assert.equal(o.dateFiled, '1954-05-17');
  assert.deepEqual(o.citation, ['347 U.S. 483']);
  assert.match(o.absolute_url, /\/opinion\/118144\/brown-v-board\//);
  assert.match(o.url, /\/opinion\/118144\/$/);
  assert.equal(o.license, 'public-domain');
  assert.equal(await opinionText(''), null);
  __setFetch(throwingFetch());
  assert.equal(await opinionText(11), null);
  __setFetch(null);
});

test('citationCount reads the cluster citation_count field', async () => {
  __setFetch(envelopeFetch({ citation_count: 25000 }));
  assert.equal(await citationCount(118144), 25000);
  __setFetch(null);
  assert.equal(await citationCount(''), null);
  __setFetch(envelopeFetch({}));
  assert.equal(await citationCount(118144), null);
  __setFetch(null);
});

test('clusterDetail flattens a cluster with assembled reporter citations', async () => {
  __setFetch(envelopeFetch({
    id: 118144, case_name: 'Brown v. Board of Education', court: '.../courts/scotus/',
    date_filed: '1954-05-17', citation_count: 25000, precedential_status: 'Published',
    citations: [{ volume: '347', reporter: 'U.S.', page: '483' }],
  }));
  const d = await clusterDetail(118144);
  __setFetch(null);
  assert.equal(d.clusterId, '118144');
  assert.equal(d.court, 'scotus');
  assert.deepEqual(d.citations, ['347 U.S. 483']);
  assert.equal(await clusterDetail(''), null);
});

test('renderPage renders a case list and escapes injection', () => {
  const html = renderPage({ cases: [normalizeCase({ ...RAW_HIT, caseName: '<script>x</script>' })] });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('scotus'));
  assert.ok(html.includes('source: CourtListener'));
});

test('renderPage renders a single detail with snippet + link, handles empties', () => {
  const html = renderPage({
    detail: normalizeCase(RAW_HIT),
    snippet: { snippet: 'Separate educational facilities are inherently unequal.' },
  });
  assert.ok(html.includes('Precedential status: Published'));
  assert.ok(html.includes('Cited by: 25000'));
  assert.ok(html.includes('inherently unequal'));
  assert.ok(html.includes('Read the full opinion'));
  assert.ok(renderPage({}).includes('No cases on record'));
});

test('renderPage detail shows FULL opinion text when fullText is supplied, else the snippet', () => {
  const fullBody = 'We hold that ' + 'the reasoning is detailed and long. '.repeat(40);
  // fullText as an opinionText()-shaped record
  const htmlFull = renderPage({ detail: normalizeCase(RAW_HIT), fullText: { text: fullBody } });
  assert.ok(htmlFull.includes('cl-fulltext'), 'renders the full-text block');
  assert.ok(htmlFull.includes(fullBody.slice(0, 300)), 'full text rendered untruncated');
  assert.ok(!htmlFull.includes('cl-snippet'), 'full-text block replaces the snippet block');
  // fullText as a raw string also works
  const htmlStr = renderPage({ detail: normalizeCase(RAW_HIT), fullText: fullBody });
  assert.ok(htmlStr.includes('cl-fulltext'));
  // without fullText, the snippet path still renders.
  const htmlSnip = renderPage({ detail: normalizeCase(RAW_HIT), snippet: { snippet: 'inherently unequal' } });
  assert.ok(htmlSnip.includes('cl-snippet'));
  assert.ok(!htmlSnip.includes('cl-fulltext'));
});

test('dataNote names CourtListener, public-domain, and PACER redaction respect', () => {
  const n = dataNote();
  assert.match(n, /CourtListener/);
  assert.match(n, /public domain/);
  assert.match(n, /PACER/);
  assert.match(n, /host-forever/);
});
