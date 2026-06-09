import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  optimalVoteDelaySeconds,
  optimalFireAtMs,
  timingFor,
  CHAIN_TIMING,
  DEFAULT_TIMING,
  CURATION_WINDOW_SEC,
} from './curation-timing.mjs';

test('Hive votes promptly — no reverse auction (HF25)', () => {
  // Brand-new post on Hive: small settle delay only (20s), never +5min.
  assert.equal(optimalVoteDelaySeconds('hive', 0), 20);
  // After the settle delay has elapsed → fire now.
  assert.equal(optimalVoteDelaySeconds('hive', 30), 0);
  assert.equal(optimalVoteDelaySeconds('HIVE', 20), 0); // case-insensitive
});

test('Steem schedules ~5min (300s+buffer) after a fresh post', () => {
  // Fresh post (age 0): wait the full 300s auction + 20s buffer.
  assert.equal(optimalVoteDelaySeconds('steem', 0), 320);
  // 1 minute in: wait the remaining ~4:20.
  assert.equal(optimalVoteDelaySeconds('steem', 60), 260);
  // Exactly at 5:00: still wait the buffer.
  assert.equal(optimalVoteDelaySeconds('steem', 300), 20);
});

test('Blurt has the same 5-min reverse-auction shape as Steem', () => {
  assert.equal(optimalVoteDelaySeconds('blurt', 0), 320);
  assert.equal(optimalVoteDelaySeconds('blurt', 120), 200); // 2 min in → 200s left
});

test('reverse-auction chains clamp to 0 once past the window edge (never negative)', () => {
  // Post already older than 5:20 → fire now, never a negative delay.
  assert.equal(optimalVoteDelaySeconds('steem', 320), 0);
  assert.equal(optimalVoteDelaySeconds('steem', 1000), 0);
  assert.equal(optimalVoteDelaySeconds('blurt', 99999), 0);
});

test('unknown chain falls back to the conservative (Steem/Blurt) default', () => {
  assert.deepEqual(timingFor('nope'), DEFAULT_TIMING);
  assert.equal(optimalVoteDelaySeconds('nope', 0), 320);
});

test('MELEK testnet votes promptly (no auction)', () => {
  assert.equal(optimalVoteDelaySeconds('melek-testnet', 0), 0);
  assert.equal(optimalVoteDelaySeconds('melek-testnet', 500), 0);
});

test('minDelaySec floor is honored', () => {
  // Hive would fire now (age past settle), but a 90s user floor lifts it.
  assert.equal(optimalVoteDelaySeconds('hive', 30, { minDelaySec: 90 }), 90);
  // Steem at the edge (delay 0) lifted to floor.
  assert.equal(optimalVoteDelaySeconds('steem', 400, { minDelaySec: 45 }), 45);
});

test('maxDelaySec ceiling clamps a long wait', () => {
  // Fresh Steem post would be 320s; ceiling at 100s.
  assert.equal(optimalVoteDelaySeconds('steem', 0, { maxDelaySec: 100 }), 100);
});

test('config overrides per-chain constants', () => {
  // Force a 600s auction even on Hive.
  assert.equal(
    optimalVoteDelaySeconds('hive', 0, { reverseAuctionSec: 600, bufferSec: 0 }),
    600,
  );
});

test('bad / negative postAge is treated as a fresh post', () => {
  assert.equal(optimalVoteDelaySeconds('steem', -50), 320);
  assert.equal(optimalVoteDelaySeconds('steem', NaN), 320);
  assert.equal(optimalVoteDelaySeconds('steem', 'garbage'), 320);
});

test('optimalFireAtMs returns an absolute ms, clamped to the floor', () => {
  const now = 1_000_000_000_000;
  // Fresh Steem post at `now` → fire at now + 320s.
  const fresh = optimalFireAtMs('steem', { nowMs: now, postTimeMs: now });
  assert.equal(fresh, now + 320_000);
  // Old post → fire ~now, but a floor of 10s pushes it to now+10s.
  const old = optimalFireAtMs('steem', { nowMs: now, postTimeMs: now - 9_999_000, floorMs: 10_000 });
  assert.equal(old, now + 10_000);
});

test('optimalFireAtMs Hive fresh post = prompt settle delay', () => {
  const now = 2_000_000_000_000;
  const at = optimalFireAtMs('hive', { nowMs: now, postTimeMs: now });
  assert.equal(at, now + 20_000);
});

test('constants are sane and exported', () => {
  assert.equal(CHAIN_TIMING.hive.reverseAuctionSec, 0);
  assert.equal(CHAIN_TIMING.steem.reverseAuctionSec, 300);
  assert.equal(CHAIN_TIMING.blurt.reverseAuctionSec, 300);
  assert.equal(CURATION_WINDOW_SEC, 24 * 3600);
});
