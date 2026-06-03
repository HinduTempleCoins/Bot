import { test } from 'node:test';
import assert from 'node:assert';
import { parseOaiXml, listRepositories, REPOSITORIES } from './oai-pmh.mjs';

// A realistic OAI-PMH ListRecords response: two good records (one multi-valued, one with entities &
// nested markup), one deleted record (must be skipped), and a resumptionToken to follow.
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <responseDate>2026-06-03T00:00:00Z</responseDate>
  <request verb="ListRecords" metadataPrefix="oai_dc">https://example.org/oai</request>
  <ListRecords>
    <record>
      <header><identifier>oai:example.org:1</identifier><datestamp>2026-01-01</datestamp></header>
      <metadata>
        <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>The Epic of Gilgamesh</dc:title>
          <dc:creator>Anonymous</dc:creator>
          <dc:creator>Translator, A.</dc:creator>
          <dc:date>2026-01-01</dc:date>
          <dc:identifier>https://example.org/items/1</dc:identifier>
          <dc:source>Library of Ashurbanipal</dc:source>
        </oai_dc:dc>
      </metadata>
    </record>
    <record>
      <header><identifier>oai:example.org:2</identifier></header>
      <metadata>
        <oai_dc:dc xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Tea &amp; Sympathy: a <emph>short</emph> story</dc:title>
          <dc:identifier>https://example.org/items/2</dc:identifier>
        </oai_dc:dc>
      </metadata>
    </record>
    <record>
      <header status="deleted"><identifier>oai:example.org:3</identifier></header>
    </record>
    <resumptionToken completeListSize="120" cursor="0">TOKEN-PAGE-2</resumptionToken>
  </ListRecords>
</OAI-PMH>`;

test('parseOaiXml extracts Dublin Core records with the expected fields', () => {
  const { records } = parseOaiXml(SAMPLE);
  assert.equal(records.length, 2, 'two records (deleted one skipped)');
  const r0 = records[0];
  assert.deepEqual(Object.keys(r0).sort(), ['creator', 'date', 'identifier', 'source', 'title']);
  assert.equal(r0.title, 'The Epic of Gilgamesh');
  assert.equal(r0.date, '2026-01-01');
  assert.equal(r0.identifier, 'https://example.org/items/1');
  assert.equal(r0.source, 'Library of Ashurbanipal');
});

test('parseOaiXml joins multi-valued DC fields with "; "', () => {
  const { records } = parseOaiXml(SAMPLE);
  assert.equal(records[0].creator, 'Anonymous; Translator, A.');
});

test('parseOaiXml decodes entities and strips nested markup', () => {
  const { records } = parseOaiXml(SAMPLE);
  assert.equal(records[1].title, 'Tea & Sympathy: a short story');
  assert.equal(records[1].creator, '', 'missing fields are empty strings, not undefined');
});

test('parseOaiXml skips deleted records', () => {
  const { records } = parseOaiXml(SAMPLE);
  assert.ok(!records.some((r) => r.identifier.includes('items/3') || r.title === ''));
});

test('parseOaiXml returns the resumptionToken when present', () => {
  const { resumptionToken } = parseOaiXml(SAMPLE);
  assert.equal(resumptionToken, 'TOKEN-PAGE-2');
});

test('parseOaiXml: empty/self-closed resumptionToken means done (null)', () => {
  const last = SAMPLE.replace('<resumptionToken completeListSize="120" cursor="0">TOKEN-PAGE-2</resumptionToken>',
    '<resumptionToken completeListSize="120" cursor="120"></resumptionToken>');
  const { resumptionToken } = parseOaiXml(last);
  assert.equal(resumptionToken, null);
});

test('parseOaiXml is namespace-prefix-agnostic on the record element', () => {
  const xml = `<OAI-PMH><ListRecords>
    <oai:record xmlns:oai="x"><oai:metadata><dc:title xmlns:dc="d">Prefixed Record</dc:title></oai:metadata></oai:record>
  </ListRecords></OAI-PMH>`;
  const { records } = parseOaiXml(xml);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Prefixed Record');
});

test('parseOaiXml soft-fails on garbage / non-string input', () => {
  for (const bad of ['', '<not xml', null, undefined, 42, {}]) {
    const out = parseOaiXml(bad);
    assert.deepEqual(out, { records: [], resumptionToken: null });
  }
});

test('parseOaiXml drops bare header-only records with no DC content', () => {
  const xml = `<ListRecords><record><header><identifier>oai:x:9</identifier></header></record></ListRecords>`;
  assert.deepEqual(parseOaiXml(xml).records, []);
});

test('listRepositories returns the curated directory as defensive copies', () => {
  const repos = listRepositories();
  assert.ok(repos.length >= 12, 'a real curated set');
  assert.equal(repos.length, REPOSITORIES.length);
  // includes the named aggregators from the spec
  const names = repos.map((r) => r.name).join(' | ');
  for (const n of ['DPLA', 'Europeana', 'Trove', 'OAPEN']) assert.ok(names.includes(n), `${n} present`);
  // every entry is well-formed
  for (const r of repos) {
    assert.ok(r.name && r.scope && r.oai && r.site, 'core fields present');
    assert.equal(typeof r.oaiPmh, 'boolean');
    assert.match(r.site, /^https?:\/\//);
  }
  // mutating the returned copy must not affect the source
  repos[0].name = 'MUTATED';
  assert.notEqual(REPOSITORIES[0].name, 'MUTATED');
});
