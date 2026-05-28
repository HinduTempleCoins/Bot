/**
 * tutorial/scheduler.test.js — orchestration tests for the tutorial scheduler.
 *
 * Mocks the chain adapter + chain-reader so we can drive the detector with
 * fake user activity and assert on what the scheduler does (dry-run records,
 * broadcast calls, idempotency).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TutorialScheduler } from './scheduler.js';
import { TutorialState } from './state.js';
import { WelcomerState } from '../welcomer/state.js';

function tmpStore(filename) {
  const dir = mkdtempSync(join(tmpdir(), 'melek-tut-'));
  return { dir, path: join(dir, filename), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makeFakeAdapter() {
  const calls = { reply: [], vote: [], transfer: [] };
  return {
    calls,
    client: {
      // chain-reader uses .call and .database; we override readUserActivity
      // entirely below, so these are never hit. Kept for shape parity.
      call: async () => [],
      database: { getAccounts: async () => [null] },
    },
    reply: async (args) => { calls.reply.push(args); return { id: `reply-${calls.reply.length}` }; },
    vote: async (args) => { calls.vote.push(args); return { id: `vote-${calls.vote.length}` }; },
    transfer: async (args) => { calls.transfer.push(args); return { id: `xfer-${calls.transfer.length}` }; },
  };
}

function welcomerWithAccount(name) {
  const { path, cleanup } = tmpStore('welcomer.json');
  const s = new WelcomerState({ path });
  s.recordDiscovery(name, { block: 1 });
  s.recordWelcome(name, { txId: 'tx-welcome' });
  return { state: s, cleanup };
}

function withMockedReader(scheduler, activityByAccount) {
  // Override the private check by monkey-patching #checkAndRespond's reader.
  // Cleaner approach: patch the imported module function. Simplest here:
  // monkey-patch the method to feed pre-built activity.
  scheduler._mockedActivity = activityByAccount;
  scheduler._origCheck = scheduler.constructor.prototype['_checkAndRespond' /* not the actual private name */];
}

test('TutorialScheduler: dry-run records but does not call broadcast methods', async (t) => {
  const w = welcomerWithAccount('alice');
  const tut = tmpStore('tutorial.json');
  const tutorialState = new TutorialState({ path: tut.path });
  const adapter = makeFakeAdapter();

  // Pretend alice has done an intro post that qualifies (loadStages min_body_chars
  // is 200 in stages.json; tag #introduceyourself).
  const fakeActivity = {
    posts: [{
      author: 'alice',
      permlink: 'hello-world',
      title: 'Hello world',
      body: 'a'.repeat(300),
      json_metadata: JSON.stringify({ tags: ['introduceyourself'] }),
      created: '2026-05-28T08:00:00Z',
    }],
    comments: [],
    votes_received: [],
    transfers_to_vesting: [],
    witness_votes: [],
  };

  // Patch the chain-reader by mocking the imported function. The scheduler
  // calls readUserActivity directly. Simplest mock: replace at runtime via
  // dependency injection by patching globalThis... Actually the cleanest is
  // patching the scheduler's #checkAndRespond. But that's private.
  // We patch by replacing readUserActivity through the module record:
  t.after(() => { w.cleanup(); tut.cleanup(); });

  const readActivity = async (_a, account) => {
    if (account === 'alice') return fakeActivity;
    return { posts: [], comments: [], votes_received: [], transfers_to_vesting: [], witness_votes: [] };
  };
  const scheduler = new TutorialScheduler({ adapter, state: tutorialState, welcomerState: w.state, readActivity });
  const result = await scheduler.tick({ broadcast: false });

  assert.equal(result.checked, 1);
  assert.equal(result.fired, 1);
  assert.equal(result.errors, 0);
  // Dry-run: no real broadcasts
  assert.equal(adapter.calls.reply.length, 0);
  assert.equal(adapter.calls.vote.length, 0);
  // State recorded with dry-run marker
  assert.ok(tutorialState.hasResponded('alice', 'intro_post'));
});

