// siwe-login.test.mjs — offline tests for the SIWE / EIP-4361 login module (task #78).
// No real crypto library, no network: the clock + nonce source + signature verifier are all
// injected. Run: node --test integrations/siwe-login.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createNonce,
  buildMessage,
  parseMessage,
  verify,
  caip10For,
  __setClock,
  __setNonceSource,
  __setVerifier,
  __resetNonces,
} from './siwe-login.mjs';

const ADDR = '0xAbC1230000000000000000000000000000000def';
const ADDR2 = '0x9999999999999999999999999999999999999999';
const GOOD_SIG = '0xgoodsignature';

// A fake verifier: returns true ONLY for the exact (address, signature) pair we deem good.
// Any other signature (or address) -> false. Async to mirror viem/ethers verifyMessage.
function installFakeVerifier({ addr = ADDR, sig = GOOD_SIG } = {}) {
  __setVerifier(async ({ signature, address }) =>
    signature === sig && String(address).toLowerCase() === addr.toLowerCase());
}

// deterministic environment for each test
function reset({ t = 1_700_000_000_000, nonce = 'fixednonce123' } = {}) {
  __resetNonces();
  __setClock(() => t);
  let n = 0;
  __setNonceSource(() => `${nonce}-${n++}`);
}

test('buildMessage <-> parseMessage round-trips (with statement + expiration)', () => {
  reset();
  const fields = {
    domain: 'soapy.blog',
    address: ADDR,
    uri: 'https://soapy.blog/login',
    chainId: 1,
    nonce: 'abc123',
    statement: 'Sign in to the MELEK portal.',
    issuedAt: '2026-06-03T00:00:00.000Z',
    expirationTime: '2026-06-03T01:00:00.000Z',
  };
  const msg = buildMessage(fields);
  const parsed = parseMessage(msg);
  assert.equal(parsed.domain, 'soapy.blog');
  assert.equal(parsed.address, ADDR);
  assert.equal(parsed.uri, fields.uri);
  assert.equal(parsed.chainId, '1');
  assert.equal(parsed.nonce, 'abc123');
  assert.equal(parsed.statement, fields.statement);
  assert.equal(parsed.issuedAt, fields.issuedAt);
  assert.equal(parsed.expirationTime, fields.expirationTime);
  assert.equal(parsed.version, '1');
});

test('buildMessage <-> parseMessage round-trips (no statement, no expiration)', () => {
  reset();
  const msg = buildMessage({
    domain: 'example.com',
    address: ADDR,
    uri: 'https://example.com',
    chainId: 137,
    nonce: 'n0',
    issuedAt: '2026-06-03T00:00:00.000Z',
  });
  const parsed = parseMessage(msg);
  assert.equal(parsed.statement, undefined);
  assert.equal(parsed.expirationTime, undefined);
  assert.equal(parsed.chainId, '137');
  assert.equal(parsed.nonce, 'n0');
});

test('verify succeeds with a good nonce + signature and returns a caip10', async () => {
  reset();
  installFakeVerifier();
  const { nonce, issuedAt } = createNonce(ADDR);
  const msg = buildMessage({
    domain: 'soapy.blog', address: ADDR, uri: 'https://soapy.blog/login',
    chainId: 1, nonce, issuedAt,
  });
  const res = await verify({ message: msg, signature: GOOD_SIG, address: ADDR });
  assert.equal(res.ok, true);
  assert.equal(res.address, ADDR.toLowerCase());
  assert.equal(res.caip10, `eip155:1:${ADDR.toLowerCase()}`);
  // sanity: matches caip10For directly
  assert.equal(res.caip10, await caip10For(ADDR, 1));
});

test('verify fails on unknown nonce (never created)', async () => {
  reset();
  installFakeVerifier();
  const msg = buildMessage({
    domain: 'soapy.blog', address: ADDR, uri: 'https://soapy.blog/login',
    chainId: 1, nonce: 'never-minted', issuedAt: '2026-06-03T00:00:00.000Z',
  });
  const res = await verify({ message: msg, signature: GOOD_SIG, address: ADDR });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown-nonce');
});

test('verify fails on expired nonce', async () => {
  reset({ t: 1_700_000_000_000 });
  installFakeVerifier();
  const { nonce, issuedAt } = createNonce(ADDR, { ttlMs: 1000 });
  const msg = buildMessage({
    domain: 'soapy.blog', address: ADDR, uri: 'https://soapy.blog/login',
    chainId: 1, nonce, issuedAt,
  });
  // advance the clock past the nonce TTL
  __setClock(() => 1_700_000_000_000 + 5000);
  const res = await verify({ message: msg, signature: GOOD_SIG, address: ADDR });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'nonce-expired');
});

test('verify fails when the message address does not match the claimed address', async () => {
  reset();
  installFakeVerifier();
  const { nonce, issuedAt } = createNonce(ADDR);
  // build the message with ADDR, but claim ADDR2
  const msg = buildMessage({
    domain: 'soapy.blog', address: ADDR, uri: 'https://soapy.blog/login',
    chainId: 1, nonce, issuedAt,
  });
  const res = await verify({ message: msg, signature: GOOD_SIG, address: ADDR2 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'address-mismatch');
});

test('verify fails (ok:false, no throw) on a bad signature', async () => {
  reset();
  installFakeVerifier(); // only GOOD_SIG passes
  const { nonce, issuedAt } = createNonce(ADDR);
  const msg = buildMessage({
    domain: 'soapy.blog', address: ADDR, uri: 'https://soapy.blog/login',
    chainId: 1, nonce, issuedAt,
  });
  let res;
  await assert.doesNotReject(async () => {
    res = await verify({ message: msg, signature: '0xWRONG', address: ADDR });
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'bad-signature');
});

test('nonce is single-use: a second verify with the same nonce -> ok:false (replay)', async () => {
  reset();
  installFakeVerifier();
  const { nonce, issuedAt } = createNonce(ADDR);
  const msg = buildMessage({
    domain: 'soapy.blog', address: ADDR, uri: 'https://soapy.blog/login',
    chainId: 1, nonce, issuedAt,
  });
  const first = await verify({ message: msg, signature: GOOD_SIG, address: ADDR });
  assert.equal(first.ok, true);
  const second = await verify({ message: msg, signature: GOOD_SIG, address: ADDR });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'nonce-already-used');
});

test('createNonce returns the expected shape and is single-use per call', () => {
  reset();
  const a = createNonce(ADDR);
  const b = createNonce(ADDR);
  assert.ok(a.nonce && b.nonce);
  assert.notEqual(a.nonce, b.nonce); // distinct nonces
  assert.equal(a.address, ADDR.toLowerCase());
  assert.ok(a.issuedAt);
  assert.ok(a.expiresAt);
});

test('caip10For falls through to plain eip155 form for any chainId', async () => {
  const id = await caip10For(ADDR, 8453);
  assert.equal(id, `eip155:8453:${ADDR.toLowerCase()}`);
});
