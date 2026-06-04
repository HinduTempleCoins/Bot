// webauthn.mjs — passkey / WebAuthn (FIDO2) for the Soapy.blog admin portal (task #250).
//
// A SECOND admin login alongside the email magic-link in admin-auth.mjs: the operator enrols a
// platform authenticator (fingerprint / face) or a roaming security key once, then logs in with it
// — no email inbox in the trust path. On success the PORTAL mints the SAME session as a magic link
// (createSession in admin-auth.mjs), so everything downstream is unchanged.
//
// ZERO external dependencies. Pure node:crypto. We implement only what FIDO2 needs:
//   • a minimal CBOR decoder (RFC 8949 major types 0-5) for the attestationObject + authData maps,
//   • a COSE_Key → SubjectPublicKeyInfo (PEM) converter for ES256 (-7) and RS256 (-257),
//   • clientDataJSON + authData parsing, challenge/origin/rpId binding, and signature verification.
//
// We accept "none" attestation only (no attestation certificate chain is parsed or trusted): for a
// single-operator portal the threat model is "is this the credential we registered?", which the
// signature + signCount answer. We deliberately do NOT phone home to a metadata service.
//
// Everything is PURE and offline. Randomness (the challenge) is the one impure bit; it is injectable
// via __setRandom so the tests are deterministic. NO secrets, keys, or tokens are ever logged.
//
//   import {
//     generateRegistrationOptions, verifyRegistration,
//     generateAuthenticationOptions, verifyAuthentication,
//     b64url, fromB64url,
//   } from './webauthn.mjs'

import crypto from 'node:crypto';

// ── base64url helpers (WebAuthn ships everything as base64url ArrayBuffers) ───────────────────────
export function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s) {
  const str = String(s || '');
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const norm = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(norm, 'base64');
}

// ── injectable randomness (deterministic in tests) ───────────────────────────────────────────────
let _random = (n) => crypto.randomBytes(n);
export function __setRandom(fn) { _random = typeof fn === 'function' ? fn : ((n) => crypto.randomBytes(n)); }
export function __resetRandom() { _random = (n) => crypto.randomBytes(n); }

// ── minimal CBOR decoder (RFC 8949) — major types 0-5, enough for attestationObject/authData ──────
// Returns { value, offset } so a map's values can be decoded in sequence. Throws on anything we
// don't support rather than guessing — a malformed/over-clever attestation should fail closed.
function cborDecode(buf, start = 0) {
  let offset = start;
  function readLength(ai) {
    if (ai < 24) return ai;
    if (ai === 24) { const v = buf.readUInt8(offset); offset += 1; return v; }
    if (ai === 25) { const v = buf.readUInt16BE(offset); offset += 2; return v; }
    if (ai === 26) { const v = buf.readUInt32BE(offset); offset += 4; return v; }
    if (ai === 27) {
      const hi = buf.readUInt32BE(offset); const lo = buf.readUInt32BE(offset + 4); offset += 8;
      const v = hi * 0x100000000 + lo;
      if (!Number.isSafeInteger(v)) throw new Error('cbor: integer too large');
      return v;
    }
    throw new Error('cbor: indefinite-length not supported');
  }
  function decodeItem() {
    if (offset >= buf.length) throw new Error('cbor: unexpected end');
    const head = buf.readUInt8(offset); offset += 1;
    const major = head >> 5;
    const ai = head & 0x1f;
    switch (major) {
      case 0: // unsigned int
        return readLength(ai);
      case 1: // negative int  (-1 - n)  → COSE labels like -7, -1, -2, -3 live here
        return -1 - readLength(ai);
      case 2: { // byte string
        const len = readLength(ai);
        const v = buf.subarray(offset, offset + len); offset += len; return v;
      }
      case 3: { // text string
        const len = readLength(ai);
        const v = buf.toString('utf8', offset, offset + len); offset += len; return v;
      }
      case 4: { // array
        const len = readLength(ai);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(decodeItem());
        return arr;
      }
      case 5: { // map
        const len = readLength(ai);
        const map = new Map();
        for (let i = 0; i < len; i++) { const k = decodeItem(); const v = decodeItem(); map.set(k, v); }
        return map;
      }
      default:
        throw new Error(`cbor: unsupported major type ${major}`);
    }
  }
  const value = decodeItem();
  return { value, offset };
}

// ── COSE_Key → public key ──────────────────────────────────────────────────────────────────────
// COSE_Key common labels:  1=kty, 3=alg.
//   EC2 (kty=2):  -1=crv (1=P-256), -2=x, -3=y.   alg -7 = ES256.
//   RSA (kty=3):  -1=n, -2=e.                       alg -257 = RS256.
// We hand-build a SubjectPublicKeyInfo DER and import it via crypto.createPublicKey({format:'der'}).
const COSE = { kty: 1, alg: 3, crv: -1, x: -2, y: -3, n: -1, e: -2 };

