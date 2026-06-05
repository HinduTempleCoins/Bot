import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Store } from './store.js';
import { VoteEngine } from './vote-engine.js';

const MELEK = 'melek-testnet';

function tmpStore() {
  const p = path.join(os.tmpdir(), `autovote-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  return new Store(p);
}

// A mock chain that records broadcast votes and serves canned blocks.
class MockChain {
  constructor() {
    this.votes = [];
    this.failNext = false;
  }
  async headBlockNumber() { return 0; }
  async getBlockOps() { return null; }
  async vote(op) {
    if (this.failNext) { this.failNext = false; throw new Error('broadcast boom'); }
    this.votes.push(op);
    return { id: 'tx_' + this.votes.length };
  }
}

function setup(chainId = MELEK) {
  const store = tmpStore();
  const chain = new MockChain();
  const engine = new VoteEngine(store, {
    chains: { [chainId]: chain },
    voteIntervalMs: 3300,
    log: () => {},
    blockMainnet: true,
  });
  return { store, chain, engine };
}

test('fanbase: new post by tracked author queues + broadcasts a vote', async () => {
  const { store, chain, engine } = setup();
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: '5Jkey' });
  store.addFanbase({ chain: MELEK, owner: 'me', authors: ['alice'], weight: 80, delayMs: 0 });

  engine.processBlock(MELEK, {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'post-1', parent_author: '' } }],
  });
  await engine.flushPending(Date.now());

  assert.equal(chain.votes.length, 1);
  assert.deepEqual(chain.votes[0], { voter: 'me', author: 'alice', permlink: 'post-1', weight: 8000 });
  assert.equal(store.votesFor(MELEK, 'me')[0].ok, true);
});

test('fanbase: comments are ignored (posts only)', async () => {
  const { store, chain, engine } = setup();
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: 'k' });
  store.addFanbase({ chain: MELEK, owner: 'me', authors: ['alice'], weight: 100 });
  engine.processBlock(MELEK, {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 're-1', parent_author: 'bob' } }],
  });
  await engine.flushPending(Date.now());
  assert.equal(chain.votes.length, 0);
});

test('trail: follows a leader upvote at scaled weight', async () => {
  const { store, chain, engine } = setup();
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: 'k' });
  store.addTrail({ chain: MELEK, owner: 'me', target: 'leader', weight: 50, delayMs: 0 });
  engine.processBlock(MELEK, {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'vote', payload: { voter: 'leader', author: 'alice', permlink: 'p', weight: 10000 } }],
  });
  await engine.flushPending(Date.now());
  assert.equal(chain.votes.length, 1);
  assert.equal(chain.votes[0].weight, 5000);
});

test('dedupe: same post never voted twice', async () => {
  const { store, chain, engine } = setup();
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: 'k' });
  store.addFanbase({ chain: MELEK, owner: 'me', authors: ['alice'], weight: 100 });
  const block = {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p1', parent_author: '' } }],
  };
  engine.processBlock(MELEK, block);
  await engine.flushPending(Date.now());
  engine.processBlock(MELEK, block);
  await engine.flushPending(Date.now() + 10_000);
  assert.equal(chain.votes.length, 1, 'only one vote despite two sightings');
});

test('rate limit: second vote held until interval elapses', async () => {
  const { store, chain, engine } = setup();
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: 'k' });
  store.addFanbase({ chain: MELEK, owner: 'me', authors: ['a', 'b'], weight: 100 });
  const now = 1_000_000;
  engine.processBlock(MELEK, {
    timestamp: new Date(now).toISOString().slice(0, 19),
    ops: [
      { type: 'comment', payload: { author: 'a', permlink: 'pa', parent_author: '' } },
      { type: 'comment', payload: { author: 'b', permlink: 'pb', parent_author: '' } },
    ],
  });
  await engine.flushPending(now);
  assert.equal(chain.votes.length, 1, 'first vote fires');
  await engine.flushPending(now + 1000);
  assert.equal(chain.votes.length, 1, 'second still held');
  await engine.flushPending(now + 3400);
  assert.equal(chain.votes.length, 2, 'second fires after interval');
});

test('daily cap: drops votes beyond cap', async () => {
  const { store, chain, engine } = setup();
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: 'k' });
  store.addFanbase({ chain: MELEK, owner: 'me', authors: ['a', 'b'], weight: 100, maxPerDay: 1 });
  let now = 1_000_000;
  engine.processBlock(MELEK, {
    timestamp: new Date(now).toISOString().slice(0, 19),
    ops: [
      { type: 'comment', payload: { author: 'a', permlink: 'pa', parent_author: '' } },
      { type: 'comment', payload: { author: 'b', permlink: 'pb', parent_author: '' } },
    ],
  });
  await engine.flushPending(now);
  await engine.flushPending(now + 5000);
  assert.equal(chain.votes.length, 1, 'cap of 1 honored');
});

test('schedule: fires when due, marks done, dedupes', async () => {
  const { store, chain, engine } = setup();
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: 'k' });
  const s = store.addSchedule({ chain: MELEK, owner: 'me', author: 'x', permlink: 'y', weight: 10000, voteAt: 5000 });
  engine.queueDueSchedules(4000);
  await engine.flushPending(4000);
  assert.equal(chain.votes.length, 0);
  engine.queueDueSchedules(6000);
  await engine.flushPending(6000);
  assert.equal(chain.votes.length, 1);
  assert.equal(store.data.schedules.find((x) => x.id === s.id).done, true);
  engine.queueDueSchedules(7000);
  await engine.flushPending(7000);
  assert.equal(chain.votes.length, 1);
});

test('failed broadcast is logged as not-ok and can be retried (no dedupe lock)', async () => {
  const { store, chain, engine } = setup();
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: 'k' });
  store.addFanbase({ chain: MELEK, owner: 'me', authors: ['alice'], weight: 100 });
  chain.failNext = true;
  const block = {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p', parent_author: '' } }],
  };
  engine.processBlock(MELEK, block);
  await engine.flushPending(Date.now());
  assert.equal(store.votesFor(MELEK, 'me')[0].ok, false, 'failure logged');
  engine.processBlock(MELEK, block);
  await engine.flushPending(Date.now() + 10_000);
  assert.equal(chain.votes.length, 1, 'retry succeeded');
});

test('paused fanbase does not vote', async () => {
  const { store, chain, engine } = setup();
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: 'k' });
  const f = store.addFanbase({ chain: MELEK, owner: 'me', authors: ['alice'], weight: 100 });
  store.setPaused('fanbases', f.id, true, MELEK, 'me');
  engine.processBlock(MELEK, {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p', parent_author: '' } }],
  });
  await engine.flushPending(Date.now());
  assert.equal(chain.votes.length, 0);
});

// ── chain-agnostic behavior ────────────────────────────────────────────────

test('per-chain isolation: a melek rule never fires on another chain block', async () => {
  const store = tmpStore();
  const melek = new MockChain();
  const hive = new MockChain();
  const engine = new VoteEngine(store, {
    chains: { 'melek-testnet': melek, hive },
    log: () => {}, blockMainnet: false, voteIntervalMs: 0,
  });
  store.upsertUser(MELEK, 'me', 'postingkey', { postingKey: 'k' });
  store.addFanbase({ chain: MELEK, owner: 'me', authors: ['alice'], weight: 100 });

  // Same author posts, but we process it as a HIVE block — must NOT vote.
  engine.processBlock('hive', {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p', parent_author: '' } }],
  });
  await engine.flushPending(Date.now());
  assert.equal(melek.votes.length, 0);
  assert.equal(hive.votes.length, 0);

  // Now the correct chain — votes.
  engine.processBlock(MELEK, {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p', parent_author: '' } }],
  });
  await engine.flushPending(Date.now());
  assert.equal(melek.votes.length, 1);
});

test('mainnet broadcast is blocked by default (recorded as failure, not sent)', async () => {
  const store = tmpStore();
  const hive = new MockChain();
  const engine = new VoteEngine(store, {
    chains: { hive }, log: () => {}, blockMainnet: true, voteIntervalMs: 0,
  });
  store.upsertUser('hive', 'me', 'postingkey', { postingKey: 'k' });
  store.addFanbase({ chain: 'hive', owner: 'me', authors: ['alice'], weight: 100 });
  engine.processBlock('hive', {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p', parent_author: '' } }],
  });
  await engine.flushPending(Date.now());
  assert.equal(hive.votes.length, 0, 'no mainnet broadcast');
  const v = store.votesFor('hive', 'me')[0];
  assert.equal(v.ok, false);
  assert.match(v.error, /mainnet broadcast blocked/);
});

test('auth routing: hivesigner user broadcasts via token, not local WIF', async () => {
  const store = tmpStore();
  const melek = new MockChain();
  const hsCalls = [];
  const engine = new VoteEngine(store, {
    chains: { 'melek-testnet': melek },
    hsBroadcast: async (token, op) => { hsCalls.push({ token, op }); return { id: 'hs_tx' }; },
    log: () => {}, blockMainnet: false, voteIntervalMs: 0,
  });
  store.upsertUser(MELEK, 'me', 'hivesigner', { hsToken: 'TOKEN123' });
  store.addFanbase({ chain: MELEK, owner: 'me', authors: ['alice'], weight: 100 });
  engine.processBlock(MELEK, {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p', parent_author: '' } }],
  });
  await engine.flushPending(Date.now());
  assert.equal(melek.votes.length, 0, 'no local WIF broadcast');
  assert.equal(hsCalls.length, 1, 'broadcast via hivesigner token');
  assert.equal(hsCalls[0].token, 'TOKEN123');
  assert.equal(store.votesFor(MELEK, 'me')[0].txId, 'hs_tx');
});

test('auth routing: whalevault user is never queued for offline voting', async () => {
  const store = tmpStore();
  const melek = new MockChain();
  const engine = new VoteEngine(store, {
    chains: { 'melek-testnet': melek }, log: () => {}, blockMainnet: false, voteIntervalMs: 0,
  });
  store.upsertUser(MELEK, 'me', 'whalevault', {});
  store.addFanbase({ chain: MELEK, owner: 'me', authors: ['alice'], weight: 100 });
  engine.processBlock(MELEK, {
    timestamp: new Date().toISOString().slice(0, 19),
    ops: [{ type: 'comment', payload: { author: 'alice', permlink: 'p', parent_author: '' } }],
  });
  await engine.flushPending(Date.now());
  assert.equal(melek.votes.length, 0, 'whalevault never auto-votes server-side');
  assert.equal(engine._pending.size, 0, 'nothing queued for whalevault');
});

test.after(() => {
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.startsWith('autovote-test-')) try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
  }
});
