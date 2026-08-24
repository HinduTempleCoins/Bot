// registry.test.mjs — offline (node --test). No network, temp stores, soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { enroll, getAmbassador, getByCode, listAmbassadors, setStatus, tierFor } from './registry.mjs';

let n = 0;
function tmp() {
  const id = `${process.pid}-${Date.now()}-${n++}`;
  const file = join(tmpdir(), `amb-reg-${id}.json`);
  const qr = { file: join(tmpdir(), `amb-reg-qr-${id}.json`) };
  return {
    opts: { file, qr, karma: 42, tenureDays: 30 },
    cleanup() { for (const p of [file, qr.file]) { try { unlinkSync(p); } catch {} } },
  };
}

test('enroll issues an amb-<account> referral code and stores the row', async () => {
  const { opts, cleanup } = tmp();
  try {
    const r = await enroll('alice', opts);
    assert.equal(r.ok, true);
    assert.equal(r.ambassador.account, 'alice');
    assert.equal(r.ambassador.code, 'amb-alice');
    assert.equal(r.ambassador.status, 'active');
    assert.match(r.ambassador.referralLink, /\/go\/amb-alice$/);
    // persisted + resolvable by account and by code
    assert.equal(getAmbassador('alice', opts).code, 'amb-alice');
    assert.equal(getByCode('amb-alice', opts).account, 'alice');
    assert.equal(listAmbassadors(opts).length, 1);
  } finally { cleanup(); }
});

test('karma floor blocks a below-floor account (fail-closed)', async () => {
  const { opts, cleanup } = tmp();
  try {
    const r = await enroll('lowkarma', { ...opts, karma: 0 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /karma floor/);
    assert.equal(getAmbassador('lowkarma', opts), null);
  } finally { cleanup(); }
});

test('tenure floor blocks a too-new account', async () => {
  const { opts, cleanup } = tmp();
  try {
    const r = await enroll('freshone', { ...opts, tenureDays: 0 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /tenure floor/);
  } finally { cleanup(); }
});

test('enroll is idempotent for an active ambassador', async () => {
  const { opts, cleanup } = tmp();
  try {
    await enroll('alice', opts);
    const again = await enroll('alice', opts);
    assert.equal(again.ok, true);
    assert.equal(again.existing, true);
    assert.equal(listAmbassadors(opts).length, 1);
  } finally { cleanup(); }
});

test('invalid account name is soft-rejected', async () => {
  const { opts, cleanup } = tmp();
  try {
    const r = await enroll('!!bad!!', opts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /valid MELEK account/);
  } finally { cleanup(); }
});

test('setStatus can pause an ambassador', async () => {
  const { opts, cleanup } = tmp();
  try {
    await enroll('alice', opts);
    const r = setStatus('alice', 'paused', opts);
    assert.equal(r.ok, true);
    assert.equal(getAmbassador('alice', opts).status, 'paused');
  } finally { cleanup(); }
});

test('tierFor lifts by earned results, never by hand', () => {
  assert.equal(tierFor({ survivingReferrals: 0 }).tier, 'scout');
  assert.equal(tierFor({ survivingReferrals: 3 }).tier, 'herald');
  assert.equal(tierFor({ survivingReferrals: 12 }).tier, 'envoy');
  assert.ok(tierFor({ survivingReferrals: 12 }).referralMultiplier > tierFor({ survivingReferrals: 0 }).referralMultiplier);
});
