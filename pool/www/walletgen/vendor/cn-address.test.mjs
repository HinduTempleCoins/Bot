// cn-address.test.mjs — CryptoNote address assembly (varint tag + 2 pubkeys + keccak csum).
//
// VECTOR-VALIDATED structurally:
//   - encodeVarint/decodeVarint against published CryptoNote/Monero varint values
//     (18 -> [0x12]; 0x6241d18c0 -> the Zephyr multi-byte varint).
//   - Monero mainnet tag 18 -> addresses begin "4"; Zephyr tag 0x6241d18c0 -> begin "ZEPH"
//     (documented network behavior, from each project's cryptonote_config.h).
// ROUND-TRIP / CROSS-PRIMITIVE: makeAddress -> parseAddress recovers tag + both pubkeys and
//   reports checksumOk; the checksum is independently recomputed as keccak256(body)[:4];
//   flipping one payload byte makes the parsed checksum fail. (No external full address↔keys
//   vector is asserted here because the published one is truncated in the provenance doc;
//   instead the assembly is validated end-to-end against its own inverse + the keccak
//   primitive, which is itself vector-validated in keccak.test.mjs.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from './keccak.mjs';
import { cnBase58Decode } from './cn-base58.mjs';
import {
  makeAddress,
  parseAddress,
  encodeVarint,
  decodeVarint,
} from './cn-address.mjs';

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fixedKey = (seed) => {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (i * seed + 7) & 0xff;
  return out;
};

const pubSpend = fixedKey(13);
const pubView = fixedKey(29);

test('encodeVarint published values', () => {
  assert.equal(hex(encodeVarint(18)), '12');          // Monero tag 18
  assert.equal(hex(encodeVarint(0)), '00');
  assert.equal(hex(encodeVarint(127)), '7f');
  assert.equal(hex(encodeVarint(128)), '8001');       // first multi-byte varint
  // Zephyr mainnet tag 0x6241d18c0 — multi-byte CryptoNote varint.
  assert.equal(hex(encodeVarint(0x6241d18c0n)), 'c0b1f4a062');
});

test('varint round-trips', () => {
  for (const v of [0n, 1n, 18n, 128n, 16384n, 0x6241d18c0n]) {
    const enc = encodeVarint(v);
    const { value, length } = decodeVarint(enc);
    assert.equal(value, v);
    assert.equal(length, enc.length);
  }
});

test('Monero tag 18 -> address begins "4", length 95', () => {
  const addr = makeAddress({ tag: 18n, pubSpend, pubView });
  assert.equal(addr[0], '4');
  assert.equal(addr.length, 95);
});

test('Zephyr tag 0x6241d18c0 -> address begins "ZEPH"', () => {
  const addr = makeAddress({ tag: 0x6241d18c0n, pubSpend, pubView });
  assert.equal(addr.slice(0, 4), 'ZEPH');
});

test('round-trip: makeAddress -> parseAddress recovers tag + both pubkeys, checksumOk', () => {
  const addr = makeAddress({ tag: 18n, pubSpend, pubView });
  const p = parseAddress(addr);
  assert.equal(p.tag, 18n);
  assert.equal(hex(p.pubSpend), hex(pubSpend));
  assert.equal(hex(p.pubView), hex(pubView));
  assert.equal(p.checksumOk, true);
});

test('checksum is keccak256(varint(tag)||spend||view)[:4]', () => {
  const tag = 18n;
  const body = new Uint8Array([...encodeVarint(tag), ...pubSpend, ...pubView]);
  const expect = keccak256(body).subarray(0, 4);
  // The address decodes to body || checksum.
  const addr = makeAddress({ tag, pubSpend, pubView });
  const raw = cnBase58Decode(addr);
  assert.equal(hex(raw.subarray(raw.length - 4)), hex(expect));
});

test('a corrupted address payload fails the checksum', () => {
  const addr = makeAddress({ tag: 18n, pubSpend, pubView });
  const raw = cnBase58Decode(addr);
  raw[5] ^= 0xff; // mutate a spend-key byte
  // Re-encode the mutated raw and parse it.
  // (Import encode lazily to keep this test self-contained.)
  return import('./cn-base58.mjs').then(({ cnBase58Encode }) => {
    const p = parseAddress(cnBase58Encode(raw));
    assert.equal(p.checksumOk, false);
  });
});
