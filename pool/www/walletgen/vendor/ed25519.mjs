// ed25519.mjs — minimal ed25519 group operations for CryptoNote key generation.
//
// CryptoNote/Monero key generation needs exactly two ed25519 primitives:
//   - scReduce32(b32): reduce a 32-byte little-endian scalar modulo the group order L,
//     giving a canonical private key (Monero's sc_reduce32 / "make a key valid").
//   - scalarmultBase(scalar32): public = scalar * G, returned as the 32-byte compressed
//     Edwards point (ge_scalarmult_base + ge_p3_tobytes).
//
// It does NOT do signing — we only ever derive public keys/addresses here.
//
// Provenance: clean-room BigInt implementation of the standard Twisted Edwards curve
// arithmetic for ed25519 (RFC 8032 curve constants p = 2^255-19, L, d, basepoint B).
// Extended (projective) coordinates, constant-set ladder via double-and-add over the
// little-endian scalar bits. No external deps. BigInt is supported in every target
// browser and in Node. Verified against Monero address test vectors. License: CC0.

const p = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n; // group order
// d = -121665/121666 mod p (the Edwards curve coefficient).
const D = ((-121665n * modInverse(121666n, p)) % p + p) % p;

// Basepoint B (RFC 8032): y = 4/5, x = recover.
const By = (4n * modInverse(5n, p)) % p;
const Bx = recoverX(By, 0n);
const B = [Bx, By, 1n, (Bx * By) % p]; // extended coords (X,Y,Z,T)

function mod(a) { const r = a % p; return r >= 0n ? r : r + p; }

function modInverse(a, m) {
  // Fermat's little theorem inverse for prime m.
  return modPow(((a % m) + m) % m, m - 2n, m);
}

function modPow(base, exp, m) {
  let result = 1n;
  base %= m;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

// Recover x from y on the curve (-x^2 + y^2 = 1 + d x^2 y^2). sign = wanted parity of x.
function recoverX(y, sign) {
  const y2 = (y * y) % p;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  // x = u * v^3 * (u v^7)^((p-5)/8)
  const v3 = (v * v % p) * v % p;
  const v7 = (v3 * v3 % p) * v % p;
  let x = (u * v3 % p) * modPow((u * v7) % p, (p - 5n) / 8n, p) % p;
  // Check x^2 * v == u (mod p); else multiply by sqrt(-1).
  const vx2 = (v * x % p) * x % p;
  if (mod(vx2 - u) !== 0n) {
    if (mod(vx2 + u) === 0n) {
      const sqrtm1 = modPow(2n, (p - 1n) / 4n, p);
      x = (x * sqrtm1) % p;
    }
  }
  if ((x & 1n) !== BigInt(sign)) x = mod(-x);
  return x;
}

// Extended-coordinate point addition (RFC 8032 §5.1.4).
function pointAdd(P, Q) {
  const [X1, Y1, Z1, T1] = P;
  const [X2, Y2, Z2, T2] = Q;
  const A = mod((Y1 - X1) * (Y2 - X2));
  const Bc = mod((Y1 + X1) * (Y2 + X2));
  const C = mod(T1 * 2n * D * T2);
  const Dc = mod(Z1 * 2n * Z2);
  const E = Bc - A;
  const F = Dc - C;
  const G = Dc + C;
  const H = Bc + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}

// Scalar multiply (double-and-add). Scalar is a BigInt.
function scalarMul(scalar, point) {
  let result = [0n, 1n, 1n, 0n]; // neutral element
  let addend = point;
  let k = scalar;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    k >>= 1n;
  }
  return result;
}

// Compress an extended point to 32 little-endian bytes (RFC 8032 §5.1.2).
function encodePoint(P) {
  const [X, Y, Z] = P;
  const zinv = modInverse(Z, p);
  const x = mod(X * zinv);
  const y = mod(Y * zinv);
  const out = new Uint8Array(32);
  let yy = y;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(yy & 0xffn);
    yy >>= 8n;
  }
  // Set the sign bit (high bit of last byte) to x's low bit.
  out[31] |= Number(x & 1n) << 7;
  return out;
}

function bytesToBigIntLE(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

function bigIntToBytesLE(n, len = 32) {
  const out = new Uint8Array(len);
  let x = n;
  for (let i = 0; i < len; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/**
 * scReduce32: reduce a 32-byte little-endian scalar modulo L. Mirrors Monero's
 * sc_reduce32 (which reduces a single 32-byte input — NOT the 64-byte sc_reduce).
 * @param {Uint8Array} b32
 * @returns {Uint8Array} 32-byte canonical scalar (little-endian)
 */
export function scReduce32(b32) {
  const n = bytesToBigIntLE(b32) % L;
  return bigIntToBytesLE(n, 32);
}

/**
 * scalarmultBase: public = scalar * B, compressed to 32 bytes. The scalar is taken as a
 * little-endian 32-byte value and reduced mod L first (so it accepts any 32-byte input).
 * @param {Uint8Array} scalar32
 * @returns {Uint8Array} 32-byte compressed public key (little-endian)
 */
export function scalarmultBase(scalar32) {
  const a = bytesToBigIntLE(scalar32) % L;
  const P = scalarMul(a, B);
  return encodePoint(P);
}

// Exposed for tests / advanced callers.
export const ED25519_L = L;
