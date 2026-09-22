// caselaw-cap.test.mjs — offline tests for the (now CourtListener-backed) caselaw citation reader.
// Network stubbed via __setFetch; no live calls. CourtListener v4 reads work keyless. Run:
//   node --test integrations/soapbox/caselaw-cap.test.mjs
//
// BACKEND SWAP: this module used to read the decommissioned api.case.law; it now reads CourtListener REST
// v4 (citation-lookup + clusters + opinions) while keeping the same exports and case-card shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCitation, caseById, caseByCitation, citationUrl, caseText, snippetOf, normalizeCase,
  renderPage, dataNote, __setFetch,
} from './caselaw-cap.mjs';

// A realistic CourtListener v4 CLUSTER, with its lead opinion body inlined on sub_opinions (so the reader
// resolves the text without a second network hop in tests). Live, sub_opinions are resource URLs.
const RAW_CLUSTER = {
  id: 118144,
  case_name: 'Brown v. Board of Education',
  case_name_full: 'Oliver Brown et al. v. Board of Education of Topeka',
  date_filed: '1954-05-17',
  court: 'https://www.courtlistener.com/api/rest/v4/courts/scotus/',
  citations: [{ volume: '347', reporter: 'U.S.', page: '483', type: 1 }],
  precedential_status: 'Published',
  citation_count: 25000,
  absolute_url: '/opinion/118144/brown-v-board-of-education/',
  sub_opinions: [{ plain_text: 'We conclude that separate educational facilities are inherently unequal. ' + 'x '.repeat(200) }],
};
// The v4 citation-lookup endpoint returns an ARRAY of {citation, status, clusters:[…]} entries.
const LOOKUP_RESP = [{ citation: '347 U.S. 483', normalized_citations: ['347 U.S. 483'], status: 200, clusters: [RAW_CLUSTER] }];

function envelopeFetch(payload, { ok = true } = {}) { return async () => ({ ok, json: async () => payload }); }
function captureFetch(sink, payload) { return async (u, opts) => { sink.url = String(u); sink.opts = opts || {}; return { ok: true, json: async () => payload }; }; }
function throwingFetch() { return async () => { throw new Error('network down'); }; }

const clusterWithBody = (body) => ({ ...RAW_CLUSTER, sub_opinions: [{ plain_text: body }] });

test('parseCitation parses standard reporter citations', () => {
  assert.deepEqual(parseCitation('347 U.S. 483'), { volume: '347', reporter: 'U.S.', page: '483', normalized: '347 U.S. 483' });
  assert.deepEqual(parseCitation('98 F.3d 1010'), { volume: '98', reporter: 'F.3d', page: '1010', normalized: '98 F.3d 1010' });
  assert.equal(parseCitation('5 Cal. 4th 200').reporter, 'Cal. 4th');
  assert.equal(parseCitation('not a citation'), null);
  assert.equal(parseCitation(''), null);
});

test('citationUrl builds a CourtListener lookup URL from a parsed citation', () => {
  const u = citationUrl(parseCitation('347 U.S. 483'));
  assert.match(u, /courtlistener\.com/);
  assert.match(u, /347%20U\.S\.%20483|347\+U\.S\.\+483/);
  assert.match(u, /type=o/);
  assert.equal(citationUrl(null), '');
});

test('caseText pulls the opinion body (columns or inlined sub_opinions) and collapses whitespace', () => {
  assert.equal(caseText({ plain_text: '  hello\n\nworld  ' }), 'hello world');
  assert.equal(caseText({ html: '<p>Equal <b>protection</b></p>' }), 'Equal protection');
  assert.match(caseText(RAW_CLUSTER), /^We conclude that separate/);
  assert.equal(caseText({ sub_opinions: [] }), '');
  assert.equal(caseText(null), '');
});

test('snippetOf bounds text and adds an ellipsis when truncated', () => {
  assert.equal(snippetOf('short', 280), 'short');
  const s = snippetOf('alpha beta gamma delta epsilon zeta', 12);
  assert.ok(s.length <= 14);
  assert.ok(s.endsWith('…'));
});

test('normalizeCase flattens a CourtListener cluster with public-domain provenance', () => {
  const c = normalizeCase(RAW_CLUSTER);
  assert.equal(c.caseId, '118144');
  assert.equal(c.caseName, 'Brown v. Board of Education');
  assert.equal(c.court, 'scotus');
  assert.equal(c.decisionDate, '1954-05-17');
  assert.deepEqual(c.citations, ['347 U.S. 483']);
  assert.equal(c.reporter, 'U.S.');
  assert.match(c.snippet, /separate educational facilities/);
  assert.equal(c.license, 'public-domain');
  assert.match(c.source, /Free Law Project/);
  assert.match(c.url, /\/opinion\/118144\/brown-v-board-of-education\/$/);
  assert.equal(normalizeCase(null), null);
  assert.equal(normalizeCase({}), null);
});

test('caseById fetches the cluster by id and normalizes; soft-fails to null', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, RAW_CLUSTER));
  const c = await caseById(118144);
  __setFetch(null);
  assert.match(sink.url, /\/clusters\/118144\//);
  assert.equal(c.caseName, 'Brown v. Board of Education');
  assert.equal(await caseById(''), null);
  __setFetch(throwingFetch());
  assert.equal(await caseById(118144), null);
  __setFetch(null);
});

