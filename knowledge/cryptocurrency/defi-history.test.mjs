// knowledge/cryptocurrency/defi-history.test.mjs — offline, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFI_TIMELINE,
  eras,
  byEra,
  search,
  timeline,
  renderTimeline,
  esc,
} from './defi-history.mjs';

test('DEFI_TIMELINE covers ICO, IEO, DeFi and the three AMM platforms', () => {
  const es = new Set(DEFI_TIMELINE.map((r) => r.era));
  assert.ok(es.has('ICO'));
  assert.ok(es.has('IEO'));
  assert.ok(es.has('DeFi'));
  const plats = DEFI_TIMELINE.filter((r) => r.platform).map((r) => r.platform);
  for (const p of ['Uniswap', 'PancakeSwap', 'SunSwap']) assert.ok(plats.includes(p), p);
  // every platform entry carries chain + ammModel
  for (const r of DEFI_TIMELINE.filter((x) => x.platform)) {
    assert.ok(r.chain, `${r.platform} chain`);
    assert.ok(r.ammModel, `${r.platform} ammModel`);
  }
});

test('eras() returns distinct era names', () => {
  const e = eras();
  assert.deepEqual(new Set(e).size, e.length);
  assert.ok(e.includes('Platform'));
});

test('byEra is case-insensitive and matches DEFI_TIMELINE', () => {
  const a = byEra('ico');
  const b = byEra('ICO');
  assert.ok(a.length > 0);
  assert.deepEqual(a, b);
  assert.ok(a.every((r) => r.era === 'ICO'));
});

test('byEra soft-fails on unknown / null / empty -> []', () => {
  assert.deepEqual(byEra('nonsense'), []);
  assert.deepEqual(byEra(null), []);
  assert.deepEqual(byEra(''), []);
  assert.deepEqual(byEra(undefined), []);
});

test('search matches over event/note/platform, case-insensitive', () => {
  assert.ok(search('uniswap').some((r) => r.platform === 'Uniswap'));
  assert.ok(search('TRON').some((r) => r.platform === 'SunSwap'));
  assert.ok(search('yield farming').length >= 1); // note text
  assert.deepEqual(search('UNISWAP'), search('uniswap'));
});

test('search soft-fails on empty / null -> []', () => {
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('   '), []);
  assert.deepEqual(search(null), []);
  assert.deepEqual(search('zzz-no-match'), []);
});

test('timeline() returns a copy, not the frozen original', () => {
  const t = timeline();
  assert.equal(t.length, DEFI_TIMELINE.length);
  assert.notEqual(t, DEFI_TIMELINE);
  t.push({ junk: true });
  assert.equal(timeline().length, DEFI_TIMELINE.length); // original untouched
});

test('renderTimeline text is deterministic and mentions platforms', () => {
  const txt = renderTimeline();
  assert.equal(txt, renderTimeline());
  assert.ok(txt.includes('Uniswap'));
  assert.ok(txt.includes('ICO'));
});

test('renderTimeline html escapes interpolation and builds a table', () => {
  const html = renderTimeline({ html: true });
  assert.ok(html.startsWith('<table'));
  assert.ok(html.includes('<th>AMM model</th>'));
  // injection attempt via a crafted row is escaped
  const bad = renderTimeline({
    html: true,
    rows: [{ year: 1, era: 'X', event: '<script>', note: 'a&b', platform: '"q"' }],
  });
  assert.ok(!bad.includes('<script>'));
  assert.ok(bad.includes('&lt;script&gt;'));
  assert.ok(bad.includes('a&amp;b'));
});

test('renderTimeline soft-fails on non-array rows', () => {
  // explicit null is not an array -> empty body (soft-fail, no throw)
  assert.equal(renderTimeline({ rows: null }), '');
  const emptyHtml = renderTimeline({ rows: null, html: true });
  assert.ok(emptyHtml.startsWith('<table'));
  assert.ok(emptyHtml.endsWith('<tbody></tbody></table>'));
  // undefined rows falls through to the DEFI_TIMELINE default
  assert.ok(renderTimeline({ rows: undefined }).includes('Uniswap'));
});

test('esc handles null/undefined without throwing', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
});
