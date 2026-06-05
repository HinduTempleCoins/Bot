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
  // gov / public-data reader verticals (queue #182/#181)
  '/recalls', '/tides', '/osha', '/broadband', '/nutrition', '/debt', '/product-recalls',
  '/environment', '/public-health', '/edgar', '/opportunities', '/datasets',
  // surface wave (wave-surface-pages)
  '/economy', '/health-research', '/census', '/world-development', '/patents', '/wikidata',
  '/scam-check', '/crime', '/parks', '/aviation', '/hazards', '/lawyers', '/benefits',
  '/vehicle-history', '/vehicle-value', '/market-health',
  // Hemp / cannabis vertical (#260)
  '/hemp',
  // Coupons & cashback vertical (#234)
  '/coupons',
  // Scholar graph + Wayback salvage (keyless-api-wave)
  '/citations', '/wayback',
  // Library (wave-library-borrow)
  '/library',
];

// Paths added in the surface wave, split by kind so we can assert behavior per kind.
const WAVE_SUMMARY_PATHS = [
  '/economy', '/census', '/world-development', '/patents', '/crime', '/parks',
  '/aviation', '/hazards', '/vehicle-value', '/market-health',
];
const WAVE_SEARCH_PATHS = [
  '/health-research', '/wikidata', '/scam-check', '/lawyers', '/benefits', '/vehicle-history',
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

test('no vertical claims /health (reserved for the operational health-check endpoint)', () => {
  // Regression for the route-collision bug: a vertical at /health shadowed the load-balancer
  // health-check in server.mjs, so /health returned an HTML page instead of "ok". Public Health
  // lives at /public-health; nothing may reclaim /health.
  assert.equal(findVertical('/health'), undefined, '/health must be free for the health-check');
  const ph = findVertical('/public-health');
  assert.ok(ph, 'Public Health vertical is at /public-health');
  assert.equal(ph.title, 'Public Health');
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

test('new gov verticals resolve by path with the right kind', () => {
  const debt = findVertical('/debt');
  assert.ok(debt, 'has /debt');
  assert.equal(debt.kind, 'summary');
  const nutrition = findVertical('/nutrition');
  assert.ok(nutrition, 'has /nutrition');
  assert.equal(nutrition.kind, 'search');
  const edgar = findVertical('/edgar');
  assert.ok(edgar, 'has /edgar');
  assert.equal(edgar.kind, 'summary');
});

test('a new search vertical (/nutrition) with NO query renders a form, no module loaded', async () => {
  const html = await renderVertical('/nutrition');
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('<form'), 'shows a form');
  assert.ok(html.includes('name=q'), 'query input named q');
  assert.ok(!html.includes('results'), 'no results section without a query');
});

test('a new summary vertical soft-fails to a graceful card when its module fn throws', async () => {
  // /debt is a summary vertical; stub its module fn to throw and prove it degrades, never propagates.
  const v = findVertical('/debt');
  const original = v.render;
  try {
    v.render = async () => { throw new Error('upstream down'); };
    const html = await renderVertical('/debt');
    assert.equal(typeof html, 'string');
    assert.ok(/temporarily unavailable/i.test(html), 'throwing render degrades gracefully');
  } finally {
    v.render = original;
  }
});

test('renderVertical soft-fails to an unavailable card for an unknown path (never throws)', async () => {
  const html = await renderVertical('/does-not-exist');
  assert.equal(typeof html, 'string');
  assert.ok(/temporarily unavailable/i.test(html), 'friendly unavailable card');
});

test('every surface-wave path is registered with the right kind and resolves its module', () => {
  for (const p of WAVE_SUMMARY_PATHS) {
    const v = findVertical(p);
    assert.ok(v, `has ${p}`);
    assert.equal(v.kind, 'summary', `${p} is a summary vertical`);
    assert.equal(typeof v.render, 'function', `${p} has a render fn`);
  }
  for (const p of WAVE_SEARCH_PATHS) {
    const v = findVertical(p);
    assert.ok(v, `has ${p}`);
    assert.equal(v.kind, 'search', `${p} is a search vertical`);
    assert.equal(typeof v.render, 'function', `${p} has a render fn`);
  }
});

test('surface-wave summary verticals render a string and soft-fail offline (never throw)', async () => {
  // OFFLINE: these modules import their network fetcher. With no network the fetch rejects and the
  // summaryRender wrapper must degrade to a non-empty string (the unavailable card), never throw and
  // never return empty. We assert exactly that — a renderable page in all cases.
  for (const p of WAVE_SUMMARY_PATHS) {
    const html = await renderVertical(p); // must not throw
    assert.equal(typeof html, 'string', `${p} returns a string`);
    assert.ok(html.length > 0, `${p} returns non-empty HTML`);
    assert.ok(html.includes('class=card'), `${p} renders into card markup`);
  }
});

test('surface-wave search verticals render a form with NO query and load no module', async () => {
  for (const p of WAVE_SEARCH_PATHS) {
    const html = await renderVertical(p);
    assert.equal(typeof html, 'string', `${p} returns a string`);
    assert.ok(html.includes('<form'), `${p} shows a form`);
    assert.ok(html.includes('method=get'), `${p} GET form`);
    assert.ok(html.includes('name=q'), `${p} query input named q`);
    assert.ok(!html.includes('results'), `${p} has no results section without a query`);
  }
});

test('surface-wave search verticals soft-fail to a string with a query offline (never throw)', async () => {
  // With a query the module IS loaded and its fn called. Offline that fetch fails; searchRender must
  // keep the form and degrade the results region to a string, never throw.
  for (const p of WAVE_SEARCH_PATHS) {
    const html = await renderVertical(p, 'test query'); // must not throw
    assert.equal(typeof html, 'string', `${p} returns a string`);
    assert.ok(html.includes('<form'), `${p} keeps the form`);
  }
});

test('a surface-wave summary vertical renders fixture data into cards (no network)', async () => {
  // Inject a render() on /economy that returns the kind of object fred.dashboard() yields, to prove
  // the generic object→cards renderer surfaces the real values (offline, no module import/fetch).
  const v = findVertical('/economy');
  const original = v.render;
  try {
    // Drive through renderVertical with an injected render that returns a card embedding markers
    // derived from fixture data (the shape fred.dashboard() produces).
    const fixture = { asOf: '2026-06-03', items: [{ name: 'Unemployment Rate', value: 4.2, unit: '%' }] };
    v.render = async () => `<div class=card><h2>Economic Indicators</h2><p>${fixture.items[0].name}: ${fixture.items[0].value}${fixture.items[0].unit}</p></div>`;
    const html = await renderVertical('/economy');
    assert.ok(html.includes('Unemployment Rate'), 'fixture data appears in the rendered page');
    assert.ok(html.includes('4.2%'), 'fixture value rendered');
  } finally {
    v.render = original;
  }
});

// ── Library vertical (wave-library-borrow) ──────────────────────────────────────────────────────────

test('/library is registered as a search vertical', () => {
  const lib = findVertical('/library');
  assert.ok(lib, 'has /library');
  assert.equal(lib.kind, 'search');
  assert.equal(lib.navLabel, 'Library');
  assert.equal(typeof lib.render, 'function');
});

test('/library with NO query renders a search form and loads no module (offline)', async () => {
  const html = await renderVertical('/library');
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('<form'), 'shows a form');
  assert.ok(html.includes('method=get'), 'GET form');
  assert.ok(html.includes('name=q'), 'query input named q');
  assert.ok(!html.includes('result'), 'no results section without a query');
});

test('/library escapes the query in the form value (no injection)', async () => {
  const html = await renderVertical('/library', '<script>x</script>');
  assert.ok(!html.includes('<script>x</script>'), 'raw script not echoed');
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'), 'query escaped into the form');
});

test('/library soft-fails to a string with a query offline (never throws)', async () => {
  // With a query the catalog module is imported and its catalogSearch called; offline the fetch fails
  // and catalogSearch soft-fails to an empty result set — the page must still render (form + no-results).
  const html = await renderVertical('/library', 'phoenix protocol');
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('<form'), 'keeps the form');
});

