// Tests for the "Measure my device" benchmark math + honest earnings estimate.
// Run: node --test pool/www/measure.test.mjs
//
// All offline: the benchmark math is pure, and runBenchmark is driven with a fake Worker
// and fake timers so no real RandomX / Web Worker runs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  syntheticJob, aggregateHashrate, steadyHashrate, estimateEarnings,
  fmtUsd, fmtHs, networkInputsFromPool, runBenchmark, renderEstimateHtml,
} from './measure.mjs';

// ---------- synthetic job ----------
test('syntheticJob is real-shaped and impossible to beat (no shares during a benchmark)', () => {
  const j = syntheticJob({ lane: { offset: 2, stride: 4 } });
  assert.equal(j.blob.length, 152);       // 76 bytes
  assert.equal(j.seed_hash.length, 64);   // 32 bytes
  assert.equal(j.target, 0);              // hardest possible -> never a share
  assert.deepEqual(j.lane, { offset: 2, stride: 4 });
});

// ---------- aggregation ----------
test('aggregateHashrate sums per-worker H/s from a Map or object', () => {
  assert.deepEqual(aggregateHashrate(new Map([[0, 4], [1, 6]])), { total: 10, threads: 2 });
  assert.deepEqual(aggregateHashrate({ a: 3, b: 3, c: 3 }), { total: 9, threads: 3 });
  assert.deepEqual(aggregateHashrate(null), { total: 0, threads: 0 });
});

test('steadyHashrate drops the warm-up sample and returns the median', () => {
  // first sample (1) is warm-up while the cache builds; steady median of [8,9,10] = 9
  assert.equal(steadyHashrate([1, 8, 9, 10]), 9);
  // even count after dropping warm-up: [10,20] -> 15
  assert.equal(steadyHashrate([2, 10, 20]), 15);
  // too few samples to drop a warm-up: median of all
  assert.equal(steadyHashrate([5, 7]), 6);
  assert.equal(steadyHashrate([]), 0);
  assert.equal(steadyHashrate(['x', -3, 4]), 4); // filters junk/negatives
});

// ---------- earnings formula (the load-bearing honesty math) ----------
test('estimateEarnings — known numbers', () => {
  // 100 H/s on a 1,000,000 H/s network, 0.6 coin/block, 120s blocks, 1% fee.
  // blocks/day = 86400/120 = 720 ; minted/day = 720*0.6 = 432 ; share = 1e-4
  // gross = 432 * 1e-4 = 0.0432 ; after 1% fee = 0.0432*0.99 = 0.042768
  const e = estimateEarnings({ myHashrate: 100, networkHashrate: 1_000_000, blockReward: 0.6, blockTime: 120, poolFeePercent: 1 });
  assert.ok(Math.abs(e.coinPerDay - 0.042768) < 1e-9);
  assert.ok(Math.abs(e.sharePpm - 100) < 1e-9); // 1e-4 = 100 ppm
  assert.ok(Math.abs(e.coinPerMonth - 0.042768 * 30) < 1e-9);
  assert.equal(e.usdPerDay, null); // no price given
});

test('estimateEarnings — with a USD price', () => {
  const e = estimateEarnings({ myHashrate: 100, networkHashrate: 1_000_000, blockReward: 0.6, blockTime: 120, poolFeePercent: 0, priceUsd: 150 });
  // coinPerDay (no fee) = 0.0432 ; *150 = 6.48
  assert.ok(Math.abs(e.usdPerDay - 6.48) < 1e-9);
});

test('estimateEarnings — missing/zero inputs yield null (no fabricated number)', () => {
  assert.equal(estimateEarnings({ myHashrate: 0, networkHashrate: 1e6, blockReward: 1, blockTime: 60 }), null);
  assert.equal(estimateEarnings({ myHashrate: 10, networkHashrate: 0, blockReward: 1, blockTime: 60 }), null);
  assert.equal(estimateEarnings({ myHashrate: 10, networkHashrate: 1e6, blockReward: 0, blockTime: 60 }), null);
  assert.equal(estimateEarnings({ myHashrate: 10, networkHashrate: 1e6, blockReward: 1, blockTime: 0 }), null);
});

test('fee clamps to 0..100', () => {
  const e = estimateEarnings({ myHashrate: 100, networkHashrate: 1e6, blockReward: 0.6, blockTime: 120, poolFeePercent: 250 });
  assert.equal(e.coinPerDay, 0); // 100% fee floor
});

// ---------- honest formatting ----------
test('fmtUsd shows fractions of a cent honestly, never rounds tiny amounts to $0.00', () => {
  assert.equal(fmtUsd(0), '$0');
  assert.equal(fmtUsd(1.5), '$1.50');
  const tiny = fmtUsd(0.0003);
  assert.match(tiny, /\$0\.0003/);
  assert.match(tiny, /¢/);
  assert.equal(fmtUsd(null), null);
  assert.equal(fmtUsd('nope'), null);
});

