// he-ingest.test.mjs — offline tests for the HIVE-Engine movement → brief notes module (task #70).
// Fully offline: a canned source is injected via __setSource, no network is touched.
//   node --test integrations/he-ingest.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenMovement, ingest, briefNotes, watchlist, __setSource } from './he-ingest.mjs';

// ── tokenMovement (pure) ────────────────────────────────────────────────────────────────────────

test('tokenMovement computes +% price change correctly', () => {
  const m = tokenMovement(
    { symbol: 'VKBT', price: 1.0, volume24h: 100 },
    { symbol: 'VKBT', price: 1.12, volume24h: 150 },
  );
  assert.equal(m.symbol, 'VKBT');
  assert.equal(m.priceChangePct, 12);          // 1.00 → 1.12 = +12%
  assert.equal(m.volumeChangePct, 50);          // 100 → 150 = +50%
  assert.equal(m.direction, 'up');
  assert.equal(m.notable, true);                // 12% clears the 5% default
});

test('tokenMovement flags notable beyond threshold (and direction down on a drop)', () => {
  const m = tokenMovement({ symbol: 'CURE', price: 2.0 }, { symbol: 'CURE', price: 1.6 });
  assert.equal(m.priceChangePct, -20);
  assert.equal(m.direction, 'down');
  assert.equal(m.notable, true);
});

test('tokenMovement reads a tiny move as flat and not notable', () => {
  const m = tokenMovement({ symbol: 'VKBT', price: 1.0 }, { symbol: 'VKBT', price: 1.002 });
  assert.equal(m.priceChangePct, 0.2);
  assert.equal(m.direction, 'flat');            // below 0.5% FLAT threshold
  assert.equal(m.notable, false);
});

test('tokenMovement: a real move below the notable threshold is directional but not notable', () => {
  const m = tokenMovement({ symbol: 'VKBT', price: 1.0 }, { symbol: 'VKBT', price: 1.02 });
  assert.equal(m.priceChangePct, 2);
  assert.equal(m.direction, 'up');
  assert.equal(m.notable, false);               // 2% < 5%
});

test('tokenMovement handles missing baseline gracefully (null change, flat, not notable)', () => {
  const m = tokenMovement(null, { symbol: 'VKBT', price: 1.0, volume24h: 10 });
  assert.equal(m.symbol, 'VKBT');
  assert.equal(m.priceChangePct, null);
  assert.equal(m.volumeChangePct, null);
  assert.equal(m.direction, 'flat');
  assert.equal(m.notable, false);
});

// ── ingest (injected source, offline) ────────────────────────────────────────────────────────────

test('ingest compares baseline→current via injected source and returns movements', async () => {
  const CURRENT = {
    VKBT: { symbol: 'VKBT', price: 1.12, volume24h: 150 },
    CURE: { symbol: 'CURE', price: 0.5, volume24h: 80 },
  };
  __setSource(async (s) => CURRENT[s] || null);
  const baseline = {
    VKBT: { price: 1.0, volume24h: 100 },
    CURE: { price: 0.5, volume24h: 100 },
  };
  const out = await ingest(['VKBT', 'CURE'], { baseline });
  __setSource(null); // restore default

  assert.equal(out.length, 2);
  const vkbt = out.find((r) => r.symbol === 'VKBT');
  assert.equal(vkbt.priceChangePct, 12);
  assert.equal(vkbt.notable, true);
  const cure = out.find((r) => r.symbol === 'CURE');
  assert.equal(cure.priceChangePct, 0);         // no price move
  assert.equal(cure.notable, false);
});

test('ingest skips tokens with no baseline or no current snapshot', async () => {
  __setSource(async (s) => (s === 'VKBT' ? { symbol: 'VKBT', price: 1.1, volume24h: 50 } : null));
  const out = await ingest(['VKBT', 'CURE'], { baseline: { VKBT: { price: 1.0, volume24h: 40 } } });
  __setSource(null);
  assert.equal(out.length, 1);                   // CURE has no current snapshot → skipped
  assert.equal(out[0].symbol, 'VKBT');
});

test('ingest soft-fails to [] when the source throws', async () => {
  __setSource(async () => { throw new Error('rpc down'); });
  const out = await ingest(['VKBT'], { baseline: { VKBT: { price: 1.0 } } });
  __setSource(null);
  assert.deepEqual(out, []);                     // per-token throw → that token skipped → []
});

test('ingest falls back to the default watchlist when no tokens are passed', async () => {
  const seen = [];
  __setSource(async (s) => { seen.push(s); return null; });
  await ingest(undefined, { baseline: {} });
  __setSource(null);
  assert.ok(seen.includes('VKBT'));
  assert.ok(seen.includes('CURE'));
});

// ── briefNotes (pure markdown) ────────────────────────────────────────────────────────────────────

test('briefNotes emits markdown with the biggest move first and highlights notable', () => {
  const movements = [
    { symbol: 'CURE', price: 0.5, priceChangePct: 2, volumeChangePct: 5, direction: 'up', notable: false },
    { symbol: 'VKBT', price: 1.12, priceChangePct: 12, volumeChangePct: 50, direction: 'up', notable: true },
  ];
  const md = briefNotes(movements);
  assert.match(md, /### Token movement/);
  // biggest mover (VKBT +12%) must come before the smaller mover (CURE +2%)
  assert.ok(md.indexOf('VKBT') < md.indexOf('CURE'), 'biggest move should sort first');
  // notable move bolded + flagged
  assert.match(md, /\*\*.*VKBT.*\+12%.*\*\* — notable move/);
  // the "on rising volume" phrasing the briefs want
  assert.match(md, /on rising volume \(\+50%\)/);
});

test('briefNotes degrades to a placeholder line on no data', () => {
  const md = briefNotes([]);
  assert.match(md, /### Token movement/);
  assert.match(md, /No token movement this pass/);
});

test('briefNotes never throws on garbage input', () => {
  assert.doesNotThrow(() => briefNotes(null));
  assert.doesNotThrow(() => briefNotes([null, undefined]));
});

// ── watchlist ────────────────────────────────────────────────────────────────────────────────────

test('watchlist includes VKBT and CURE by default', () => {
  const w = watchlist();
  assert.ok(w.includes('VKBT'));
  assert.ok(w.includes('CURE'));
  assert.ok(w.length >= 2 && w.length <= 8, 'watchlist stays small');
});

test('watchlist respects the HE_INGEST_WATCH env override', () => {
  const prev = process.env.HE_INGEST_WATCH;
  process.env.HE_INGEST_WATCH = 'FOO, BAR  BAZ';
  try {
    assert.deepEqual(watchlist(), ['FOO', 'BAR', 'BAZ']);
  } finally {
    if (prev == null) delete process.env.HE_INGEST_WATCH; else process.env.HE_INGEST_WATCH = prev;
  }
});
