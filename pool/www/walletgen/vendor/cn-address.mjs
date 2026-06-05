// cn-address.mjs — assemble a CryptoNote public address from a network tag + two pubkeys.
//
// address = cnBase58( varint(networkTag) || pubSpend(32) || pubView(32) || checksum(4) )
// where checksum = first 4 bytes of keccak256(varint(tag) || pubSpend || pubView).
//
// Monero mainnet tag = 18 (0x12). Zephyr mainnet tag = 0x6241d18c0 (a multi-byte varint —
// that is why ZEPH addresses begin "ZEPH"). The tag is encoded as a CryptoNote/Monero
// varint (7 bits per byte, little-endian, high bit = continuation).
//
// Provenance: clean-room, mirrors Monero's get_account_address_as_str. Verified against
// Monero address test vectors. License: CC0.

import { keccak256 } from './keccak.mjs';
import { cnBase58Encode, cnBase58Decode } from './cn-base58.mjs';

/** Encode an unsigned integer as a CryptoNote varint (Uint8Array). Accepts Number/BigInt. */
export function encodeVarint(value) {
  let n = BigInt(value);
  if (n < 0n) throw new Error('varint must be non-negative');
  const out = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    out.push(b);
  } while (n > 0n);
  return Uint8Array.from(out);
}

/** Decode a CryptoNote varint from the start of `bytes`. Returns { value: BigInt, length }. */
export function decodeVarint(bytes) {
  let value = 0n;
  let shift = 0n;
  let i = 0;
  for (; i < bytes.length; i++) {
    const b = bytes[i];
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, length: i + 1 };
    shift += 7n;
  }
  throw new Error('varint: truncated');
}

function concat(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

/**
 * makeAddress({ tag, pubSpend, pubView }) -> base58 address string.
 * @param {Object} o
 * @param {number|bigint} o.tag - network address tag (e.g. 18 for XMR mainnet)
 * @param {Uint8Array} o.pubSpend - 32-byte public spend key
 * @param {Uint8Array} o.pubView - 32-byte public view key
 */
export function makeAddress({ tag, pubSpend, pubView }) {
  if (pubSpend.length !== 32 || pubView.length !== 32) {
    throw new Error('makeAddress: pubSpend and pubView must be 32 bytes each');
  }
  const prefix = encodeVarint(tag);
  const payload = concat(prefix, pubSpend, pubView);
  const checksum = keccak256(payload).subarray(0, 4);
  return cnBase58Encode(concat(payload, checksum));
}

/**
 * parseAddress(addr) -> { tag, pubSpend, pubView, checksumOk }. Inverse of makeAddress;
 * used by tests and to re-validate a pasted address.
 */
export function parseAddress(addr) {
  const raw = cnBase58Decode(addr);
  const { value: tag, length: tagLen } = decodeVarint(raw);
  const body = raw.subarray(0, raw.length - 4);
  const checksum = raw.subarray(raw.length - 4);
  const expect = keccak256(body).subarray(0, 4);
  let checksumOk = true;
  for (let i = 0; i < 4; i++) if (checksum[i] !== expect[i]) checksumOk = false;
  const pubSpend = raw.subarray(tagLen, tagLen + 32);
  const pubView = raw.subarray(tagLen + 32, tagLen + 64);
  return { tag, pubSpend, pubView, checksumOk };
}
