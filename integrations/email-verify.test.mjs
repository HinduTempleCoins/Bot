// email-verify.test.mjs — offline tests for the signup-help email verification flow.
//
// node --test integrations/email-verify.test.mjs
//
// Every test injects a fake mailer (__setMailer) so Resend is NEVER contacted. The clock is
// injected so expiry is deterministic. We assert the key invariant: the raw token is given ONLY
// to the mailer (in the link) — startVerification's return value never carries it.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startVerification,
  verifyToken,
  isValidEmail,
  __setMailer,
  __resetMailer,
  __setProviders,
  __resetProviders,
  __resetPending,
  __pendingCount,
  cleanupExpired,
} from './email-verify.mjs';

// A controllable clock + a mailer that captures whatever it is handed.
let clock;
let captured;
function makeCapturingMailer() {
  captured = [];
  return async (args) => { captured.push(args); return { ok: true }; };
}

beforeEach(() => {
  __resetProviders();
  __resetPending();
  __resetMailer();
  clock = { t: 1_700_000_000_000 };
  __setProviders({ now: () => clock.t });
});

// ── isValidEmail ────────────────────────────────────────────────────────────────
test('isValidEmail accepts ordinary addresses', () => {
  assert.ok(isValidEmail('user@example.com'));
  assert.ok(isValidEmail('First.Last+tag@sub.domain.co'));
  assert.ok(isValidEmail('  Mixed@Case.COM  ')); // trimmed + lowercased internally
});

test('isValidEmail rejects malformed addresses', () => {
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('nope'), false);
  assert.equal(isValidEmail('no@domain'), false);       // no dotted TLD
  assert.equal(isValidEmail('two@@example.com'), false);
  assert.equal(isValidEmail('spa ce@example.com'), false);
  assert.equal(isValidEmail('@example.com'), false);
  assert.equal(isValidEmail('user@.com'), false);
  assert.equal(isValidEmail('user@example.c'), false);   // 1-char TLD
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail('a@b.com' + 'x'.repeat(260)), false); // over-length
});

// ── startVerification ─────────────────────────────────────────────────────────
test('startVerification rejects a malformed email and never mails', async () => {
  __setMailer(makeCapturingMailer());
  const r = await startVerification('not-an-email', { baseUrl: 'https://signup.example' });
  assert.equal(r.ok, false);
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'invalid-email');
  assert.equal(captured.length, 0);
  assert.equal(__pendingCount(), 0);
});

test('startVerification accepts a good email and mails a link containing a token', async () => {
  __setMailer(makeCapturingMailer());
  const r = await startVerification('user@example.com', { baseUrl: 'https://signup.example/' });
  assert.equal(r.ok, true);
  assert.equal(r.sent, true);
  assert.equal(r.email, 'user@example.com');
  // exactly one mail, to the right address, with a /verify?token= link
  assert.equal(captured.length, 1);
  assert.equal(captured[0].email, 'user@example.com');
  assert.match(captured[0].link, /^https:\/\/signup\.example\/verify\?token=/);
  const url = new URL(captured[0].link);
  const token = url.searchParams.get('token');
  assert.ok(token && token.length > 0, 'link carries a non-empty token');
});

test('startVerification NEVER returns the raw token to the caller (mailer is the only one who sees it)', async () => {
  __setMailer(makeCapturingMailer());
  const r = await startVerification('caller@example.com', { baseUrl: 'https://s.example' });
  const mailedToken = new URL(captured[0].link).searchParams.get('token');
  // the token does not appear anywhere in the caller's return object
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes(mailedToken), 'return value must not contain the token');
  assert.equal(r.token, undefined);
});

test('startVerification soft-fails when the mailer throws (ok:true, sent:false)', async () => {
  __setMailer(async () => { throw new Error('resend down'); });
  const r = await startVerification('user@example.com', { baseUrl: 'https://s.example' });
  assert.equal(r.ok, true);
  assert.equal(r.sent, false);
});

test('startVerification reports sent:false when the mailer returns {ok:false}', async () => {
  __setMailer(async () => ({ ok: false, error: 'no-resend-key' }));
  const r = await startVerification('user@example.com', { baseUrl: 'https://s.example' });
  assert.equal(r.ok, true);
  assert.equal(r.sent, false);
});

// ── verifyToken ─────────────────────────────────────────────────────────────────
test('verifyToken succeeds once then fails on reuse (single-use)', async () => {
  __setMailer(makeCapturingMailer());
  await startVerification('once@example.com', { baseUrl: 'https://s.example' });
  const token = new URL(captured[0].link).searchParams.get('token');

  const first = verifyToken(token, { now: clock.t });
  assert.equal(first.ok, true);
  assert.equal(first.email, 'once@example.com');

  const second = verifyToken(token, { now: clock.t });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'unknown-or-used');
});

test('verifyToken fails for an expired token (advance clock past ttl)', async () => {
  __setMailer(makeCapturingMailer());
  await startVerification('slow@example.com', { ttlMs: 1000, baseUrl: 'https://s.example' });
  const token = new URL(captured[0].link).searchParams.get('token');
  clock.t += 5000; // past the 1s ttl
  const r = verifyToken(token, { now: clock.t });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test('verifyToken fails for an unknown / never-issued token', () => {
  // a structurally plausible but never-minted token
  const r = verifyToken('garbage.notavalidsig', { now: clock.t });
  assert.equal(r.ok, false);
  assert.ok(['bad-signature', 'malformed'].includes(r.reason));
});

test('verifyToken fails for a tampered (bad-signature) token', async () => {
  __setMailer(makeCapturingMailer());
  await startVerification('tamper@example.com', { baseUrl: 'https://s.example' });
  const token = new URL(captured[0].link).searchParams.get('token');
  const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
  const r = verifyToken(tampered, { now: clock.t });
  assert.equal(r.ok, false);
  assert.ok(['bad-signature', 'malformed'].includes(r.reason));
});

test('verifyToken rejects non-string / empty input', () => {
  assert.equal(verifyToken(undefined, { now: clock.t }).ok, false);
  assert.equal(verifyToken('', { now: clock.t }).ok, false);
  assert.equal(verifyToken(12345, { now: clock.t }).ok, false);
});

// ── cleanup ───────────────────────────────────────────────────────────────────
test('cleanupExpired removes expired pending tokens', async () => {
  __setMailer(makeCapturingMailer());
  await startVerification('a@example.com', { ttlMs: 1000, baseUrl: 'https://s.example' });
  await startVerification('b@example.com', { ttlMs: 1_000_000, baseUrl: 'https://s.example' });
  assert.equal(__pendingCount(), 2);
  clock.t += 5000; // a's token is now expired, b's is not
  const removed = cleanupExpired(clock.t);
  assert.equal(removed, 1);
  assert.equal(__pendingCount(), 1);
});
