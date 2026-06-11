// witness-status-feed.test.mjs — offline tests for the read-only witness-health feed.
// node:test + node:assert/strict. No network, no keys, no fs. Happy + edges.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  witnessStatus,
  renderStatusHtml,
  esc,
  __setReader,
  DEFAULT_THRESHOLDS,
} from './witness-status-feed.mjs';

const NOW = 1_700_000_000_000;
const clock = () => NOW;

// A fully-healthy monitor+feed snapshot: producing, no misses, fresh feed.
function healthySnap() {
  return {
    account: 'hathor',
    ok: true,
    totalMissed: 0,
    lastConfirmedBlock: 500000,
    headBlock: 500002,
    blocksBehind: 2,
    signingKeyDisabled: false,
    version: '0.23.0',
    ts: NOW,
    lastPublished: { price: 0.42, at: NOW - 20 * 60000 }, // 20 min old → fresh
  };
}

test('healthy: producing, no misses, fresh feed → healthy true', async () => {
  const s = await witnessStatus(healthySnap(), { now: clock });
  assert.equal(s.account, 'hathor');
  assert.equal(s.producing, true);
  assert.equal(s.healthy, true);
  assert.equal(s.missedBlocks, 0);
  assert.equal(s.lastBlock, 500000);
  assert.equal(s.priceFeedAgeMin, 20);
});

test('healthy: reader can be a function (sync and async)', async () => {
  const syncS = await witnessStatus(() => healthySnap(), { now: clock });
  assert.equal(syncS.healthy, true);
  const asyncS = await witnessStatus(async () => healthySnap(), { now: clock });
  assert.equal(asyncS.healthy, true);
});

test('healthy: derives feed age from priceFeedAt / explicit priceFeedAgeMin', async () => {
  const a = healthySnap();
  delete a.lastPublished;
  a.priceFeedAt = NOW - 30 * 60000;
  const sa = await witnessStatus(a, { now: clock });
  assert.equal(sa.priceFeedAgeMin, 30);

  const b = healthySnap();
  delete b.lastPublished;
  b.priceFeedAgeMin = 5;
  const sb = await witnessStatus(b, { now: clock });
  assert.equal(sb.priceFeedAgeMin, 5);
  assert.equal(sb.healthy, true);
});

test('degraded: missed blocks rose → producing true but healthy false', async () => {
  const snap = healthySnap();
  snap.totalMissed = 3;
  const s = await witnessStatus(snap, { now: clock });
  assert.equal(s.producing, true);
  assert.equal(s.missedBlocks, 3);
  assert.equal(s.healthy, false, 'a missed block drops health');
});

test('down: too far behind head → not producing, not healthy', async () => {
  const snap = healthySnap();
  snap.blocksBehind = 200;
  snap.headBlock = 500200;
  const s = await witnessStatus(snap, { now: clock });
  assert.equal(s.producing, false);
  assert.equal(s.healthy, false);
});

test('down: signing key disabled → not producing', async () => {
  const snap = healthySnap();
  snap.signingKeyDisabled = true;
  const s = await witnessStatus(snap, { now: clock });
  assert.equal(s.producing, false);
  assert.equal(s.healthy, false);
});

test('stale feed: fresh chain but old price feed → producing but not healthy', async () => {
  const snap = healthySnap();
  snap.lastPublished = { price: 0.42, at: NOW - 5 * 60 * 60000 }; // 5 hours old
  const s = await witnessStatus(snap, { now: clock });
  assert.equal(s.producing, true);
  assert.equal(s.priceFeedAgeMin, 300);
  assert.equal(s.healthy, false, 'stale feed is not healthy');
});

test('unknown feed: no feed timestamp → priceFeedAgeMin null, not healthy', async () => {
  const snap = healthySnap();
  delete snap.lastPublished;
  const s = await witnessStatus(snap, { now: clock });
  assert.equal(s.priceFeedAgeMin, null);
  assert.equal(s.producing, true);
  assert.equal(s.healthy, false, 'unknown feed age cannot be healthy');
});

test('failed read: ok:false snapshot → safe not-healthy status', async () => {
  const s = await witnessStatus({ account: 'hathor', ok: false, error: 'rpc down' }, { now: clock });
  assert.equal(s.producing, false);
  assert.equal(s.healthy, false);
  assert.equal(s.missedBlocks, 0);
  assert.equal(s.lastBlock, 0);
  assert.equal(s.priceFeedAgeMin, null);
});

