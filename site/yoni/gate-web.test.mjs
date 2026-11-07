// site/yoni/gate-web.test.mjs — OFFLINE. That no secret means no gate opens, that a click can only
// ever mint `attested`, that the token survives without the in-memory store, and that nothing about
// the visitor is kept beyond an opaque id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCookies, subjectFor, newSubject, levelFor, satisfies, attest, clickCanSatisfy,
  setCookies, secretFrom, SUBJECT_COOKIE, GATE_COOKIE, ATTEST_CEILING,
} from './gate-web.mjs';
import { __reset } from '../../integrations/agegate/model.mjs';

const ENV = { YONI_GATE_SECRET: 'test-secret-not-a-real-one' };
const reqWith = (cookie) => ({ headers: cookie ? { cookie } : {} });

test('cookies parse, and a torn pair is skipped rather than throwing', () => {
  const c = parseCookies('a=1; b=two; broken; =nokey; c=%2Fslash%2F');
  assert.equal(c.a, '1');
  assert.equal(c.b, 'two');
  assert.equal(c.c, '/slash/');
  assert.equal('broken' in c, false);
  assert.equal(parseCookies(undefined).a, undefined);
  assert.deepEqual(parseCookies(''), {});
});

test('a subject is opaque hex and is reused once set', () => {
  const fresh = subjectFor(reqWith(''));
  assert.equal(fresh.minted, true);
  assert.match(fresh.subject, /^[a-f0-9]{32}$/);
  const again = subjectFor(reqWith(`${SUBJECT_COOKIE}=${fresh.subject}`));
  assert.equal(again.minted, false);
  assert.equal(again.subject, fresh.subject);
});

test('a junk subject cookie is replaced, not trusted', () => {
  for (const junk of ['', 'short', '../../etc/passwd', '<script>', 'ZZZZ']) {
    const r = subjectFor(reqWith(`${SUBJECT_COOKIE}=${junk}`));
    assert.equal(r.minted, true, `rejected: ${junk}`);
    assert.match(r.subject, /^[a-f0-9]{32}$/);
  }
});

test('no signing secret means nothing opens', async () => {
  __reset();
  assert.equal(secretFrom({}), '');
  const out = await attest('abc', { env: {} });
  assert.equal(out.ok, false);
  assert.match(out.reason, /no signing secret/);
  assert.equal(levelFor(reqWith(`${GATE_COOKIE}=anything`), { env: {} }), 'none');
});

test('an attestation mints a token that verifies back as attested', async () => {
  __reset();
  const out = await attest('subject-one', { env: ENV });
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.level, ATTEST_CEILING);
  assert.ok(out.maxAgeSec > 0);
  assert.equal(levelFor(reqWith(`${GATE_COOKIE}=${encodeURIComponent(out.token)}`), { env: ENV }), 'attested');
});

test('the token works with the record store wiped — it is the record', async () => {
  __reset();
  const out = await attest('subject-two', { env: ENV });
  assert.equal(out.ok, true, out.reason);
  __reset();  // a dispatcher restart
  assert.equal(levelFor(reqWith(`${GATE_COOKIE}=${encodeURIComponent(out.token)}`), { env: ENV }), 'attested');
});

test('a tampered, foreign or malformed token is worth nothing', async () => {
  __reset();
  const out = await attest('subject-three', { env: ENV });
  const good = out.token;
  const bad = [
    `${good}x`, good.replace(/.$/, 'A'), 'ag1.abc.def', 'nonsense', '',
  ];
  for (const t of bad) {
    assert.equal(levelFor(reqWith(`${GATE_COOKIE}=${encodeURIComponent(t)}`), { env: ENV }), 'none', `rejected: ${t.slice(0, 12)}`);
  }
  // signed with a different secret
  const other = await attest('subject-three', { env: { YONI_GATE_SECRET: 'a-different-secret' } });
  assert.equal(levelFor(reqWith(`${GATE_COOKIE}=${encodeURIComponent(other.token)}`), { env: ENV }), 'none');
});

test('an expired token stops counting', async () => {
  __reset();
  let t = 1_000_000;
  const out = await attest('subject-four', { env: ENV, now: () => t });
  assert.equal(out.ok, true, out.reason);
  const cookie = `${GATE_COOKIE}=${encodeURIComponent(out.token)}`;
  assert.equal(levelFor(reqWith(cookie), { env: ENV, now: () => t + 1000 }), 'attested');
  t += 25 * 3600 * 1000;  // attested TTL is 24h
  assert.equal(levelFor(reqWith(cookie), { env: ENV, now: () => t }), 'none');
});

test('a click can satisfy the open and attested surfaces and no others', () => {
  assert.equal(clickCanSatisfy('wiki'), true);
  assert.equal(clickCanSatisfy('preview'), true);
  assert.equal(clickCanSatisfy('apply'), true);
  for (const s of ['gallery', 'video', 'live', 'upload', 'payout']) {
    assert.equal(clickCanSatisfy(s), false, `${s} must not be clickable-open`);
  }
});

test('an attested visitor reaches apply but never gallery, video or live', async () => {
  __reset();
  const out = await attest('subject-five', { env: ENV });
  const req = reqWith(`${GATE_COOKIE}=${encodeURIComponent(out.token)}`);
  assert.equal(satisfies(req, 'apply', { env: ENV }).ok, true);
  assert.equal(satisfies(req, 'wiki', { env: ENV }).ok, true);
  for (const s of ['gallery', 'video', 'live', 'upload', 'payout']) {
    const r = satisfies(req, s, { env: ENV });
    assert.equal(r.ok, false, `${s} opened on an attestation`);
    assert.equal(r.have, 'attested');
  }
});

test('cookies are httpOnly, SameSite and Secure by default', () => {
  const out = setCookies({ subject: 'abc', minted: true, token: 'ag1.x.y', maxAgeSec: 60 });
  assert.equal(out.length, 2);
  for (const c of out) {
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Secure/);
    assert.match(c, /Path=\//);
  }
  // an existing subject is not re-set
  assert.equal(setCookies({ subject: 'abc', minted: false, token: 't', maxAgeSec: 5 }).length, 1);
  // only for a plain-http check of the box
  assert.doesNotMatch(setCookies({ token: 't', maxAgeSec: 5, secure: false })[0], /Secure/);
});

test('a fresh subject is unique per call', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) seen.add(newSubject());
  assert.equal(seen.size, 50);
});
