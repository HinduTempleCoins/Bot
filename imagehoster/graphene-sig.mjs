// graphene-sig.mjs — verify a Graphene (Steem-family) compact signature against a public key string.
//
// Used by the image hoster to check the upload challenge the condenser signs with the user's
// posting key:   sig = Signature.signBufferSha256(sha256("ImageSigningChallenge" || imageBytes), postingKey)
// The signature is 65 bytes hex: [27+4+recid][r:32][s:32]. A public key string is
// PREFIX + base58(pub33 || ripemd160(pub33)[0..4]) — e.g. "MELEK6pZd…".
//
// Pure, zero-dependency (BigInt secp256k1, affine arithmetic). VERIFY ONLY — no private keys here.

import crypto from 'node:crypto';

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
    0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];

const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function inv(a, m = P) {
    let [r0, r1] = [mod(a, m), m];
    let [s0, s1] = [1n, 0n];
    while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    return mod(s0, m);
}
function powmod(b, e, m = P) {
    let r = 1n; b = mod(b, m);
    while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
    return r;
}
function add(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a[0] === b[0]) {
        if (mod(a[1] + b[1]) === 0n) return null;
        const l = mod(3n * a[0] * a[0] * inv(2n * a[1]));
        const x = mod(l * l - 2n * a[0]);
        return [x, mod(l * (a[0] - x) - a[1])];
    }
    const l = mod((b[1] - a[1]) * inv(b[0] - a[0]));
    const x = mod(l * l - a[0] - b[0]);
    return [x, mod(l * (a[0] - x) - a[1])];
}
function mul(pt, k) {
    let r = null, q = pt;
    while (k > 0n) { if (k & 1n) r = add(r, q); q = add(q, q); k >>= 1n; }
    return r;
}
const big = (buf) => BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'));

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58decode(str) {
    let n = 0n;
    for (const c of String(str)) {
        const i = B58.indexOf(c);
        if (i < 0) return null;
        n = n * 58n + BigInt(i);
    }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    let lead = 0;
    for (const c of String(str)) { if (c === '1') lead++; else break; }
    return Buffer.concat([Buffer.alloc(lead), n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex')]);
}

/** "MELEK6pZd…" → { prefix, pub33 } | null. Checks the ripemd160 checksum when the runtime has it. */
export function parsePublicKey(s) {
    const m = /^([A-Z]{2,8})([1-9A-HJ-NP-Za-km-z]{40,60})$/.exec(String(s || ''));
    if (!m) return null;
    const raw = b58decode(m[2]);
    if (!raw || raw.length !== 37) return null;
    const pub33 = raw.subarray(0, 33);
    if (pub33[0] !== 2 && pub33[0] !== 3) return null;
    try {
        const sum = crypto.createHash('ripemd160').update(pub33).digest().subarray(0, 4);
        if (!sum.equals(raw.subarray(33))) return null;
    } catch { /* runtime without ripemd160: the curve check below still rejects garbage */ }
    return { prefix: m[1], pub33: Buffer.from(pub33) };
}

function decompress(pub33) {
    const x = big(pub33.subarray(1));
    if (x >= P) return null;
    const y2 = mod(x * x * x + 7n);
    let y = powmod(y2, (P + 1n) / 4n);
    if (mod(y * y) !== y2) return null; // not on the curve
    if ((y & 1n) !== BigInt(pub33[0] & 1)) y = P - y;
    return [x, y];
}

/** Parse a 65-byte compact signature (hex) → { r, s } | null. */
export function parseSignature(hex) {
    if (!/^[0-9a-f]{130}$/i.test(String(hex || ''))) return null;
    const b = Buffer.from(hex, 'hex');
    if (b[0] < 27 || b[0] > 34) return null;
    const r = big(b.subarray(1, 33)), s = big(b.subarray(33, 65));
    if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
    return { r, s };
}

/** ECDSA verify: does `sigHex` sign the 32-byte `digest` with public key string `pubStr`? Never throws. */
export function verifyDigest(digest, sigHex, pubStr) {
    try {
        const sig = parseSignature(sigHex);
        const key = parsePublicKey(pubStr);
        if (!sig || !key || !digest || digest.length !== 32) return false;
        const Q = decompress(key.pub33);
        if (!Q) return false;
        const e = big(digest) % N;
        const w = inv(sig.s, N);
        const X = add(mul(G, mod(e * w, N)), mul(Q, mod(sig.r * w, N)));
        return !!X && mod(X[0], N) === sig.r;
    } catch {
        return false;
    }
}

export const IMAGE_CHALLENGE_PREFIX = Buffer.from('ImageSigningChallenge');

/** sha256("ImageSigningChallenge" || bytes) — the digest the condenser signs for an upload. */
export function imageChallengeDigest(bytes) {
    return crypto.createHash('sha256').update(Buffer.concat([IMAGE_CHALLENGE_PREFIX, Buffer.from(bytes)])).digest();
}
