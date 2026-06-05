// secp256k1.mjs — minimal secp256k1 public-key derivation for EVM addresses.
//
// EVM key generation needs one primitive: pub = priv * G on secp256k1, returned as the
// 64-byte uncompressed public key (X||Y, no 0x04 prefix). The address is then the last 20
// bytes of keccak256(pub). No signing here — only public-key derivation.
//
// Provenance: clean-room BigInt implementation of secp256k1 (y^2 = x^3 + 7 over the field
// p = 2^256 - 2^32 - 977; generator G and order n per SEC2). Jacobian-free affine
// double-and-add. Verified against the standard G-multiple test vectors. License: CC0.

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function mod(a, m = P) { const r = a % m; return r >= 0n ? r : r + m; }

function modInverse(a, m = P) {
  // Extended Euclid.
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return mod(old_s, m);
}

// Affine point addition / doubling on secp256k1. Points are [x, y] BigInt or null (∞).
function pointAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (x1 === x2 && mod(y1 + y2) === 0n) return null; // P + (-P) = ∞
  let m;
  if (x1 === x2 && y1 === y2) {
    // doubling: m = (3 x1^2) / (2 y1)
    m = mod(3n * x1 * x1 * modInverse(2n * y1));
  } else {
    m = mod((y2 - y1) * modInverse(mod(x2 - x1)));
  }
  const x3 = mod(m * m - x1 - x2);
  const y3 = mod(m * (x1 - x3) - y1);
  return [x3, y3];
}

function scalarMul(k, point) {
  let result = null;
  let addend = point;
  let n = mod(k, N);
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  return result;
}

function bytesToBigIntBE(bytes) {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

function bigIntTo32BE(n) {
  const out = new Uint8Array(32);
  let x = n;
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

/**
 * isValidPrivateKey(priv32) -> boolean. Valid iff 0 < k < N.
 * @param {Uint8Array} priv32
 */
export function isValidPrivateKey(priv32) {
  const k = bytesToBigIntBE(priv32);
  return k > 0n && k < N;
}

/**
 * publicKeyFromPrivate(priv32) -> Uint8Array(64). Uncompressed X||Y, no 0x04 prefix.
 * @param {Uint8Array} priv32
 */
export function publicKeyFromPrivate(priv32) {
  const k = bytesToBigIntBE(priv32);
  if (k <= 0n || k >= N) throw new Error('secp256k1: private key out of range');
  const pub = scalarMul(k, [Gx, Gy]);
  if (pub === null) throw new Error('secp256k1: derived point at infinity');
  const out = new Uint8Array(64);
  out.set(bigIntTo32BE(pub[0]), 0);
  out.set(bigIntTo32BE(pub[1]), 32);
  return out;
}

export const SECP256K1_N = N;
