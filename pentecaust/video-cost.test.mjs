// video-cost.test.mjs — offline tests for the MELEK video cost model.
// Pure arithmetic: no network, no fetch, no state. The tests pin the numbers that decide viability —
// ~2 GB of egress per 1080p viewer-hour, and one video against a full day of total chain capacity.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BITRATE_LADDER, LADDER_HEIGHTS, AUDIO_KBPS, CODECS, PRICE_SCENARIOS,
  MAX_BLOCK_BYTES, BLOCK_INTERVAL_SEC, BLOCKS_PER_DAY, CHAIN_BYTES_PER_DAY,
  nearestRung, rungKbps, ladderFor, codecFactor,
  estimateVideo, egressPerViewerHour, egressBytes, projectCost, prices, checkClaim,
  describeCost, renderCostPanel,
} from './video-cost.mjs';

// ── the chain side, taken from the live-testnet config, not from memory ──────────────────────────
test('the chain budget matches MAINNET, read from the live chain', () => {
  // Was 65,536 — which is both the wrong parameter (maxTransactionSize, not maximum_block_size) and
  // the testnet figure. Mainnet's get_chain_properties returned maximum_block_size: 131072 on
  // 2026-09-08, so every chain-share number computed from the old constant was 2x pessimistic.
  assert.equal(MAX_BLOCK_BYTES, 131072);
  assert.equal(BLOCK_INTERVAL_SEC, 4);
  assert.equal(BLOCKS_PER_DAY, 21600);
  assert.equal(CHAIN_BYTES_PER_DAY, 2_831_155_200);
  assert.ok(CHAIN_BYTES_PER_DAY / 1e9 > 2.82 && CHAIN_BYTES_PER_DAY / 1e9 < 2.84, '~2.83 GB/day for the ENTIRE chain');
});

// ── the ladder ───────────────────────────────────────────────────────────────────────────────────
test('bitrate ladder is monotonic and audio rides on every rung', () => {
  let prev = 0;
  for (const h of LADDER_HEIGHTS) {
    assert.ok(BITRATE_LADDER[h] > prev, `${h}p must cost more than the rung below`);
    prev = BITRATE_LADDER[h];
    assert.equal(rungKbps(h), BITRATE_LADDER[h] + AUDIO_KBPS);
  }
});

test('nearestRung snaps down, and clamps at the ends', () => {
  assert.equal(nearestRung(1080), 1080);
  assert.equal(nearestRung(1082), 1080);
  assert.equal(nearestRung(1079), 720);
  assert.equal(nearestRung(9999), 2160);
  assert.equal(nearestRung(0), 0);
  assert.equal(nearestRung('nonsense'), 0);
});

test('ladderFor gives the working ladder, single gives one rendition', () => {
  assert.deepEqual(ladderFor(1080), [1080, 720, 480, 360]);
  assert.deepEqual(ladderFor(1080, { single: true }), [1080]);
  assert.deepEqual(ladderFor(480), [480, 360, 240, 144]);
  assert.deepEqual(ladderFor(0), []);
  assert.equal(ladderFor(2160, { max: 2 }).length, 2);
});

test('codec factors buy real bytes', () => {
  assert.equal(codecFactor('h264'), 1.0);
  assert.equal(codecFactor('AV1'), CODECS.av1);
  assert.equal(codecFactor('nonsense'), 1.0);
  assert.ok(rungKbps(1080, 'av1') < rungKbps(1080, 'h264'));
});

// ── STORAGE — the number that ends the on-chain conversation ─────────────────────────────────────
test('a 10-minute 1080p single rendition is ~347 MB', () => {
  const m = estimateVideo({ durationSec: 600, height: 1080, single: true });
  assert.equal(m.renditions.length, 1);
  assert.equal(m.storageBytes, 347_100_000);            // (4500 + 128) kbps * 600s
  assert.ok(m.storageGb > 0.34 && m.storageGb < 0.35);
});

