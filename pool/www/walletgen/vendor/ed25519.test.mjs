// ed25519.test.mjs — CryptoNote ed25519 ops (scReduce32 + scalarmultBase).
//
// VECTOR-VALIDATED:
//   - scalarmultBase(1) == the compressed Ed25519 base point B
//     (5866666666666666666666666666666666666666666666666666666666666666), the canonical
//     RFC 8032 base-point encoding.
//   - scalarmultBase(L) == identity point compressed (0100..00): multiplying the base point
//     by the group order yields the neutral element — a structural vector for L.
// ROUND-TRIP / CROSS-CHECK: scReduce32 reduces mod L (checked: a value < L is unchanged;
// a value >= L reduces correctly; the result feeds scalarmultBase consistently).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scReduce32, scalarmultBase, ED25519_L } from './ed25519.mjs';

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// 32-byte little-endian from a small integer.
const scalarLE = (n) => {
  const out = new Uint8Array(32);
  let x = BigInt(n);
  for (let i = 0; i < 32; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
};

test('scalarmultBase(1) == published compressed Ed25519 base point B', () => {
  assert.equal(
    hex(scalarmultBase(scalarLE(1))),
    '5866666666666666666666666666666666666666666666666666666666666666',
  );
});

test('scalarmultBase output is 32 bytes', () => {
  assert.equal(scalarmultBase(scalarLE(1)).length, 32);
  assert.equal(scalarmultBase(scalarLE(12345)).length, 32);
});

test('scalarmultBase(L) == identity (neutral) point compressed', () => {
  // L * B = identity; the compressed neutral element is y=1 => 0x01 then zeros.
  const Lbytes = scalarLE(ED25519_L);
  assert.equal(
    hex(scalarmultBase(Lbytes)),
    '0100000000000000000000000000000000000000000000000000000000000000',
  );
});

test('scalarmultBase reduces mod L: (k) and (k+L) give the same public key', () => {
  const k = 7n;
  const a = hex(scalarmultBase(scalarLE(k)));
  const b = hex(scalarmultBase(scalarLE(k + ED25519_L)));
  assert.equal(a, b);
});

test('scReduce32: a scalar already < L is unchanged', () => {
  const small = scalarLE(123456789n);
  assert.equal(hex(scReduce32(small)), hex(small));
});

test('scReduce32: a scalar >= L reduces below L and matches BigInt mod', () => {
  const v = ED25519_L + 5n;
  const out = scReduce32(scalarLE(v));
  // little-endian -> BigInt
  let n = 0n;
  for (let i = 31; i >= 0; i--) n = (n << 8n) | BigInt(out[i]);
  assert.equal(n, 5n);
  assert.ok(n < ED25519_L);
});

test('scReduce32 output is always 32 bytes', () => {
  assert.equal(scReduce32(new Uint8Array(32).fill(0xff)).length, 32);
});
