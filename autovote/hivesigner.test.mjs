// hivesigner.test.mjs — HiveSigner vote/broadcast path, tested with ANGELICALIST (our Hive account,
// confirmed live on Hive mainnet). OFFLINE: injected fetch, no real OAuth, no mainnet broadcast.
// Live activation still needs a registered HiveSigner app (HIVESIGNER_APP) — see the PR / status notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voteViaHiveSigner, broadcast, me, configured } from './hivesigner.js';

test('without an app registered, HiveSigner reports not-configured (no broken login button)', () => {
  // No HIVESIGNER_APP/CALLBACK env in the test env → the UI shows "pending registration".
  assert.equal(configured(), false);
});

test('angelicalist casts a Hive vote via its bearer token (the op the engine sends)', async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ result: { id: 'hivetx1' } }) };
  };
  const r = await voteViaHiveSigner('hs-token', { voter: 'angelicalist', author: 'someauthor', permlink: 'a-post', weight: 7500 }, fetchImpl);
  assert.deepEqual(r, { result: { id: 'hivetx1' } });
  assert.match(captured.url, /\/api\/broadcast$/);
  assert.equal(captured.headers.Authorization, 'hs-token');     // HiveSigner uses the raw token as the header
  assert.deepEqual(captured.body.operations[0], ['vote', { voter: 'angelicalist', author: 'someauthor', permlink: 'a-post', weight: 7500 }]);
});

test('me() resolves the angelicalist account from a token', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ account: { name: 'angelicalist' } }) });
  const m = await me('hs-token', fetchImpl);
  assert.equal(m.account.name, 'angelicalist');
});

test('a HiveSigner broadcast error surfaces (a vote is never silently dropped)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid token' }) });
  await assert.rejects(() => broadcast('bad-token', [['vote', {}]], fetchImpl), /broadcast failed: 401/);
});
