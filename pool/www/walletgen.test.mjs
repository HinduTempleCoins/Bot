// Tests for the client-side wallet generators (pool/www/walletgen/).
// Run: node --test pool/www/walletgen.test.mjs
//
// The cryptonote primitives are checked against PUBLISHED Monero address test vectors so a
// regression in keccak/ed25519/base58/mnemonic is caught immediately. The EVM path is
// checked against the canonical secp256k1 G-multiple addresses (privkey 1 and 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { keccak256 } from './walletgen/vendor/keccak.mjs';
import { scReduce32, scalarmultBase } from './walletgen/vendor/ed25519.mjs';
import { cnBase58Encode, cnBase58Decode } from './walletgen/vendor/cn-base58.mjs';
import { makeAddress, parseAddress, encodeVarint, decodeVarint } from './walletgen/vendor/cn-address.mjs';
import { bytesToMnemonic, mnemonicToBytes } from './walletgen/vendor/mnemonic.mjs';
import { ENGLISH_WORDS } from './walletgen/vendor/english-wordlist.mjs';
import { publicKeyFromPrivate, isValidPrivateKey } from './walletgen/vendor/secp256k1.mjs';
import {
  generateWallet, generateCryptonoteWallet, recoverCryptonoteWallet,
  generateEvmWallet, recoverEvmWallet, evmAddressFromPrivate, toChecksumAddress,
  resolveWalletCoin, WALLET_COINS,
} from './walletgen/walletgen.mjs';

const fromHex = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const hex = (b) => Buffer.from(b).toString('hex');

