// market-health.test.js — the "Health of the Market" gauge, with injected fetch (no network).
// Builds a synthetic Yahoo chart response so the math is deterministic and offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  healthScore, healthSeries, healthData, classify,
  renderHealthGauge, renderHealthData, engineBlock,
  TIMEFRAME_KEYS, __setFetch,
} from './market-health.mjs';
import { invalidate } from './cache.mjs';

// A synthetic chart: `n` daily bars, gently rising (so trend/momentum are well-defined), for ANY symbol.
function chart(n = 400, start = 1000, step = 0.5) {
  const now = Math.floor(Date.now() / 1000);
  const t = [], c = [];
  for (let i = 0; i < n; i++) { t.push(now - (n - i) * 86400); c.push(start + i * step); }
  return { ok: true, status: 200, json: async () => ({ chart: { result: [{ timestamp: t, indicators: { quote: [{ close: c }] } }] } }) };
}
// VIX-ish flat series for the ^VIX symbol so the volatility component has a value.
function fetchStub() {
  return async (url) => {
    if (String(url).includes('%5EVIX')) return chart(300, 16, 0); // flat VIX ~16
    return chart(400, 1000, 0.6); // S&P / TNX rising
  };
}

test('classify maps the bands', () => {
  assert.equal(classify(90), 'Extreme Greed');
  assert.equal(classify(65), 'Greed');
  assert.equal(classify(50), 'Neutral');
  assert.equal(classify(35), 'Fear');
  assert.equal(classify(10), 'Extreme Fear');
});

test('healthScore returns a score in 0–100 with components', async () => {
  invalidate(); __setFetch(fetchStub());
  const h = await healthScore('1Y');
  assert.ok(h && typeof h.score === 'number', 'score is a number');
  assert.ok(h.score >= 0 && h.score <= 100, `score ${h.score} in range`);
  assert.equal(typeof h.classification, 'string');
  assert.ok(h.components && typeof h.components.trend === 'number');
  for (const k of ['trend', 'drawdown', 'momentum', 'volatility', 'rates']) {
    assert.ok(h.components[k] >= 0 && h.components[k] <= 100, `${k} in range`);
  }
  __setFetch(null); invalidate();
});

test('healthSeries returns a non-empty series for a valid timeframe', async () => {
  invalidate(); __setFetch(fetchStub());
  const s = await healthSeries('1Y');
  assert.ok(Array.isArray(s.points) && s.points.length > 0, 'non-empty points');
  for (const p of s.points) {
    assert.ok(typeof p.t === 'number');
    assert.ok(p.score >= 0 && p.score <= 100, `point score ${p.score} in range`);
  }
  assert.ok(s.coverage && s.coverage.from && s.coverage.to, 'coverage present');
  assert.ok(TIMEFRAME_KEYS.includes(s.timeframe));
  __setFetch(null); invalidate();
});

test('an invalid timeframe falls back to the default and still produces a series', async () => {
  invalidate(); __setFetch(fetchStub());
  const s = await healthSeries('NONSENSE');
  assert.ok(TIMEFRAME_KEYS.includes(s.timeframe));
  assert.ok(s.points.length > 0);
  __setFetch(null); invalidate();
});

test('healthData returns the supporting stat panel object', async () => {
  invalidate(); __setFetch(fetchStub());
  const d = await healthData('1Y');
  assert.equal(typeof d.windowReturn, 'number');
  assert.ok('ytd' in d && 'return5y' in d && 'maxDrawdown' in d && 'volatility' in d);
  assert.ok(d.maxDrawdown <= 0, 'drawdown is non-positive');
  __setFetch(null); invalidate();
});

test('render functions return non-empty strings', async () => {
  invalidate(); __setFetch(fetchStub());
  const h = await healthScore('1Y');
  const s = await healthSeries('1Y');
  const d = await healthData('1Y');
  const gauge = renderHealthGauge(h, s);
  const panel = renderHealthData(d);
  assert.equal(typeof gauge, 'string'); assert.ok(gauge.length > 100, 'gauge has markup');
  assert.ok(gauge.includes('Health of the Market'));
  assert.ok(gauge.includes('mh-tfb'), 'has the timeframe selector');
  assert.equal(typeof panel, 'string'); assert.ok(panel.length > 50);
  assert.ok(panel.includes('Market health data'));
  const md = await engineBlock('1Y');
  assert.equal(typeof md, 'string'); assert.ok(md.includes('Health of the Market'));
  __setFetch(null); invalidate();
});

test('render functions tolerate empty/null input', () => {
  assert.equal(renderHealthData(null), '');
  const g = renderHealthGauge({ score: null }, { points: [] });
  assert.equal(typeof g, 'string'); assert.ok(g.length > 0);
});
