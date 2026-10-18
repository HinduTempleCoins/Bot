// films-credits.test.mjs — OFFLINE tests: query shape, folding SPARQL rows, ordering, the byte-offset index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { creditsQuery, foldCredits, finishFilm, indexNdjson, readRecord } from './films-credits.mjs';

const E = 'http://www.wikidata.org/entity/';
const row = (f, p, v, label, sl) => ({ f: { value: E + f }, p: { value: p }, v: { value: E + v }, vLabel: { value: label }, ...(sl != null ? { sl: { value: String(sl) } } : {}) });

test('query asks for every role for the given films only', () => {
  const q = creditsQuery(['Q1', 'bad', 'Q2']);
  assert.match(q, /VALUES \?f \{ wd:Q1 wd:Q2 \}/);
  for (const p of ['P161', 'P57', 'P58', 'P86', 'P162', 'P344', 'P1040']) assert.ok(q.includes(`wdt:${p}`));
});

test('fold: roles, people index, no duplicates, unlabelled items skipped, best-known cast first', () => {
  const { films, people } = foldCredits([
    row('Q10', 'P161', 'Q100', 'Minor Actor', 2), row('Q10', 'P161', 'Q101', 'Star Actor', 90), row('Q10', 'P161', 'Q101', 'Star Actor', 90),
    row('Q10', 'P57', 'Q102', 'The Director', 50), row('Q10', 'P161', 'Q103', 'Q103'),
    row('Q11', 'P161', 'Q101', 'Star Actor', 90),
  ]);
  const f = finishFilm(films.get('Q10'));
  assert.deepEqual(f.cast, [['Q101', 'Star Actor'], ['Q100', 'Minor Actor']]);
  assert.deepEqual(f.dir, [['Q102', 'The Director']]);
  assert.deepEqual(people.get('Q101').f, [['Q10', 'cast'], ['Q11', 'cast']]);
  assert.ok(!people.has('Q103'));
});

test('index reads records by key from disk and finds names', () => {
  const dir = mkdtempSync(tmpdir() + '/credits-test-');
  writeFileSync(dir + '/p.ndjson', [{ q: 'Q1', n: 'Ana "Q" López', f: [] }, { q: 'Q22', n: 'Bo', f: [['Q5', 'dir']] }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const ix = indexNdjson(dir + '/p.ndjson', 'q', { nameField: 'n' });
  assert.deepEqual(readRecord(ix, 'Q22'), { q: 'Q22', n: 'Bo', f: [['Q5', 'dir']] });
  assert.equal(readRecord(ix, 'Q9'), null);
  assert.deepEqual(ix.names, [['Q1', 'Ana "Q" López'], ['Q22', 'Bo']]);
  assert.equal(readRecord(indexNdjson(dir + '/missing.ndjson', 'q'), 'Q1'), null);
});
