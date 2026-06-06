/**
 * Tests for graphene.js. After the PRE-SIGNER 2 refactor, the adapter no longer
 * signs locally: every write op funnels through #broadcast(), which delegates to
 * a MELEK-Signer client (createSignerClient / createMockSigner shape:
 * { broadcast(ops, { clientRef }) }). These tests inject a mock signer via the
 * constructor and assert on the exact op array, never touching a real chain or
 * any private key.
 *
 * Env-setup quirk: keys.js reads HATHOR_* env vars at module-load time, so the
 * env vars are set BEFORE graphene.js is imported. They are explicit non-WIF
 * placeholders — and they are NO LONGER used by any broadcast path (kept only to
 * exercise the deprecated read-only key getters in keys.js).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// HARD RULE: no WIF private keys in this repo, ever, by construction. These are
// explicit non-WIF placeholders; nothing in the broadcast path reads them.
process.env.HATHOR_ACCOUNT = 'hathor';
process.env.HATHOR_POSTING_KEY = 'TEST-FAKE-POSTING-KEY-DO-NOT-USE';
process.env.HATHOR_ACTIVE_KEY = 'TEST-FAKE-ACTIVE-KEY-DO-NOT-USE';

const { GrapheneAdapter } = await import('./graphene.js');
const { createMockSigner, createSignerClient } = await import('./melek-signer-client.mjs');

// A capturing signer with the MELEK-Signer client shape. Records each broadcast
// call so tests can assert on the ops and the clientRef.
function makeCapturingSigner() {
  const calls = [];
  return {
    calls,
    signer: {
      async broadcast(ops, meta = {}) {
        calls.push({ ops, meta });
        return { id: 'stub-tx-id', ops: ops.length };
      },
    },
  };
}

function makeAdapter(signer) {
  return new GrapheneAdapter({
    rpcUrl: 'http://localhost:9999',
    chainId: '0'.repeat(64),
    addressPrefix: 'MLK',
    network: 'test',
    signer,
  });
}

function makeStubbedAdapter() {
  const { calls, signer } = makeCapturingSigner();
  // `captured` mirrors the old shape: an array of op-arrays, one per broadcast.
  const captured = { get length() { return calls.length; }, get(i) { return calls[i].ops; } };
  // Provide [] indexing for existing assertions: captured[0] → first ops array.
  const proxy = new Proxy(captured, {
    get(t, prop) {
      if (prop === 'length') return calls.length;
      const n = Number(prop);
      if (Number.isInteger(n)) return calls[n]?.ops;
      return t[prop];
    },
  });
  return { adapter: makeAdapter(signer), captured: proxy, calls };
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

test('graphene.js source embeds no WIF private key and no local-signing path', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./graphene.js', import.meta.url), 'utf8');
  // No base58 WIF literal anywhere in the module source.
  assert.doesNotMatch(src, /[5KL][1-9A-HJ-NP-Za-km-z]{50,}/);
  // The local-signing path is GONE: no PrivateKey.fromString, no key getters.
  assert.doesNotMatch(src, /PrivateKey\.fromString/);
  assert.doesNotMatch(src, /getPostingKey|getActiveKey/);
  // Broadcasting is delegated to the MELEK-Signer client.
  assert.match(src, /melek-signer-client/);
});

// ── PRE-SIGNER 2: broadcast-path behavior ──────────────────────────────────

test('broadcast without a signer configured → soft, clear read-only error', async () => {
  // signer: null means "not configured" (the fromEnv() unset case).
  const adapter = makeAdapter(null);
  assert.equal(adapter.canBroadcast(), false);
  await assert.rejects(
    () => adapter.post({ title: 't', body: 'b', tags: ['x'], permlink: 'p' }),
    /signer not configured — read-only mode/,
  );
  await assert.rejects(
    () => adapter.transfer({ to: 'alice', amount: '1.000 MELEK' }),
    /no local-key fallback by design/,
  );
});

test('with a mock signer wired (injected fetch) → ops flow through POST /v1/broadcast', async () => {
  const mock = createMockSigner({
    tokens: { 'tok-all': { scopes: ['comment', 'vote', 'transfer', 'custom_json', 'feed_publish'] } },
  });
  const signer = createSignerClient({ url: 'http://signer.test', token: 'tok-all', fetch: mock.fetch });
  const adapter = makeAdapter(signer);
  assert.equal(adapter.canBroadcast(), true);

  const r = await adapter.transfer({ to: 'alice', amount: '10.000 MELEK', memo: 'gm' });
  assert.equal(r.ok, true);
  assert.match(r.id, /^mock-tx-/);

  const audit = mock.audit();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].at, 'accepted');
  const [opName, opVal] = audit[0].ops[0];
  assert.equal(opName, 'transfer');
  assert.equal(opVal.from, 'hathor');
  assert.equal(opVal.to, 'alice');
  // clientRef lands in the signer audit log.
  assert.match(audit[0].clientRef, /^transfer-hathor-alice-/);
});

test('a WIF passed as the signer token is refused (looksLikeRawKey / zero-WIF rule)', async () => {
  // A real-looking WIF must never be accepted as a bearer token.
  const wif = '5J' + 'K'.repeat(49); // matches WIF_RE shape
  assert.throws(
    () => createSignerClient({ url: 'http://signer.test', token: wif }),
    /looks like a raw private key — refused/,
  );
});

test('post/vote/customJson/feed all route through the signer when configured', async () => {
  const mock = createMockSigner({
    tokens: { 'tok-all': { scopes: ['comment', 'vote', 'transfer', 'custom_json', 'feed_publish'] } },
  });
  const signer = createSignerClient({ url: 'http://signer.test', token: 'tok-all', fetch: mock.fetch });
  const adapter = makeAdapter(signer);

  await adapter.post({ title: 'hi', body: 'b', tags: ['t'], permlink: 'pl' });
  await adapter.vote({ author: 'alice', permlink: 'p', weight: 10000 });
  await adapter.customJson({ id: 'plugin', json: { a: 1 } });
  await adapter.publishFeed({ exchangeRate: { base: '1.000 MELEK', quote: '1.000 USD' } });

  const kinds = mock.audit().map((a) => a.ops[0][0]);
  assert.deepEqual(kinds, ['comment', 'vote', 'custom_json', 'feed_publish']);
  assert.ok(mock.audit().every((a) => a.at === 'accepted'));
});