// DER helpers ----------------------------------------------------------------------------------
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function derTLV(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}
function derSeq(...parts) { return derTLV(0x30, Buffer.concat(parts)); }
function derOID(bytes) { return derTLV(0x06, Buffer.from(bytes)); }
function derNull() { return Buffer.from([0x05, 0x00]); }
function derBitString(content) { return derTLV(0x03, Buffer.concat([Buffer.from([0x00]), content])); }
function derUInt(buf) {
  // strip leading zeros, then re-add ONE if the high bit is set (keep it positive)
  let b = buf;
  let i = 0;
  while (i < b.length - 1 && b[i] === 0x00) i++;
  b = b.subarray(i);
  if (b.length && (b[0] & 0x80)) b = Buffer.concat([Buffer.from([0x00]), b]);
  return derTLV(0x02, b);
}

// OIDs as raw DER content bytes
const OID_EC_PUBLICKEY = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];     // 1.2.840.10045.2.1
const OID_P256 = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];        // 1.2.840.10045.3.1.7 (prime256v1)
const OID_RSA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];   // 1.2.840.113549.1.1.1

// Build an SPKI DER for an EC P-256 key from x,y (32 bytes each).
function ecSpkiDer(x, y) {
  if (x.length !== 32 || y.length !== 32) throw new Error('cose: bad EC coordinate length');
  const point = Buffer.concat([Buffer.from([0x04]), x, y]); // uncompressed point
  const algId = derSeq(derOID(OID_EC_PUBLICKEY), derOID(OID_P256));
  return derSeq(algId, derBitString(point));
}
// Build an SPKI DER for an RSA key from modulus n and exponent e.
function rsaSpkiDer(n, e) {
  const rsaPub = derSeq(derUInt(n), derUInt(e));
  const algId = derSeq(derOID(OID_RSA), derNull());
  return derSeq(algId, derBitString(rsaPub));
}

// Convert a decoded COSE_Key Map → { keyObject, alg } where keyObject is a node:crypto public key.
function coseToKey(coseMap) {
  if (!(coseMap instanceof Map)) throw new Error('cose: not a map');
  const kty = coseMap.get(COSE.kty);
  const alg = coseMap.get(COSE.alg);
  if (kty === 2) { // EC2
    if (alg !== -7) throw new Error(`cose: unsupported EC alg ${alg} (only ES256/-7)`);
    const crv = coseMap.get(COSE.crv);
    if (crv !== 1) throw new Error(`cose: unsupported curve ${crv} (only P-256)`);
    const x = toBuf(coseMap.get(COSE.x));
    const y = toBuf(coseMap.get(COSE.y));
    const der = ecSpkiDer(x, y);
    const keyObject = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return { keyObject, alg: -7 };
  }
  if (kty === 3) { // RSA
    if (alg !== -257) throw new Error(`cose: unsupported RSA alg ${alg} (only RS256/-257)`);
    const n = toBuf(coseMap.get(COSE.n));
    const e = toBuf(coseMap.get(COSE.e));
    const der = rsaSpkiDer(n, e);
    const keyObject = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return { keyObject, alg: -257 };
  }
  throw new Error(`cose: unsupported key type ${kty}`);
}
function toBuf(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  throw new Error('cose: expected byte string');
}

// Export a COSE public key as PEM (so a credential store can persist it as text and re-import later).
export function coseKeyToPem(coseMapOrBuf) {
  const map = Buffer.isBuffer(coseMapOrBuf) || coseMapOrBuf instanceof Uint8Array
    ? cborDecode(toBuf(coseMapOrBuf)).value
    : coseMapOrBuf;
  const { keyObject } = coseToKey(map);
  return keyObject.export({ type: 'spki', format: 'pem' });
}

// ── authData parsing (https://w3c.github.io/webauthn/#sctn-authenticator-data) ───────────────────
// rpIdHash(32) || flags(1) || signCount(4) || [attestedCredentialData] || [extensions]
// attestedCredentialData = aaguid(16) || credIdLen(2) || credId || COSE_Key(rest)
function parseAuthData(authData) {
  if (authData.length < 37) throw new Error('authData: too short');
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData.readUInt8(32);
  const signCount = authData.readUInt32BE(33);
  const flagUP = !!(flags & 0x01);          // user present
  const flagUV = !!(flags & 0x04);          // user verified
  const flagAT = !!(flags & 0x40);          // attested credential data present
  const flagED = !!(flags & 0x80);          // extension data present

  let offset = 37;
  let aaguid = null;
  let credentialId = null;
  let coseKeyMap = null;
  if (flagAT) {
    aaguid = authData.subarray(offset, offset + 16); offset += 16;
    const credIdLen = authData.readUInt16BE(offset); offset += 2;
    credentialId = authData.subarray(offset, offset + credIdLen); offset += credIdLen;
    // The COSE key is the next CBOR item; decode it and learn where it ended.
    const dec = cborDecode(authData, offset);
    coseKeyMap = dec.value;
    offset = dec.offset;
  }
  return { rpIdHash, flags, flagUP, flagUV, flagAT, flagED, signCount, aaguid, credentialId, coseKeyMap, restOffset: offset };
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }

