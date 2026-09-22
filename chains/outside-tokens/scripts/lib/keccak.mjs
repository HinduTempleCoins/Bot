// keccak.mjs — pure-JS keccak-256 (Ethereum's hash), ZERO dependencies, no network, no keys.
//
// WHY THIS EXISTS: Node's crypto has 'sha3-256' but NOT keccak-256. They differ only in the padding
// byte (SHA3 pads 0x06, keccak pads 0x01), but that difference makes SHA3 useless for matching an
// on-chain `keccak256(...)`. To prove — offline, with no toolchain — that the Merkle root/leaves this
// package builds are byte-identical to what MerkleDistributor.sol computes, we need the real keccak.
// This is a self-contained keccak-f[1600] sponge. It is validated against known vectors in the
// offline tests (empty string, "abc"), so a regression is caught immediately.
//
// Reference: FIPS-202 keccak-f permutation with keccak (0x01) padding, rate 1088 bits (136 bytes).

// Round constants (iota step), as BigInt 64-bit lanes.
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets, indexed [x][y] in the 5x5 lane grid (flattened x + 5*y).
const ROT = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

const MASK64 = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << n) | (x >> (64n - n))) & MASK64;

// One keccak-f[1600] permutation over 25 BigInt lanes (mutates `s`).
function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    // θ
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    const D = new Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D[x];

    // ρ and π
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const idx = x + 5 * y;
        const nx = y;
        const ny = (2 * x + 3 * y) % 5;
        B[nx + 5 * ny] = rotl(s[idx], BigInt(ROT[idx]));
      }
    }

    // χ
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        s[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK64) & B[((x + 2) % 5) + 5 * y]);
      }
    }

    // ι
    s[0] ^= RC[round];
  }
}

/**
 * keccak256 of a byte array.
 * @param {Uint8Array} input
 * @returns {Uint8Array} 32-byte digest
 */
export function keccak256Bytes(input) {
  const rate = 136; // bytes (1088 bits) for keccak-256
  const s = new Array(25).fill(0n); // state lanes
  const msg = input;

  // absorb full blocks
  let offset = 0;
  const blocks = Math.floor(msg.length / rate);
  const absorbBlock = (block) => {
    for (let i = 0; i < rate; i += 8) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) lane |= BigInt(block[i + b]) << BigInt(8 * b);
      s[i / 8] ^= lane;
    }
    keccakF(s);
  };

  for (let n = 0; n < blocks; n++) {
    absorbBlock(msg.subarray(offset, offset + rate));
    offset += rate;
  }

  // final block with keccak padding: 0x01 ... 0x80
  const rem = msg.length - offset;
  const last = new Uint8Array(rate);
  last.set(msg.subarray(offset), 0);
  last[rem] ^= 0x01;
  last[rate - 1] ^= 0x80;
  absorbBlock(last);

  // squeeze 32 bytes (fits in the first 4 lanes of the rate)
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const lane = s[Math.floor(i / 8)];
    out[i] = Number((lane >> BigInt(8 * (i % 8))) & 0xffn);
  }
  return out;
}

// ---- hex helpers ----------------------------------------------------------

export function hexToBytes(hex) {
  let h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2) h = "0" + h;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  let h = "0x";
  for (const b of bytes) h += b.toString(16).padStart(2, "0");
  return h;
}

/** keccak256 of a 0x-hex string (interpreted as bytes) → 0x-hex digest. */
export function keccak256Hex(hex) {
  return bytesToHex(keccak256Bytes(hexToBytes(hex)));
}

/** keccak256 of a UTF-8 string → 0x-hex digest. */
export function keccak256Utf8(str) {
  return bytesToHex(keccak256Bytes(new TextEncoder().encode(str)));
}