test('a 10-minute 1080p LADDER is ~0.7 GB — a QUARTER of total chain capacity for a whole day', () => {
  const m = estimateVideo({ durationSec: 600, height: 1080 });
  assert.equal(m.renditions.length, 4);
  assert.ok(m.storageGb > 0.69 && m.storageGb < 0.72, `got ${m.storageGb} GB`);
  // The load-bearing claim, recomputed against mainnet. Halving the share does not change the
  // conclusion — ONE ten-minute video is still a quarter of what the entire chain can carry in a
  // day, for every user and every operation combined. Video does not go on the chain.
  assert.ok(m.chainDayShare > 0.22 && m.chainDayShare < 0.28, `got ${m.chainDayShare}`);
  assert.match(m.note, /2\.83 GB\/day for the entire chain/);
});

test('renditions are ordered top-first and sum to the total', () => {
  const m = estimateVideo({ durationSec: 300, height: 720 });
  assert.deepEqual(m.renditions.map((r) => r.height), [720, 480, 360, 240]);
  assert.equal(m.renditions.reduce((s, r) => s + r.bytes, 0), m.storageBytes);
});

test('explicit heights override the ladder, and duplicates collapse', () => {
  const m = estimateVideo({ durationSec: 60, heights: [1080, 1080, 480] });
  assert.deepEqual(m.renditions.map((r) => r.height), [1080, 480]);
});

test('estimateVideo is total — junk gives a zeroed model, never a throw', () => {
  for (const junk of [undefined, {}, { durationSec: -5 }, { durationSec: 'x', height: 'y' }]) {
    const m = estimateVideo(junk);
    assert.ok(Number.isFinite(m.storageBytes));
    assert.ok(m.storageBytes >= 0);
  }
});

// ── EGRESS — the bill that scales with success ───────────────────────────────────────────────────
test('~2 GB of egress per 1080p viewer-hour — the number that decides viability', () => {
  const bytes = egressPerViewerHour(1080);
  const gb = bytes / 1e9;
  assert.ok(gb > 2 && gb < 3, `expected the 2-3 GB/viewer-hour band, got ${gb}`);
  assert.equal(bytes, 2_082_600_000);                   // (4500 + 128) kbps * 3600s
});

test('dropping the served rendition is the biggest lever on the bill', () => {
  const at1080 = egressPerViewerHour(1080);
  const at720 = egressPerViewerHour(720);
  const at480 = egressPerViewerHour(480);
  assert.ok(at720 < at1080 * 0.6, '720p is well under half the 1080p bill');
  assert.ok(at480 < at1080 * 0.35);
});

test('egressBytes scales linearly and floors at zero', () => {
  assert.equal(egressBytes({ viewerHours: 2, height: 1080 }), egressPerViewerHour(1080) * 2);
  assert.equal(egressBytes({ viewerHours: -3 }), 0);
  assert.equal(egressBytes({}), 0);
});

test('a thousand 1080p viewer-hours moves about two terabytes', () => {
  const tb = (egressPerViewerHour(1080) * 1000) / 1e12;
  assert.ok(tb > 2 && tb < 2.2, `got ${tb} TB`);
});

// ── PRICES + PROJECTION ──────────────────────────────────────────────────────────────────────────
test('price scenarios are ordered and default to our own boxes', () => {
  assert.ok(PRICE_SCENARIOS.ownBox.egressUsdPerGb < PRICE_SCENARIOS.cheapCloud.egressUsdPerGb);
  assert.ok(PRICE_SCENARIOS.cheapCloud.egressUsdPerGb < PRICE_SCENARIOS.bigCloud.egressUsdPerGb);
  assert.equal(prices().label, PRICE_SCENARIOS.ownBox.label);
  assert.equal(prices('bigCloud').egressUsdPerGb, 0.085);
  assert.equal(prices('nonexistent').label, PRICE_SCENARIOS.ownBox.label);
  assert.equal(prices({ egressUsdPerGb: 0.5 }).egressUsdPerGb, 0.5);
});

test('views x watch-fraction becomes viewer-hours', () => {
  const m = projectCost({ durationSec: 600, height: 1080, views: 1000, watchFraction: 0.5 });
  assert.ok(Math.abs(m.viewerHours - (1000 * 0.5 * (600 / 3600))) < 1e-9);
  assert.equal(m.egressBytes, Math.round(egressPerViewerHour(1080) * m.viewerHours));
});

