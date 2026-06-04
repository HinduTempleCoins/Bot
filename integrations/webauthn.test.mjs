// webauthn.test.mjs — offline tests for the zero-dep WebAuthn verifier (task #250).
//
// We construct a real registration (attestationObject, "none" fmt) and a real authentication
// assertion IN-TEST using a generated EC P-256 key, encoding CBOR + authData by hand and signing
// authData||SHA256(clientDataJSON) ourselves. This proves the decoder/COSE/verify paths end to end
// without any browser or live authenticator, and lets us tamper with each input to prove fail-closed.

import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

import {
  generateRegistrationOptions,
  verifyRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
  coseKeyToPem,
  b64url,
  fromB64url,
  __setRandom,
  __resetRandom,
} from './webauthn.mjs';

const RP_ID = 'soapy.blog';
const ORIGIN = 'https://soapy.blog';

// ── tiny CBOR ENCODER (test-only, mirror of the module's decoder) ────────────────────────────────
function cborUInt(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
function cborInt(n) { // unsigned or negative
  if (n >= 0) return cborUInt(0, n);
  return cborUInt(1, -1 - n);
}
function cborBytes(buf) { return Buffer.concat([cborUInt(2, buf.length), buf]); }
function cborText(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([cborUInt(3, b.length), b]); }
function cborMap(pairs) { // pairs: [[keyBuf, valBuf], ...]
  const parts = [cborUInt(5, pairs.length)];
  for (const [k, v] of pairs) parts.push(k, v);
  return Buffer.concat(parts);
}

// Build a COSE_Key (EC2/ES256) CBOR map from a node EC public key.
function coseKeyFromEcPublic(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  const x = fromB64url(jwk.x);
  const y = fromB64url(jwk.y);
  // map keys: 1(kty)=2, 3(alg)=-7, -1(crv)=1, -2(x), -3(y)
  return cborMap([
    [cborInt(1), cborInt(2)],
    [cborInt(3), cborInt(-7)],
    [cborInt(-1), cborInt(1)],
    [cborInt(-2), cborBytes(x)],
    [cborInt(-3), cborBytes(y)],
  ]);
}

function buildAuthData({ rpId, flags, signCount, credentialId = null, coseKey = null }) {
  const rpIdHash = crypto.createHash('sha256').update(Buffer.from(rpId, 'utf8')).digest();
  const head = Buffer.alloc(37);
  rpIdHash.copy(head, 0);
  head.writeUInt8(flags, 32);
  head.writeUInt32BE(signCount, 33);
  if (!credentialId) return head;
  const aaguid = Buffer.alloc(16, 0);
  const credIdLen = Buffer.alloc(2); credIdLen.writeUInt16BE(credentialId.length, 0);
  return Buffer.concat([head, aaguid, credIdLen, credentialId, coseKey]);
}

// Make a full registration response for a freshly generated EC key.
function makeRegistration({ challenge, origin = ORIGIN, rpId = RP_ID, type = 'webauthn.create' }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = crypto.randomBytes(20);
  const coseKey = coseKeyFromEcPublic(publicKey);
  // flags: UP(0x01) | UV(0x04) | AT(0x40) = 0x45
  const authData = buildAuthData({ rpId, flags: 0x45, signCount: 0, credentialId, coseKey });
  const attestationObject = cborMap([
    [cborText('fmt'), cborText('none')],
    [cborText('attStmt'), cborMap([])],
    [cborText('authData'), cborBytes(authData)],
  ]);
  const clientData = JSON.stringify({ type, challenge, origin, crossOrigin: false });
  return {
    privateKey,
    credentialId,
    response: {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      response: {
        clientDataJSON: b64url(Buffer.from(clientData, 'utf8')),
        attestationObject: b64url(attestationObject),
      },
    },
  };
}

// Make an authentication assertion signed by the given private key.
function makeAssertion({ privateKey, credentialId, challenge, origin = ORIGIN, rpId = RP_ID, signCount = 1, type = 'webauthn.get' }) {
  const authData = buildAuthData({ rpId, flags: 0x05, signCount }); // UP|UV, no AT
  const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
  const clientHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signed = Buffer.concat([authData, clientHash]);
  const signature = crypto.sign('sha256', signed, { key: privateKey, dsaEncoding: 'der' });
  return {
    id: b64url(credentialId),
    rawId: b64url(credentialId),
    response: {
      clientDataJSON: b64url(clientDataJSON),
      authenticatorData: b64url(authData),
      signature: b64url(signature),
    },
  };
}

// ── option generation ────────────────────────────────────────────────────────────────────────────
test('generateRegistrationOptions returns ES256+RS256 params and a challenge', () => {
  __setRandom((n) => Buffer.alloc(n, 7));
  const o = generateRegistrationOptions({ rpId: RP_ID, rpName: 'Soapy', userName: 'op' });
  assert.equal(o.rp.id, RP_ID);
  assert.equal(o.attestation, 'none');
  assert.deepEqual(o.pubKeyCredParams.map((p) => p.alg), [-7, -257]);
  assert.ok(o.challenge);
  __resetRandom();
});

test('generateAuthenticationOptions echoes rpId + challenge + allowCredentials', () => {
  const o = generateAuthenticationOptions({ rpId: RP_ID, challenge: 'abc', allowCredentialIds: ['cred1'] });
  assert.equal(o.rpId, RP_ID);
  assert.equal(o.challenge, 'abc');
  assert.deepEqual(o.allowCredentials, [{ type: 'public-key', id: 'cred1' }]);
});

// ── registration verify ────────────────────────────────────────────────────────────────────────────
test('verifyRegistration accepts a valid none-attestation and extracts the key', () => {
  const challenge = b64url(crypto.randomBytes(32));
  const reg = makeRegistration({ challenge });
  const r = verifyRegistration(reg.response, { expectedChallenge: challenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.credentialId, b64url(reg.credentialId));
  assert.match(r.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.equal(r.signCount, 0);
  // coseKey bytes round-trip back to the same PEM
  assert.equal(coseKeyToPem(fromB64url(r.coseKey)), r.publicKeyPem);
});

test('verifyRegistration rejects wrong challenge / origin / rpId', () => {
  const challenge = b64url(crypto.randomBytes(32));
  const reg = makeRegistration({ challenge });
  const base = { expectedChallenge: challenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID };

  assert.equal(verifyRegistration(reg.response, { ...base, expectedChallenge: b64url(crypto.randomBytes(32)) }).ok, false);
  assert.equal(verifyRegistration(reg.response, { ...base, expectedOrigin: 'https://evil.example' }).ok, false);
  assert.equal(verifyRegistration(reg.response, { ...base, expectedRpId: 'evil.example' }).ok, false);
});

test('verifyRegistration rejects a clientData type of webauthn.get', () => {
  const challenge = b64url(crypto.randomBytes(32));
  const reg = makeRegistration({ challenge, type: 'webauthn.get' });
  const r = verifyRegistration(reg.response, { expectedChallenge: challenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  assert.equal(r.ok, false);
});

// ── authentication verify ────────────────────────────────────────────────────────────────────────
test('verifyAuthentication accepts a valid assertion signed by the registered key', () => {
  const regChallenge = b64url(crypto.randomBytes(32));
  const reg = makeRegistration({ challenge: regChallenge });
  const r = verifyRegistration(reg.response, { expectedChallenge: regChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  assert.equal(r.ok, true, r.reason);
  const stored = { credentialId: r.credentialId, publicKeyPem: r.publicKeyPem, signCount: r.signCount };

  const authChallenge = b64url(crypto.randomBytes(32));
  const assertion = makeAssertion({ privateKey: reg.privateKey, credentialId: reg.credentialId, challenge: authChallenge, signCount: 5 });
  const v = verifyAuthentication(assertion, stored, { expectedChallenge: authChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.newSignCount, 5);
});

test('verifyAuthentication rejects a tampered signature', () => {
  const regChallenge = b64url(crypto.randomBytes(32));
  const reg = makeRegistration({ challenge: regChallenge });
  const r = verifyRegistration(reg.response, { expectedChallenge: regChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  const stored = { credentialId: r.credentialId, publicKeyPem: r.publicKeyPem, signCount: 0 };

  const authChallenge = b64url(crypto.randomBytes(32));
  const assertion = makeAssertion({ privateKey: reg.privateKey, credentialId: reg.credentialId, challenge: authChallenge, signCount: 1 });
  // flip a byte in the signature
  const sig = fromB64url(assertion.response.signature);
  sig[sig.length - 1] ^= 0xff;
  assertion.response.signature = b64url(sig);
  const v = verifyAuthentication(assertion, stored, { expectedChallenge: authChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'bad-signature');
});

test('verifyAuthentication rejects wrong challenge and wrong origin', () => {
  const regChallenge = b64url(crypto.randomBytes(32));
  const reg = makeRegistration({ challenge: regChallenge });
  const r = verifyRegistration(reg.response, { expectedChallenge: regChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  const stored = { credentialId: r.credentialId, publicKeyPem: r.publicKeyPem, signCount: 0 };

  const authChallenge = b64url(crypto.randomBytes(32));
  const assertion = makeAssertion({ privateKey: reg.privateKey, credentialId: reg.credentialId, challenge: authChallenge, signCount: 1 });

  // wrong expected challenge
  assert.equal(verifyAuthentication(assertion, stored, { expectedChallenge: b64url(crypto.randomBytes(32)), expectedOrigin: ORIGIN, expectedRpId: RP_ID }).ok, false);
  // wrong expected origin
  assert.equal(verifyAuthentication(assertion, stored, { expectedChallenge: authChallenge, expectedOrigin: 'https://evil.example', expectedRpId: RP_ID }).ok, false);
});

test('verifyAuthentication rejects a clientData type of webauthn.create', () => {
  const regChallenge = b64url(crypto.randomBytes(32));
  const reg = makeRegistration({ challenge: regChallenge });
  const r = verifyRegistration(reg.response, { expectedChallenge: regChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  const stored = { credentialId: r.credentialId, publicKeyPem: r.publicKeyPem, signCount: 0 };
  const authChallenge = b64url(crypto.randomBytes(32));
  const assertion = makeAssertion({ privateKey: reg.privateKey, credentialId: reg.credentialId, challenge: authChallenge, signCount: 1, type: 'webauthn.create' });
  assert.equal(verifyAuthentication(assertion, stored, { expectedChallenge: authChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID }).ok, false);
});

test('verifyAuthentication rejects a non-incrementing sign counter', () => {
  const regChallenge = b64url(crypto.randomBytes(32));
  const reg = makeRegistration({ challenge: regChallenge });
  const r = verifyRegistration(reg.response, { expectedChallenge: regChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  const stored = { credentialId: r.credentialId, publicKeyPem: r.publicKeyPem, signCount: 10 };
  const authChallenge = b64url(crypto.randomBytes(32));
  const assertion = makeAssertion({ privateKey: reg.privateKey, credentialId: reg.credentialId, challenge: authChallenge, signCount: 9 });
  const v = verifyAuthentication(assertion, stored, { expectedChallenge: authChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'sign-count-not-incremented');
});

test('verifyAuthentication rejects a mismatched credentialId', () => {
  const regChallenge = b64url(crypto.randomBytes(32));
  const reg = makeRegistration({ challenge: regChallenge });
  const r = verifyRegistration(reg.response, { expectedChallenge: regChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  const stored = { credentialId: b64url(crypto.randomBytes(20)), publicKeyPem: r.publicKeyPem, signCount: 0 };
  const authChallenge = b64url(crypto.randomBytes(32));
  const assertion = makeAssertion({ privateKey: reg.privateKey, credentialId: reg.credentialId, challenge: authChallenge, signCount: 1 });
  const v = verifyAuthentication(assertion, stored, { expectedChallenge: authChallenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'credential-id-mismatch');
});
