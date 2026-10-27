// integrations/agegate/model.test.mjs — OFFLINE. Levels, per-surface policy, the cost model that
// is the whole reason this exists, tokens, the no-PII boundary, and the hard line between a reveal
// click and actual age assurance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __reset, LEVELS, rank, meets, SURFACE_POLICY, policyFor,
  record, lookup, check, costReport, assertNoPII, TTL_BY_LEVEL,
  mintToken, verifyToken, selfAttestation, runCheck,
  reveal, previewMode, REVEAL_MAX_LEVEL,
} from './model.mjs';

const clock = (start = 1_700_000_000_000) => { let t = start; return { now: () => t, tick: (ms) => { t += ms; } }; };

test('levels are ordered and comparison is by rank, not string equality', () => {
  assert.deepEqual(LEVELS, ['none', 'attested', 'verified', 'id']);
  assert.ok(meets('id', 'verified'));
  assert.ok(meets('verified', 'attested'));
  assert.ok(!meets('attested', 'verified'));
  assert.equal(rank('nonsense'), 0, 'an unknown level is the bottom, never the top');
});

test('an unknown surface FAILS CLOSED at the highest level', () => {
  assert.equal(policyFor('something-new').level, 'id');
  assert.equal(policyFor('wiki').level, 'none');
  assert.equal(policyFor('live').level, 'verified');
});

test('publishing and getting paid need identity, which is the 2257 side not the viewer side', () => {
  assert.equal(SURFACE_POLICY.upload.level, 'id');
  assert.equal(SURFACE_POLICY.payout.level, 'id');
  assert.ok(/2257/.test(SURFACE_POLICY.upload.reason));
});

test('a public surface never asks for anything and never costs anything', () => {
  __reset();
  const c = check('anon', 'wiki');
  assert.equal(c.allowed, true);
  assert.equal(c.paidCheckRequired, false);
});

test('THE COST MODEL: a cached result is the difference between paying per visitor and per person', () => {
  __reset();
  record('alice', 'verified', { provider: 'vendor', providerRef: 'r1' });
  for (let i = 0; i < 50; i += 1) {
    const c = check('alice', 'video');
    assert.equal(c.allowed, true);
    assert.equal(c.paidCheckRequired, false, 'a returning visitor must never trigger a paid check');
  }
  const rep = costReport({ attested: 0, verified: 0.25, id: 1.5 });
  assert.equal(rep.checks.verified, 1, 'one paid check');
  assert.equal(rep.checks.reused, 50, 'fifty free reuses');
  assert.equal(rep.spend, 0.25);
  assert.ok(rep.savedByReuse > 12, `reuse saved ${rep.savedByReuse}`);
});

test('an unverified visitor to a gated surface is told what is needed and that it costs', () => {
  __reset();
  const c = check('stranger', 'live');
  assert.equal(c.allowed, false);
  assert.equal(c.need, 'verified');
  assert.equal(c.have, 'none');
  assert.equal(c.paidCheckRequired, true);
});

test('a stronger result is never downgraded by a weaker later one', () => {
  __reset();
  record('alice', 'id', { provider: 'vendor', providerRef: 'r1' });
  record('alice', 'attested', { provider: 'self' });
  assert.equal(lookup('alice').level, 'id', 'attesting after an ID check must not weaken it');
});

test('verification expires, and the level decides how long', () => {
  __reset();
  const c = clock();
  record('alice', 'attested', {}, c);
  assert.ok(lookup('alice', c));
  c.tick(TTL_BY_LEVEL.attested + 1);
  assert.equal(lookup('alice', c), null, 'an attestation is good for a day, not forever');
  record('bob', 'verified', {}, c);
  c.tick(TTL_BY_LEVEL.attested + 1);
  assert.ok(lookup('bob', c), 'a real check lasts much longer');
});

