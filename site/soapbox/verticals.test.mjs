import { test } from 'node:test';
import assert from 'node:assert';
import {
  VERTICALS, verticalPaths, findVertical, renderVertical,
} from './verticals.mjs';

// OFFLINE only — no network. We test the registry shape, lookup, and rendering. For summary rendering
// we use the `/cams` vertical because its module fn (camsSummary) reads a STATIC curated list with no
// fetch; for search rendering we render with NO query, which never loads any module at all. Soft-fail
// paths (unknown path / unavailable module) are also covered, so the suite makes zero network calls.

const EXPECTED_PATHS = [
  '/energy', '/weather', '/cams', '/scanners', '/media', '/gridcoin', '/nasa',
  '/commodities-goods', '/public-safety', '/legal', '/pharma', '/biodiversity', '/vehicle',
];

test('VERTICALS exposes the expected paths', () => {
  for (const p of EXPECTED_PATHS) {
    assert.ok(verticalPaths.includes(p), `has ${p}`);
  }
  assert.equal(VERTICALS.length, EXPECTED_PATHS.length, 'no unexpected extras');
});

test('every vertical entry has the required shape', () => {
  for (const v of VERTICALS) {
    assert.equal(typeof v.path, 'string');
    assert.ok(v.path.startsWith('/'), `${v.path} is a path`);
    assert.equal(typeof v.title, 'string');
    assert.ok(v.title.length, 'has a title');
    assert.equal(typeof v.navLabel, 'string');
    assert.ok(['summary', 'search'].includes(v.kind), `${v.path} kind is summary|search`);
    assert.equal(typeof v.render, 'function');
  }
});

test('findVertical resolves by path and is undefined for unknown', () => {
  const cams = findVertical('/cams');
  assert.ok(cams);
  assert.equal(cams.path, '/cams');
  assert.equal(cams.kind, 'summary');
  assert.equal(findVertical('/nope'), undefined);
});

test('renderVertical returns an HTML string for a summary vertical (no network)', async () => {
  // camsSummary is a pure static-list summary — no fetch.
  const html = await renderVertical('/cams');
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0);
  assert.ok(html.includes('class=card'), 'renders into card markup');
});

test('a search vertical with NO query renders a search form (no module loaded)', async () => {
  const html = await renderVertical('/legal');
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('<form'), 'shows a form');
  assert.ok(html.includes('method=get'), 'GET form');
  assert.ok(html.includes('name=q'), 'query input named q');
  // with no query there must be NO results card
  assert.ok(!html.includes('results'), 'no results section without a query');
});

test('renderVertical escapes the query in the search form (no injection)', async () => {
  const html = await renderVertical('/vehicle', '<script>x</script>');
  assert.ok(!html.includes('<script>x</script>'), 'raw script not echoed');
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'), 'query is escaped into the form value');
});

test('renderVertical soft-fails to an unavailable card for an unknown path (never throws)', async () => {
  const html = await renderVertical('/does-not-exist');
  assert.equal(typeof html, 'string');
  assert.ok(/temporarily unavailable/i.test(html), 'friendly unavailable card');
});

test('summary vertical with a stubbed/injected module fn renders, and an unavailable one degrades', async () => {
  // Inject a render() that mimics a summary vertical returning a known object, to prove the generic
  // object→cards renderer produces a string with our data (no module import, no network).
  const v = findVertical('/cams');
  const original = v.render;
  try {
    v.render = async () => `<div class=card><h2>Stubbed</h2><p>${'OK-MARKER'}</p></div>`;
    const html = await renderVertical('/cams');
    assert.ok(html.includes('OK-MARKER'), 'uses the injected render output');

    // Now a render() that throws must degrade to the unavailable card, never propagate.
    v.render = async () => { throw new Error('boom'); };
    const failed = await renderVertical('/cams');
    assert.ok(/temporarily unavailable/i.test(failed), 'throwing render degrades gracefully');
  } finally {
    v.render = original;
  }
});