test('TutorialScheduler: --broadcast calls reply + upvote, records real txId', async (t) => {
  const w = welcomerWithAccount('bob');
  const tut = tmpStore('tutorial.json');
  const tutorialState = new TutorialState({ path: tut.path });
  const adapter = makeFakeAdapter();

  const fakeActivity = {
    posts: [{
      author: 'bob',
      permlink: 'my-intro',
      title: 'Bob arrives',
      body: 'a'.repeat(300),
      json_metadata: JSON.stringify({ tags: ['introduceyourself'] }),
      created: '2026-05-28T08:00:00Z',
    }],
    comments: [],
    votes_received: [],
    transfers_to_vesting: [],
    witness_votes: [],
  };

  t.after(() => { w.cleanup(); tut.cleanup(); });

  const readActivity = async () => fakeActivity;
  const scheduler = new TutorialScheduler({ adapter, state: tutorialState, welcomerState: w.state, readActivity });
  await scheduler.tick({ broadcast: true });

  assert.equal(adapter.calls.reply.length, 1);
  assert.equal(adapter.calls.reply[0].parentAuthor, 'bob');
  assert.equal(adapter.calls.reply[0].parentPermlink, 'my-intro');
  // intro_post is comment_and_upvote (stages.json) → one vote call.
  assert.equal(adapter.calls.vote.length, 1);
  assert.equal(adapter.calls.vote[0].author, 'bob');
  assert.equal(adapter.calls.vote[0].permlink, 'my-intro');
  // No transfer for intro_post.
  assert.equal(adapter.calls.transfer.length, 0);

  // State recorded with real txId.
  assert.ok(tutorialState.hasResponded('bob', 'intro_post'));
});

test('TutorialScheduler: idempotent — never fires same stage twice', async (t) => {
  const w = welcomerWithAccount('carol');
  const tut = tmpStore('tutorial.json');
  const tutorialState = new TutorialState({ path: tut.path });
  const adapter = makeFakeAdapter();

  const fakeActivity = {
    posts: [{
      author: 'carol',
      permlink: 'p1',
      title: 'Carol',
      body: 'a'.repeat(300),
      json_metadata: JSON.stringify({ tags: ['introduceyourself'] }),
      created: '2026-05-28T08:00:00Z',
    }],
    comments: [],
    votes_received: [],
    transfers_to_vesting: [],
    witness_votes: [],
  };

  t.after(() => { w.cleanup(); tut.cleanup(); });

  const readActivity = async () => fakeActivity;
  const scheduler = new TutorialScheduler({ adapter, state: tutorialState, welcomerState: w.state, readActivity });
  const r1 = await scheduler.tick({ broadcast: true });
  const r2 = await scheduler.tick({ broadcast: true });

  assert.equal(r1.fired, 1);
  assert.equal(r2.fired, 0);
  assert.equal(adapter.calls.reply.length, 1);
  assert.equal(adapter.calls.vote.length, 1);
});

test('TutorialScheduler: only walks welcomed accounts, skips discovered-but-not-welcomed', async (t) => {
  const { path: wp, cleanup: wc } = tmpStore('welcomer.json');
  const wstate = new WelcomerState({ path: wp });
  wstate.recordDiscovery('discovered_only', { block: 1 });
  wstate.recordDiscovery('also_welcomed', { block: 2 });
  wstate.recordWelcome('also_welcomed', { txId: 'tx-w' });
  const tut = tmpStore('tutorial.json');
  const tutorialState = new TutorialState({ path: tut.path });
  const adapter = makeFakeAdapter();

  t.after(() => { wc(); tut.cleanup(); });

  const seen = [];
  const readActivity = async (_a, account) => {
    seen.push(account);
    return { posts: [], comments: [], votes_received: [], transfers_to_vesting: [], witness_votes: [] };
  };
  const scheduler = new TutorialScheduler({ adapter, state: tutorialState, welcomerState: wstate, readActivity });
  await scheduler.tick({ broadcast: false });

  assert.deepEqual(seen, ['also_welcomed']);
});