test('THE NO-PII BOUNDARY is enforced, not documented', () => {
  // separator-stripping is why this must be substring matching: face_scan -> facescan, which
  // equals neither "face" nor "scan". An anchored pattern let it through.
  for (const k of ['dob', 'dateOfBirth', 'id_number', 'documentNumber', 'passport', 'selfie',
    'face_scan', 'facescan', 'photo', 'ID Image', 'biometricTemplate', 'driversLicence', 'ssn']) {
    const g = assertNoPII({ subject: 'alice', [k]: 'x' });
    assert.equal(g.ok, false, `${k} must be refused`);
    assert.match(g.reason, /never the document/);
  }
  // and the legitimate record shape must still pass, or the guard is useless
  assert.equal(assertNoPII({ subject: 'alice', level: 'id', provider: 'v', providerRef: 'abc', at: 1, expiresAt: 2 }).ok, true);
});

test('a token carries the level and expiry and nothing identifying', () => {
  __reset();
  const c = clock();
  const t = mintToken('alice', 'verified', 's3cret', { audience: 'gallery' }, c);
  assert.equal(t.ok, true);
  const v = verifyToken(t.token, 's3cret', { audience: 'gallery' }, c);
  assert.equal(v.ok, true);
  assert.equal(v.level, 'verified');
  assert.ok(!/dob|birth/i.test(t.token));
});

test('a token cannot be forged, replayed past expiry, or used on the wrong surface', () => {
  const c = clock();
  const t = mintToken('alice', 'verified', 'secret-a', { audience: 'gallery' }, c);
  assert.equal(verifyToken(t.token, 'secret-b', {}, c).ok, false, 'wrong key');
  assert.equal(verifyToken(t.token.slice(0, -2) + 'xx', 'secret-a', {}, c).ok, false, 'tampered signature');
  assert.equal(verifyToken(t.token, 'secret-a', { audience: 'live' }, c).ok, false, 'wrong audience');
  assert.equal(verifyToken('garbage', 'secret-a', {}, c).ok, false);
  const c2 = clock();
  const t2 = mintToken('alice', 'attested', 'secret-a', {}, c2);
  c2.tick(TTL_BY_LEVEL.attested + 1);
  assert.equal(verifyToken(t2.token, 'secret-a', {}, c2).reason, 'expired');
});

test('self-attestation works and is only ever the bottom rung', async () => {
  __reset();
  const yes = await runCheck(selfAttestation, 'alice', { attested: true });
  assert.equal(yes.ok, true);
  assert.equal(yes.record.level, 'attested');
  const no = await runCheck(selfAttestation, 'bob', { attested: false });
  assert.equal(no.ok, false);
  assert.equal(check('alice', 'gallery').allowed, false, 'attesting does not open a gated surface');
});

test('a provider that throws is declined, not crashed through', async () => {
  __reset();
  const broken = { id: 'broken', level: 'verified', check: async () => { throw new Error('vendor down'); } };
  const r = await runCheck(broken, 'alice', {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /vendor down/);
  assert.equal(lookup('alice'), null, 'a failed check records nothing');
});

// ── click-to-reveal ─────────────────────────────────────────────────────────────────────────────

test('A REVEAL CLICK IS CONSENT TO VIEW, NEVER AGE ASSURANCE', () => {
  __reset();
  const blocked = reveal('alice', 'gallery');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /consent to view, not age assurance/);
  assert.equal(blocked.need, 'verified');

  const allowed = reveal('alice', 'preview');
  assert.equal(allowed.ok, true);
  assert.equal(allowed.consentToView, true);
  assert.equal(allowed.ageAssured, false, 'it must say so explicitly');
  assert.equal(allowed.record.level, REVEAL_MAX_LEVEL);
  assert.equal(REVEAL_MAX_LEVEL, 'attested');
});

test('revealing everywhere still cannot unlock a gated surface', () => {
  __reset();
  reveal('alice', 'preview');
  reveal('alice', 'wiki');
  for (const s of ['gallery', 'video', 'live', 'upload', 'payout']) {
    assert.equal(check('alice', s).allowed, false, `${s} must stay closed`);
  }
});

test('a CSS blur over the original is reported as cosmetic, not a gate', () => {
  assert.equal(previewMode({}).gates, false);
  assert.match(previewMode({}).note, /already in the page/);
  assert.equal(previewMode({ serverSideDerivative: true }).gates, false, 'a derivative alone is not enough if the original is still reachable');
  const real = previewMode({ serverSideDerivative: true, originalWithheld: true });
  assert.equal(real.gates, true);
  assert.equal(real.mode, 'gated');
});
