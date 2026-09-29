import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldRows, sparqlFor, NOT_A_SERIES } from './films-relations.mjs';

const r = (f, p, v, vl, extra = {}) => ({ f: { value: `http://www.wikidata.org/entity/${f}` }, p: { value: p }, v: { value: `http://www.wikidata.org/entity/${v}` }, vLabel: { value: vl }, ...extra });

test('foldRows: sequels, series order, studios, remakes; list-type "series" dropped', () => {
  const out = foldRows([
    r('Q2', 'P155', 'Q1', 'Toy Story'), r('Q2', 'P156', 'Q3', 'Toy Story 3'),
    r('Q2', 'P179', 'Q10', 'Toy Story', { n: { value: '2' } }),
    r('Q2', 'P179', 'Q11', 'list of Pixar films', { n: { value: '3' } }),
    r('Q2', 'P272', 'Q127552', 'Pixar'),
    r('Q9', 'P144', 'Q1', 'Toy Story', { isFilm: { value: 'true' } }),
  ]);
  assert.equal(out.byFilm.Q2.prev, 'Q1');
  assert.equal(out.byFilm.Q2.next, 'Q3');
  assert.deepEqual(out.byFilm.Q2.series, [{ id: 'Q10', t: 'Toy Story', n: 2 }]);
  assert.equal(out.byFilm.Q2.studio[0].t, 'Pixar');
  assert.deepEqual(out.byFilm.Q9.remakeOf, ['Q1']);
  assert.equal(out.groups.Q127552.kind, 'studio');
  assert.ok(NOT_A_SERIES.test("BBC's 100 Greatest Films of the 21st Century"));
  assert.match(sparqlFor(['Q1']), /pq:P1545/);
});
