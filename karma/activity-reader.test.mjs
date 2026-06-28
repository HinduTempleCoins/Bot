// activity-reader.test.mjs — the deeper karma signal reader. OFFLINE: injected fetch returns canned RPC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readActivity } from './activity-reader.mjs';

// a fake node: get_accounts → 1 account; get_account_history → a mix of posts/comments/votes (role-filtered).
function fakeNode({ created, reputation, history }) {
  return async (_url, opts) => {
    const { method, params } = JSON.parse(opts.body);
    let result = null;
    if (method === 'condenser_api.get_accounts') result = [{ name: params[0][0], created, reputation }];
    if (method === 'condenser_api.get_account_history') result = history.map((op, i) => [i, { op }]);
    return { json: async () => ({ result }) };
  };
}

test('counts posts/comments (as author) and upvotes-given/self-votes/flags (as voter), role-filtered', async () => {
  const acc = 'sol';
  const history = [
    ['comment', { author: 'sol', parent_author: '' }],            // a post
    ['comment', { author: 'sol', parent_author: 'mina' }],        // a reply (comment)
    ['comment', { author: 'mina', parent_author: 'sol' }],        // SOMEONE ELSE replying to sol — not sol's
    ['vote', { voter: 'sol', author: 'mina', weight: 10000 }],    // upvote given to another
    ['vote', { voter: 'sol', author: 'sol', weight: 10000 }],     // self-vote
    ['vote', { voter: 'sol', author: 'dax', weight: -5000 }],     // a flag (downvote)
    ['vote', { voter: 'hathor', author: 'sol', weight: 10000 }],  // someone voting ON sol — not sol's vote
  ];
  const r = await readActivity(acc, { rpcUrl: 'http://rpc', fetch: fakeNode({ created: '2026-06-01T00:00:00', reputation: 0, history }) });
  assert.equal(r.postCount, 1);
  assert.equal(r.commentCount, 1);
  assert.equal(r.upvotesGiven, 1);
  assert.equal(r.selfVotes, 1);
  assert.equal(r.flagsGiven, 1);
  assert.ok(r.accountAgeDays > 0);
  assert.ok(typeof r.reputation === 'number');                    // normalized
});

test('soft-fails to a zero snapshot on a dead RPC; rejects empty account / missing rpc', async () => {
  const dead = async () => { throw new Error('rpc down'); };
  const r = await readActivity('sol', { rpcUrl: 'http://rpc', fetch: dead });
  assert.equal(r.postCount, 0); assert.equal(r.upvotesGiven, 0);   // never throws
  assert.equal((await readActivity('', { rpcUrl: 'http://rpc' })).account, '');
  assert.equal((await readActivity('sol', {})).postCount, 0);      // no rpcUrl → empty
});
