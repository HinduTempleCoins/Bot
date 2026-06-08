// mnemonic.test.mjs — Monero 25-word electrum-style mnemonic <-> 32-byte seed.
//
// ROUND-TRIP VALIDATED (both directions) + STRUCTURAL VECTORS:
//   - bytesToMnemonic emits exactly 25 words (24 data + 1 CRC32 checksum word).
//   - seed -> words -> seed recovers the original 32 bytes for several fixed seeds.
//   - words -> seed -> words is stable.
//   - The checksum word is enforced: corrupting it is rejected.
//   - Monero allows the checksum word to be omitted (24 words) — decoding still works.
//   - A fixed seed maps to a known, pinned word list (regression vector; the encoding is
//     deterministic per Monero electrum_words.cpp).
// No external published phrase<->hex pair is asserted (the provenance doc truncates it);
// instead the encoding is locked by exact round-trip against the seed bytes, which is the
// property that actually protects user funds (the seed must restore the same wallet).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToMnemonic, mnemonicToBytes, WORD_COUNT } from './mnemonic.mjs';

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => {
  const o = new Uint8Array(h.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16);
  return o;
};

const SEEDS = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '0b7a7bb5d8c1a2f3e4d5c6b7a8990011223344556677889900aabbccddeeff2d',
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
];

test('wordlist has 1626 words', () => {
  assert.equal(WORD_COUNT, 1626);
});

test('bytesToMnemonic emits exactly 25 words', () => {
  const m = bytesToMnemonic(fromHex(SEEDS[2]));
  assert.equal(m.trim().split(/\s+/).length, 25);
});

test('round-trip seed -> mnemonic -> seed recovers the exact bytes', () => {
  for (const s of SEEDS) {
    const seed = fromHex(s);
    assert.equal(hex(mnemonicToBytes(bytesToMnemonic(seed))), s);
  }
});

test('round-trip mnemonic -> seed -> mnemonic is stable', () => {
  for (const s of SEEDS) {
    const m1 = bytesToMnemonic(fromHex(s));
    const m2 = bytesToMnemonic(mnemonicToBytes(m1));
    assert.equal(m1, m2);
  }
});

test('a 24-word phrase (no checksum word) still decodes', () => {
  const full = bytesToMnemonic(fromHex(SEEDS[2]));
  const words = full.trim().split(/\s+/);
  const twentyFour = words.slice(0, 24).join(' ');
  assert.equal(hex(mnemonicToBytes(twentyFour)), SEEDS[2]);
});

test('a corrupted checksum word is rejected', () => {
  const words = bytesToMnemonic(fromHex(SEEDS[2])).trim().split(/\s+/);
  // Replace the checksum (25th) word with a different valid word.
  words[24] = words[24] === 'abbey' ? 'abducts' : 'abbey';
  assert.throws(() => mnemonicToBytes(words.join(' ')));
});

test('wrong word count is rejected', () => {
  assert.throws(() => mnemonicToBytes('abbey abbey abbey'));
});

test('seed=0x01(LE) maps to a pinned word list (deterministic regression vector)', () => {
  const m = bytesToMnemonic(fromHex(SEEDS[1]));
  assert.equal(
    m,
    'abducts abducts abducts abbey abbey abbey abbey abbey abbey abbey abbey abbey ' +
    'abbey abbey abbey abbey abbey abbey abbey abbey abbey abbey abbey abbey abbey',
  );
});
