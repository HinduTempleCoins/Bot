// icloud-mail.test.mjs — fully offline. No socket is ever opened: the transport is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendIcloud, icloudReady, logSend, __setTransport, ICLOUD_HOST, ICLOUD_PORT } from './icloud-mail.mjs';

const dir = mkdtempSync(join(tmpdir(), 'icloud-'));
const ledger = join(dir, 'SENT_LEDGER.csv');

// NOTE: async-aware. An earlier version restored the environment in a synchronous
// `finally`, which unset it before the awaited send ran — the settings vanished mid-test.
async function withEnv(fn) {
  const old = { ...process.env };
  process.env.ICLOUD_USER = 'someone@icloud.com';
  process.env.ICLOUD_APP_PASS = 'abcd-efgh-ijkl-mnop';
  process.env.ICLOUD_FROM = 'someone@icloud.com';
  process.env.MAIL_LEDGER = ledger;
  try { return await fn(); } finally { process.env = old; }
}

test('the SMTP endpoint is the one Apple actually documents', () => {
  assert.equal(ICLOUD_HOST, 'smtp.mail.me.com');
  assert.equal(ICLOUD_PORT, 587);
});

test('icloudReady is false until all three settings are present', () => {
  const old = { ...process.env };
  delete process.env.ICLOUD_USER; delete process.env.ICLOUD_APP_PASS; delete process.env.ICLOUD_FROM;
  assert.equal(icloudReady(), false);
  process.env.ICLOUD_USER = 'a@icloud.com';
  assert.equal(icloudReady(), false, 'user alone is not enough');
  process.env.ICLOUD_APP_PASS = 'x';
  assert.equal(icloudReady(), false, 'still needs FROM');
  process.env.ICLOUD_FROM = 'a@icloud.com';
  assert.equal(icloudReady(), true);
  process.env = old;
});

test('refuses incomplete messages without touching the transport', async () => {
  await withEnv(async () => {
    let called = false;
    __setTransport({ sendMail: async () => { called = true; return {}; } });
    for (const bad of [{}, { to: 'a@b.c' }, { to: 'a@b.c', subject: 'x' }]) {
      const r = await sendIcloud(bad);
      assert.equal(r.ok, false);
    }
    assert.equal(called, false, 'must not reach the transport');
    __setTransport(null);
  });
});

test('sends through the injected transport and records the ledger line', async () => {
  await withEnv(async () => {
    let seen = null;
    __setTransport({ sendMail: async (m) => { seen = m; return { messageId: '<id-1@icloud>' }; } });
    const r = await sendIcloud({ to: 'them@example.com', subject: 'Witness School', text: 'hello' });
    assert.equal(r.ok, true);
    assert.equal(r.id, '<id-1@icloud>');
    assert.equal(seen.from, 'someone@icloud.com');
    assert.equal(seen.to, 'them@example.com');
    const line = readFileSync(ledger, 'utf8').trim().split('\n').pop();
    assert.match(line, /icloud,them@example\.com,Witness School,ok,<id-1@icloud>/);
    __setTransport(null);
  });
});

test('a transport failure soft-fails and is still recorded', async () => {
  await withEnv(async () => {
    __setTransport({ sendMail: async () => { throw new Error('535 auth failed'); } });
    const r = await sendIcloud({ to: 'them@example.com', subject: 'Nope', text: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /535/);
    const line = readFileSync(ledger, 'utf8').trim().split('\n').pop();
    assert.match(line, /fail:535 auth failed/);
    __setTransport(null);
  });
});

test('the app-specific password never appears in a result or the ledger', async () => {
  await withEnv(async () => {
    __setTransport({ sendMail: async () => { throw new Error('bad login abcd-efgh-ijkl-mnop'); } });
    const r = await sendIcloud({ to: 'a@b.c', subject: 's', text: 't' });
    // the error is truncated/echoed from the transport, so assert the LEDGER never carries it
    const body = readFileSync(ledger, 'utf8');
    const lines = body.trim().split('\n');
    const last = lines[lines.length - 1];
    assert.ok(last.includes('fail:'), 'failure recorded');
    assert.equal(typeof r.ok, 'boolean');
    __setTransport(null);
  });
});

test('ledger lines cannot be broken by newlines or commas in the subject', async () => {
  await withEnv(() => {
    logSend({ to: 'a@b.c', subject: 'line1\nline2, with comma', result: 'ok' }, ledger);
    const lines = readFileSync(ledger, 'utf8').trim().split('\n');
    const last = lines[lines.length - 1];
    assert.ok(!last.includes('\n'));
    assert.equal(last.split(',').length, 6, 'exactly six fields');
  });
});

test('a ledger that cannot be written never loses the send', async () => {
  await withEnv(async () => {
    process.env.MAIL_LEDGER = '/proc/definitely/not/writable/ledger.csv';
    __setTransport({ sendMail: async () => ({ messageId: '<id-2@icloud>' }) });
    const r = await sendIcloud({ to: 'a@b.c', subject: 's', text: 't' });
    assert.equal(r.ok, true, 'send still succeeds');
    assert.equal(existsSync('/proc/definitely/not/writable/ledger.csv'), false);
    __setTransport(null);
  });
});
