import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldRows, indexes, sparqlFor, queryBatch, __setFetch } from './films-based-on.mjs';

const row = (f, b, bl, extra = {}) => ({ f: { value: `http://www.wikidata.org/entity/${f}` }, b: { value: `http://www.wikidata.org/entity/${b}` }, bLabel: { value: bl }, ...extra });

test('foldRows merges authors, earliest year, kinds and Gutenberg ids per book', () => {
  const out = foldRows([
    row('Q1', 'Q150827', 'Frankenstein', { aLabel: { value: 'Mary Shelley' }, pub: { value: '+1831-01-01T00:00:00Z' }, gut: { value: '84' }, kindLabel: { value: 'novel' } }),
    row('Q1', 'Q150827', 'Frankenstein', { pub: { value: '+1818-01-01T00:00:00Z' }, gut: { value: '41445' } }),
    row('Q2', 'Q9', 'Q9'), // unlabelled → skipped
  ]);
  assert.deepEqual(out.Q1[0], { id: 'Q150827', t: 'Frankenstein', a: ['Mary Shelley'], y: 1818, kind: ['novel'], gut: ['84', '41445'] });
  assert.equal(out.Q2, undefined);
  const idx = indexes(out);
  assert.deepEqual(idx.byGutenberg['84'], ['Q1']);
  assert.deepEqual(idx.byBook.Q150827, ['Q1']);
});

test('sparqlFor asks for P144 with Gutenberg on the work or an edition; queryBatch soft-fails', async () => {
  const q = sparqlFor(['Q1', 'Q2']);
  assert.match(q, /VALUES \?f \{ wd:Q1 wd:Q2 \}/);
  assert.match(q, /wdt:P144/);
  assert.match(q, /wdt:P747 \?ed \. \?ed wdt:P2034/);
  __setFetch(async () => { throw new Error('offline'); });
  assert.equal(await queryBatch(['Q1']), null);
  __setFetch(async () => ({ ok: true, json: async () => ({ results: { bindings: [row('Q1', 'Q2', 'B')] } }) }));
  assert.equal((await queryBatch(['Q1'])).length, 1);
  __setFetch(null);
});
