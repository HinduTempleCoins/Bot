// resource-center.test.mjs — OFFLINE tests for integrations/resource-center.mjs (queue #57).
//
// runPass() makes uninjectable network calls (marketSnapshot/macro/forex/scanAccounts have no
// __setFetch hook and no injectable deps), so we do NOT exercise it here. Instead we test the
// PURE exported helper `briefReport(snapshot)` — the brief-ready markdown assembler — by feeding
// hand-built snapshot fixtures and asserting the section shape. No network, no filesystem writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefReport } from './resource-center.mjs';

// A minimal-but-complete snapshot shaped like runPass()'s output.
function snap(overrides = {}) {
  const base = {
    ts: '2026-06-03T12:34:56.000Z',
    metrics: {
      hiveEngine: null,
      metals: { gold: null, silver: null, platinum: null, copper: null },
      indices: { dow: null, sp500: null, nasdaq: null, vix: null },
      forex: [],
      dxy: null,
      riskOn: null,
    },
    proposals: null,
    holdings: [],
    news: null,
    firstTrade: null,
    circlesMd: '',
    crossVenueMd: '',
    copyTradeMd: '',
    impactMd: '',
    diagnosticsMd: '',
    sources: {},
  };
  return { ...base, ...overrides, metrics: { ...base.metrics, ...(overrides.metrics || {}) } };
}

