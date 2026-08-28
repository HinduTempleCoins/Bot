// credentials-issuer.test.mjs — offline tests for the MELEK Academy credential issuer/registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRAMS, ISSUERS, CREDENTIAL_TYPES, getProgram, programsInTrack,
  issueCredential, verifyCredential, hashCredential, credentialId, toOpenBadge, createRegistry,
} from './credentials-issuer.mjs';

const AT = new Date('2026-08-28');

test('every program is well-formed and maps to a known type + issuer', () => {
  assert.ok(PROGRAMS.length >= 6);
  for (const p of PROGRAMS) {
    assert.ok(p.id && p.name && p.criteria && p.note, `program ${p.id} complete`);
    assert.ok(CREDENTIAL_TYPES[p.type], `program ${p.id} has a known type`);
    const issuerId = CREDENTIAL_TYPES[p.type].issuer;
    assert.ok(ISSUERS[issuerId], `type ${p.type} -> known issuer`);
  }
});

test('the three flagship legit-now credentials exist (press, ordination, angelic-ai)', () => {
  assert.ok(getProgram('melek-press-pass'));
  assert.ok(getProgram('ordination-minister'));
  assert.ok(getProgram('angelic-ai-foundations'));
});

test('issue: press pass is issued under MELEK Press with a verifiable id + hash', () => {
  const r = issueCredential({ programId: 'melek-press-pass', recipientName: 'Jane Reporter', recipientId: 'jane', now: AT });
  assert.equal(r.ok, true);
  const c = r.credential;
  assert.match(c.id, /^MELEK-PRESS-[0-9A-F]{12}$/);
  assert.equal(c.issuer.id, 'press');
  assert.equal(c.accreditation, 'non-accredited');
  assert.equal(c.verification.method, 'sha256');
  assert.equal(c.verification.anchor, null);          // on-chain anchor is a later seam
  assert.equal(c.verification.hash, hashCredential({ programId: 'melek-press-pass', type: 'press', issuer: 'press', recipientName: 'Jane Reporter', recipientId: 'jane', issuedAt: '2026-08-28', expiresAt: '', evidence: '' }));
});

test('issue: ordination is a church (temple) credential', () => {
  const r = issueCredential({ programId: 'ordination-minister', recipientName: 'Rev. Test', now: AT });
  assert.equal(r.ok, true);
  assert.equal(r.credential.issuer.id, 'temple');
  assert.match(r.credential.id, /^MELEK-MIN-/);
});

test('issue: deterministic — same inputs -> same id/hash', () => {
  const a = issueCredential({ programId: 'angelic-ai-foundations', recipientName: 'Sam', now: AT });
  const b = issueCredential({ programId: 'angelic-ai-foundations', recipientName: 'Sam', now: AT });
  assert.equal(a.credential.id, b.credential.id);
  assert.equal(a.credential.verification.hash, b.credential.verification.hash);
});

test('issue soft-fails on unknown program + missing recipient', () => {
  assert.equal(issueCredential({ programId: 'nope', recipientName: 'X' }).ok, false);
  assert.equal(issueCredential({ programId: 'melek-press-pass', recipientName: '  ' }).ok, false);
});

test('verify: a freshly issued credential verifies', () => {
  const r = issueCredential({ programId: 'crypto-blockchain-literacy', recipientName: 'Ada', now: AT });
  const v = verifyCredential(r.credential);
  assert.equal(v.valid, true);
});

test('verify: tampering with the recipient breaks the hash', () => {
  const r = issueCredential({ programId: 'crypto-blockchain-literacy', recipientName: 'Ada', now: AT });
  const forged = JSON.parse(JSON.stringify(r.credential));
  forged.recipient.name = 'Mallory';
  const v = verifyCredential(forged);
  assert.equal(v.valid, false);
  assert.match(v.reason, /hash-mismatch/);
});

test('verify: expiry is enforced', () => {
  const r = issueCredential({ programId: 'melek-press-pass', recipientName: 'Temp', now: AT, expiresInDays: 30 });
  assert.equal(r.credential.expiresAt, '2026-09-27');
  assert.equal(verifyCredential(r.credential, { now: new Date('2026-09-01') }).valid, true);
  const late = verifyCredential(r.credential, { now: new Date('2026-10-01') });
  assert.equal(late.valid, false);
  assert.equal(late.reason, 'expired');
});

test('verify: non-credential input soft-fails', () => {
  assert.equal(verifyCredential(null).valid, false);
  assert.equal(verifyCredential({}).valid, false);
});

test('Open Badges 3.0 export has the required VC/OB fields', () => {
  const r = issueCredential({ programId: 'angelic-ai-foundations', recipientName: 'Sam', now: AT });
  const ob = toOpenBadge(r.credential);
  assert.ok(ob['@context'].some((u) => /openbadges|imsglobal/.test(u)));
  assert.deepEqual(ob.type, ['VerifiableCredential', 'OpenBadgeCredential']);
  assert.equal(ob.credentialSubject.name, 'Sam');
  assert.equal(ob.credentialSubject.achievement.name, 'Angelic AI — Foundations');
  assert.equal(ob.credentialStatus.hash, r.credential.verification.hash);
});

test('registry: issue -> get -> verify -> list', () => {
  const reg = createRegistry();
  const r = reg.issue({ programId: 'ordination-minister', recipientName: 'Rev. A', now: AT });
  assert.equal(r.ok, true);
  assert.equal(reg.count(), 1);
  assert.equal(reg.get(r.credential.id).recipient.name, 'Rev. A');
  assert.equal(reg.verify(r.credential.id).valid, true);
  assert.equal(reg.list({ type: 'ministerial' }).length, 1);
  assert.equal(reg.list({ track: 'crypto' }).length, 0);
  assert.equal(reg.verify('MELEK-MIN-DOESNOTEXIST').valid, false);
});

test('programsInTrack groups by track', () => {
  assert.ok(programsInTrack('ministry').length >= 2);
  assert.ok(programsInTrack('press').length >= 1);
});
