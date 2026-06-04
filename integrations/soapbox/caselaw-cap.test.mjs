// caselaw-cap.test.mjs — offline tests for the Caselaw Access Project (CAP) reader.
// Network stubbed via __setFetch; no live calls. CAP reads are keyless/open. Run:
//   node --test integrations/soapbox/caselaw-cap.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCitation, caseById, caseByCitation, citationUrl, caseText, snippetOf, normalizeCase,
  renderPage, dataNote, __setFetch,
} from './caselaw-cap.mjs';

const RAW_CASE = {
  id: 12345, name_abbreviation: 'Brown v. Board of Education',
  name: 'Oliver Brown et al. v. Board of Education of Topeka',
  decision_date: '1954-05-17',
  court: { name_abbreviation: 'U.S.', name: 'Supreme Court of the United States' },
  citations: [{ cite: '347 U.S. 483', type: 'official' }],
  reporter: { full_name: 'United States Supreme Court Reports' },
  casebody: { data: { opinions: [{ text: 'We conclude that separate educational facilities are inherently unequal. ' + 'x '.repeat(200) }] } },
  frontend_url: 'https://case.law/caselaw/?reporter=us&volume=347&case=brown',
};

function envelopeFetch(payload, { ok = true } = {}) { return async () => ({ ok, json: async () => payload }); }
function captureFetch(sink, payload) { return async (u) => { sink.url = String(u); return { ok: true, json: async () => payload }; }; }
function throwingFetch() { return async () => { throw new Error('network down'); }; }

test('parseCitation parses standard reporter citations', () => {
  assert.deepEqual(parseCitation('347 U.S. 483'), { volume: '347', reporter: 'U.S.', page: '483', normalized: '347 U.S. 483' });
  assert.deepEqual(parseCitation('98 F.3d 1010'), { volume: '98', reporter: 'F.3d', page: '1010', normalized: '98 F.3d 1010' });
  assert.equal(parseCitation('5 Cal. 4th 200').reporter, 'Cal. 4th');
  assert.equal(parseCitation('not a citation'), null);
  assert.equal(parseCitation(''), null);
});

test('citationUrl builds a case.law lookup URL from a parsed citation', () => {
  const u = citationUrl(parseCitation('347 U.S. 483'));
  assert.match(u, /case\.law/);
  assert.match(u, /347%20U\.S\.%20483|347\+U\.S\.\+483/);
  assert.equal(citationUrl(null), '');
});

test('caseText pulls the first opinion text and collapses whitespace', () => {
  assert.match(caseText(RAW_CASE), /^We conclude that separate/);
  assert.equal(caseText({ casebody: { data: { opinions: [] } } }), '');
  assert.equal(caseText(null), '');
});

test('snippetOf bounds text and adds an ellipsis when truncated', () => {
  assert.equal(snippetOf('short', 280), 'short');
  const s = snippetOf('alpha beta gamma delta epsilon zeta', 12);
  assert.ok(s.length <= 14);
  assert.ok(s.endsWith('…'));
});

test('normalizeCase flattens a CAP record with public-domain provenance', () => {
  const c = normalizeCase(RAW_CASE);
  assert.equal(c.caseId, '12345');
  assert.equal(c.caseName, 'Brown v. Board of Education');
  assert.equal(c.court, 'U.S.');
  assert.equal(c.decisionDate, '1954-05-17');
  assert.deepEqual(c.citations, ['347 U.S. 483']);
  assert.match(c.snippet, /separate educational facilities/);
  assert.equal(c.license, 'public-domain');
  assert.match(c.source, /Caselaw Access Project/);
  assert.equal(c.url, RAW_CASE.frontend_url);
  assert.equal(normalizeCase(null), null);
  assert.equal(normalizeCase({}), null);
});

test('caseById fetches full_case text and normalizes; soft-fails to null', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, RAW_CASE));
  const c = await caseById(12345);
  __setFetch(null);
  assert.match(sink.url, /\/cases\/12345\//);
  assert.match(sink.url, /full_case=true/);
  assert.equal(c.caseName, 'Brown v. Board of Education');
  assert.equal(await caseById(''), null);
  __setFetch(throwingFetch());
  assert.equal(await caseById(12345), null);
  __setFetch(null);
});

