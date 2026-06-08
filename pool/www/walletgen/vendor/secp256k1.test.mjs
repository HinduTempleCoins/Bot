// secp256k1.test.mjs — secp256k1 public-key derivation + EVM-address derivation vectors.
//
// VECTOR-VALIDATED:
//   - privkey = 1 -> pubkey is the SEC2 generator G (Gx||Gy). This is THE definitional
//     vector for scalar multiplication.
//   - privkey = 1 -> ETH address 0x7e5f4552091a69125d5dfcb7b8c2659029395bdf and
//     privkey = 2 -> 0x2b5ad5c4795c026514f8317c7a215e218dccd6cf are the well-known,
//     widely-published Ethereum addresses for those keys.
// The address is asserted to be the last 20 bytes of keccak256(uncompressed 64-byte pub),
// i.e. the real ETH derivation, validated against an external library's published output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from './keccak.mjs';
import {
  publicKeyFromPrivate,
  isValidPrivateKey,
  SECP256K1_N,
} from './secp256k1.mjs';

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// priv32 from a small integer (big-endian).
const priv = (n) => {
  const out = new Uint8Array(32);
  let x = BigInt(n);
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
};

// ETH address = last 20 bytes of keccak256(uncompressed pub X||Y).
const ethAddr = (priv32) => '0x' + hex(keccak256(publicKeyFromPrivate(priv32)).subarray(12));

const Gx = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const Gy = '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';

test('publicKeyFromPrivate(1) == generator G (Gx||Gy), 64 bytes uncompressed', () => {
  const pub = publicKeyFromPrivate(priv(1));
  assert.equal(pub.length, 64);
  assert.equal(hex(pub), Gx + Gy);
});

test('EVM address for privkey 1 == published 0x7e5f...95bdf', () => {
  assert.equal(ethAddr(priv(1)), '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
});

test('EVM address for privkey 2 == published 0x2b5a...d6cf', () => {
  assert.equal(ethAddr(priv(2)), '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf');
});

test('address is exactly keccak256(pub)[-20:]', () => {
  const pub = publicKeyFromPrivate(priv(1));
  const full = keccak256(pub);
  assert.equal('0x' + hex(full.subarray(12)), ethAddr(priv(1)));
  assert.equal(full.subarray(12).length, 20);
});

test('isValidPrivateKey: 0 < k < N', () => {
  assert.equal(isValidPrivateKey(priv(1)), true);
  assert.equal(isValidPrivateKey(new Uint8Array(32)), false); // k == 0
  // k == N is out of range; k == N-1 is valid.
  const nBytes = (() => {
    const out = new Uint8Array(32);
    let x = SECP256K1_N;
    for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
    return out;
  })();
  assert.equal(isValidPrivateKey(nBytes), false);
  const nMinus1 = new Uint8Array(nBytes); nMinus1[31] -= 1;
  assert.equal(isValidPrivateKey(nMinus1), true);
});

test('publicKeyFromPrivate rejects out-of-range keys', () => {
  assert.throws(() => publicKeyFromPrivate(new Uint8Array(32))); // 0
});
