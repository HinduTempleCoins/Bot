// secp256k1.test.mjs — signup-path EVM keygen. Same vendored lib as the pool wallet; this
// test pins the published privkey->pubkey->ETH-address vectors on the SIGNUP copy too, so a
// future divergence between the two copies is caught here.
//
// VECTOR-VALIDATED: privkey 1 -> generator G and ETH address 0x7e5f...95bdf;
//                   privkey 2 -> ETH address 0x2b5a...d6cf.
// keccak256 for the address derivation is imported from the pool copy (the signup vendor
// dir intentionally ships only secp256k1; the keccak primitive is shared and itself
// vector-validated in pool/www/walletgen/vendor/keccak.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from '../../../../pool/www/walletgen/vendor/keccak.mjs';
import { publicKeyFromPrivate, isValidPrivateKey } from './secp256k1.mjs';

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const priv = (n) => {
  const out = new Uint8Array(32);
  let x = BigInt(n);
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
};
const ethAddr = (p) => '0x' + hex(keccak256(publicKeyFromPrivate(p)).subarray(12));

test('signup secp256k1: privkey 1 -> generator G (64-byte uncompressed)', () => {
  const pub = publicKeyFromPrivate(priv(1));
  assert.equal(pub.length, 64);
  assert.equal(
    hex(pub),
    '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' +
    '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8',
  );
});

test('signup secp256k1: privkey 1 -> ETH address 0x7e5f...95bdf', () => {
  assert.equal(ethAddr(priv(1)), '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
});

test('signup secp256k1: privkey 2 -> ETH address 0x2b5a...d6cf', () => {
  assert.equal(ethAddr(priv(2)), '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf');
});

test('signup secp256k1: isValidPrivateKey rejects zero', () => {
  assert.equal(isValidPrivateKey(new Uint8Array(32)), false);
  assert.equal(isValidPrivateKey(priv(1)), true);
});
