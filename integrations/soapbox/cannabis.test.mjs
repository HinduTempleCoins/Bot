import { test } from 'node:test';
import assert from 'node:assert';
import {
  deriveSeedIndex, STRAIN_SOURCES, REPORTS, reports,
  classifyByThc, legalStatus, THC_LIMIT_PCT, STATUTES, LAW_NOTES, LAW_SOURCES,
  organizations, ORGANIZATIONS,
  flowerPrices, seedPrices, strainLookup,
  scourCannabis, __setScour, CANNABIS_TOPIC_SEEDS,
  cannabisSummary,
} from './cannabis.mjs';

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

// ── US-LAW classifier: hemp vs marijuana ─────────────────────────────────────────────────────────

test('classifyByThc: at/under 0.3% is hemp, over is marijuana', () => {
  assert.equal(THC_LIMIT_PCT, 0.3);
  assert.equal(classifyByThc(0).classification, 'hemp');
  assert.equal(classifyByThc(0.3).classification, 'hemp', 'exactly 0.3% is at the line → hemp');
  assert.equal(classifyByThc(0.29).classification, 'hemp');
  assert.equal(classifyByThc(0.31).classification, 'marijuana');
  assert.equal(classifyByThc(18).classification, 'marijuana');
});

test('classifyByThc: cites the statute (7 USC 1639o / 21 USC 802)', () => {
  const hemp = classifyByThc(0.2);
  assert.match(hemp.citation.hemp, /1639o/);
  assert.match(hemp.citation.hempUrl, /^https:\/\//);
  const mj = classifyByThc(5);
  assert.match(mj.citation.csa, /802/);
  assert.match(mj.note, /Schedule I/);
});

test('classifyByThc: dryWeight:false flags the measurement basis', () => {
  const r = classifyByThc(0.2, { dryWeight: false });
  assert.equal(r.dryWeight, false);
  assert.match(r.note, /DRY WEIGHT/i);
});

test('classifyByThc: null on bad input', () => {
  assert.equal(classifyByThc(NaN), null);
  assert.equal(classifyByThc(-1), null);
  assert.equal(classifyByThc('x'), null);
  assert.equal(classifyByThc(undefined), null);
});

test('STATUTES + LAW_NOTES + LAW_SOURCES: shapes + nuances encoded', () => {
  for (const [cite, url, desc] of Object.values(STATUTES)) {
    assert.ok(cite && desc);
    assert.match(url, /^https:\/\//);
  }
  assert.ok(LAW_NOTES.length >= 4, 'total-THC, delta-8, reschedule, state-varies notes');
  const joined = LAW_NOTES.map((n) => n[0]).join(' | ');
  assert.match(joined, /Total-THC/);
  assert.match(joined, /delta-8/i);
  assert.match(joined, /Schedule III/);
  assert.match(joined, /State law varies/i);
  for (const [name, url] of LAW_SOURCES) { assert.ok(name); assert.match(url, /^https:\/\//); }
});

test('legalStatus: cited federal line + state-varies note, no fabricated specifics', () => {
  const ca = legalStatus('California');
  assert.equal(ca.state, 'California');
  assert.match(ca.federal.line, /1639o/);
  assert.match(ca.federal.line, /Schedule I/);
  assert.match(ca.stateNote, /California/);
  assert.match(ca.stateNote, /varies/i);
  assert.ok(Array.isArray(ca.sources) && ca.sources.length);
  assert.match(ca.disclaimer, /not legal advice/i);
  // no-state form still gives the federal line
  const none = legalStatus();
  assert.equal(none.state, null);
  assert.match(none.stateNote, /varies/i);
});

// ── Reform orgs + churches registry ──────────────────────────────────────────────────────────────

test('organizations: facts+links+right-of-reply, no legitimacy verdict field', () => {
  assert.equal(organizations(), ORGANIZATIONS);
  for (const o of ORGANIZATIONS) {
    assert.ok(o.name && o.focus && o.note);
    assert.ok(['reform-org', 'church'].includes(o.type));
    assert.match(o.url, /^https:\/\//);
    assert.ok(o.rightOfReply, 'every entry has a right-of-reply path');
    // facts-not-verdicts: no "legitimate"/"scam"/"verified" judgment fields
    assert.ok(!('legitimate' in o) && !('verdict' in o) && !('rating' in o));
  }
  const names = ORGANIZATIONS.map((o) => o.name).join(' | ');
  for (const must of ['NORML', 'Marijuana Policy Project', 'Drug Policy Alliance', 'SSDP', 'Last Prisoner Project', 'Marijuana Justice']) {
    assert.match(names, new RegExp(must.replace(/[()]/g, '.')), `registry includes ${must}`);
  }
});

test('organizations: filter by type', () => {
  const orgs = organizations('reform-org');
  const churches = organizations('church');
  assert.ok(orgs.length >= 6 && orgs.every((o) => o.type === 'reform-org'));
  assert.ok(churches.length >= 2 && churches.every((o) => o.type === 'church'));
  const cn = churches.map((c) => c.name).join(' | ');
  assert.match(cn, /Oklevueha/);
  assert.match(cn, /THC Ministry/);
});

// ── Price aggregation: flower + seeds (injectable sources, offline) ──────────────────────────────

test('flowerPrices: derives our own median index from injectable sources', async () => {
  const r = await flowerPrices({ sources: { vendorA: () => [8, 10, 12], vendorB: () => [9, 11] } });
  assert.equal(r.item, 'cannabis flower (per gram)');
  assert.equal(r.median, 10); // sorted 8,9,10,11,12 → median 10
  assert.ok(r.low <= r.median && r.median <= r.high);
  assert.deepEqual(r.sources.sort(), ['vendorA', 'vendorB']);
  assert.ok(typeof r.asOf === 'string');
});

test('flowerPrices: no sources → honest empty index, never fabricates', async () => {
  const r = await flowerPrices();
  assert.equal(r.median, null);
  assert.equal(r.n, 0);
  assert.deepEqual(r.sources, []);
});

test('flowerPrices: a throwing source soft-fails, others still aggregate', async () => {
  const r = await flowerPrices({ sources: { bad: () => { throw new Error('down'); }, ok: () => [10, 20, 30] } });
  assert.equal(r.median, 20);
  assert.deepEqual(r.sources, ['ok']);
});

test('seedPrices: accepts {price} rows and per-pack item label', async () => {
  const r = await seedPrices({ sources: { bank: () => [{ price: 40 }, { price: 60 }, { price: 80 }] } });
  assert.equal(r.item, 'cannabis seeds (per pack)');
  assert.equal(r.median, 60);
  assert.deepEqual(r.sources, ['bank']);
});

test('strainLookup: SeedFinder-style link-outs, soft-fail lineage, no fabrication', async () => {
  const r = await strainLookup('Northern Lights');
  assert.equal(r.query, 'Northern Lights');
  assert.equal(r.lineage, null, 'we never fabricate parentage');
  const srcs = r.links.map((l) => l.source);
  assert.ok(srcs.includes('SeedFinder') && srcs.includes('Leafly'));
  for (const l of r.links) assert.match(l.url, /^https:\/\/.*Northern/i);
  // empty query → empty links
  assert.deepEqual((await strainLookup('')).links, []);
});

// ── Resource-Center scour (injectable, offline) ──────────────────────────────────────────────────

test('scourCannabis: topic seeds defined + injectable scour, deduped cited results', async () => {
  assert.ok(CANNABIS_TOPIC_SEEDS.length >= 6);
  const calls = [];
  __setScour(async (q) => { calls.push(q); return [{ title: q, url: `https://ex/${encodeURIComponent(q)}`, snippet: 's' }]; });
  try {
    // single query path
    const one = await scourCannabis('delta-8 legality', { limit: 5 });
    assert.equal(one.query, 'delta-8 legality');
    assert.equal(one.results.length, 1);
    assert.equal(calls.length, 1);
    // topic-seed fan-out path
    calls.length = 0;
    const seeded = await scourCannabis(null, { limit: 4 });
    assert.equal(calls.length, CANNABIS_TOPIC_SEEDS.length);
    assert.equal(seeded.query, '(topic seeds)');
    assert.ok(seeded.results.length >= 1);
  } finally { __setScour(null); }
});

test('scourCannabis: a throwing scour soft-fails to empty results', async () => {
  __setScour(async () => { throw new Error('net down'); });
  try {
    const r = await scourCannabis('hemp');
    assert.deepEqual(r.results, []);
    assert.equal(r.sources, 0);
  } finally { __setScour(null); }
});

// ── Summary includes the new counts ──────────────────────────────────────────────────────────────

test('cannabisSummary: includes org/church/law-note counts', async () => {
  const s = await cannabisSummary();
  assert.ok(s.orgCount >= 6);
  assert.ok(s.churchCount >= 2);
  assert.ok(s.lawNotes >= 4);
  assert.ok(s.strainSources >= 1);
});