test('caseById({full:true}) adds untruncated fullText; default keeps only the 280 snippet', async () => {
  const longBody = 'We conclude that separate educational facilities are inherently unequal. ' + 'x '.repeat(400);
  const rawLong = { ...RAW_CASE, casebody: { data: { opinions: [{ text: longBody }] } } };
  // default: snippet only, no fullText, snippet bounded.
  __setFetch(envelopeFetch(rawLong));
  const plain = await caseById(12345);
  __setFetch(null);
  assert.ok(plain.snippet.length <= 282, 'snippet stays bounded');
  assert.equal(plain.fullText, undefined, 'no fullText without {full:true}');
  // full: the whole opinion text, untruncated.
  __setFetch(envelopeFetch(rawLong));
  const full = await caseById(12345, { full: true });
  __setFetch(null);
  assert.equal(full.fullText, caseText(rawLong), 'fullText is the untruncated caseText');
  assert.ok(full.fullText.length > 280, 'fullText exceeds the snippet cap');
  assert.ok(full.snippet.length <= 282, 'snippet still present and bounded alongside fullText');
});

test('caseByCitation parses, queries by cite, and tags the lookup', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { results: [RAW_CASE] }));
  const c = await caseByCitation('347 U.S. 483');
  __setFetch(null);
  assert.match(sink.url, /cite=347\+U\.S\.\+483|cite=347%20U\.S\.%20483/);
  assert.equal(c.caseName, 'Brown v. Board of Education');
  assert.equal(c.citationLookup, '347 U.S. 483');
  assert.equal(await caseByCitation('garbage'), null);
});

test('caseByCitation soft-fails to null when no results', async () => {
  __setFetch(envelopeFetch({ results: [] }));
  assert.equal(await caseByCitation('347 U.S. 483'), null);
  __setFetch(null);
});

test('caseByCitation({full:true}) carries untruncated fullText; default keeps only the snippet', async () => {
  const longBody = 'We conclude that separate educational facilities are inherently unequal. ' + 'x '.repeat(400);
  const rawLong = { ...RAW_CASE, casebody: { data: { opinions: [{ text: longBody }] } } };
  // default (back-compat): snippet only, no fullText.
  __setFetch(envelopeFetch({ results: [rawLong] }));
  const plain = await caseByCitation('347 U.S. 483');
  __setFetch(null);
  assert.equal(plain.fullText, undefined, 'no fullText without {full:true}');
  assert.ok(plain.snippet.length <= 282, 'snippet bounded');
  assert.equal(plain.citationLookup, '347 U.S. 483');
  // {full:true}: the whole opinion text, untruncated, alongside the bounded snippet.
  __setFetch(envelopeFetch({ results: [rawLong] }));
  const full = await caseByCitation('347 U.S. 483', { full: true });
  __setFetch(null);
  assert.equal(full.fullText, caseText(rawLong), 'fullText is the untruncated caseText');
  assert.ok(full.fullText.length > 280, 'fullText exceeds the snippet cap');
  assert.ok(full.snippet.length <= 282, 'snippet still present alongside fullText');
  assert.equal(full.citationLookup, '347 U.S. 483');
});

test('renderPage renders a case card and escapes injection', () => {
  const html = renderPage({ case: normalizeCase({ ...RAW_CASE, name_abbreviation: '<script>x</script>' }) });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('1954-05-17'));
  assert.ok(html.includes('347 U.S. 483'));
  assert.ok(html.includes('Read the full case'));
  assert.ok(html.includes('source: Caselaw Access Project'));
});

test('renderPage shows the FULL opinion text when the card carries fullText, else the snippet', () => {
  const longBody = 'We conclude that separate educational facilities are inherently unequal. ' + 'y '.repeat(400);
  const full = normalizeCase({ ...RAW_CASE, casebody: { data: { opinions: [{ text: longBody }] } } }, { full: true });
  const htmlFull = renderPage({ case: full });
  assert.ok(htmlFull.includes('cap-fulltext'), 'renders the full-text block');
  assert.ok(htmlFull.includes('inherently unequal'), 'includes the opinion body');
  // the full block carries text well beyond the 280-char snippet cap (no ellipsis truncation).
  assert.ok(full.fullText.length > 280, 'fullText exceeds the snippet cap');
  assert.ok(htmlFull.includes(full.fullText.slice(0, 300)), 'full text is rendered untruncated');
  // without fullText, the snippet path still renders.
  const htmlSnip = renderPage({ case: normalizeCase(RAW_CASE) });
  assert.ok(htmlSnip.includes('cap-snippet'), 'falls back to the snippet block');
  assert.ok(!htmlSnip.includes('cap-fulltext'), 'no full-text block without fullText');
});

test('renderPage handles a not-found case without throwing', () => {
  const html = renderPage({ citation: '999 X. 1' });
  assert.ok(html.includes('No case found'));
  assert.ok(html.includes('999 X. 1'));
});

test('dataNote names CAP, public-domain, and host-forever', () => {
  const n = dataNote();
  assert.match(n, /Caselaw Access Project/);
  assert.match(n, /public domain/);
  assert.match(n, /host-forever/);
});
