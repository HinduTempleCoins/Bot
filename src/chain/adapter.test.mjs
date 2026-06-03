// adapter.test.mjs — OFFLINE tests for the universal ChainAdapter interface,
// the registry, and the grant-not-raw-key invariant. No network, no keys.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  ChainAdapter,
  GrapheneAdapterStub,
  REQUIRED_METHODS,
  registry,
  register,
  get,
  families,
  isInterfaceConformant,
  isGrant,
  looksLikeRawKey,
  assertGrant,
} from './adapter.mjs';

// a minimal conforming mock — every required method present.
function makeMockAdapter() {
  return {
    family: 'mock',
    async connect() { return { connected: true, family: 'mock' }; },
    async readBalance(a) { return { account: a, balance: '0.000 MOCK' }; },
    async readAssets() { return [{ symbol: 'MOCK', amount: '0.000' }]; },
    async signAndSend(grant) { assertGrant(grant); return { broadcast: true }; },
    async resolveName(n) { return n; },
    async fetchFile() { return null; },
  };
}

test('REQUIRED_METHODS lists the full interface', () => {
  assert.deepEqual(
    [...REQUIRED_METHODS].sort(),
    ['connect', 'fetchFile', 'readAssets', 'readBalance', 'resolveName', 'signAndSend'].sort(),
  );
});

test('a conforming mock adapter passes the interface-conformance check', () => {
  const { ok, missing } = isInterfaceConformant(makeMockAdapter());
  assert.equal(ok, true);
  assert.deepEqual(missing, []);
});

test('a non-conforming adapter is reported with the missing methods', () => {
  const broken = { connect() {}, readBalance() {} };
  const { ok, missing } = isInterfaceConformant(broken);
  assert.equal(ok, false);
  assert.ok(missing.includes('signAndSend'));
  assert.ok(missing.includes('fetchFile'));
});

test('base ChainAdapter conforms and soft-fails on reads', async () => {
  const base = new ChainAdapter();
  assert.equal(isInterfaceConformant(base).ok, true);
  assert.deepEqual(await base.readBalance('alice'), { account: 'alice', balance: null });
  assert.deepEqual(await base.readAssets('alice'), []);
  assert.equal(await base.resolveName('bob'), 'bob');
  assert.equal(await base.fetchFile('ipfs://x'), null);
});

test('GrapheneAdapterStub conforms and is a stub (no broadcast)', async () => {
  const g = new GrapheneAdapterStub({ rpcUrl: 'https://example.invalid' });
  assert.equal(isInterfaceConformant(g).ok, true);
  assert.equal(g.family, 'graphene');
  assert.equal((await g.connect()).stub, true);
  assert.equal(await g.resolveName('HATHOR'), 'hathor');
});

test('registry register/get round-trips and rejects junk', () => {
  registry.clear();
  const mock = makeMockAdapter();
  const returned = register('mock', mock);
  assert.equal(returned, mock);
  assert.equal(get('mock'), mock);
  assert.deepEqual(families(), ['mock']);

  assert.throws(() => register('', mock), /non-empty string/);
  assert.throws(() => register('bad', { connect() {} }), /missing methods/);
  assert.equal(get('nope'), undefined);
});

// ---- the grant-not-raw-key invariant -------------------------------------

test('looksLikeRawKey flags WIF and 0x-hex private keys', () => {
  // WIF-shaped (51 chars, starts with 5) — assembled, not a real key.
  const wif = '5' + 'J'.repeat(50);
  assert.equal(looksLikeRawKey(wif), true);
  // 64-char hex EVM key
  assert.equal(looksLikeRawKey('0x' + 'a'.repeat(64)), true);
  assert.equal(looksLikeRawKey('a'.repeat(64)), true);
  // a normal token / handle is NOT a key
  assert.equal(looksLikeRawKey('grant_abc123'), false);
  assert.equal(looksLikeRawKey('hathor'), false);
  assert.equal(looksLikeRawKey(undefined), false);
});

test('isGrant accepts a scoped handle and rejects keys/garbage', () => {
  assert.equal(isGrant({ kind: 'grant', token: 'sk_live_opaque_handle' }), true);
  assert.equal(isGrant({ kind: 'grant', handle: 'h-123', scope: 'transfer' }), true);
  assert.equal(isGrant({ kind: 'grant', id: 'g1' }), true);
  // missing kind
  assert.equal(isGrant({ token: 'x' }), false);
  // empty/absent reference
  assert.equal(isGrant({ kind: 'grant' }), false);
  // a key smuggled into the token field
  assert.equal(isGrant({ kind: 'grant', token: '5' + 'J'.repeat(50) }), false);
  assert.equal(isGrant('5' + 'J'.repeat(50)), false);
  assert.equal(isGrant(null), false);
});

test('signAndSend ACCEPTS a grant handle', async () => {
  const g = new GrapheneAdapterStub({ rpcUrl: 'x' });
  const res = await g.signAndSend({ kind: 'grant', token: 'opaque_bearer_token' });
  assert.equal(res.broadcast, false); // stub
  assert.equal(res.via, 'grant');
});

test('signAndSend REJECTS a raw-key-shaped string arg', async () => {
  const g = new GrapheneAdapterStub({ rpcUrl: 'x' });
  const wif = '5' + 'K'.repeat(50);
  await assert.rejects(() => g.signAndSend(wif), /raw private key/);
});

test('signAndSend REJECTS a grant whose token is a raw key', async () => {
  const g = new GrapheneAdapterStub({ rpcUrl: 'x' });
  const bad = { kind: 'grant', token: '0x' + 'b'.repeat(64) };
  await assert.rejects(() => g.signAndSend(bad), /raw private key/);
});

test('signAndSend REJECTS a malformed (non-grant) arg', async () => {
  const g = new GrapheneAdapterStub({ rpcUrl: 'x' });
  await assert.rejects(() => g.signAndSend({ token: 'no-kind' }), /expected a grant handle/);
  await assert.rejects(() => g.signAndSend(undefined), /expected a grant handle/);
});

test('base ChainAdapter.signAndSend enforces grant then throws not-implemented', async () => {
  const base = new ChainAdapter({ family: 'evm' });
  // raw key refused before "not implemented"
  await assert.rejects(() => base.signAndSend('5' + 'L'.repeat(50)), /raw private key/);
  // valid grant gets past the gate, then hits not-implemented
  await assert.rejects(
    () => base.signAndSend({ kind: 'grant', token: 'ok' }),
    /not implemented/,
  );
});
