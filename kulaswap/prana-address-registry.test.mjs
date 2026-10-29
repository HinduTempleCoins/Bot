// prana-address-registry.test.mjs — OFFLINE. Injected fetch + fs, no network, no tokens stored.
import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import {
  record, addressFor, allAddresses, recordFromSigner, isEvmAddress, __setFetch,
} from './prana-address-registry.mjs';

let _n = 0;
function env() {
  const file = join(tmpdir(), `prana-addr-${process.pid}-${_n++}.json`);
  return { opts: { file }, cleanup: () => { try { unlinkSync(file); } catch {} } };
}
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

test('an EVM address is recognised strictly', () => {
  assert.equal(isEvmAddress(A), true);
  assert.equal(isEvmAddress('0xABCdef1234567890abcdef1234567890ABCDeF12'), true);
  for (const bad of ['', null, undefined, '0x', '1111111111111111111111111111111111111111',
    '0x111111111111111111111111111111111111111', '0x11111111111111111111111111111111111111111',
    '0xZZ11111111111111111111111111111111111111', 'soapbox']) {
    assert.equal(isEvmAddress(bad), false, `${bad} must not pass`);
  }
});

test('record stores and reads back', () => {
  const e = env();
  const r = record('vankushfamily', A, e.opts);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(addressFor('vankushfamily', e.opts), A);
  assert.equal(addressFor('VanKushFamily', e.opts), A, 'account lookup is case-insensitive');
  e.cleanup();
});

test('re-recording the same address is a no-op, not a churn', () => {
  const e = env();
  record('vankushfamily', A, e.opts);
  const again = record('vankushfamily', A.toUpperCase().replace('0X', '0x'), e.opts);
  assert.equal(again.changed, false);
  e.cleanup();
});

test('a changed address is recorded and the old one kept in history', () => {
  const e = env();
  record('vankushfamily', A, e.opts);
  const r = record('vankushfamily', B, e.opts);
  assert.equal(r.changed, true);
  assert.equal(r.previous, A, 'a moved payout address must be visible afterwards');
  assert.equal(addressFor('vankushfamily', e.opts), B);
  e.cleanup();
});

test('bad accounts and non-addresses are refused, never thrown', () => {
  const e = env();
  for (const bad of ['', null, 'A', '!!', 'ab', 'a.bc']) {
    assert.equal(record(bad, A, e.opts).ok, false);
  }
  assert.equal(record('vankushfamily', 'not-an-address', e.opts).ok, false);
  assert.equal(record('vankushfamily', null, e.opts).ok, false);
  assert.equal(addressFor('vankushfamily', e.opts), null, 'nothing was written');
  e.cleanup();
});

test('allAddresses gives the relayer exactly the Map it wants', () => {
  const e = env();
  record('alice', A, e.opts);
  record('bob', B, e.opts);
  const m = allAddresses(e.opts);
  assert.equal(m.size, 2);
  assert.equal(m.get('alice'), A);
  assert.equal(m.get('bob'), B);
  e.cleanup();
});

test('recordFromSigner takes the address the signer returns for that token', async () => {
  const e = env();
  let sawAuth = null; let sawUrl = null;
  __setFetch(async (url, init) => {
    sawUrl = url; sawAuth = init.headers.Authorization;
    return { ok: true, json: async () => ({ ok: true, address: A }) };
  });
  const r = await recordFromSigner({ token: 'tok-abc', expectAccount: 'vankushfamily', signerUrl: 'https://signer.test', ...e.opts });
  assert.equal(r.ok, true);
  assert.equal(r.address, A);
  assert.equal(sawUrl, 'https://signer.test/v1/evm/address');
  assert.equal(sawAuth, 'Bearer tok-abc');
  assert.equal(addressFor('vankushfamily', e.opts), A);
  __setFetch(null); e.cleanup();
});

test('no token means no call and no write', async () => {
  const e = env();
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, json: async () => ({ ok: true, address: A }) }; });
  const r = await recordFromSigner({ token: '', expectAccount: 'vankushfamily', ...e.opts });
  assert.equal(r.ok, false);
  assert.equal(called, false);
  __setFetch(null); e.cleanup();
});

test('a signer 401 records nothing and surfaces its reason', async () => {
  const e = env();
  __setFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid or revoked token' }) }));
  const r = await recordFromSigner({ token: 'stale', expectAccount: 'vankushfamily', ...e.opts });
  assert.equal(r.ok, false);
  assert.match(r.reason, /invalid or revoked/);
  assert.equal(addressFor('vankushfamily', e.opts), null);
  __setFetch(null); e.cleanup();
});

test('a signer that is down or returns junk never throws', async () => {
  const e = env();
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  let r = await recordFromSigner({ token: 't', expectAccount: 'vankushfamily', ...e.opts });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unreachable/);

  __setFetch(async () => ({ ok: true, json: async () => ({ ok: true, address: 'garbage' }) }));
  r = await recordFromSigner({ token: 't', expectAccount: 'vankushfamily', ...e.opts });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no usable address/);
  assert.equal(addressFor('vankushfamily', e.opts), null);
  __setFetch(null); e.cleanup();
});

test('⛔ a caller cannot record an address for an account it did not authenticate', async () => {
  const e = env();
  __setFetch(async () => ({ ok: true, json: async () => ({ ok: true, address: A }) }));
  // no expectAccount, or a bogus one, writes nothing — the account must be the proven one
  for (const bad of [undefined, null, '', '!!', 'ab']) {
    const r = await recordFromSigner({ token: 't', expectAccount: bad, ...e.opts });
    assert.equal(r.ok, false, `expectAccount ${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(allAddresses(e.opts).size, 0);
  __setFetch(null); e.cleanup();
});

test('a corrupt or unwritable registry degrades instead of throwing', () => {
  const e = env();
  const bad = { read: () => '{{{not json', write: () => {} };
  assert.equal(addressFor('alice', { ...e.opts, fs: bad }), null);
  assert.equal(allAddresses({ ...e.opts, fs: bad }).size, 0);
  const ro = { read: () => null, write: () => { throw new Error('read-only'); } };
  assert.equal(record('alice', A, { ...e.opts, fs: ro }).ok, true, 'soft-fails rather than throwing');
  e.cleanup();
});
