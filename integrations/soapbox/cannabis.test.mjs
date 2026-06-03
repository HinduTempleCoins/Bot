import { test } from 'node:test';
import assert from 'node:assert';
import { deriveSeedIndex, STRAIN_SOURCES, REPORTS, reports } from './cannabis.mjs';

// ── deriveSeedIndex: the PURE math (median + IQR), offline ──────────────────────────────────────

test('deriveSeedIndex returns null on empty / non-array / no usable prices', () => {
  assert.equal(deriveSeedIndex([]), null);
  assert.equal(deriveSeedIndex(null), null);
  assert.equal(deriveSeedIndex(undefined), null);
  assert.equal(deriveSeedIndex('nope'), null);
  assert.equal(deriveSeedIndex([0, -5, NaN, Infinity, 'x']), null, 'all non-positive/non-finite dropped');
});

test('deriveSeedIndex computes median + IQR fences from numbers', () => {
  // sorted: 10,20,30,40,50  → median 30, Q1 20, Q3 40 (linear interp on n-1)
  const r = deriveSeedIndex([50, 10, 30, 20, 40]);
  assert.ok(r);
  assert.equal(r.value.n, 5);
  assert.equal(r.value.median, 30);
  assert.equal(r.value.low, 20);
  assert.equal(r.value.high, 40);
});

test('deriveSeedIndex accepts listing objects with a price field', () => {
  const r = deriveSeedIndex([{ price: 12 }, { price: 18 }, { price: 24 }, { price: 30 }]);
  assert.ok(r);
  assert.equal(r.value.n, 4);
  assert.equal(r.value.median, 21); // (18+24)/2
  // Q1 = interp at idx 0.75 between 12 and 18 → 16.5 ; Q3 = idx 2.25 between 24 and 30 → 25.5
  assert.equal(r.value.low, 16.5);
  assert.equal(r.value.high, 25.5);
});

test('deriveSeedIndex drops bad rows but keeps the good ones', () => {
  const r = deriveSeedIndex([{ price: 10 }, { price: -1 }, { nope: 1 }, 20, null, 30]);
  assert.ok(r);
  assert.equal(r.value.n, 3, 'kept 10, 20, 30');
  assert.equal(r.value.median, 20);
});

test('deriveSeedIndex single value: all three fences equal it, low confidence', () => {
  const r = deriveSeedIndex([42]);
  assert.ok(r);
  assert.deepEqual({ low: r.value.low, median: r.value.median, high: r.value.high, n: r.value.n }, { low: 42, median: 42, high: 42, n: 1 });
  assert.ok(r.confidence <= 0.5, 'n<3 is never high-confidence');
});

test('deriveSeedIndex confidence: tight large sample beats wide tiny sample', () => {
  const tight = deriveSeedIndex([20, 21, 21, 22, 20, 22, 21, 20]); // n=8, small spread
  const wide = deriveSeedIndex([5, 100]);                          // n=2, huge spread
  assert.ok(tight.confidence > wide.confidence);
  assert.ok(tight.confidence <= 1 && wide.confidence >= 0);
});

test('deriveSeedIndex outputs provenance tags', () => {
  const r = deriveSeedIndex([10, 20, 30], { source: 'Seedsman scrape', fetched_at: new Date().toISOString() });
  assert.equal(r.source, 'Seedsman scrape');
  assert.ok(typeof r.fetched_at === 'string');
  assert.ok(['live', 'recent', 'stale', 'archival', 'unknown'].includes(r.freshness));
  assert.equal(r.freshness, 'live', 'just-now timestamp → live');
  assert.ok(typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1);
});

test('deriveSeedIndex marks an old timestamp as not-live', () => {
  const old = new Date(Date.now() - 10 * 86_400_000).toISOString(); // 10 days
  const r = deriveSeedIndex([10, 20, 30], { fetched_at: old });
  assert.equal(r.freshness, 'archival');
});

// ── Directory shape (no network) ────────────────────────────────────────────────────────────────

test('STRAIN_SOURCES: every row is [name, https-url, desc] and includes the core lineage DBs', () => {
  const cats = Object.keys(STRAIN_SOURCES);
  assert.ok(cats.length >= 3);
  const names = [];
  for (const rows of Object.values(STRAIN_SOURCES)) {
    for (const row of rows) {
      assert.equal(row.length, 3);
      const [name, url, desc] = row;
      assert.ok(name && typeof name === 'string');
      assert.match(url, /^https:\/\//, `${name} url is https`);
      assert.ok(desc && typeof desc === 'string');
      names.push(name);
    }
  }
  for (const must of ['SeedFinder', 'Leafly', 'Cannapedia']) {
    assert.ok(names.includes(must), `directory includes ${must}`);
  }
});

test('REPORTS / reports(): free UNODC + IMF link-outs, https, same reference', () => {
  assert.equal(reports(), REPORTS);
  assert.ok(REPORTS.length >= 3);
  for (const [name, url, desc] of REPORTS) {
    assert.ok(name && desc);
    assert.match(url, /^https:\/\//);
  }
  const names = REPORTS.map((r) => r[0]).join(' | ');
  assert.match(names, /UNODC/);
  assert.match(names, /IMF/);
});
