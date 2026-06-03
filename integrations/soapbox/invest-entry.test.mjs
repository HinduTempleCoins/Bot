import { test } from 'node:test';
import assert from 'node:assert';
import { BROKERS, ETF_ENTRY, RETIREMENT_VEHICLES, DISCLAIMER, entryPointsFor } from './invest-entry.mjs';

test('BROKERS is non-empty and well-shaped', () => {
  assert.ok(Array.isArray(BROKERS) && BROKERS.length >= 5, 'several brokers');
  for (const b of BROKERS) {
    assert.equal(typeof b.name, 'string');
    assert.ok(b.name.length > 0);
    assert.equal(b.kind, 'broker');
    assert.ok(/^https:\/\//.test(b.url), `${b.name} has an https url`);
    assert.equal(typeof b.fractional, 'boolean');
    assert.equal(typeof b.commissionFree, 'boolean');
    assert.equal(typeof b.retirementAccounts, 'boolean');
    assert.equal(typeof b.notes, 'string');
    assert.ok(b.notes.length > 0);
    assert.ok('affiliate' in b, `${b.name} carries an affiliate field`);
  }
});

test('ETF_ENTRY is non-empty and well-shaped', () => {
  assert.ok(Array.isArray(ETF_ENTRY) && ETF_ENTRY.length >= 3, 'a few ETF examples');
  for (const e of ETF_ENTRY) {
    assert.equal(typeof e.ticker, 'string');
    assert.ok(e.ticker.length > 0);
    assert.equal(typeof e.name, 'string');
    assert.equal(typeof e.assetClass, 'string');
    assert.equal(typeof e.expenseNote, 'string');
  }
});

test('RETIREMENT_VEHICLES is non-empty with plain-English descriptions', () => {
  assert.ok(Array.isArray(RETIREMENT_VEHICLES) && RETIREMENT_VEHICLES.length >= 3);
  for (const r of RETIREMENT_VEHICLES) {
    assert.equal(typeof r.name, 'string');
    assert.ok(r.name.length > 0);
    assert.equal(typeof r.description, 'string');
    assert.ok(r.description.length > 10);
  }
});

test('DISCLAIMER is a non-advice educational notice', () => {
  assert.equal(typeof DISCLAIMER, 'string');
  assert.match(DISCLAIMER, /not financial/i);
  assert.match(DISCLAIMER, /educational/i);
});

test('entryPointsFor returns a full panel for a known ticker (string)', () => {
  const p = entryPointsFor('AAPL');
  assert.equal(p.ticker, 'AAPL');
  assert.equal(p.brokers, BROKERS);
  assert.equal(p.etfExamples, ETF_ENTRY);
  assert.equal(p.retirement, RETIREMENT_VEHICLES);
  assert.equal(p.disclaimer, DISCLAIMER);
});

test('entryPointsFor accepts a stock-like object and normalizes ticker', () => {
  assert.equal(entryPointsFor({ symbol: 'voo' }).ticker, 'VOO');
  assert.equal(entryPointsFor({ ticker: ' msft ' }).ticker, 'MSFT');
});

test('entryPointsFor soft-fails to a safe default panel for empty input', () => {
  for (const bad of ['', '   ', null, undefined]) {
    const p = entryPointsFor(bad);
    assert.equal(p.ticker, null, 'safe default has no ticker');
    assert.ok(p.brokers.length > 0);
    assert.ok(p.etfExamples.length > 0);
    assert.ok(p.retirement.length > 0);
    assert.equal(p.disclaimer, DISCLAIMER, 'disclaimer present on the default panel');
  }
});

test('entryPointsFor soft-fails on garbage input without throwing', () => {
  for (const junk of [42, true, {}, [], { symbol: 123 }, Symbol('x'), () => {}, NaN]) {
    let p;
    assert.doesNotThrow(() => { p = entryPointsFor(junk); });
    assert.equal(p.ticker, null);
    assert.equal(p.disclaimer, DISCLAIMER);
    assert.ok(p.brokers.length > 0);
  }
});

test('no affiliate codes are baked in by default', () => {
  for (const b of BROKERS) {
    assert.strictEqual(b.affiliate, null, `${b.name} ships with no affiliate code`);
    // URLs must be clean — no query params / referral tags.
    assert.ok(!b.url.includes('?'), `${b.name} url carries no query/referral params`);
    assert.ok(!/ref=|aff|partner|utm_/i.test(b.url), `${b.name} url has no affiliate markers`);
  }
});