test('header carries the formatted timestamp and engine footer', () => {
  const md = briefReport(snap());
  assert.match(md, /## Market Intelligence — 2026-06-03 12:34 UTC/);
  assert.match(md, /Engine: resource-center\.mjs · advisory only, no trades executed/);
});

test('missing Hive-Engine metrics renders the unavailable line', () => {
  const md = briefReport(snap());
  assert.match(md, /\*\*Hive-Engine\*\*: data unavailable this pass\./);
});

test('present Hive-Engine metrics render token/market/volume + movers', () => {
  const md = briefReport(snap({
    metrics: {
      hiveEngine: {
        totalTokens: 1264, activeMarkets: 312, totalVolumeHive: 98765,
        topVolume: [{ symbol: 'SWAP.HIVE', volume: 5000 }, { symbol: 'LEO', volume: 1200 }],
        topGainers: [{ symbol: 'PIZZA', change: 12.5 }],
        topLosers: [{ symbol: 'DEC', change: -8.3 }],
      },
    },
  }));
  assert.match(md, /\*\*Hive-Engine \/ TribalDEX\*\* \(start here\): 1264 tokens, 312 active markets/);
  assert.match(md, /Top volume: SWAP\.HIVE \(5,000\), LEO \(1,200\)\./);
  assert.match(md, /▲ PIZZA \+12\.50%/);
  assert.match(md, /▼ DEC -8\.30%/);
});

test('FIRST TRADE block appears at top when firstTrade is set, with structured evidence', () => {
  const md = briefReport(snap({
    firstTrade: {
      account: 'angelicalist',
      hiveBuyingPower: 1234.5,
      edge: 'SWAP.DOGE arb 3.2%',
      evidence: { spread: 3.2, depth: 800, fees: '0.25% taker' },
      suggested: 'Buy SWAP.DOGE on HE, sell external.',
    },
  }));
  assert.match(md, /### ⚡ FIRST TRADE — angelicalist/);
  assert.match(md, /Buying power: \*\*1,234\.5 HIVE\*\*/);
  assert.match(md, /Best executable edge: \*\*SWAP\.DOGE arb 3\.2%\*\*/);
  assert.match(md, /→ Buy SWAP\.DOGE on HE, sell external\./);
  assert.match(md, /spread 3\.2% · depth 800 HIVE · 0\.25% taker/);
  // FIRST TRADE must precede the Hive-Engine line
  assert.ok(md.indexOf('FIRST TRADE') < md.indexOf('**Hive-Engine'));
});

test('firstTrade with string evidence renders it verbatim', () => {
  const md = briefReport(snap({
    firstTrade: { account: 'angelicalist', hiveBuyingPower: 10, edge: 'X', evidence: 'manual note here', suggested: '' },
  }));
  assert.match(md, /\*\(manual note here\)\*/);
});

test('metals and indices format prices, percents, and risk regime', () => {
  const md = briefReport(snap({
    metrics: {
      metals: { gold: { price: 2345.6, change: 1.1 }, silver: { price: 29.4, change: -0.5 }, platinum: null, copper: null },
      indices: { dow: { change: 0.4 }, sp500: { change: 0.2 }, nasdaq: { change: -0.1 }, vix: { price: 15.2 } },
      forex: [],
      dxy: null,
      riskOn: 'risk-on (VIX<20)',
    },
  }));
  assert.match(md, /\*\*Metals\*\*: Gold \$2,345\.6 \+1\.10% · Silver \$29\.4 -0\.50%\./);
  assert.match(md, /\*\*Indices\*\*: Dow \+0\.40% · S&P \+0\.20% · Nasdaq -0\.10% · VIX 15\.2 \(risk-on \(VIX<20\)\)\./);
});

test('forex line renders pairs and DXY when present', () => {
  const md = briefReport(snap({
    metrics: {
      forex: [{ pair: 'EUR/USD', rate: 1.0876, change: 0.1 }, { pair: 'USD/JPY', rate: 156.23, change: -0.2 }],
      dxy: { price: 104.5, change: 0.3 },
    },
  }));
  assert.match(md, /\*\*Forex\*\*: EUR\/USD 1\.0876 · USD\/JPY 156\.23 · DXY 104\.5 \+0\.30%\./);
});

test('holdings section lists rotation opportunities with spread and action', () => {
  const md = briefReport(snap({
    holdings: [
      { account: 'angelicalist', symbol: 'SWAP.LTC', valueUsd: 42.7, spreadPct: 2.5, action: 'rotate to SWAP.HIVE' },
      { account: 'kalivankush', symbol: 'DEC', valueUsd: 5, spreadPct: null, action: 'hold' },
    ],
  }));
  assert.match(md, /### Holdings & rotation opportunities/);
  assert.match(md, /\*\*@angelicalist SWAP\.LTC\*\* \(~\$42\.7, spread \+2\.5%\): rotate to SWAP\.HIVE/);
  assert.match(md, /\*\*@kalivankush DEC\*\* \(~\$5, spread —\): hold/);
});

test('news diagnostics handles both array and object-keyed assets shapes', () => {
  const asArray = briefReport(snap({
    news: { assets: [{ topic: 'crypto', headlineCount: 9, sentimentHint: 'bullish', sentimentScore: 0.6, themes: [{ word: 'etf' }, { word: 'halving' }] }] },
  }));
  assert.match(asArray, /### News diagnostics/);
  assert.match(asArray, /\*\*crypto\*\*: ▲ bullish \(0\.6\), 9 headlines — themes: etf, halving\./);

  const asObject = briefReport(snap({
    news: { assets: { gold: { topic: 'gold', headlineCount: 3, sentimentHint: 'bearish', sentimentScore: -0.4, themes: [] } } },
  }));
  assert.match(asObject, /\*\*gold\*\*: ▼ bearish \(-0\.4\), 3 headlines\./);
});

test('engine markdown blocks are appended when provided', () => {
  const md = briefReport(snap({
    circlesMd: '### Profit circles\nloop A',
    crossVenueMd: '### Cross-venue arb\nvenue X',
    copyTradeMd: '### Copy trade\ncandidate Y',
    impactMd: '### Market impact\nsim Z',
    diagnosticsMd: '### Diagnostics\nsignal Q',
  }));
  assert.match(md, /### Profit circles\nloop A/);
  assert.match(md, /### Cross-venue arb\nvenue X/);
  assert.match(md, /### Copy trade\ncandidate Y/);
  assert.match(md, /### Market impact\nsim Z/);
  assert.match(md, /### Diagnostics\nsignal Q/);
});

test('empty snapshot produces a valid string with header and footer only sections', () => {
  const md = briefReport(snap());
  assert.equal(typeof md, 'string');
  assert.ok(md.length > 0);
  // no FIRST TRADE / holdings / news sections when those are empty
  assert.doesNotMatch(md, /FIRST TRADE/);
  assert.doesNotMatch(md, /Holdings & rotation/);
  assert.doesNotMatch(md, /News diagnostics/);
});
