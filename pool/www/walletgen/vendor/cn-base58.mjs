// cn-base58.mjs — CryptoNote base58 (block-based), as used by Monero/Zephyr addresses.
//
// This is NOT Bitcoin base58: CryptoNote encodes the byte string in 8-byte blocks, each
// block producing a FIXED number of base58 chars (per the size table below), so the output
// length is deterministic. Monero/Zephyr addresses use this scheme.
//
// Provenance: clean-room reimplementation of Monero's src/common/base58.cpp algorithm
// (full_block_size=8, encoded_block_sizes={0,2,3,5,6,7,9,10,11}). Verified against Monero
// address test vectors. License: CC0 / public domain.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_SIZE = 58n;
const FULL_BLOCK_SIZE = 8;
const FULL_ENCODED_BLOCK_SIZE = 11;
// data block size (bytes) -> encoded char count
const ENCODED_BLOCK_SIZES = [0, 2, 3, 5, 6, 7, 9, 10, 11];
// encoded char count -> data block size (reverse of the above), used by the decoder
const DECODED_BLOCK_SIZES = (() => {
  const m = {};
  for (let i = 0; i < ENCODED_BLOCK_SIZES.length; i++) m[ENCODED_BLOCK_SIZES[i]] = i;
  return m;
})();

function bytesToBigIntBE(bytes) {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

function encodeBlock(block) {
  const num = bytesToBigIntBE(block);
  const size = ENCODED_BLOCK_SIZES[block.length];
  const out = new Array(size).fill('1'); // '1' is alphabet[0]
  let n = num;
  let i = size - 1;
  while (n > 0n && i >= 0) {
    const rem = Number(n % ALPHABET_SIZE);
    n = n / ALPHABET_SIZE;
    out[i] = ALPHABET[rem];
    i--;
  }
  return out.join('');
}

/**
 * cnBase58Encode(bytes) -> string. Block-based CryptoNote base58.
 * @param {Uint8Array} bytes
 */
export function cnBase58Encode(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let result = '';
  const fullBlocks = Math.floor(data.length / FULL_BLOCK_SIZE);
  const lastSize = data.length % FULL_BLOCK_SIZE;
  for (let i = 0; i < fullBlocks; i++) {
    result += encodeBlock(data.subarray(i * FULL_BLOCK_SIZE, (i + 1) * FULL_BLOCK_SIZE));
  }
  if (lastSize > 0) {
    result += encodeBlock(data.subarray(fullBlocks * FULL_BLOCK_SIZE));
  }
  return result;
}

function decodeBlock(str, outBuf, outOffset) {
  const size = DECODED_BLOCK_SIZES[str.length];
  if (size === undefined) throw new Error('cnBase58: invalid encoded block length');
  let num = 0n;
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('cnBase58: char not in alphabet');
    num = num * ALPHABET_SIZE + BigInt(idx);
  }
  if (num >= (1n << BigInt(size * 8))) throw new Error('cnBase58: overflow in block');
  for (let i = size - 1; i >= 0; i--) {
    outBuf[outOffset + i] = Number(num & 0xffn);
    num >>= 8n;
  }
  return size;
}

/**
 * cnBase58Decode(str) -> Uint8Array. Inverse of cnBase58Encode (used in tests/validation).
 * @param {string} str
 */
export function cnBase58Decode(str) {
  const fullBlocks = Math.floor(str.length / FULL_ENCODED_BLOCK_SIZE);
  const lastEnc = str.length % FULL_ENCODED_BLOCK_SIZE;
  const lastDec = lastEnc === 0 ? 0 : DECODED_BLOCK_SIZES[lastEnc];
  if (lastEnc !== 0 && lastDec === undefined) throw new Error('cnBase58: invalid length');
  const out = new Uint8Array(fullBlocks * FULL_BLOCK_SIZE + lastDec);
  let outOff = 0;
  for (let i = 0; i < fullBlocks; i++) {
    outOff += decodeBlock(str.substr(i * FULL_ENCODED_BLOCK_SIZE, FULL_ENCODED_BLOCK_SIZE), out, outOff);
  }
  if (lastEnc > 0) decodeBlock(str.substr(fullBlocks * FULL_ENCODED_BLOCK_SIZE), out, outOff);
  return out;
}