function constEq(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Parse + validate clientDataJSON; returns the decoded object on success or throws.
function parseClientData(clientDataB64url, { expectedType, expectedChallenge, expectedOrigin }) {
  let data;
  try { data = JSON.parse(fromB64url(clientDataB64url).toString('utf8')); }
  catch { throw new Error('clientData: not valid JSON'); }
  if (data.type !== expectedType) throw new Error(`clientData: type ${data.type} != ${expectedType}`);
  // challenge is base64url in clientDataJSON; compare to the expected challenge (also base64url).
  if (!data.challenge || !constEq(fromB64url(data.challenge), fromB64url(expectedChallenge))) {
    throw new Error('clientData: challenge mismatch');
  }
  if (data.origin !== expectedOrigin) throw new Error(`clientData: origin ${data.origin} != ${expectedOrigin}`);
  return data;
}

// ── REGISTRATION ─────────────────────────────────────────────────────────────────────────────────
// generateRegistrationOptions — the PublicKeyCredentialCreationOptions the browser's
// navigator.credentials.create() consumes. challenge + user.id are base64url; the caller stashes the
// challenge server-side (single-use) to compare against in verifyRegistration.
export function generateRegistrationOptions({
  rpId, rpName, userId, userName, userDisplayName,
  challenge, timeout = 60000, excludeCredentialIds = [],
} = {}) {
  if (!rpId) throw new Error('generateRegistrationOptions: rpId required');
  const ch = challenge || b64url(_random(32));
  const uid = userId ? b64url(Buffer.from(String(userId))) : b64url(_random(16));
  return {
    challenge: ch,
    rp: { id: rpId, name: rpName || rpId },
    user: { id: uid, name: userName || 'admin', displayName: userDisplayName || userName || 'admin' },
    // ES256 (-7) preferred, RS256 (-257) fallback — the two we can verify.
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    timeout,
    attestation: 'none',
    authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
    excludeCredentials: (excludeCredentialIds || []).map((id) => ({ type: 'public-key', id })),
  };
}

// verifyRegistration — validate an attestation response from navigator.credentials.create().
// `attestationResponse` = { id, rawId, response: { clientDataJSON, attestationObject } } (all base64url).
// Returns { ok:true, credentialId, publicKeyPem, coseKey, signCount, aaguid } on success;
// { ok:false, reason } on any failure (fail closed). We accept ONLY "none" attestation.
export function verifyRegistration(attestationResponse, { expectedChallenge, expectedOrigin, expectedRpId } = {}) {
  try {
    const resp = attestationResponse?.response || {};
    if (!resp.clientDataJSON || !resp.attestationObject) return { ok: false, reason: 'missing-fields' };
    parseClientData(resp.clientDataJSON, {
      expectedType: 'webauthn.create', expectedChallenge, expectedOrigin,
    });

    const attObj = cborDecode(fromB64url(resp.attestationObject)).value;
    if (!(attObj instanceof Map)) return { ok: false, reason: 'bad-attestation-object' };
    const fmt = attObj.get('fmt');
    if (fmt !== 'none') return { ok: false, reason: `unsupported-attestation-format:${fmt}` };
    const authData = toBuf(attObj.get('authData'));
    const parsed = parseAuthData(authData);

    // rpIdHash MUST equal SHA-256(rpId)
    if (!constEq(parsed.rpIdHash, sha256(Buffer.from(expectedRpId, 'utf8')))) {
      return { ok: false, reason: 'rpid-hash-mismatch' };
    }
    if (!parsed.flagUP) return { ok: false, reason: 'user-not-present' };
    if (!parsed.flagAT || !parsed.credentialId || !parsed.coseKeyMap) {
      return { ok: false, reason: 'no-attested-credential' };
    }

    // COSE key → PEM (this also validates the alg/curve are ones we support)
    let publicKeyPem;
    try { publicKeyPem = coseToKey(parsed.coseKeyMap).keyObject.export({ type: 'spki', format: 'pem' }); }
    catch (e) { return { ok: false, reason: `cose:${e.message}` }; }

    return {
      ok: true,
      credentialId: b64url(parsed.credentialId),
      publicKeyPem,
      coseKey: b64url(encodeCoseKeyBytes(authData, parsed)),
      signCount: parsed.signCount,
      aaguid: parsed.aaguid ? b64url(parsed.aaguid) : null,
    };
  } catch (e) {
    return { ok: false, reason: e?.message || 'verify-failed' };
  }
}

// Slice the raw COSE_Key bytes back out of authData (from the credential-id end to where CBOR ended),
// so the store can persist the exact COSE key too (PEM is the canonical form we actually verify with).
function encodeCoseKeyBytes(authData, parsed) {
  // attested credential data started at 37: aaguid(16)+credIdLen(2)+credId(n) then COSE key to restOffset
  const credIdLen = parsed.credentialId.length;
  const coseStart = 37 + 16 + 2 + credIdLen;
  return authData.subarray(coseStart, parsed.restOffset);
}

// ── AUTHENTICATION ───────────────────────────────────────────────────────────────────────────────
// generateAuthenticationOptions — PublicKeyCredentialRequestOptions for navigator.credentials.get().
export function generateAuthenticationOptions({
  rpId, challenge, timeout = 60000, allowCredentialIds = [],
} = {}) {
  if (!rpId) throw new Error('generateAuthenticationOptions: rpId required');
  const ch = challenge || b64url(_random(32));
  return {
    challenge: ch,
    rpId,
    timeout,
    userVerification: 'preferred',
    allowCredentials: (allowCredentialIds || []).map((id) => ({ type: 'public-key', id })),
  };
}

// verifyAuthentication — validate an assertion from navigator.credentials.get().
// `assertionResponse` = { id, rawId, response: { clientDataJSON, authenticatorData, signature, userHandle } }.
// `storedCredential` = { credentialId, publicKeyPem, signCount } (what verifyRegistration produced).
// Returns { ok:true, newSignCount } on success; { ok:false, reason } otherwise (fail closed).
export function verifyAuthentication(assertionResponse, storedCredential, { expectedChallenge, expectedOrigin, expectedRpId } = {}) {
  try {
    const resp = assertionResponse?.response || {};
    if (!resp.clientDataJSON || !resp.authenticatorData || !resp.signature) return { ok: false, reason: 'missing-fields' };
    if (!storedCredential?.publicKeyPem) return { ok: false, reason: 'no-stored-key' };

    // The returned credential id must match the one we stored (defends against a swapped credential).
    if (assertionResponse.id && storedCredential.credentialId && assertionResponse.id !== storedCredential.credentialId) {
      return { ok: false, reason: 'credential-id-mismatch' };
    }

    parseClientData(resp.clientDataJSON, {
      expectedType: 'webauthn.get', expectedChallenge, expectedOrigin,
    });

    const authData = fromB64url(resp.authenticatorData);
    const parsed = parseAuthData(authData);
    if (!constEq(parsed.rpIdHash, sha256(Buffer.from(expectedRpId, 'utf8')))) {
      return { ok: false, reason: 'rpid-hash-mismatch' };
    }
    if (!parsed.flagUP) return { ok: false, reason: 'user-not-present' };

    // Signed message = authenticatorData || SHA-256(clientDataJSON)
    const clientHash = sha256(fromB64url(resp.clientDataJSON));
    const signed = Buffer.concat([authData, clientHash]);
    const signature = fromB64url(resp.signature);

    // Verify against the stored public key. ES256 = ECDSA-P256-SHA256 (DER sig); RS256 = RSA-SHA256.
    const keyObject = crypto.createPublicKey(storedCredential.publicKeyPem);
    const keyType = keyObject.asymmetricKeyType; // 'ec' | 'rsa'
    let valid = false;
    if (keyType === 'ec') {
      valid = crypto.verify('sha256', signed, { key: keyObject, dsaEncoding: 'der' }, signature);
    } else if (keyType === 'rsa') {
      valid = crypto.verify('sha256', signed, keyObject, signature);
    } else {
      return { ok: false, reason: `unsupported-key-type:${keyType}` };
    }
    if (!valid) return { ok: false, reason: 'bad-signature' };

    // signCount: must be strictly greater than stored UNLESS both are 0 (authenticators that don't
    // implement a counter always report 0 — that is explicitly allowed by the spec).
    const stored = Number(storedCredential.signCount || 0);
    const got = parsed.signCount;
    if (!(got === 0 && stored === 0) && got <= stored) {
      return { ok: false, reason: 'sign-count-not-incremented' };
    }

    return { ok: true, newSignCount: got, userVerified: parsed.flagUV };
  } catch (e) {
    return { ok: false, reason: e?.message || 'verify-failed' };
  }
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('webauthn.mjs')) {
  const opts = generateRegistrationOptions({ rpId: 'soapy.blog', rpName: 'Soapy.blog Admin', userName: 'operator' });
  console.log('sample registration options (challenge is random, single-use):');
  console.log(JSON.stringify({ ...opts, challenge: `${opts.challenge.slice(0, 8)}…`, user: { ...opts.user, id: `${opts.user.id.slice(0, 8)}…` } }, null, 2));
}