test('caseById({full:true}) adds untruncated fullText; default keeps only the 280 snippet', async () => {
  const longBody = 'We conclude that separate educational facilities are inherently unequal. ' + 'x '.repeat(400);
  const rawLong = clusterWithBody(longBody);
  // default: snippet only, no fullText, snippet bounded.
  __setFetch(envelopeFetch(rawLong));
  const plain = await caseById(118144);
  __setFetch(null);
  assert.ok(plain.snippet.length <= 282, 'snippet stays bounded');
  assert.equal(plain.fullText, undefined, 'no fullText without {full:true}');
  // full: the whole opinion text, untruncated.
  __setFetch(envelopeFetch(rawLong));
  const full = await caseById(118144, { full: true });
  __setFetch(null);
  assert.equal(full.fullText, caseText(rawLong), 'fullText is the untruncated caseText');
  assert.ok(full.fullText.length > 280, 'fullText exceeds the snippet cap');
  assert.ok(full.snippet.length <= 282, 'snippet still present and bounded alongside fullText');
});

test('caseByCitation POSTs volume/reporter/page to citation-lookup and tags the lookup', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, LOOKUP_RESP));
  const c = await caseByCitation('347 U.S. 483');
  __setFetch(null);
  assert.match(sink.url, /\/citation-lookup\/$/);
  assert.equal(sink.opts.method, 'POST');
  const body = JSON.parse(sink.opts.body);
  assert.equal(body.volume, '347');
  assert.equal(body.reporter, 'U.S.');
  assert.equal(body.page, '483');
  assert.equal(c.caseName, 'Brown v. Board of Education');
  assert.equal(c.citationLookup, '347 U.S. 483');
  assert.equal(await caseByCitation('garbage'), null);
});

test('caseByCitation soft-fails to null when no clusters match', async () => {
  __setFetch(envelopeFetch([{ citation: '347 U.S. 483', status: 404, clusters: [] }]));
  assert.equal(await caseByCitation('347 U.S. 483'), null);
  __setFetch(envelopeFetch([]));
  assert.equal(await caseByCitation('347 U.S. 483'), null);
  __setFetch(throwingFetch());
  assert.equal(await caseByCitation('347 U.S. 483'), null);
  __setFetch(null);
});

test('caseByCitation({full:true}) carries untruncated fullText; default keeps only the snippet', async () => {
  const longBody = 'We conclude that separate educational facilities are inherently unequal. ' + 'x '.repeat(400);
  const resp = [{ status: 200, clusters: [clusterWithBody(longBody)] }];
  // default (back-compat): snippet only, no fullText.
  __setFetch(envelopeFetch(resp));
  const plain = await caseByCitation('347 U.S. 483');
  __setFetch(null);
  assert.equal(plain.fullText, undefined, 'no fullText without {full:true}');
  assert.ok(plain.snippet.length <= 282, 'snippet bounded');
  assert.equal(plain.citationLookup, '347 U.S. 483');
  // {full:true}: the whole opinion text, untruncated, alongside the bounded snippet.
  __setFetch(envelopeFetch(resp));
  const full = await caseByCitation('347 U.S. 483', { full: true });
  __setFetch(null);
  assert.equal(full.fullText, caseText(clusterWithBody(longBody)), 'fullText is the untruncated caseText');
  assert.ok(full.fullText.length > 280, 'fullText exceeds the snippet cap');
  assert.ok(full.snippet.length <= 282, 'snippet still present alongside fullText');
  assert.equal(full.citationLookup, '347 U.S. 483');
});

test('renderPage renders a case card and escapes injection', () => {
  const html = renderPage({ case: normalizeCase({ ...RAW_CLUSTER, case_name: '<script>x</script>' }) });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('1954-05-17'));
  assert.ok(html.includes('347 U.S. 483'));
  assert.ok(html.includes('Read the full opinion'));
  assert.ok(html.includes('source: CourtListener'));
});

test('renderPage shows the FULL opinion text when the card carries fullText, else the snippet', () => {
  const longBody = 'We conclude that separate educational facilities are inherently unequal. ' + 'y '.repeat(400);
  const full = normalizeCase(clusterWithBody(longBody), { full: true });
  const htmlFull = renderPage({ case: full });
  assert.ok(htmlFull.includes('cap-fulltext'), 'renders the full-text block');
  assert.ok(htmlFull.includes('inherently unequal'), 'includes the opinion body');
  assert.ok(full.fullText.length > 280, 'fullText exceeds the snippet cap');
  assert.ok(htmlFull.includes(full.fullText.slice(0, 300)), 'full text is rendered untruncated');
  // without fullText, the snippet path still renders.
  const htmlSnip = renderPage({ case: normalizeCase(RAW_CLUSTER) });
  assert.ok(htmlSnip.includes('cap-snippet'), 'falls back to the snippet block');
  assert.ok(!htmlSnip.includes('cap-fulltext'), 'no full-text block without fullText');
});

test('renderPage handles a not-found case without throwing', () => {
  const html = renderPage({ citation: '999 X. 1' });
  assert.ok(html.includes('No case found'));
  assert.ok(html.includes('999 X. 1'));
});

test('dataNote names CourtListener, public-domain, and host-forever', () => {
  const n = dataNote();
  assert.match(n, /CourtListener/);
  assert.match(n, /public domain/);
  assert.match(n, /host-forever/);
});
