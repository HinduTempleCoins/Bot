// uscode.test.mjs — offline tests for the U.S. Code citation parser + link builder. No network.
// Run: node --test integrations/soapbox/uscode.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCitation, olrcUrl, corneliiUrl, uslmIdentifier, citationCard, USLM_SHAPE,
  renderPage, dataNote,
} from './uscode.mjs';

test('parseCitation handles the common written forms', () => {
  assert.deepEqual(parseCitation('18 U.S.C. § 2261A'), { title: 18, section: '2261A', subsections: '', normalized: '18 U.S.C. § 2261A' });
  assert.equal(parseCitation('18 USC 2261A').section, '2261A');
  assert.equal(parseCitation('42 U.S.C. §§ 1983').section, '1983'); // double section-sign tolerated
  const sub = parseCitation('18 U.S.C. 2261A(b)(2)');
  assert.equal(sub.section, '2261A');
  assert.equal(sub.subsections, '(b)(2)');
  assert.equal(sub.normalized, '18 U.S.C. § 2261A(b)(2)');
});

test('parseCitation handles hyphenated sections and the "of title" form', () => {
  assert.equal(parseCitation('42 U.S.C. § 1395w-4').section, '1395w-4');
  const b = parseCitation('§ 2261A of title 18');
  assert.equal(b.title, 18);
  assert.equal(b.section, '2261A');
});

test('parseCitation rejects junk and out-of-range titles', () => {
  assert.equal(parseCitation('not a citation'), null);
  assert.equal(parseCitation(''), null);
  assert.equal(parseCitation('99 U.S.C. § 1'), null); // no title 99
  assert.equal(parseCitation('18 U.S.C. §'), null);   // no section
});

test('uslmIdentifier builds the stable @identifier path', () => {
  assert.equal(uslmIdentifier(parseCitation('18 U.S.C. § 2261A')), '/us/usc/t18/s2261A');
  assert.equal(uslmIdentifier(null), '');
});

test('olrcUrl points at the official OLRC source by citation', () => {
  const u = olrcUrl(parseCitation('18 U.S.C. § 2261A'));
  assert.match(u, /uscode\.house\.gov/);
  assert.match(u, /title18-section2261A/);
  assert.equal(olrcUrl(null), '');
});

test('corneliiUrl builds the Cornell LII display link', () => {
  assert.equal(corneliiUrl(parseCitation('18 U.S.C. § 2261A')), 'https://www.law.cornell.edu/uscode/text/18/2261A');
  assert.equal(corneliiUrl(null), '');
});

test('citationCard assembles parse + identifier + both links with public-domain license', () => {
  const c = citationCard('18 U.S.C. § 2261A');
  assert.equal(c.title, 18);
  assert.equal(c.section, '2261A');
  assert.equal(c.identifier, '/us/usc/t18/s2261A');
  assert.match(c.olrcUrl, /uscode\.house\.gov/);
  assert.match(c.corneliiUrl, /law\.cornell\.edu/);
  assert.equal(c.license, 'public-domain');
  assert.match(c.source, /Office of the Law Revision Counsel/);
  assert.equal(citationCard('garbage'), null);
});

test('USLM_SHAPE documents the bulk-XML download + structure for ingestion', () => {
  assert.match(USLM_SHAPE.downloadRoot, /uscode\.house\.gov\/download/);
  assert.match(USLM_SHAPE.namespace, /xml\.house\.gov\/schemas\/uslm/);
  assert.equal(USLM_SHAPE.root, 'uscDoc');
  assert.ok(USLM_SHAPE.hierarchy.includes('section'));
  assert.match(USLM_SHAPE.identifierPattern, /\/us\/usc\/t<title>\/s<section>/);
});

test('renderPage renders a citation card with both source links, escapes injection', () => {
  const html = renderPage({ card: citationCard('18 U.S.C. § 2261A') });
  assert.ok(html.includes('18 U.S.C. § 2261A'));
  assert.ok(html.includes('/us/usc/t18/s2261A'));
  assert.ok(html.includes('uscode.house.gov'));
  assert.ok(html.includes('law.cornell.edu'));
  // escaping: feed a card with an injected section via a crafted input
  const bad = renderPage({ input: '<script>x</script>' });
  assert.ok(!bad.includes('<script>x'));
  assert.ok(bad.includes('Could not parse'));
});

test('renderPage handles unparseable input without throwing', () => {
  assert.ok(renderPage({ input: 'nope' }).includes('Could not parse'));
  assert.ok(renderPage({}).includes('U.S. Code citation'));
});

test('dataNote names OLRC/USLM, public-domain, and the window-not-scrape posture', () => {
  const n = dataNote();
  assert.match(n, /Office of the Law Revision Counsel|OLRC/);
  assert.match(n, /public domain/);
  assert.match(n, /never scrape/);
});
