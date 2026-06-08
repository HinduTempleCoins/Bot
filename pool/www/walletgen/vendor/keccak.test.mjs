// keccak.test.mjs — Keccak-256 (original Keccak pad 0x01) against published vectors.
//
// VECTOR-VALIDATED. The empty-string and "abc" Keccak-256 digests are the canonical
// published values (the ones Ethereum/Monero rely on). A SHA3-256 (0x06 pad)
// implementation would produce different digests for both, so these vectors also prove
// the correct original-Keccak padding variant is in use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from './keccak.mjs';

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const te = new TextEncoder();

test('keccak256("") == published empty-string digest', () => {
  assert.equal(
    hex(keccak256(new Uint8Array(0))),
    'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  );
});

test('keccak256("abc") == published digest', () => {
  assert.equal(
    hex(keccak256(te.encode('abc'))),
    '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  );
});

test('keccak256 output is always 32 bytes across block boundaries', () => {
  assert.equal(keccak256(new Uint8Array(0)).length, 32);
  assert.equal(keccak256(te.encode('abc')).length, 32);
  // 135 = rate-1, 136 = exactly one rate block (forces a 2nd padding block), 200 = multi.
  assert.equal(keccak256(new Uint8Array(135)).length, 32);
  assert.equal(keccak256(new Uint8Array(136)).length, 32);
  assert.equal(keccak256(new Uint8Array(200)).length, 32);
});

test('keccak256 is deterministic / stable (full-rate boundary self-consistency)', () => {
  // Not an externally published vector — a regression pin at the rate boundary (136 bytes
  // = exactly one block, exercising the always-append padding-block path).
  const a = hex(keccak256(new Uint8Array(136)));
  const b = hex(keccak256(new Uint8Array(136)));
  assert.equal(a, b);
  assert.equal(a, '3a5912a7c5faa06ee4fe906253e339467a9ce87d533c65be3c15cb231cdb25f9');
});