test('fmtHs scales units', () => {
  assert.equal(fmtHs(8.8), '8.80 H/s');
  assert.equal(fmtHs(2500), '2.50 KH/s');
  assert.equal(fmtHs(0), '0.00 H/s');
});

// ---------- pulling live numbers out of the stats API ----------
test('networkInputsFromPool reads nested Miningcore + flat shapes', () => {
  const nested = networkInputsFromPool({
    pool: {
      coin: { symbol: 'xmr' },
      poolFeePercent: 1.5,
      poolStats: { poolHashrate: 5000 },
      networkStats: { networkHashrate: 2_000_000, reward: 0.6, blockTime: 120 },
    },
  });
  assert.equal(nested.networkHashrate, 2_000_000);
  assert.equal(nested.blockReward, 0.6);
  assert.equal(nested.blockTime, 120);
  assert.equal(nested.poolFeePercent, 1.5);
  assert.equal(nested.symbol, 'XMR');

  const flat = networkInputsFromPool({ networkStats: { networkHashrate: 10 }, blockReward: 1, coin: { blockTime: 60, type: 'zeph' } });
  assert.equal(flat.networkHashrate, 10);
  assert.equal(flat.blockReward, 1);
  assert.equal(flat.blockTime, 60);
  assert.equal(flat.symbol, 'ZEPH');

  const empty = networkInputsFromPool(null);
  assert.equal(empty.networkHashrate, null);
  assert.equal(empty.poolFeePercent, 0);
});

// ---------- the estimate HTML is honest ----------
test('renderEstimateHtml labels it an estimate and says fractions of a cent', () => {
  const net = { networkHashrate: 1_000_000, blockReward: 0.6, blockTime: 120, poolFeePercent: 1, symbol: 'XMR' };
  const html = renderEstimateHtml(100, net);
  assert.match(html, /Estimate \(not a promise\)/i);
  assert.match(html, /fractions of a cent/i);
  assert.match(html, /XMR\/day/);
  assert.match(html, /ppm/);
});

test('renderEstimateHtml degrades honestly when live numbers are missing', () => {
  const html = renderEstimateHtml(100, null);
  assert.match(html, /won’t guess/i);
  assert.match(html, /participation/i);
  assert.doesNotMatch(html, /\/day/); // no fabricated per-day figure
});

// ---------- runBenchmark with a fake Worker + fake timers ----------
class FakeWorker {
  constructor(url, opts) { this.url = url; this.opts = opts; this.posted = []; this.terminated = false; FakeWorker.all.push(this); }
  postMessage(m) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  emit(m) { this.onmessage && this.onmessage({ data: m }); }
}
FakeWorker.all = [];

test('runBenchmark spawns workers with the synthetic job, samples, and returns a steady H/s', async () => {
  FakeWorker.all = [];
  // controllable timers
  let timeoutCb = null; let timeoutMs = null;
  let intervalCb = null;
  const deps = {
    WorkerImpl: FakeWorker,
    now: () => 0,
    setTimeout: (fn, ms) => { timeoutCb = fn; timeoutMs = ms; return 1; },
    setInterval: (fn) => { intervalCb = fn; return 2; },
    clearInterval: () => {},
  };

  const p = runBenchmark({ threads: 3, durationMs: 30000, deps });

  // 3 workers, each got throttle=1, a synthetic job, and start
  assert.equal(FakeWorker.all.length, 3);
  for (const w of FakeWorker.all) {
    assert.ok(w.posted.some((m) => m.type === 'throttle' && m.value === 1));
    const job = w.posted.find((m) => m.type === 'job');
    assert.ok(job && job.job.target === 0, 'benchmark job is impossible to beat');
    assert.ok(w.posted.some((m) => m.type === 'start'));
  }
  // distinct nonce lanes
  const offsets = FakeWorker.all.map((w) => w.posted.find((m) => m.type === 'job').job.lane.offset).sort();
  assert.deepEqual(offsets, [0, 1, 2]);
  assert.equal(timeoutMs, 30000);

  // workers report hashrate; drive a few sample ticks
  FakeWorker.all[0].emit({ type: 'hashrate', hs: 3 });
  FakeWorker.all[1].emit({ type: 'hashrate', hs: 3 });
  FakeWorker.all[2].emit({ type: 'hashrate', hs: 3 });
  intervalCb(); // sample 1 (warm-up) -> 9
  intervalCb(); // sample 2 -> 9
  intervalCb(); // sample 3 -> 9

  // fire the end-of-window timeout
  timeoutCb();
  const result = await p;
  assert.equal(result.threads, 3);
  assert.equal(result.hashrate, 9); // median of steady samples
  assert.ok(FakeWorker.all.every((w) => w.terminated), 'workers cleaned up');
});

test('runBenchmark rejects when Web Workers are unavailable', async () => {
  await assert.rejects(runBenchmark({ deps: { WorkerImpl: null } }), /Web Workers unavailable/);
});
