// cn-base58.test.mjs — CryptoNote block-based base58 (NOT Bitcoin base58).
//
// VECTOR-VALIDATED against the published vectors in Monero's src/common/base58.cpp tests:
//   - 8 zero bytes        -> "11111111111" (11 chars)
//   - 0xff (1 byte)       -> "5Q"
//   - 0xffffffffffffffff  -> "jpXCZedGfVQ"
//   - ""                  -> ""
// ROUND-TRIP: encode->decode recovers the bytes for full-block and partial-block inputs,
// including a 69-byte buffer (the exact length of a Monero address payload+checksum).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnBase58Encode, cnBase58Decode } from './cn-base58.mjs';

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => {
  const o = new Uint8Array(h.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16);
  return o;
};

test('published Monero base58 block vectors', () => {
  assert.equal(cnBase58Encode(new Uint8Array(0)), '');
  assert.equal(cnBase58Encode(new Uint8Array(8)), '11111111111'); // 8 zero bytes
  assert.equal(cnBase58Encode(fromHex('ff')), '5Q');
  assert.equal(cnBase58Encode(fromHex('ffffffffffffffff')), 'jpXCZedGfVQ');
});

test('a full 8-byte block always encodes to 11 chars', () => {
  assert.equal(cnBase58Encode(fromHex('0011223344556677')).length, 11);
});

test('round-trip: encode then decode recovers full-block bytes', () => {
  const data = fromHex('0011223344556677ffeeddccbbaa9988');
  assert.equal(hex(cnBase58Decode(cnBase58Encode(data))), hex(data));
});

test('round-trip: partial trailing block (non-multiple of 8)', () => {
  // 5 bytes -> last block; tests the partial-block size table both ways.
  const data = fromHex('deadbeef00');
  assert.equal(hex(cnBase58Decode(cnBase58Encode(data))), hex(data));
});

test('round-trip: 69-byte address-length payload', () => {
  // 1 (tag) + 32 (spend) + 32 (view) + 4 (checksum) = 69 bytes, the real address size.
  const data = new Uint8Array(69);
  for (let i = 0; i < 69; i++) data[i] = (i * 37 + 11) & 0xff;
  assert.equal(hex(cnBase58Decode(cnBase58Encode(data))), hex(data));
});

test('decode rejects a char outside the CryptoNote alphabet', () => {
  // '0', 'O', 'I', 'l' are NOT in the alphabet.
  assert.throws(() => cnBase58Decode('0000000000O'));
});