test('empty soft-fail: null / undefined / garbage reader → safe default', async () => {
  for (const bad of [null, undefined, 42, 'nope', [], () => { throw new Error('boom'); }, () => null]) {
    const s = await witnessStatus(bad, { now: clock });
    assert.equal(s.account, 'hathor');
    assert.equal(s.producing, false);
    assert.equal(s.healthy, false);
    assert.equal(s.missedBlocks, 0);
    assert.equal(s.lastBlock, 0);
    assert.equal(s.priceFeedAgeMin, null);
  }
});

test('no args at all → safe default (never throws)', async () => {
  const s = await witnessStatus();
  assert.equal(s.healthy, false);
  assert.equal(s.account, 'hathor');
});

test('future feed timestamp → treated as age 0, not negative', async () => {
  const snap = healthySnap();
  snap.lastPublished = { price: 0.42, at: NOW + 60000 };
  const s = await witnessStatus(snap, { now: clock });
  assert.equal(s.priceFeedAgeMin, 0);
});

test('__setReader sets a default used when no arg passed', async () => {
  __setReader(() => healthySnap());
  try {
    const s = await witnessStatus(undefined, { now: clock });
    assert.equal(s.healthy, true);
  } finally {
    __setReader(null);
  }
  const after = await witnessStatus(undefined, { now: clock });
  assert.equal(after.healthy, false, 'reset reader → back to safe default');
});

test('garbage / non-finite numeric fields collapse safely', async () => {
  const snap = {
    account: 'hathor', ok: true,
    totalMissed: 'NaN', lastConfirmedBlock: null, headBlock: undefined,
    blocksBehind: 'x', signingKeyDisabled: false,
    lastPublished: { price: 1, at: 'bad' },
  };
  const s = await witnessStatus(snap, { now: clock });
  assert.equal(s.missedBlocks, 0);
  assert.equal(s.lastBlock, 0);
  assert.equal(s.priceFeedAgeMin, null);
  assert.equal(s.producing, false);
});

// ── renderStatusHtml ───────────────────────────────────────────────────────────────────────────

test('renderStatusHtml: healthy card has ok class and facts', () => {
  const html = renderStatusHtml({ account: 'hathor', producing: true, missedBlocks: 0, lastBlock: 500000, priceFeedAgeMin: 20, healthy: true });
  assert.match(html, /witness-status--ok/);
  assert.match(html, />healthy</);
  assert.match(html, /@hathor/);
  assert.match(html, /producing blocks/);
  assert.match(html, /last block #500000/);
  assert.match(html, /price feed: 20 min ago/);
});

test('renderStatusHtml: degraded and down classes', () => {
  const deg = renderStatusHtml({ account: 'hathor', producing: true, missedBlocks: 3, lastBlock: 1, priceFeedAgeMin: 300, healthy: false });
  assert.match(deg, /witness-status--warn/);
  assert.match(deg, />degraded</);
  const down = renderStatusHtml({ account: 'hathor', producing: false, missedBlocks: 0, lastBlock: 0, priceFeedAgeMin: null, healthy: false });
  assert.match(down, /witness-status--err/);
  assert.match(down, />down</);
  assert.match(down, /not producing/);
  assert.match(down, /no confirmed block/);
  assert.match(down, /price feed: unknown/);
});

test('renderStatusHtml: esc()s a malicious account name', () => {
  const html = renderStatusHtml({ account: '<script>alert(1)</script>', producing: true, missedBlocks: 0, lastBlock: 5, priceFeedAgeMin: 1, healthy: true });
  assert.ok(!html.includes('<script>'), 'script tag must be escaped');
  assert.match(html, /&lt;script&gt;/);
});

test('renderStatusHtml: null/garbage status → safe unknown card, never throws', () => {
  for (const bad of [null, undefined, 42, 'nope', []]) {
    const html = renderStatusHtml(bad);
    assert.equal(typeof html, 'string');
    assert.match(html, /witness-status/);
    assert.match(html, /@hathor/);
  }
});

test('esc escapes the five entities', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});

test('DEFAULT_THRESHOLDS is frozen and sane', () => {
  assert.equal(Object.isFrozen(DEFAULT_THRESHOLDS), true);
  assert.ok(DEFAULT_THRESHOLDS.maxBlocksBehind > 0);
  assert.ok(DEFAULT_THRESHOLDS.maxFeedAgeMin > 0);
});
