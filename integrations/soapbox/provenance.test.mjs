// provenance.test.mjs — offline guards for the cross-vertical provenance + Source-Confidence layer
// (queue #99, doc 6). Pure functions, no network. Run: node --test integrations/soapbox/provenance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tag,
  freshnessScore,
  sourceReliability,
  sourceConfidence,
  validate,
  isValidFreshnessClass,
  SOURCE_RELIABILITY,
  DEFAULT_RELIABILITY,
} from './provenance.mjs';

const DAY = 86400000;
const HOUR = 3600000;
const NOW = Date.UTC(2026, 5, 3, 12, 0, 0); // fixed clock so age-based decay is deterministic

// ── tag ────────────────────────────────────────────────────────────────────────────────────────────
test('tag attaches a standard envelope and returns the same record', () => {
  const rec = { price: 42 };
  const out = tag(rec, { source: 'coingecko', fetchedAt: NOW, freshnessClass: 'LIVE' });
  assert.equal(out, rec, 'returns the same object for chaining');
  assert.ok(rec._provenance, 'envelope attached');
  assert.equal(rec._provenance.source, 'coingecko');
  assert.equal(rec._provenance.freshnessClass, 'LIVE');
  assert.equal(typeof rec._provenance.fetchedAt, 'string');
  assert.equal(Date.parse(rec._provenance.fetchedAt), NOW, 'fetchedAt normalized to ISO of the given ms');
});

test('tag defaults: fetchedAt → now, freshnessClass → LIVE', () => {
  const before = Date.now();
  const rec = tag({}, { source: 'yahoo' });
  const after = Date.now();
  assert.equal(rec._provenance.freshnessClass, 'LIVE');
  const got = Date.parse(rec._provenance.fetchedAt);
  assert.ok(got >= before && got <= after, 'fetchedAt defaulted to roughly now');
});

test('tag accepts ISO strings and Date objects for fetchedAt', () => {
  const iso = '2026-01-01T00:00:00.000Z';
  assert.equal(tag({}, { source: 'fred', fetchedAt: iso })._provenance.fetchedAt, iso);
  const d = new Date('2025-12-25T00:00:00.000Z');
  assert.equal(tag({}, { source: 'fred', fetchedAt: d })._provenance.fetchedAt, d.toISOString());
});

test('tag accepts collected-YYYY freshness class', () => {
  const rec = tag({}, { source: 'census', freshnessClass: 'collected-2020' });
  assert.equal(rec._provenance.freshnessClass, 'collected-2020');
});

test('tag rejects bad input', () => {
  assert.throws(() => tag(null, { source: 'x' }), TypeError);
  assert.throws(() => tag({}, {}), TypeError, 'missing source');
  assert.throws(() => tag({}, { source: 'x', freshnessClass: 'WEEKLY' }), RangeError, 'unknown class');
  assert.throws(() => tag({}, { source: 'x', freshnessClass: 'collected-99' }), RangeError, 'bad collected year');
});

// ── isValidFreshnessClass ─────────────────────────────────────────────────────────────────────────
test('isValidFreshnessClass accepts the vocabulary and rejects junk', () => {
  for (const ok of ['LIVE', 'DAILY', 'static', 'collected-2020', 'collected-1999']) {
    assert.ok(isValidFreshnessClass(ok), `${ok} should be valid`);
  }
  for (const bad of ['live', 'WEEKLY', 'collected-20', 'collected-', '', null, undefined, 5]) {
    assert.ok(!isValidFreshnessClass(bad), `${JSON.stringify(bad)} should be invalid`);
  }
});

// ── freshnessScore ────────────────────────────────────────────────────────────────────────────────
test('static freshness is always 1', () => {
  const rec = tag({}, { source: 'wikipedia', freshnessClass: 'static', fetchedAt: NOW - 5000 * DAY });
  assert.equal(freshnessScore(rec, NOW), 1);
});

