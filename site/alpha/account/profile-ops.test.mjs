// profile-ops.test.mjs — OFFLINE. The serialiser is checked byte-for-byte against what the live MELEK
// node returned from condenser_api.get_transaction_hex for the same transactions (captured 2026-10-18;
// the node's hex ends with the empty signatures array, "00", which the unsigned form omits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSavedLogin, isUsableImageUrl, buildPostingMetadata, serializeAccountUpdate2Tx, accountUpdate2Tx,
  refBlock, txDigest, uploadChallengeDigest, bytesToHex, varint32, expirationSeconds,
} from './profile-ops.mjs';
import crypto from 'node:crypto';

const NODE_HEX_1 = '0000000000004044d46a012b06686174686f7200000000000e7b2270726f66696c65223a7b7d7d000000';
const NODE_HEX_2 = '22c8efbeaddebf53d46a012b067365736861740000000000757b2270726f66696c65223a7b226e616d65223a2253c3a973686174222c2270726f66696c655f696d616765223a2268747470733a2f2f6d656c656b2e73616c6f6e2f696d672f633431346364306532303464653937346637333735336337653238643736333865376233363931622e706e67227d7d000000';

test('account_update2 serialisation matches the live node byte for byte', () => {
  const t1 = accountUpdate2Tx({ ref_block_num: 0, ref_block_prefix: 0, expiration: '2026-10-18T04:00:00', account: 'hathor', posting_json_metadata: '{"profile":{}}' });
  assert.equal(bytesToHex(serializeAccountUpdate2Tx(t1)) + '00', NODE_HEX_1);
  const t2 = accountUpdate2Tx({
    ref_block_num: 51234, ref_block_prefix: 3735928559, expiration: '2026-10-18T05:06:07', account: 'seshat',
    posting_json_metadata: '{"profile":{"name":"Séshat","profile_image":"https://melek.salon/img/c414cd0e204de974f73753c7e28d7638e7b3691b.png"}}',
  });
  assert.equal(bytesToHex(serializeAccountUpdate2Tx(t2)) + '00', NODE_HEX_2);
  assert.deepEqual(t2.operations[0][0], 'account_update2');
  assert.equal(t2.operations[0][1].json_metadata, '', 'json_metadata stays empty → posting authority only');
});

test('varint32 + expiration helpers', () => {
  assert.equal(bytesToHex(varint32(0)), '00');
  assert.equal(bytesToHex(varint32(117)), '75');
  assert.equal(bytesToHex(varint32(300)), 'ac02');
  assert.equal(expirationSeconds('1970-01-01T00:01:00'), 60);
});

test('refBlock derives ref_block_num/prefix/expiration from dynamic global properties', () => {
  const r = refBlock({ head_block_number: 0x0123abcd, head_block_id: '0123abcdefbeadde0000000000000000000000ff', time: '2026-10-18T04:00:00' });
  assert.equal(r.ref_block_num, 0xabcd);
  assert.equal(r.ref_block_prefix, 0xdeadbeef);
  assert.equal(r.expiration, '2026-10-18T04:01:00');
});

test('txDigest = sha256(chain_id || tx); uploadChallengeDigest = sha256("ImageSigningChallenge" || bytes)', async () => {
  const chain = '907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b';
  const tx = new Uint8Array([1, 2, 3]);
  const want = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(chain, 'hex'), Buffer.from(tx)])).digest('hex');
  assert.equal(bytesToHex(await txDigest(chain, tx)), want);
  const img = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const want2 = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('ImageSigningChallenge'), Buffer.from(img)])).digest('hex');
  assert.equal(bytesToHex(await uploadChallengeDigest(img)), want2);
});

test('readSavedLogin decodes the condenser autopost2 record', () => {
  const wif = '5' + 'K'.repeat(50);
  const hex = Buffer.from(`alice\t${wif}\t\tMELEKxyz\tfalse`).toString('hex');
  assert.deepEqual(readSavedLogin(hex), { username: 'alice', postingWif: wif });
  assert.deepEqual(readSavedLogin(Buffer.from('bob\tnone\t\t\ttrue').toString('hex')), { username: 'bob', postingWif: '' });
  assert.equal(readSavedLogin(''), null);
  assert.equal(readSavedLogin('{"username":"x"}'), null);
});

test('isUsableImageUrl: https only, nothing that breaks out of a CSS url()', () => {
  assert.ok(isUsableImageUrl('https://melek.salon/img/abc.png'));
  assert.ok(!isUsableImageUrl('http://melek.salon/img/abc.png'));
  assert.ok(!isUsableImageUrl('javascript:alert(1)'));
  assert.ok(!isUsableImageUrl('https://x/a.png) url(evil'));
});

test('buildPostingMetadata keeps other keys, seeds from json_metadata once, sets/removes the picture', () => {
  // first save: posting is empty → profile seeded from json_metadata (name kept)
  const j = JSON.stringify({ profile: { name: 'Seshat', about: 'helper', user_image: 'old' } });
  const a = JSON.parse(buildPostingMetadata('', j, { profile_image: 'https://melek.salon/img/a.png' }));
  assert.deepEqual(a, { profile: { name: 'Seshat', about: 'helper', profile_image: 'https://melek.salon/img/a.png' } });
  // later save: posting already has a profile → that one is the base; other top-level keys survive
  const p = JSON.stringify({ profile: { name: 'S2', profile_image: 'https://old' }, app: 'x' });
  const b = JSON.parse(buildPostingMetadata(p, j, { profile_image: 'https://new' }));
  assert.deepEqual(b, { profile: { name: 'S2', profile_image: 'https://new' }, app: 'x' });
  // remove
  const c = JSON.parse(buildPostingMetadata(p, j, { profile_image: '' }));
  assert.deepEqual(c, { profile: { name: 'S2' }, app: 'x' });
  // garbage in → clean object out
  assert.deepEqual(JSON.parse(buildPostingMetadata('{bad', '[1]', { profile_image: 'https://z' })), { profile: { profile_image: 'https://z' } });
});