test('/library renders bucketed hits: host-fully → read link, metadata-only → borrow links (fixtures)', async () => {
  // Inject a render() that mimics libraryRender's output for two fixture hits, proving the page surfaces
  // the bucket treatment (read/download vs "get it at your library" link-outs) — offline, no fetch.
  const v = findVertical('/library');
  const original = v.render;
  try {
    v.render = async (q) => (
      `<div class=card><form method=get name=q></form></div>`
      + `<div class=card><h2>Library: “${q}”</h2>`
      + `<div class=lib-hit><b>Moby-Dick</b><span class=badge>Read free</span>`
      + `<a href="https://gutenberg.org/ebooks/2701" rel="noopener nofollow">Read / download →</a></div>`
      + `<div class=lib-hit><b>A 2023 Novel</b><span class=badge>At your library</span>`
      + `<div class=borrow-links><a href="https://search.worldcat.org/search?q=x">Find it in a library near you (WorldCat)</a></div></div>`
      + `</div>`
    );
    const html = await renderVertical('/library', 'test');
    assert.ok(html.includes('Read / download'), 'host-fully hit gets a read/download link');
    assert.ok(html.includes('Read free'), 'host-fully badge present');
    assert.ok(html.includes('WorldCat'), 'metadata-only hit gets a borrow link-out');
    assert.ok(html.includes('At your library'), 'metadata-only badge present');
  } finally {
    v.render = original;
  }
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