test('freshness is 0..1 and starts near 1 for a just-fetched record', () => {
  const live = tag({}, { source: 'coingecko', freshnessClass: 'LIVE', fetchedAt: NOW });
  const f = freshnessScore(live, NOW);
  assert.ok(f > 0.99 && f <= 1, `fresh LIVE ~1, got ${f}`);
});

test('freshness decays with age, ordered LIVE faster than DAILY faster than collected', () => {
  // same age (2 days), different classes → LIVE most decayed, collected least.
  const age = NOW - 2 * DAY;
  const live = freshnessScore(tag({}, { source: 'x', freshnessClass: 'LIVE', fetchedAt: age }), NOW);
  const daily = freshnessScore(tag({}, { source: 'x', freshnessClass: 'DAILY', fetchedAt: age }), NOW);
  const collected = freshnessScore(tag({}, { source: 'x', freshnessClass: 'collected-2026' }), NOW);
  assert.ok(live < daily, `LIVE (${live}) should decay faster than DAILY (${daily})`);
  assert.ok(daily < collected, `DAILY (${daily}) should decay faster than collected-this-year (${collected})`);
  for (const v of [live, daily, collected]) assert.ok(v >= 0 && v <= 1);
});

test('LIVE decays monotonically as it ages', () => {
  const at = (h) => freshnessScore(tag({}, { source: 'x', freshnessClass: 'LIVE', fetchedAt: NOW - h * HOUR }), NOW);
  const series = [at(0), at(6), at(12), at(24), at(48)];
  for (let i = 1; i < series.length; i++) {
    assert.ok(series[i] < series[i - 1], `freshness must drop with age at step ${i}: ${series}`);
  }
});

test('collected-YYYY decays over years, older years scoring lower', () => {
  const y = (yr) => freshnessScore(tag({}, { source: 'census', freshnessClass: `collected-${yr}` }), NOW);
  assert.ok(y(2026) > y(2020), 'this-year beats 6 years ago');
  assert.ok(y(2020) > y(2010), '6 years ago beats 16 years ago');
  assert.ok(y(2010) > 0, 'old data still has some freshness, just low');
});

test('future fetchedAt is clamped (treated as brand new, never >1)', () => {
  const future = tag({}, { source: 'x', freshnessClass: 'LIVE', fetchedAt: NOW + 10 * DAY });
  const f = freshnessScore(future, NOW);
  assert.ok(f > 0.99 && f <= 1, `future timestamp clamps to ~1, got ${f}`);
});

test('freshness degrades gracefully on missing/garbage envelope', () => {
  assert.equal(freshnessScore({}, NOW), 0, 'no envelope → 0');
  assert.equal(freshnessScore(null, NOW), 0);
  const bad = { _provenance: { source: 'x', fetchedAt: 'not-a-date', freshnessClass: 'LIVE' } };
  assert.equal(freshnessScore(bad, NOW), 0, 'unparseable date → 0');
});

// ── sourceReliability ─────────────────────────────────────────────────────────────────────────────
test('sourceReliability tiers: gov/official > freemium > scrape', () => {
  const gov = sourceReliability('sec-edgar');
  const freemium = sourceReliability('coingecko');
  const scrape = sourceReliability('scrape');
  assert.ok(gov > freemium, `gov (${gov}) > freemium (${freemium})`);
  assert.ok(freemium > scrape, `freemium (${freemium}) > scrape (${scrape})`);
  for (const v of [gov, freemium, scrape]) assert.ok(v >= 0 && v <= 1);
});

test('sourceReliability is case-insensitive and substring-matches with longest key winning', () => {
  assert.equal(sourceReliability('COINGECKO'), SOURCE_RELIABILITY['coingecko']);
  assert.equal(sourceReliability('coingecko-pro'), SOURCE_RELIABILITY['coingecko'], 'substring match');
  // 'sec-edgar' contains both 'sec' and 'edgar'; longest exact key match should resolve sensibly.
  assert.equal(sourceReliability('sec-edgar'), SOURCE_RELIABILITY['sec-edgar']);
});

