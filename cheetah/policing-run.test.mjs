// policing-run.test.mjs — the standing "Cheetah comes to stop it" loop, fully offline.
//
// We inject the post-pull seam and the broadcaster, so NO chain and NO keys are touched. Detection +
// tone are exercised by policing-scenarios.test.mjs; here we test the LOOP: dry-run returns plans,
// live sends via the injected broadcaster, dedup prevents double-posting, and everything soft-fails.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  policingScan,
  __setFetchPosts,
  __setScan,
  __setBroadcast,
  __resetReplied,
} from './policing-run.mjs';

function reset() {
  __setFetchPosts(null);
  __setScan(null);
  __setBroadcast(null);
  __resetReplied();
}

// A fake scan that flags a specific permlink as a crediting-comment and passes everything else.
function fakeScanFlagging(flagPermlink, note = 'Originally by @hathor — credit where due.') {
  return async (post) => {
    if (post.permlink === flagPermlink) {
      return { intent: 'crediting-comment', post, source: '@hathor/introducing-hathor-on-melek', confidence: 0.97, comment: note };
    }
    return { skipped: 'no-match', post };
  };
}

test('dry-run returns reply PLANS and never broadcasts', async () => {
  reset();
  __setFetchPosts(async () => [
    { author: 'thief', permlink: 'stolen-intro', body: 'copied text' },
    { author: 'carol', permlink: 'original', body: 'my own words' },
  ]);
  __setScan(fakeScanFlagging('stolen-intro'));
  let broadcastCalls = 0;
  __setBroadcast(async () => { broadcastCalls += 1; return { id: 'x' }; });

  // broadcast:false → plans only, broadcaster untouched.
  const out = await policingScan({ broadcast: false });
  assert.equal(out.scanned, 2);
  assert.equal(out.plans.length, 1);
  assert.equal(broadcastCalls, 0);
  const plan = out.plans[0];
  assert.equal(plan.parentAuthor, 'thief');
  assert.equal(plan.parentPermlink, 'stolen-intro');
  assert.match(plan.body, /credit/i);
  assert.deepEqual(plan.tags, ['cheetah', 'attribution']);
});

test('live: sends via the injected broadcaster and records the reply', async () => {
  reset();
  __setFetchPosts(async () => [{ author: 'thief', permlink: 'stolen-intro', body: 'copied' }]);
  __setScan(fakeScanFlagging('stolen-intro'));
  const sent = [];
  __setBroadcast(async (plan) => { sent.push(plan); return { id: 'tx123' }; });

  const out = await policingScan({ broadcast: true });
  assert.equal(out.replied.length, 1);
  assert.equal(out.replied[0].tx, 'tx123');
  assert.equal(out.replied[0].ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].parentPermlink, 'stolen-intro');
});

test('dedup: a post already replied to is skipped on the next pass', async () => {
  reset();
  __setFetchPosts(async () => [{ author: 'thief', permlink: 'stolen-intro', body: 'copied' }]);
  __setScan(fakeScanFlagging('stolen-intro'));
  let calls = 0;
  __setBroadcast(async () => { calls += 1; return { id: 'tx' }; });

  const first = await policingScan({ broadcast: true });
  assert.equal(first.replied.length, 1);
  assert.equal(calls, 1);

  // Same post next pass → skipped, broadcaster not called again.
  const second = await policingScan({ broadcast: true });
  assert.equal(second.replied.length, 0);
  assert.equal(second.skipped.some((s) => s.reason === 'already-replied'), true);
  assert.equal(calls, 1);
});

test('injectable dedup store is honored (box can back it durably)', async () => {
  reset();
  __setFetchPosts(async () => [{ author: 'thief', permlink: 'p1', body: 'copied' }]);
  __setScan(fakeScanFlagging('p1'));
  __setBroadcast(async () => ({ id: 'tx' }));
  const store = new Set(['thief/p1']); // pretend we already replied last week

  const out = await policingScan({
    broadcast: true,
    alreadyReplied: (a, p) => store.has(`${a}/${p}`),
    markReplied: (a, p) => store.add(`${a}/${p}`),
  });
  assert.equal(out.replied.length, 0);
  assert.equal(out.skipped[0].reason, 'already-replied');
});

test('a broadcaster error is captured, not thrown, and the post is NOT marked replied', async () => {
  reset();
  __setFetchPosts(async () => [{ author: 'thief', permlink: 'stolen-intro', body: 'copied' }]);
  __setScan(fakeScanFlagging('stolen-intro'));
  __setBroadcast(async () => { throw new Error('chain rejected'); });

  const out = await policingScan({ broadcast: true });
  assert.equal(out.replied.length, 0);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].stage, 'broadcast');

  // Next pass with a working broadcaster should retry (it was never marked replied).
  let calls = 0;
  __setBroadcast(async () => { calls += 1; return { id: 'tx' }; });
  const retry = await policingScan({ broadcast: true });
  assert.equal(calls, 1);
  assert.equal(retry.replied.length, 1);
});

test('a fetch failure soft-fails to an empty pass', async () => {
  reset();
  __setFetchPosts(async () => { throw new Error('rpc down'); });
  const out = await policingScan({});
  assert.equal(out.scanned, 0);
  assert.equal(out.errors[0].stage, 'fetch');
});

test('discovery + image-credit intents also produce plans with the right tags', async () => {
  reset();
  __setFetchPosts(async () => [
    { author: 'a', permlink: 'disc', body: 'x' },
    { author: 'b', permlink: 'img', body: 'y' },
  ]);
  __setScan(async (post) => {
    if (post.permlink === 'disc') return { intent: 'discovery-comment', post, comment: 'See also @hathor/...' };
    if (post.permlink === 'img') return { intent: 'image-credit-comment', post, source: '@hathor/pic', comment: 'Image first appears at @hathor/pic' };
    return { skipped: 'no-match', post };
  });

  const out = await policingScan({ broadcast: false });
  const byPermlink = Object.fromEntries(out.plans.map((p) => [p.parentPermlink, p]));
  assert.deepEqual(byPermlink.disc.tags, ['cheetah', 'discovery']);
  assert.deepEqual(byPermlink.img.tags, ['cheetah', 'attribution']);
});
