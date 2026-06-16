// kula-econ.test.mjs — OFFLINE. KULA net-supply + PoL-floor model: net flow, use-policy split, floor
// price, deflation check, and a multi-epoch sim proving sinks make KULA flat/deflationary AND grow a
// PoL floor. Pure math, soft-fail, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  netKulaFlow, applyUsePolicy, polFloorPrice, isDeflationary, simulate,
} from './kula-econ.mjs';

test('netKulaFlow: net = emitted − burned − boughtBack; can go negative (deflationary)', () => {
  const f = netKulaFlow({ emitted: 100_000, burned: 125_000, boughtBack: 75_000 });
  assert.equal(f.sinks, 200_000);
  assert.equal(f.net, -100_000, 'sinks exceed emission → circulating supply shrinks');
  assert.equal(f.netMinted, -25_000, 'gross minted supply also shrinks (burn > emit)');
});

test('netKulaFlow: pure-emission loop (no sinks) is inflationary', () => {
  const f = netKulaFlow({ emitted: 100_000, burned: 0, boughtBack: 0 });
  assert.equal(f.net, 100_000, 'PoL→KULA with no KULA sink = pure inflation (the problem)');
});

test('netKulaFlow soft-fails bad input to 0, never throws', () => {
  const f = netKulaFlow({ emitted: 'x', burned: -5, boughtBack: NaN });
  assert.equal(f.emitted, 0);
  assert.equal(f.burned, 0);
  assert.equal(f.net, 0);
});

test('applyUsePolicy splits use volume into burn + buyback per bps', () => {
  const f = applyUsePolicy({ useVolumeKula: 250_000, burnBps: 5000, buybackBps: 3000, emitted: 100_000 });
  assert.equal(f.burned, 125_000, '50% of 250k burned');
  assert.equal(f.boughtBack, 75_000, '30% of 250k bought back + locked');
  assert.equal(f.toTreasury, 50_000, 'remaining 20% to treasury (not a sink)');
  assert.equal(f.net, -100_000, 'net circulating shrinks');
});

test('applyUsePolicy scales down a >100% misconfig instead of throwing', () => {
  const f = applyUsePolicy({ useVolumeKula: 100, burnBps: 8000, buybackBps: 8000, emitted: 0 });
  // 16000 bps total → scaled to 10000; equal halves → 50 each.
  assert.equal(f.burned, 50);
  assert.equal(f.boughtBack, 50);
});

test('polFloorPrice: floor = protocol quote reserves / circulating KULA', () => {
  const p = polFloorPrice({ polReserveKula: 100_000, polReserveQuote: 50_000, circulatingKula: 1_000_000 });
  assert.equal(p.floor, 0.05, '$50k backing / 1M KULA = $0.05 floor');
  assert.equal(p.spot, 0.5, 'in-pool spot = 50k/100k = $0.50');
  assert.equal(p.coverageBps, 1000, 'pool owns 10% of supply');
});

test('polFloorPrice soft-fails on zero circulating / empty pool', () => {
  assert.equal(polFloorPrice({ polReserveKula: 0, polReserveQuote: 0, circulatingKula: 0 }).floor, 0);
  assert.equal(polFloorPrice({ polReserveQuote: 100, circulatingKula: 0 }).floor, 0);
});

test('isDeflationary: true when sinks >= emission, false otherwise', () => {
  assert.equal(isDeflationary({ emitted: 100, burned: 60, boughtBack: 50 }), true);  // 110 sinks > 100
  assert.equal(isDeflationary({ emitted: 100, burned: 100, boughtBack: 0 }), true);  // flat
  assert.equal(isDeflationary({ emitted: 100, burned: 10, boughtBack: 10 }), false); // inflationary
});

test('simulate: sinks make KULA supply DEFLATIONARY and grow the PoL floor', () => {
  const { rows, summary } = simulate(12, {
    initialSupply: 2_000_000, emittedPerEpoch: 100_000, useVolumePerEpoch: 250_000,
    burnBps: 5000, buybackBps: 3000, initPolKula: 0, initPolQuote: 0, quotePerKula: 0.10,
  });
  assert.equal(rows.length, 12);
  // each epoch: +100k emit − 125k burn − 75k lock = −100k net.
  assert.equal(rows[0].net, -100_000);
  assert.equal(rows[0].supply, 1_900_000);
  assert.ok(summary.endSupply < summary.startSupply, 'supply fell over the run');
  assert.equal(summary.endSupply, 800_000, '2M − 12*100k = 800k');
  assert.equal(summary.deflationary, true);
  // floor grows: PoL accumulates locked KULA + quote while circulating supply shrinks → floor rises.
  assert.equal(summary.floorGrew, true);
  assert.ok(summary.endFloor > summary.startFloor, 'PoL floor rose epoch over epoch');
  assert.ok(rows[11].floor > rows[0].floor);
});

test('simulate: pure-emission with NO sinks is inflationary and grows NO floor', () => {
  const { summary } = simulate(12, {
    initialSupply: 2_000_000, emittedPerEpoch: 100_000, useVolumePerEpoch: 0, // no uses → no sinks
    burnBps: 5000, buybackBps: 3000, quotePerKula: 0.10,
  });
  assert.equal(summary.endSupply, 3_200_000, '2M + 12*100k = 3.2M (pure inflation)');
  assert.equal(summary.deflationary, false);
  assert.equal(summary.endFloor, 0, 'no buyback → no protocol-owned liquidity → no floor');
});

test('simulate: a FLAT (net-zero) regime holds supply steady', () => {
  // emit 100k; burn 100k worth (use 200k @ 50% burn, 0% buyback) → net 0.
  const { summary, rows } = simulate(6, {
    initialSupply: 1_000_000, emittedPerEpoch: 100_000, useVolumePerEpoch: 200_000,
    burnBps: 5000, buybackBps: 0, quotePerKula: 0.10,
  });
  assert.equal(rows[0].net, 0, 'emission exactly offset by burn');
  assert.equal(summary.endSupply, 1_000_000, 'supply held flat');
  assert.equal(summary.deflationary, true, 'flat counts as not-inflationary');
});

test('simulate: accepts per-epoch functions for emission and use volume', () => {
  const { rows } = simulate(3, {
    initialSupply: 0,
    emittedPerEpoch: (e) => e * 1000,        // 1000, 2000, 3000
    useVolumePerEpoch: 0,
    burnBps: 0, buybackBps: 0,
  });
  assert.equal(rows[0].emitted, 1000);
  assert.equal(rows[2].emitted, 3000);
  assert.equal(rows[2].supply, 6000, 'cumulative 1000+2000+3000');
});

test('simulate soft-fails to empty on zero epochs', () => {
  const { rows, summary } = simulate(0, { initialSupply: 5 });
  assert.equal(rows.length, 0);
  assert.equal(summary.endSupply, 5);
  assert.equal(summary.deflationary, true);
});