test('sourceReliability falls back to mid for unknown sources', () => {
  assert.equal(sourceReliability('some-random-api-nobody-knows'), DEFAULT_RELIABILITY);
  assert.equal(sourceReliability(''), DEFAULT_RELIABILITY);
  assert.equal(sourceReliability(null), DEFAULT_RELIABILITY);
  assert.ok(DEFAULT_RELIABILITY > 0 && DEFAULT_RELIABILITY < 1, 'mid is strictly between 0 and 1');
});

// ── sourceConfidence ──────────────────────────────────────────────────────────────────────────────
test('sourceConfidence is bounded 0..100', () => {
  const recs = [
    tag({}, { source: 'sec-edgar', freshnessClass: 'static' }),
    tag({}, { source: 'coingecko', freshnessClass: 'LIVE', fetchedAt: NOW }),
    tag({}, { source: 'scrape', freshnessClass: 'LIVE', fetchedAt: NOW - 100 * DAY }),
    tag({}, { source: 'census', freshnessClass: 'collected-1990' }),
  ];
  for (const r of recs) {
    const c = sourceConfidence(r, NOW);
    assert.ok(Number.isInteger(c), 'confidence is an integer');
    assert.ok(c >= 0 && c <= 100, `confidence in [0,100], got ${c}`);
  }
});

test('sourceConfidence = freshness × reliability × 100', () => {
  const rec = tag({}, { source: 'coingecko', freshnessClass: 'LIVE', fetchedAt: NOW - 6 * HOUR });
  const expected = Math.round(freshnessScore(rec, NOW) * sourceReliability('coingecko') * 100);
  assert.equal(sourceConfidence(rec, NOW), expected);
});

test('sourceConfidence: a fresh authoritative source beats a stale low-reliability one', () => {
  const good = tag({}, { source: 'sec-edgar', freshnessClass: 'LIVE', fetchedAt: NOW });
  const bad = tag({}, { source: 'scrape', freshnessClass: 'LIVE', fetchedAt: NOW - 10 * DAY });
  assert.ok(sourceConfidence(good, NOW) > sourceConfidence(bad, NOW));
});

test('sourceConfidence: static authoritative reference scores high', () => {
  const ref = tag({}, { source: 'wikipedia', freshnessClass: 'static' });
  const c = sourceConfidence(ref, NOW);
  assert.ok(c >= 80, `static + reputable should score high, got ${c}`);
});

test('sourceConfidence is 0 with no envelope', () => {
  assert.equal(sourceConfidence({}, NOW), 0);
  assert.equal(sourceConfidence(null, NOW), 0);
});

// ── validate ──────────────────────────────────────────────────────────────────────────────────────
test('validate passes a well-formed envelope', () => {
  const rec = tag({}, { source: 'fred', freshnessClass: 'DAILY', fetchedAt: NOW });
  const v = validate(rec);
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test('validate catches a missing envelope', () => {
  const v = validate({ price: 1 });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /missing _provenance/.test(e)));
});

test('validate catches each missing/invalid field', () => {
  const missingSource = validate({ _provenance: { fetchedAt: new Date(NOW).toISOString(), freshnessClass: 'LIVE' } });
  assert.equal(missingSource.ok, false);
  assert.ok(missingSource.errors.some((e) => /source/.test(e)));

  const badDate = validate({ _provenance: { source: 'x', fetchedAt: 'nope', freshnessClass: 'LIVE' } });
  assert.equal(badDate.ok, false);
  assert.ok(badDate.errors.some((e) => /fetchedAt/.test(e)));

  const badClass = validate({ _provenance: { source: 'x', fetchedAt: new Date(NOW).toISOString(), freshnessClass: 'HOURLY' } });
  assert.equal(badClass.ok, false);
  assert.ok(badClass.errors.some((e) => /freshnessClass/.test(e)));
});

test('validate never throws on garbage', () => {
  for (const g of [null, undefined, 5, 'str', [], { _provenance: 'not-an-object' }]) {
    const v = validate(g);
    assert.equal(typeof v.ok, 'boolean');
    assert.ok(Array.isArray(v.errors));
    assert.equal(v.ok, false);
  }
});
