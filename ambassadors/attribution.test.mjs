// attribution.test.mjs — the /go ↔ invite-tree bridge, offline (node --test). Temp stores, soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { enroll } from './registry.mjs';
import { attributeSignup, markSurvival, payableReferrals, referralsFor, survivingCount, funnelFor } from './attribution.mjs';

let n = 0;
async function setup() {
  const id = `${process.pid}-${Date.now()}-${n++}`;
  const regFile = join(tmpdir(), `amb-attr-reg-${id}.json`);
  const refFile = join(tmpdir(), `amb-attr-ref-${id}.json`);
  const qr = { file: join(tmpdir(), `amb-attr-qr-${id}.json`) };
  // an active ambassador 'alice' with code amb-alice
  const e = await enroll('alice', { file: regFile, qr, karma: 42, tenureDays: 30 });
  assert.equal(e.ok, true);
  // opts passed to attribution: its own referral store + which registry to read + which qr store
  const opts = { file: refFile, registryFile: regFile, qr };
  return {
    opts,
    cleanup() { for (const p of [regFile, refFile, qr.file]) { try { unlinkSync(p); } catch {} } },
  };
}

test('attributeSignup maps a /go ref code → the owning ambassador', async () => {
  const { opts, cleanup } = await setup();
  try {
    const r = await attributeSignup({ newAccount: 'bob-jones', ref: 'amb-alice' }, opts);
    assert.equal(r.ok, true);
    assert.equal(r.attributed, true);
    assert.equal(r.referral.ambassador, 'alice');
    assert.equal(r.referral.via, 'go');
    assert.equal(r.referral.payable, false); // pending survival
    assert.equal(referralsFor('alice', opts).length, 1);
  } finally { cleanup(); }
});

test('survival + sybil gating: only survivors that clear the sybil gate become payable', async () => {
  const { opts, cleanup } = await setup();
  try {
    await attributeSignup({ newAccount: 'bob-jones', ref: 'amb-alice' }, opts);
    // not yet survived → not payable
    assert.equal(payableReferrals('alice', opts).length, 0);
    // survives (verified + first action) AND clears sybil (score >= min) → payable
    const s = markSurvival('bob-jones', { verifiedEmail: true, firstAction: true }, { ...opts, scoreOf: () => 100, minScore: 1 });
    assert.equal(s.ok, true);
    assert.equal(s.referral.survived, true);
    assert.equal(s.referral.sybilOk, true);
    assert.equal(s.referral.payable, true);
    assert.equal(payableReferrals('alice', opts).length, 1);
    assert.equal(survivingCount('alice', opts), 1);
  } finally { cleanup(); }
});

test('sybil gate drops a survivor with a failing humanity score (fail-closed)', async () => {
  const { opts, cleanup } = await setup();
  try {
    await attributeSignup({ newAccount: 'sybil-acct', ref: 'amb-alice' }, opts);
    const s = markSurvival('sybil-acct', { verifiedEmail: true, firstAction: true }, { ...opts, scoreOf: () => 0, minScore: 1 });
    assert.equal(s.referral.survived, true);
    assert.equal(s.referral.sybilOk, false);
    assert.equal(s.referral.payable, false);
    assert.equal(payableReferrals('alice', opts).length, 0);
  } finally { cleanup(); }
});

test('a signup with no email/first-action never pays (reward on survival, not signup)', async () => {
  const { opts, cleanup } = await setup();
  try {
    await attributeSignup({ newAccount: 'idle-acct', ref: 'amb-alice' }, opts);
    const s = markSurvival('idle-acct', { verifiedEmail: true, firstAction: false }, { ...opts, scoreOf: () => 100 });
    assert.equal(s.referral.survived, false);
    assert.equal(s.referral.payable, false);
  } finally { cleanup(); }
});

test('self-referral is dropped', async () => {
  const { opts, cleanup } = await setup();
  try {
    const r = await attributeSignup({ newAccount: 'alice', ref: 'amb-alice' }, opts);
    assert.equal(r.attributed, false);
    assert.match(r.reason, /self-referral/);
  } finally { cleanup(); }
});

test('de-dupe on account: many clicks from one prospect = one referral', async () => {
  const { opts, cleanup } = await setup();
  try {
    const first = await attributeSignup({ newAccount: 'bob-jones', ref: 'amb-alice' }, opts);
    assert.equal(first.attributed, true);
    const dup = await attributeSignup({ newAccount: 'bob-jones', ref: 'amb-alice' }, opts);
    assert.equal(dup.attributed, false);
    assert.match(dup.reason, /already attributed/);
    assert.equal(referralsFor('alice', opts).length, 1);
  } finally { cleanup(); }
});

test('an unknown ref code attributes to no one', async () => {
  const { opts, cleanup } = await setup();
  try {
    const r = await attributeSignup({ newAccount: 'carol-x', ref: 'amb-nobody' }, opts);
    assert.equal(r.attributed, false);
    assert.equal(referralsFor('alice', opts).length, 0);
  } finally { cleanup(); }
});

test('funnelFor reports clicks → signups → survivors', async () => {
  const { opts, cleanup } = await setup();
  try {
    await attributeSignup({ newAccount: 'bob-jones', ref: 'amb-alice' }, opts);
    markSurvival('bob-jones', { verifiedEmail: true, firstAction: true }, { ...opts, scoreOf: () => 100 });
    const f = funnelFor('alice', 'amb-alice', opts);
    assert.equal(f.signups, 1);
    assert.equal(f.survivors, 1);
    assert.equal(f.payable, 1);
    assert.equal(typeof f.clicks, 'number'); // 0 here (no scans logged) — pre-account rail is separate
  } finally { cleanup(); }
});
