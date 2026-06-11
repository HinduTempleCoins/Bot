import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emittedBetween,
  remainingSupply,
  yearsToExhaust,
  renderRateSummary,
  esc,
} from './emission-schedule.mjs';

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;
const YEAR = 365 * 24 * 60 * 60; // 31536000

test('emittedBetween: 1/min over one hour -> 60 units', () => {
  assert.equal(
    emittedBetween({ ratePerPeriod: 1, periodSeconds: MIN, startTs: 0, endTs: HOUR }),
    60n,
  );
});

test('emittedBetween: counts only whole periods (partial trailing period ignored)', () => {
  // 90 seconds at 1/min = 1 whole minute completed.
  assert.equal(
    emittedBetween({ ratePerPeriod: 1, periodSeconds: MIN, startTs: 0, endTs: 90 }),
    1n,
  );
});

test('emittedBetween: rate multiplies', () => {
  assert.equal(
    emittedBetween({ ratePerPeriod: 5, periodSeconds: MIN, startTs: 0, endTs: HOUR }),
    300n,
  );
});

test('emittedBetween: reversed interval -> 0n', () => {
  assert.equal(
    emittedBetween({ ratePerPeriod: 1, periodSeconds: MIN, startTs: 100, endTs: 0 }),
    0n,
  );
});

test('emittedBetween: zero/negative period -> 0n', () => {
  assert.equal(
    emittedBetween({ ratePerPeriod: 1, periodSeconds: 0, startTs: 0, endTs: HOUR }),
    0n,
  );
  assert.equal(
    emittedBetween({ ratePerPeriod: 1, periodSeconds: -10, startTs: 0, endTs: HOUR }),
    0n,
  );
});

test('emittedBetween: NaN / non-finite inputs clamp to 0n, never throws', () => {
  assert.equal(
    emittedBetween({ ratePerPeriod: NaN, periodSeconds: MIN, startTs: 0, endTs: HOUR }),
    0n,
  );
  assert.equal(
    emittedBetween({ ratePerPeriod: 1, periodSeconds: MIN, startTs: 'x', endTs: Infinity }),
    0n,
  );
  assert.equal(emittedBetween(), 0n);
  assert.equal(emittedBetween({}), 0n);
});

test('emittedBetween: caps at totalSupply when capped', () => {
  // 1/min for a full day = 1440, but supply is only 100.
  const out = emittedBetween({
    ratePerPeriod: 1,
    periodSeconds: MIN,
    startTs: 0,
    endTs: DAY,
    totalSupply: 100,
  });
  assert.equal(out, 100n);
});

test('emittedBetween: under-cap emission unchanged', () => {
  const out = emittedBetween({
    ratePerPeriod: 1,
    periodSeconds: MIN,
    startTs: 0,
    endTs: HOUR,
    totalSupply: 1000,
  });
  assert.equal(out, 60n);
});

test('remainingSupply: subtracts and stays non-negative', () => {
  assert.equal(remainingSupply({ totalSupply: 1000, emitted: 60 }), 940n);
  assert.equal(remainingSupply({ totalSupply: 100, emitted: 500 }), 0n);
});

test('remainingSupply: soft-fail on junk inputs', () => {
  assert.equal(remainingSupply({ totalSupply: NaN, emitted: 60 }), 0n);
  assert.equal(remainingSupply(), 0n);
});

test('yearsToExhaust: 64-year-ish exhaustion at 1/min', () => {
  // 1/min => 525600/yr. For ~64 years, supply ~= 33,638,400.
  const supply = 525600 * 64;
  const years = yearsToExhaust({
    totalSupply: supply,
    ratePerPeriod: 1,
    periodSeconds: MIN,
  });
  assert.ok(Math.abs(years - 64) < 1e-6, `expected ~64, got ${years}`);
});

test('yearsToExhaust: zero supply -> 0', () => {
  assert.equal(
    yearsToExhaust({ totalSupply: 0, ratePerPeriod: 1, periodSeconds: MIN }),
    0,
  );
});

test('yearsToExhaust: zero rate or period -> Infinity (never drains)', () => {
  assert.equal(
    yearsToExhaust({ totalSupply: 1000, ratePerPeriod: 0, periodSeconds: MIN }),
    Infinity,
  );
  assert.equal(
    yearsToExhaust({ totalSupply: 1000, ratePerPeriod: 1, periodSeconds: 0 }),
    Infinity,
  );
});

test('yearsToExhaust: soft-fail, never throws', () => {
  assert.equal(
    yearsToExhaust({ totalSupply: NaN, ratePerPeriod: NaN, periodSeconds: NaN }),
    0,
  );
  assert.doesNotThrow(() => yearsToExhaust());
});

test('renderRateSummary: 1/min ~= 525600/yr', () => {
  assert.equal(
    renderRateSummary({ ratePerPeriod: 1, periodSeconds: MIN }),
    '1/min ~= 525600/yr',
  );
});

test('renderRateSummary: known unit labels', () => {
  assert.equal(renderRateSummary({ ratePerPeriod: 2, periodSeconds: 1 }), `2/sec ~= ${2 * YEAR}/yr`);
  assert.equal(renderRateSummary({ ratePerPeriod: 1, periodSeconds: HOUR }), '1/hr ~= 8760/yr');
  assert.equal(renderRateSummary({ ratePerPeriod: 1, periodSeconds: DAY }), '1/day ~= 365/yr');
});

test('renderRateSummary: unknown period falls back to "<n>s" label', () => {
  assert.equal(
    renderRateSummary({ ratePerPeriod: 1, periodSeconds: 90 }),
    '1/90s ~= 350400/yr',
  );
});

test('renderRateSummary: degenerate period is safe, returns a string', () => {
  const s = renderRateSummary({ ratePerPeriod: 1, periodSeconds: 0 });
  assert.equal(typeof s, 'string');
  assert.ok(s.length > 0);
  assert.doesNotThrow(() => renderRateSummary());
});

test('esc: escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
