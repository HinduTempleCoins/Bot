// signer-castvote.test.mjs — offline. No network: fetch is injected. Asserts the adapter POSTs the vote op
// to MELEK-Signer with the bearer token + explicit posting role, and never leaks the token/needs a key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSignerCastVote, signerBroadcast, signerCastVoteFromEnv, roleForOps } from './signer-castvote.mjs';

function recorderFetch(resBody = { ok: true, result: { id: 'abc123', block_num: 42 } }, status = 200) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => resBody };
  };
  return { f, calls };
}

test('makeSignerCastVote posts the vote op with bearer token + posting role', async () => {
  const { f, calls } = recorderFetch();
  const castVote = makeSignerCastVote({ token: 'tok-secret-1', signerUrl: 'https://signer.example', clientId: 'autovote', fetch: f });
  const res = await castVote({ voter: 'hathor', author: 'alice', permlink: 'p1', weight: 3000 });

  assert.equal(res.id, 'abc123');
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, 'https://signer.example/v1/broadcast');
  assert.equal(c.opts.headers.Authorization, 'Bearer tok-secret-1');
  assert.deepEqual(c.body.ops, [['vote', { voter: 'hathor', author: 'alice', permlink: 'p1', weight: 3000 }]]);
  assert.equal(c.body.role, 'posting');           // explicit — IONOS signer defaults to active
  assert.equal(c.body.client_ref, 'autovote');
});

test('signerBroadcast throws on a signer error (soft-fail seam: runner skips this post)', async () => {
  const { f } = recorderFetch({ ok: false, error: 'op \'transfer\' not in token scope [vote,comment]' }, 403);
  await assert.rejects(
    () => signerBroadcast({ token: 't', ops: [['transfer', { from: 'hathor', to: 'x', amount: '1.000 MELEK' }]], fetch: f }),
    /not in token scope/,
  );
});

test('refuses to broadcast without a token — never a local key', async () => {
  const { f } = recorderFetch();
  await assert.rejects(() => signerBroadcast({ token: '', ops: [['vote', {}]], fetch: f }), /no bearer token/);
  assert.throws(() => makeSignerCastVote({ token: '' }), /no bearer token/);
});

test('signerCastVoteFromEnv returns null when no token (clean DRY-RUN, no key fallback)', () => {
  assert.equal(signerCastVoteFromEnv({ env: {} }), null);
  const seam = signerCastVoteFromEnv({ env: { MELEK_SIGNER_TOKEN: 't', MELEK_SIGNER_URL: 'https://s' }, fetch: async () => ({ ok: true, json: async () => ({ ok: true, result: {} }) }) });
  assert.equal(typeof seam, 'function');
});

test('roleForOps: posting for vote/comment, active otherwise', () => {
  assert.equal(roleForOps([['vote', {}]]), 'posting');
  assert.equal(roleForOps([['comment', {}]]), 'posting');
  assert.equal(roleForOps([['transfer', {}]]), 'active');
  assert.equal(roleForOps([['vote', {}], ['transfer', {}]]), 'active');
});
