// theoi-parse.test.mjs — offline tests for the Theoi HTML parser (backlog 186).
// node:test + node:assert/strict, no network, happy + edge/soft-fail paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDeity,
  extractEpithets,
  toKnowledgeRecord,
  stripTags,
  decodeEntities,
  esc,
} from './theoi-parse.mjs';

const HERA = `
<html><head><title>HERA - Greek Goddess of Marriage &amp; Queen of Heaven</title></head>
<body>
  <h1>HERA</h1>
  <h2>Queen of the Gods, the Lady of Argos</h2>
  <table>
    <tr><td>GODDESS OF</td><td>Marriage, Women &amp; the Sky</td></tr>
    <tr><td>PARENTS</td><td>Kronos and Rhea</td></tr>
    <tr><td>CONSORTS</td><td>Zeus</td></tr>
    <tr><td>CHILDREN</td><td>Ares, Hebe, Hephaistos &amp; Eileithyia</td></tr>
  </table>
  <p>Hera (<i>Boôpis</i>) was the Olympian queen of the gods and the goddess of marriage.</p>
</body></html>`;

test('parseDeity: pulls name from h1', () => {
  assert.equal(parseDeity(HERA).name, 'HERA');
});

test('parseDeity: titles from h2 split into list', () => {
  assert.deepEqual(parseDeity(HERA).titles, ['Queen of the Gods', 'the Lady of Argos']);
});

test('parseDeity: domains from GODDESS OF row, & and comma split', () => {
  assert.deepEqual(parseDeity(HERA).domains, ['Marriage', 'Women', 'the Sky']);
});

test('parseDeity: parents split on "and"', () => {
  assert.deepEqual(parseDeity(HERA).parents, ['Kronos', 'Rhea']);
});

test('parseDeity: consorts single value', () => {
  assert.deepEqual(parseDeity(HERA).consorts, ['Zeus']);
});

test('parseDeity: children mixed comma + & separators', () => {
  assert.deepEqual(parseDeity(HERA).children, ['Ares', 'Hebe', 'Hephaistos', 'Eileithyia']);
});

test('parseDeity: summary is the first real paragraph, tags stripped', () => {
  const s = parseDeity(HERA).summary;
  assert.ok(s.startsWith('Hera (Boôpis)'));
  assert.ok(!s.includes('<'));
});

test('parseDeity: GOD OF (masculine) label also recognized', () => {
  const html = '<h1>ZEUS</h1><table><tr><td>GOD OF</td><td>the Sky, Thunder</td></tr></table>';
  const d = parseDeity(html);
  assert.equal(d.name, 'ZEUS');
  assert.deepEqual(d.domains, ['the Sky', 'Thunder']);
});

test('parseDeity: falls back to <title> for name when no h1', () => {
  const html = '<title>ATHENA - Greek Goddess of Wisdom</title><body>no h1 here</body>';
  assert.equal(parseDeity(html).name, 'ATHENA');
});

// --- soft-fail / edge ---------------------------------------------------------------------

test('parseDeity: empty string → null name, empty arrays, never throws', () => {
  const d = parseDeity('');
  assert.equal(d.name, null);
  assert.deepEqual(d.domains, []);
  assert.deepEqual(d.parents, []);
});

test('parseDeity: null/undefined/number input soft-fail', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const d = parseDeity(bad);
    assert.equal(d.name, null);
    assert.deepEqual(d.domains, []);
  }
});

test('parseDeity: garbage markup → name null, never throws', () => {
  const d = parseDeity('<<<not really html >>> &amp; <tr><td></td></tr>');
  assert.equal(d.name, null);
  assert.deepEqual(d.children, []);
});

test('parseDeity: de-dupes repeated values order-preserving', () => {
  const html = '<h1>X</h1><table><tr><td>PARENTS</td><td>Zeus, Zeus, Leto</td></tr></table>';
  assert.deepEqual(parseDeity(html).parents, ['Zeus', 'Leto']);
});

// --- extractEpithets ----------------------------------------------------------------------

test('extractEpithets: collects italic transliteration', () => {
  const eps = extractEpithets(HERA);
  assert.ok(eps.includes('Boôpis'));
});

test('extractEpithets: parenthetical transliterations, de-duped', () => {
  const html = '<p>Athena (Glaukopis) the (Glaukopis) bright-eyed (Pallas).</p>';
  const eps = extractEpithets(html);
  assert.ok(eps.includes('Glaukopis'));
  assert.ok(eps.includes('Pallas'));
  assert.equal(eps.filter((e) => e === 'Glaukopis').length, 1);
});

test('extractEpithets: empty/garbage → [] never throws', () => {
  assert.deepEqual(extractEpithets(''), []);
  assert.deepEqual(extractEpithets(null), []);
  assert.deepEqual(extractEpithets(123), []);
});

// --- toKnowledgeRecord --------------------------------------------------------------------

test('toKnowledgeRecord: full record shape with source url', () => {
  const r = toKnowledgeRecord(HERA, { url: 'https://www.theoi.com/Olympios/Hera.html' });
  assert.equal(r.entity, 'HERA');
  assert.equal(r.kind, 'deity');
  assert.equal(r.source, 'https://www.theoi.com/Olympios/Hera.html');
  assert.deepEqual(r.attributes.domains, ['Marriage', 'Women', 'the Sky']);
  assert.ok(r.attributes.epithets.includes('Boôpis'));
});

test('toKnowledgeRecord: missing opts → source null, still a record', () => {
  const r = toKnowledgeRecord(HERA);
  assert.equal(r.source, null);
  assert.equal(r.kind, 'deity');
});

test('toKnowledgeRecord: empty html → entity null, empty attribute arrays', () => {
  const r = toKnowledgeRecord('', {});
  assert.equal(r.entity, null);
  assert.deepEqual(r.attributes.parents, []);
  assert.deepEqual(r.attributes.epithets, []);
});

// --- helpers ------------------------------------------------------------------------------

test('stripTags: removes scripts/styles and tags, collapses whitespace', () => {
  const out = stripTags('<style>x{}</style><div>Hello   <b>World</b></div><script>z()</script>');
  assert.equal(out, 'Hello World');
});

test('decodeEntities: named, decimal, hex; unknown passes through', () => {
  assert.equal(decodeEntities('A &amp; B &#38; C &#x26; D &bogus;'), 'A & B & C & D &bogus;');
});

test('esc: escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});
