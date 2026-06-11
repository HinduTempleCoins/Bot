// server.test.mjs — offline tests for the MELEK account-recovery PAGE (site/recovery/server.mjs).
// Fully offline: we drive the exported handler through a mock req/res (no port bound) and call the
// pure renderRecovery() directly. We assert: the explainer + form render, the custody rule holds (no
// private-key collection, plain-language safety copy), every interpolated value is escaped, the
// injected reader seam works, and empty/health behave. node:test + node:assert/strict, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, renderRecovery, recoveryStatus, esc,
  __setReader, RECOVERY_ACCOUNT, RECOVERY_WINDOW_PLAIN,
} from './server.mjs';

function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
const req = (urlPath, method = 'GET') => ({ url: urlPath, method, on() {} });
async function drive(urlPath) {
  const res = mockRes();
  await handler(req(urlPath), res);
  return res;
}

test('home: 200 HTML with the recovery explainer + the start-recovery form', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const b = res.body;
  assert.match(b, /Lost your keys\?/i);
  assert.match(b, /How recovery works/i);
  assert.match(b, /<form/);
  assert.match(b, /name=account/);
  assert.match(b, /name=newOwnerKey/);
  // names the recovery helper account
  assert.match(b, new RegExp(RECOVERY_ACCOUNT));
  // plain-language window, not microseconds
  assert.match(b, /about 30 days/);
  // noindex (recovery is not a marketing page)
  assert.match(b, /noindex/);
});

test('custody rule: never collects a private key; states keys are made on-device + never sent', async () => {
  const res = await drive('/');
  const b = res.body;
  // the page tells the user not to paste a secret/private key
  assert.match(b, /Never[\s\S]*?(secret|private) key/i);
  // it asks only for the PUBLIC key
  assert.match(b, /public/i);
  assert.match(b, /never sent to us/i);
  // no input field is named like a private/secret/wif key
  assert.doesNotMatch(b, /name=(privateKey|wif|secret|ownerKey\b|password)/i);
  // and the placeholder doesn't invite a private key
  assert.doesNotMatch(b, /paste your (private|secret) key/i);
});

test('renderRecovery is pure and escapes ALL interpolation (account + key fields)', () => {
  const evil = '"><script>alert(1)</script>';
  const out = renderRecovery({ account: evil, newOwnerKey: evil });
  assert.doesNotMatch(out, /<script>alert\(1\)<\/script>/);
  assert.match(out, /&lt;script&gt;/);
  // the escaped value lands in the value="" attributes (no raw quote-break)
  assert.match(out, /value="&quot;&gt;&lt;script&gt;/);
});

test('renderRecovery reflects a submitted account + new public key back into the form', () => {
  const out = renderRecovery({ account: 'alice', newOwnerKey: 'TST5abc' });
  assert.match(out, /value="alice"/);
  assert.match(out, /value="TST5abc"/);
});

test('esc() escapes the dangerous HTML metacharacters', () => {
  assert.equal(esc('<a>&"'), '&lt;a&gt;&amp;&quot;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('status block: renders an "open" safe note when a reader reports one', () => {
  const out = renderRecovery({ account: 'bob', status: { open: true, note: 'A request is open.' } });
  assert.match(out, /A request is open\./);
  assert.match(out, /class="safe"/);
});

test('status block escapes a malicious note', () => {
  const out = renderRecovery({ account: 'bob', status: { open: false, note: '<img src=x onerror=1>' } });
  assert.doesNotMatch(out, /<img src=x onerror=1>/);
  assert.match(out, /&lt;img src=x onerror=1&gt;/);
});

test('injected reader seam: recoveryStatus uses it, soft-fails on throw, and clears', async () => {
  __setReader(async (acct) => ({ open: acct === 'open-acct' }));
  assert.deepEqual(await recoveryStatus('open-acct'), { open: true });
  assert.deepEqual(await recoveryStatus('other'), { open: false });

  __setReader(() => { throw new Error('boom'); });
  assert.equal(await recoveryStatus('x'), null); // soft-fail, never throws

  __setReader(null);
  assert.equal(await recoveryStatus('x'), null); // no reader → null
});

test('handler routes the reader output into the page status block', async () => {
  __setReader(async () => ({ open: true, note: 'Open recovery request found.' }));
  const res = await drive('/?account=carol');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Open recovery request found\./);
  __setReader(null);
});

test('health: 200 ok', async () => {
  const res = await drive('/health');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/plain/);
  assert.equal(res.body, 'ok');
});

test('empty / unknown path redirects home; empty account renders the bare explainer', async () => {
  const res = await drive('/nope');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');

  const home = await drive('/');
  // no account submitted → empty value, page still fully renders
  assert.match(home.body, /value=""/);
  assert.match(home.body, /Start recovery/i);
});

test('exports the helper account name + plain window constant', () => {
  assert.equal(RECOVERY_ACCOUNT, 'hathor');
  assert.equal(typeof RECOVERY_WINDOW_PLAIN, 'string');
  assert.ok(RECOVERY_WINDOW_PLAIN.length > 0);
});
