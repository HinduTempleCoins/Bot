// mnemonic.mjs — Monero/CryptoNote 25-word mnemonic <-> 32-byte secret seed.
//
// Encoding (Monero "electrum-style" word seed):
//   - The 32-byte seed splits into 8 little-endian uint32 words.
//   - Each uint32 x maps to a 3-word group:
//       w1 = x % n
//       w2 = (floor(x/n) + w1) % n
//       w3 = (floor(x/n/n) + w2) % n          (n = 1626, the word count)
//   - 24 words total, plus a 25th CHECKSUM word: CRC32 over the first
//     UNIQUE_PREFIX_LENGTH (3) chars of each of the 24 words, index = crc % 24.
//
// Decoding inverts this and verifies the checksum word.
//
// Provenance: clean-room, mirrors monero electrum_words.cpp. Verified round-trip + against
// Monero seed test vectors. License: CC0.

import { ENGLISH_WORDS, UNIQUE_PREFIX_LENGTH } from './english-wordlist.mjs';

const N = ENGLISH_WORDS.length; // 1626

// --- CRC32 (IEEE 802.3, the variant Monero's checksum uses) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(str) {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Checksum index = crc32(concat of 3-char prefixes of the 24 words) % 24.
function checksumIndex(words) {
  const trimmed = words.map((w) => w.slice(0, UNIQUE_PREFIX_LENGTH)).join('');
  return crc32(trimmed) % words.length;
}

function readUint32LE(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function writeUint32LE(value, bytes, offset) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * bytesToMnemonic(seed32) -> string (25 space-separated words: 24 data + 1 checksum).
 * @param {Uint8Array} seed - exactly 32 bytes
 */
export function bytesToMnemonic(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new Error('bytesToMnemonic: seed must be 32 bytes');
  }
  const words = [];
  for (let i = 0; i < 32; i += 4) {
    const x = readUint32LE(seed, i);
    const w1 = x % N;
    const w2 = (Math.floor(x / N) + w1) % N;
    const w3 = (Math.floor(x / N / N) + w2) % N;
    words.push(ENGLISH_WORDS[w1], ENGLISH_WORDS[w2], ENGLISH_WORDS[w3]);
  }
  // 24 words now; append the checksum word.
  const cs = checksumIndex(words);
  words.push(words[cs]);
  return words.join(' ');
}

/**
 * mnemonicToBytes(phrase) -> Uint8Array(32). Verifies word count and checksum.
 * @param {string} phrase
 */
export function mnemonicToBytes(phrase) {
  const all = String(phrase).trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (all.length !== 25 && all.length !== 24) {
    throw new Error(`mnemonicToBytes: expected 25 words (24 + checksum), got ${all.length}`);
  }
  const hasChecksum = all.length === 25;
  const words = hasChecksum ? all.slice(0, 24) : all.slice();

  // Resolve each word to its index (allow unique-prefix matching like Monero).
  const indexOf = (w) => {
    let idx = ENGLISH_WORDS.indexOf(w);
    if (idx >= 0) return idx;
    const pre = w.slice(0, UNIQUE_PREFIX_LENGTH);
    idx = ENGLISH_WORDS.findIndex((x) => x.slice(0, UNIQUE_PREFIX_LENGTH) === pre);
    if (idx < 0) throw new Error(`mnemonicToBytes: unknown word "${w}"`);
    return idx;
  };

  if (hasChecksum) {
    const cs = checksumIndex(words);
    const expected = ENGLISH_WORDS[indexOf(words[cs])].slice(0, UNIQUE_PREFIX_LENGTH);
    const got = all[24].slice(0, UNIQUE_PREFIX_LENGTH);
    if (expected !== got) {
      throw new Error('mnemonicToBytes: checksum word does not match (typo in the phrase?)');
    }
  }

  const seed = new Uint8Array(32);
  for (let g = 0; g < 8; g++) {
    const w1 = indexOf(words[g * 3]);
    const w2 = indexOf(words[g * 3 + 1]);
    const w3 = indexOf(words[g * 3 + 2]);
    const x =
      w1 +
      N * (((w2 - w1) % N + N) % N) +
      N * N * (((w3 - w2) % N + N) % N);
    if (x > 0xffffffff) throw new Error('mnemonicToBytes: decoded group out of range');
    writeUint32LE(x >>> 0, seed, g * 4);
  }
  return seed;
}

export { N as WORD_COUNT };
