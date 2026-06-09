import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { Store } from './store.js';
import { VoteEngine } from './vote-engine.js';

function tmpStore() {
  const p = path.join(os.tmpdir(), `autovote-timing-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  return new Store(p);
}

class MockChain {
  constructor() { this.votes = []; }
  async headBlockNumber() { return 0; }
  async getBlockOps() { return null; }
  async vote(op) { this.votes.push(op); return { id: 'tx_' + this.votes.length }; }
}

function engineFor(chainId, { curationTiming } = {}) {
  const store = tmpStore();
  const chain = new MockChain();
  const engine = new VoteEngine(store, {
    chains: { [chainId]: chain },
    voteIntervalMs: 3300,
    log: () => {},
    blockMainnet: true,        // mainnet broadcast stays BLOCKED regardless
    curationTiming,
  });
  return { store, chain, engine };
}

// helper: the only pending entry's fireAt
function onlyFireAt(engine) {
  const vals = [...engine._pending.values()];
  assert.equal(vals.length, 1, 'exactly one pending vote');
  return vals[0].fireAt;
}

const POST_TS = '2026-06-09T00:00:00'; // condenser-style (no Z)
const POST_MS = Date.parse(POST_TS + 'Z');

test('timing OFF: fanbase keeps flat eventTime + delayMs (no behavior change)', () => {
  const { store, engine } = engineFor('hive', { curationTiming: false });
  store.upsertUser('hive', 'me', 'postingkey', { postingKey: 'k' });
  store.addFanbase({ chain: 'hive', owner: 'me', authors: ['alice'], weight: 100, delayMs: 5000 });
  engine.processBlock('hive', {
    timestamp: POST_TS,
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p1', parent_author: '' } }],
  });
  assert.equal(onlyFireAt(engine), POST_MS + 5000); // exactly legacy behavior
});

test('timing ON, Hive fanbase: prompt (post-time + ~20s settle)', () => {
  const { store, engine } = engineFor('hive', { curationTiming: true });
  store.upsertUser('hive', 'me', 'postingkey', { postingKey: 'k' });
  store.addFanbase({ chain: 'hive', owner: 'me', authors: ['alice'], weight: 100, delayMs: 0 });
  engine.processBlock('hive', {
    timestamp: POST_TS,
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p1', parent_author: '' } }],
  });
  // fireAt computed relative to `now` inside computeFireAt; assert it lands at
  // most ~20s out and is not pushed +5min.
  const fireAt = onlyFireAt(engine);
  const deltaFromNow = fireAt - Date.now();
  assert.ok(deltaFromNow <= 20_000 + 50, `Hive prompt, got ${deltaFromNow}ms`);
  // `fireAt` is computed against the engine's OWN Date.now() inside processBlock; the
  // wall clock advances by the time we read Date.now() here. For an aged post (POST_TS
  // is "today 00:00Z", so most of the day postAge > the 20s prompt → delay clamps to 0
  // → fireAt == the engine's earlier `now`), so fireAt - Date.now() is a few ms NEGATIVE.
  // Allow the same ±50ms clock slop the upper bound and the delayMs-floor test use, so
  // this never flakes red late in the UTC day (root cause of the CI exit-1).
  assert.ok(deltaFromNow >= -50, `Hive prompt floor, got ${deltaFromNow}ms`);
});

test('timing ON, Steem fanbase on a fresh post: ~5min reverse-auction edge', () => {
  const { store, engine } = engineFor('steem', { curationTiming: true });
  store.upsertUser('steem', 'me', 'postingkey', { postingKey: 'k' });
  // Use a post timestamped ~now so the auction window is still open.
  const nowTs = new Date().toISOString().slice(0, 19);
  store.addFanbase({ chain: 'steem', owner: 'me', authors: ['alice'], weight: 100, delayMs: 0 });
  engine.processBlock('steem', {
    timestamp: nowTs,
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p1', parent_author: '' } }],
  });
  const deltaFromNow = onlyFireAt(engine) - Date.now();
  // Expect ~320s (300 auction + 20 buffer); allow a few seconds of slop.
  assert.ok(deltaFromNow > 300_000, `Steem should wait > 5min, got ${deltaFromNow}ms`);
  assert.ok(deltaFromNow <= 320_000 + 5_000, `Steem ~5:20, got ${deltaFromNow}ms`);
});

test('timing ON, Steem fanbase on an OLD post: fire promptly (auction already over)', () => {
  const { store, engine } = engineFor('steem', { curationTiming: true });
  store.upsertUser('steem', 'me', 'postingkey', { postingKey: 'k' });
  // Post created 10 minutes ago → past the 5-min edge → no extra wait.
  const oldTs = new Date(Date.now() - 600_000).toISOString().slice(0, 19);
  store.addFanbase({ chain: 'steem', owner: 'me', authors: ['alice'], weight: 100, delayMs: 0 });
  engine.processBlock('steem', {
    timestamp: oldTs,
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p2', parent_author: '' } }],
  });
  const deltaFromNow = onlyFireAt(engine) - Date.now();
  assert.ok(deltaFromNow < 5_000, `old Steem post fires promptly, got ${deltaFromNow}ms`);
});

test('timing ON respects the user delayMs as a floor', () => {
  const { store, engine } = engineFor('hive', { curationTiming: true });
  store.upsertUser('hive', 'me', 'postingkey', { postingKey: 'k' });
  // Hive would be prompt (~20s) but a 2-min user floor lifts it.
  store.addFanbase({ chain: 'hive', owner: 'me', authors: ['alice'], weight: 100, delayMs: 120_000 });
  engine.processBlock('hive', {
    timestamp: POST_TS,
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p3', parent_author: '' } }],
  });
  const deltaFromNow = onlyFireAt(engine) - Date.now();
  assert.ok(deltaFromNow >= 120_000 - 50, `floor honored, got ${deltaFromNow}ms`);
});

test('computeFireAt is pure given an injected now', () => {
  const { engine } = engineFor('steem', { curationTiming: true });
  const now = 1_700_000_000_000;
  const fa = engine.computeFireAt('steem', { eventTimeMs: now, postTimeMs: now, now });
  assert.equal(fa, now + 320_000);
  // off → flat
  const { engine: e2 } = engineFor('steem', { curationTiming: false });
  assert.equal(e2.computeFireAt('steem', { eventTimeMs: now, delayMs: 7000, now }), now + 7000);
});