// ===========================================================================
// keccak256 — original Keccak (0x01 pad), not SHA3-256.
// ===========================================================================
test('keccak256 matches known vectors', () => {
  assert.equal(hex(keccak256(new Uint8Array(0))),
    'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(hex(keccak256(new TextEncoder().encode('abc'))),
    '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
});

// ===========================================================================
// ed25519 — scalarmultBase against a Monero test vector.
// ===========================================================================
test('ed25519 scalarmultBase: priv spend -> pub spend (Monero vector)', () => {
  const priv = fromHex('af6082af29108abda69cc385dfed2102b892a871695367cb22a4b9b6df8b3206');
  assert.equal(hex(scalarmultBase(priv)),
    '7aff30fbdc005ecb03f57a11e250e0d665621ffde1d44c6aa84a8212cc0d1236');
});

test('scReduce32 reduces mod L and is idempotent on an already-reduced scalar', () => {
  const already = fromHex('af6082af29108abda69cc385dfed2102b892a871695367cb22a4b9b6df8b3206');
  assert.equal(hex(scReduce32(already)), hex(already));
  // All-0xff reduces to something < L (high bits cleared).
  const big = new Uint8Array(32).fill(0xff);
  const r = scReduce32(big);
  assert.notEqual(hex(r), hex(big));
});

// ===========================================================================
// CryptoNote base58 — block-based, deterministic length.
// ===========================================================================
test('cnBase58 round-trips arbitrary bytes', () => {
  for (const h of ['00', '0011223344556677', 'ffffffffffffffff', 'deadbeef', '']) {
    assert.equal(hex(cnBase58Decode(cnBase58Encode(fromHex(h)))), h);
  }
});

test('varint encode/decode round-trips Monero and Zephyr tags', () => {
  for (const v of [0n, 18n, 127n, 128n, 0x6241d18c0n, 0x8dd58c0n]) {
    const enc = encodeVarint(v);
    const { value } = decodeVarint(enc);
    assert.equal(value, v);
  }
});

// ===========================================================================
// Full address assembly — against the published Monero address vector.
// ===========================================================================
test('makeAddress reproduces a known Monero mainnet address', () => {
  const pubSpend = fromHex('7aff30fbdc005ecb03f57a11e250e0d665621ffde1d44c6aa84a8212cc0d1236');
  const pubView = fromHex('25c1b6920540fbcfcb0e36bd2c88f5c1e62e5ef1d621279e7230b47648e64a63');
  const addr = makeAddress({ tag: 18, pubSpend, pubView });
  assert.equal(addr,
    '46HSxE7KoiDaxWFWR1wmJfcrunNj4TLiPJqiCJkQn345A4JJzgBNhUvbkrYWJX4EVJZS4kJGfGj7CTW8GEUHsbEZCEupMt6');
  const parsed = parseAddress(addr);
  assert.equal(parsed.tag, 18n);
  assert.equal(parsed.checksumOk, true);
});

test('parseAddress validates a real Zephyr address and recovers its tag', () => {
  // A real Zephyr address from the project docs (subaddress prefix 0x8dd58c0).
  const a = 'ZEPHs6xVWGFWTfEYJsJUFDPU4KxxvQmpmeFuw78x4L2vPHBbWtMtbhdLJFMdiXEXBA1kFStyDMkrLYuEvgWyAtjA8PynYZNFBm1';
  const p = parseAddress(a);
  assert.equal(p.tag, 0x8dd58c0n);
  assert.equal(p.checksumOk, true);
});

// ===========================================================================
// Mnemonic — against the published Monero seed/keys vector (end-to-end).
// ===========================================================================
const VEC_MNEMONIC =
  'fewest lipstick auburn cocoa macro circle hurried impel macro hatchet jeopardy swung ' +
  'aloof spiders gags jaws abducts buying alpine athlete junk patio academy loudly academy';

test('mnemonic -> spend/view/pub keys match the Monero vector', () => {
  const seed = mnemonicToBytes(VEC_MNEMONIC);
  const spend = scReduce32(seed);
  assert.equal(hex(spend), '0b7a7bac8a5b6de2f483d703ef82b1bb3e37dd834006d02140a6a762b9142d00');
  const view = scReduce32(keccak256(spend));
  assert.equal(hex(view), '75ec665f4912cec813ff7f20bc75b1f375ee2f8d4bb7631ae8d1af302732a609');
  assert.equal(hex(scalarmultBase(spend)),
    'd5db200426637399f0076090dea01394afc2b157f94d287516911dbbcf8b2275');
  assert.equal(hex(scalarmultBase(view)),
    'cd235f236224b8a5f1e12568927e01a2879bfd49cec2517b0717adb97fe8ae39');
});

test('mnemonic encode/decode is self-consistent for reduced keys', () => {
  // A reduced spend key re-encodes to a 25-word phrase that decodes back to itself.
  const spend = scReduce32(fromHex('af6082af29108abda69cc385dfed2102b892a871695367cb22a4b9b6df8b3206'));
  const m = bytesToMnemonic(spend);
  assert.equal(m.split(' ').length, 25);
  assert.equal(hex(mnemonicToBytes(m)), hex(spend));
});

test('mnemonic rejects a corrupted checksum word', () => {
  const words = VEC_MNEMONIC.split(' ');
  words[24] = 'zoom'; // wrong checksum word
  assert.throws(() => mnemonicToBytes(words.join(' ')), /checksum/);
});

test('wordlist has exactly 1626 words', () => {
  assert.equal(ENGLISH_WORDS.length, 1626);
});

// ===========================================================================
// secp256k1 / EVM — canonical G-multiple addresses.
// ===========================================================================
test('secp256k1 publicKeyFromPrivate(1) == generator point', () => {
  const k = new Uint8Array(32); k[31] = 1;
  assert.equal(hex(publicKeyFromPrivate(k)).slice(0, 64),
    '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
});

test('EVM address from private key 1 and 2 (known vectors)', () => {
  const k1 = new Uint8Array(32); k1[31] = 1;
  const k2 = new Uint8Array(32); k2[31] = 2;
  assert.equal(evmAddressFromPrivate(k1).toLowerCase(),
    '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  assert.equal(evmAddressFromPrivate(k2).toLowerCase(),
    '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf');
});

test('EIP-55 checksum casing matches the spec example', () => {
  // Canonical EIP-55 example address.
  assert.equal(toChecksumAddress('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'),
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
});

test('isValidPrivateKey rejects 0 and out-of-range', () => {
  assert.equal(isValidPrivateKey(new Uint8Array(32)), false); // 0
  assert.equal(isValidPrivateKey(new Uint8Array(32).fill(0xff)), false); // > N
  const ok = new Uint8Array(32); ok[31] = 5;
  assert.equal(isValidPrivateKey(ok), true);
});

// ===========================================================================
// walletgen high-level API — determinism, restore, escaping/format.
// ===========================================================================
// A deterministic "RNG" for tests: returns a fixed 32-byte buffer.
const fixedRng = (seedHex) => () => fromHex(seedHex);

test('resolveWalletCoin matches by key and symbol', () => {
  assert.equal(resolveWalletCoin('zephyr').symbol, 'ZEPH');
  assert.equal(resolveWalletCoin('ZEPH').key, 'zephyr');
  assert.equal(resolveWalletCoin('xmr').name, 'Monero');
  assert.equal(resolveWalletCoin('etc').symbol, 'ETC');
  assert.equal(resolveWalletCoin('nope'), null);
});

test('Zephyr wallet: deterministic from seed, valid ZEPH address, restorable', () => {
  const w = generateCryptonoteWallet('zephyr', { randomBytes: fixedRng('11'.repeat(32)) });
  assert.equal(w.symbol, 'ZEPH');
  assert.ok(w.address.startsWith('ZEPH'), 'ZEPH address prefix');
  assert.equal(w.mnemonic.split(' ').length, 25);
  // Re-deriving from the same seed is deterministic.
  const w2 = generateCryptonoteWallet('zephyr', { randomBytes: fixedRng('11'.repeat(32)) });
  assert.equal(w.address, w2.address);
  assert.equal(w.mnemonic, w2.mnemonic);
  // Restore from the mnemonic reproduces the same address.
  const r = recoverCryptonoteWallet('zephyr', w.mnemonic);
  assert.equal(r.address, w.address);
  assert.equal(r.secretSpendKey, w.secretSpendKey);
  // The mnemonic's address validates (checksum) and carries the Zephyr tag.
  assert.equal(parseAddress(w.address).tag, 0x6241d18c0n);
  assert.equal(parseAddress(w.address).checksumOk, true);
});

test('Monero wallet: address starts with 4 and restores', () => {
  const w = generateCryptonoteWallet('monero', { randomBytes: fixedRng('22'.repeat(32)) });
  assert.ok(w.address.startsWith('4'), 'XMR mainnet address starts 4');
  const r = recoverCryptonoteWallet('monero', w.mnemonic);
  assert.equal(r.address, w.address);
});

test('EVM wallet: one 0x address, deterministic, restorable from privkey', () => {
  const w = generateEvmWallet('ethereum_classic', { randomBytes: fixedRng('33'.repeat(32)) });
  assert.match(w.address, /^0x[0-9a-fA-F]{40}$/);
  assert.match(w.privateKey, /^0x[0-9a-f]{64}$/);
  const r = recoverEvmWallet('ethereum_classic', w.privateKey);
  assert.equal(r.address, w.address);
});

test('generateWallet dispatches by family and never returns empty secrets', () => {
  const z = generateWallet('zephyr', { randomBytes: fixedRng('44'.repeat(32)) });
  assert.ok(z.mnemonic && z.address && z.secretSpendKey);
  const e = generateWallet('etc', { randomBytes: fixedRng('55'.repeat(32)) });
  assert.ok(e.privateKey && e.address);
});

test('every registered coin generates a non-empty, well-formed wallet', () => {
  for (const key of Object.keys(WALLET_COINS)) {
    const w = generateWallet(key, { randomBytes: fixedRng('66'.repeat(32)) });
    assert.ok(w.address.length > 0, `${key} address`);
    if (w.family === 'cryptonote') assert.equal(w.mnemonic.split(' ').length, 25);
    else assert.match(w.address, /^0x[0-9a-fA-F]{40}$/);
  }
});

test('refuses to generate keys without a secure RNG (no Math.random fallback)', () => {
  // The default RNG throws if crypto.getRandomValues is missing; passing an explicit RNG is
  // the only way to make keys. Confirm a bad RNG (too few bytes) is caught downstream.
  assert.throws(() => generateEvmWallet('etc', { randomBytes: () => new Uint8Array(0) }));
});
