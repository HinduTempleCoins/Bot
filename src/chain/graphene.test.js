/**
 * Tests for the new graphene.js additions (reply, customJson). The existing
 * op constructors aren't covered here — these tests just lock in the shape
 * of the two new methods so future refactors don't silently change them.
 *
 * Mocking strategy: replace the adapter's `client` with a stub that captures
 * the operations passed to broadcast.sendOperations, so we can assert on the
 * exact op array without touching a real chain.
 *
 * Env-setup quirk: keys.js reads HATHOR_* env vars at module-load time, so
 * the env vars must be set BEFORE graphene.js is imported. We use dynamic
 * import for that.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey } from '@hiveio/dhive';

// Set env before any import of graphene.js (which transitively imports keys.js).
// HARD RULE: no WIF private keys in this repo, ever, by construction. So
// the env values here are explicit non-WIF placeholders, and we monkey-patch
// dhive's PrivateKey.fromString to accept them. The broadcast path is
// stubbed in makeStubbedAdapter() so no real signing or chain call happens.
process.env.HATHOR_ACCOUNT = 'hathor';
process.env.HATHOR_POSTING_KEY = 'TEST-FAKE-POSTING-KEY-DO-NOT-USE';
process.env.HATHOR_ACTIVE_KEY = 'TEST-FAKE-ACTIVE-KEY-DO-NOT-USE';

const _origFromString = PrivateKey.fromString.bind(PrivateKey);
PrivateKey.fromString = (s) => (typeof s === 'string' && s.startsWith('TEST-') ? { _testStub: true } : _origFromString(s));

const { GrapheneAdapter } = await import('./graphene.js');

function makeStubbedAdapter() {
  const captured = [];
  const a = new GrapheneAdapter({
    rpcUrl: 'http://localhost:9999',
    chainId: '0'.repeat(64),
    addressPrefix: 'MLK',
    network: 'test',
  });
  a.client = {
    broadcast: {
      sendOperations: async (ops, _key) => {
        captured.push(ops);
        return { id: 'stub-tx-id' };
      },
    },
  };
  return { adapter: a, captured };
}

test('reply: emits a comment op with title="" and parent set', async () => {
  const { adapter, captured } = makeStubbedAdapter();
  const result = await adapter.reply({
    parentAuthor: 'alice',
    parentPermlink: 'intro-post',
    body: 'welcome',
    permlink: 'hathor-reply-fixed',
    tags: ['welcome', 'intro'],
  });
  assert.equal(result.id, 'stub-tx-id');
  assert.equal(captured.length, 1);
  const [opName, opVal] = captured[0][0];
  assert.equal(opName, 'comment');
  assert.equal(opVal.parent_author, 'alice');
  assert.equal(opVal.parent_permlink, 'intro-post');
  assert.equal(opVal.author, 'hathor');
  assert.equal(opVal.title, '');
  assert.equal(opVal.body, 'welcome');
  assert.equal(opVal.permlink, 'hathor-reply-fixed');
  const meta = JSON.parse(opVal.json_metadata);
  assert.deepEqual(meta.tags, ['welcome', 'intro']);
});

test('reply: throws when parentAuthor or parentPermlink missing', async () => {
  const { adapter } = makeStubbedAdapter();
  await assert.rejects(
    () => adapter.reply({ parentAuthor: '', parentPermlink: 'x', body: 'y' }),
    /parentAuthor and parentPermlink required/,
  );
});

test('reply: auto-derives a permlink when none provided', async () => {
  const { adapter, captured } = makeStubbedAdapter();
  await adapter.reply({
    parentAuthor: 'alice',
    parentPermlink: 'intro-post',
    body: 'welcome',
  });
  const opVal = captured[0][0][1];
  assert.match(opVal.permlink, /^re-alice-intro-post-/);
  assert.match(opVal.permlink, /^[a-z0-9-]+$/);
});

test('customJson: posting-auth path (default) emits the op with the bot as posting auth', async () => {
  const { adapter, captured } = makeStubbedAdapter();
  await adapter.customJson({
    id: 'ssc-mainnet-hive',
    json: { contractName: 'tokens', contractAction: 'transfer', contractPayload: { to: 'alice', quantity: '1' } },
  });
  assert.equal(captured.length, 1);
  const [opName, opVal] = captured[0][0];
  assert.equal(opName, 'custom_json');
  assert.deepEqual(opVal.required_auths, []);
  assert.deepEqual(opVal.required_posting_auths, ['hathor']);
  assert.equal(opVal.id, 'ssc-mainnet-hive');
  const parsed = JSON.parse(opVal.json);
  assert.equal(parsed.contractAction, 'transfer');
});

test('customJson: active-auth path when requiredAuths provided', async () => {
  const { adapter, captured } = makeStubbedAdapter();
  await adapter.customJson({
    id: 'high-value-op',
    json: { kind: 'sensitive' },
    requiredAuths: ['hathor'],
  });
  const opVal = captured[0][0][1];
  assert.deepEqual(opVal.required_auths, ['hathor']);
  assert.deepEqual(opVal.required_posting_auths, []);
});

test('customJson: accepts string json without re-stringifying', async () => {
  const { adapter, captured } = makeStubbedAdapter();
  const raw = '{"already":"json"}';
  await adapter.customJson({ id: 'x', json: raw });
  const opVal = captured[0][0][1];
  assert.equal(opVal.json, raw);
});

test('customJson: builds the op with no key material in the op object', async () => {
  const { adapter, captured } = makeStubbedAdapter();
  await adapter.customJson({ id: 'x', json: { a: 1 } });
  const [, opVal] = captured[0][0];
  // A custom_json op carries only auth account *names*, never key strings.
  assert.deepEqual(Object.keys(opVal).sort(), ['id', 'json', 'required_auths', 'required_posting_auths']);
  const serialized = JSON.stringify(opVal);
  // No WIF (base58, leading 5/K/L) and no PrivateKey stub leaks into the op.
  assert.doesNotMatch(serialized, /[5KL][1-9A-HJ-NP-Za-km-z]{50,}/);
  assert.equal(serialized.includes('TEST-FAKE'), false);
});

test('reply: builds the comment op with no key material in the op object', async () => {
  const { adapter, captured } = makeStubbedAdapter();
  await adapter.reply({ parentAuthor: 'alice', parentPermlink: 'p', body: 'hi', permlink: 'r1' });
  const [, opVal] = captured[0][0];
  const serialized = JSON.stringify(opVal);
  assert.doesNotMatch(serialized, /[5KL][1-9A-HJ-NP-Za-km-z]{50,}/);
  assert.equal(serialized.includes('TEST-FAKE'), false);
});

test('graphene.js source embeds no WIF private key', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./graphene.js', import.meta.url), 'utf8');
  // No base58 WIF literal anywhere in the module source.
  assert.doesNotMatch(src, /[5KL][1-9A-HJ-NP-Za-km-z]{50,}/);
  // Keys are only ever fetched via the env-backed keys.js helpers.
  assert.match(src, /getPostingKey|getActiveKey/);
});