test('egress dominates storage the moment anyone actually watches', () => {
  const m = projectCost({ durationSec: 600, height: 1080, views: 1000, watchFraction: 0.5, months: 12 });
  assert.ok(m.egressUsd > m.storageUsd * 5, 'storage is paid once; egress is paid every view');
  assert.ok(m.totalUsd > 0);
});

test('S3-class egress is an order of magnitude worse than our own boxes', () => {
  const own = projectCost({ durationSec: 600, height: 1080, viewerHours: 1000, prices: 'ownBox' });
  const big = projectCost({ durationSec: 600, height: 1080, viewerHours: 1000, prices: 'bigCloud' });
  assert.ok(big.egressUsd > own.egressUsd * 50);
  assert.ok(own.viewerHoursPerUsd > big.viewerHoursPerUsd * 50);
});

test('serveHeight is the lever: serving 720p by default nearly halves the bill', () => {
  const hi = projectCost({ durationSec: 600, height: 1080, viewerHours: 500 });
  const lo = projectCost({ durationSec: 600, height: 1080, viewerHours: 500, serveHeight: 720 });
  assert.equal(hi.serveHeight, 1080);
  assert.equal(lo.serveHeight, 720);
  assert.ok(lo.egressUsd < hi.egressUsd * 0.6);
  assert.equal(lo.storageBytes, hi.storageBytes, 'the ladder stored is unchanged — only what we serve moved');
});

test('projectCost is total', () => {
  for (const junk of [undefined, {}, { views: 'x' }, { durationSec: null, viewerHours: -1 }]) {
    const m = projectCost(junk);
    assert.ok(Number.isFinite(m.totalUsd));
    assert.ok(m.totalUsd >= 0);
  }
});

// ── CLAIM CHECK — ties the cost model back to what a post asserts ────────────────────────────────
test('checkClaim backs out the implied bitrate and flags nonsense', () => {
  const good = checkClaim({ filesizeBytes: 347_100_000, durationSec: 600, height: 1080 });
  assert.equal(good.ok, true);
  assert.equal(good.verdict, 'plausible');
  assert.ok(Math.abs(good.impliedKbps - 4628) < 5);

  const truncated = checkClaim({ filesizeBytes: 1_000_000, durationSec: 600, height: 1080 });
  assert.equal(truncated.ok, false);
  assert.match(truncated.verdict, /truncated|mislabelled/);

  const master = checkClaim({ filesizeBytes: 20_000_000_000, durationSec: 600, height: 1080 });
  assert.equal(master.ok, false);
  assert.match(master.verdict, /mezzanine|master/);

  assert.equal(checkClaim({}).verdict, 'not enough numbers to check');
});

// ── presentation ─────────────────────────────────────────────────────────────────────────────────
test('describeCost states storage, egress and the chain share', () => {
  const lines = describeCost(projectCost({ durationSec: 600, height: 1080, viewerHours: 100 })).join('\n');
  assert.match(lines, /STORAGE/);
  assert.match(lines, /EGRESS/);
  assert.match(lines, /per viewer-hour/);
  assert.match(lines, /FULL DAY of total chain capacity/);
  assert.ok(describeCost(null).length > 0, 'total — no throw on junk');
});

test('renderCostPanel escapes everything and names the egress asymmetry', () => {
  const html = renderCostPanel(projectCost({ durationSec: 600, height: 1080, viewerHours: 10 }));
  assert.match(html, /What this costs to serve/);
  assert.match(html, /per viewer-hour/);
  assert.match(html, /egress is paid every single time somebody watches/);
  assert.ok(!/<script/i.test(html));

  const nasty = renderCostPanel({ note: '<script>alert(1)</script>', renditions: [{ height: '<img>', kbps: '"x"', bytes: 1 }] });
  assert.ok(!nasty.includes('<script>'));
  assert.ok(nasty.includes('&lt;script&gt;'));
  assert.ok(nasty.includes('&lt;img&gt;'));
});
