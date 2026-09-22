// privacy-law-map.test.mjs — offline unit tests for the federal↔Texas privacy statute map.
// Pure/offline: interpretingCases takes an injected searchCases (no network). Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIVACY_PAIRINGS, RELATIONSHIP_PATTERNS, findPairing, interpretingCases,
  texasStatuteUrl, renderMap, renderPairing, renderLegend, escapeHtml,
} from './privacy-law-map.mjs';

test('every pairing is well-formed and uses a known relationship pattern', () => {
  assert.ok(PRIVACY_PAIRINGS.length >= 5, 'at least five pairings');
  const ids = new Set();
  for (const p of PRIVACY_PAIRINGS) {
    assert.ok(p.id && !ids.has(p.id), `unique id: ${p.id}`);
    ids.add(p.id);
    assert.ok(p.topic && p.plain, `${p.id} has topic + plain-language`);
    assert.ok(RELATIONSHIP_PATTERNS[p.pattern], `${p.id} pattern is known: ${p.pattern}`);
    assert.ok(p.federal && p.federal.cite, `${p.id} has a federal cite`);
    assert.ok(p.texas && p.texas.cite, `${p.id} has a Texas cite`);
  }
});

test('the flagship pairings are present with correct citations', () => {
  const comp = findPairing('comprehensive');
  assert.equal(comp.pattern, 'fills-gap');
  assert.match(comp.texas.cite, /Ch\. 541/);
  const credit = findPairing('credit');
  assert.equal(credit.pattern, 'preempted'); // FCRA preempts much state law — the teaching contrast
  assert.match(credit.federal.cite, /1681/);
  const health = findPairing('health');
  assert.equal(health.pattern, 'goes-further');
});

test('findPairing is case-insensitive and soft-fails', () => {
  assert.equal(findPairing('CREDIT').id, 'credit');
  assert.equal(findPairing(''), null);
  assert.equal(findPairing(null), null);
  assert.equal(findPairing('nope'), null);
});

test('texasStatuteUrl builds official statutes.capitol.texas.gov links', () => {
  assert.equal(texasStatuteUrl('BC', '541'), 'https://statutes.capitol.texas.gov/Docs/BC/htm/BC.541.htm');
  assert.equal(texasStatuteUrl('HS', '181'), 'https://statutes.capitol.texas.gov/Docs/HS/htm/HS.181.htm');
  // unknown code soft-fails to the site root, never a broken/undefined URL
  assert.equal(texasStatuteUrl('ZZ', '9'), 'https://statutes.capitol.texas.gov/');
  assert.equal(texasStatuteUrl('BC', ''), 'https://statutes.capitol.texas.gov/');
});

test('interpretingCases pulls via the injected searchCases and passes the query', async () => {
  let seen = null;
  const fakeSearch = async (opts) => { seen = opts; return [{ caseName: 'Doe v. Roe', court: 'N.D. Tex.' }]; };
  const rows = await interpretingCases(findPairing('credit'), { searchCases: fakeSearch, limit: 3 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].caseName, 'Doe v. Roe');
  assert.equal(seen.limit, 3);
  assert.match(seen.q, /1681|Credit/i);
});

test('interpretingCases soft-fails (never throws) on a bad reader or bad pairing', async () => {
  const boom = async () => { throw new Error('network down'); };
  assert.deepEqual(await interpretingCases(findPairing('credit'), { searchCases: boom }), []);
  assert.deepEqual(await interpretingCases(null, { searchCases: async () => [1] }), []);
  assert.deepEqual(await interpretingCases(findPairing('credit'), {}), []); // no searchCases
});

test('renderMap escapes output and renders every pairing collapsed by default', () => {
  const html = renderMap({ casesHrefFor: (id) => `/privacy?statute=${id}` });
  for (const p of PRIVACY_PAIRINGS) {
    assert.ok(html.includes(escapeHtml(p.topic)), `renders topic ${p.topic}`);
  }
  assert.ok(html.includes('See the cases interpreting this'), 'offers the live-cases link');
  assert.ok(!html.includes('<script'), 'no script injection');
  assert.ok(html.includes(renderLegend().slice(0, 20)), 'includes the legend');
});

test('renderPairing opens the expanded pairing and lists injected cases', () => {
  const cases = [{ caseName: 'Smith v. Jones', court: 'SCOTUS' }];
  const html = renderPairing(findPairing('comprehensive'), { cases, open: true, casesHref: '/privacy?statute=comprehensive' });
  assert.match(html, /<details[^>]*\sopen/);
  assert.ok(html.includes('Smith v. Jones'));
  assert.ok(html.includes('Cases interpreting this'));
});

test('renderPairing shows an empty-state when the live lookup returns nothing', () => {
  const html = renderPairing(findPairing('health'), { cases: [], casesHref: '/privacy?statute=health' });
  assert.ok(html.includes('No interpreting cases returned'));
});

test('verify-flagged effective dates render with a confirm note (never asserted as fact)', () => {
  const html = renderPairing(findPairing('comprehensive'), { open: true });
  assert.ok(html.includes('confirm at the official link'), 'unverified date carries a confirm note');
});
