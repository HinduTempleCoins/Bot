// transport.test.mjs — which road a gated send leaves by. Offline: fetch and the mailbox store are injected.
//
// The tests that matter are the REFUSALS. A verified ESP domain is not permission to cold-send from it,
// and the CAN-SPAM elements must hold on the new road exactly as they hold on the old one — a second
// transport is the classic place for a legal requirement to quietly not apply.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TRANSPORTS, chooseTransport, sendVia, espFrom, __setFetch } from './transport.mjs';

// A mailbox store on disk, since mailbox.mjs reads a file. `opts.file` threads through.
function storeWith(email) {
  const dir = mkdtempSync(join(tmpdir(), 'herald-transport-'));
  const file = join(dir, 'mailboxes.json');
  const rec = email ? { alice: { email, provider: 'google', refreshToken: 'r', accessToken: 'a', expiresAt: Date.now() + 3600e3 } } : {};
  writeFileSync(file, JSON.stringify({ mailboxes: rec }));
  return file;
}
const ESP = { resendKey: 'rs_test', from: 'ryan@getmelek-outreach.com', postalAddress: '1 Temple Rd, McKinney TX 75069' };
const okFetch = () => __setFetch(async () => ({ status: 200, json: async () => ({ id: 'esp-1' }) }));

test('both roads are named and the list is closed', () => {
  assert.deepEqual(TRANSPORTS, ['gmail', 'esp']);
});

// --- the refusal that matters most -------------------------------------------

test('a VERIFIED identity domain is still refused as a cold-send From', () => {
  // melek.salon is verified at the ESP with sending enabled. That is not permission.
  const c = chooseTransport('alice', { ...ESP, from: 'hello@melek.salon', file: storeWith(null) });
  assert.equal(c.transport, null);
  assert.ok(c.blockers.some((b) => /identity domain/.test(b)), c.blockers.join('; '));
});

test('a SUBDOMAIN of an identity domain is refused too — reputation is inherited', () => {
  const c = chooseTransport('alice', { ...ESP, from: 'hi@outreach.melek.salon', file: storeWith(null) });
  assert.equal(c.transport, null);
  assert.ok(c.blockers.some((b) => /identity domain/.test(b)));
});

test('an ESP key with no sending address does not silently pick one', () => {
  const c = chooseTransport('alice', { resendKey: 'rs_test', from: '', file: storeWith(null) });
  assert.equal(c.transport, null);
  assert.ok(c.blockers.some((b) => /HERALD_SEND_FROM/.test(b)));
});

// --- selection ---------------------------------------------------------------

test('a dedicated sending domain plus a key selects the ESP road', () => {
  const c = chooseTransport('alice', { ...ESP, file: storeWith(null) });
  assert.equal(c.transport, 'esp');
  assert.equal(c.from, ESP.from);
});

test('with no ESP, a connected mailbox still works — and the fallback states the 7-day problem', () => {
  const c = chooseTransport('alice', { file: storeWith('alice@gmail.com'), from: '', resendKey: '', postmarkToken: '' });
  assert.equal(c.transport, 'gmail');
  assert.match(c.reason, /7-day|refresh-token/i);
  assert.match(c.reason, /bounces are invisible/i);
});

test('the ESP is preferred over Gmail when both are available', () => {
  const c = chooseTransport('alice', { ...ESP, file: storeWith('alice@gmail.com') });
  assert.equal(c.transport, 'esp');
});

test('HERALD_TRANSPORT=gmail is honoured over an available ESP', () => {
  const c = chooseTransport('alice', { ...ESP, transport: 'gmail', file: storeWith('alice@gmail.com') });
  assert.equal(c.transport, 'gmail');
});

test('an explicit transport that is not usable FAILS rather than silently taking the other road', () => {
  const c = chooseTransport('alice', { transport: 'esp', file: storeWith('alice@gmail.com'), resendKey: '', postmarkToken: '' });
  assert.equal(c.transport, null, 'must not fall back to gmail when esp was named');
});

test('no ESP and no mailbox yields no transport, with reasons', () => {
  const c = chooseTransport('alice', { file: storeWith(null), resendKey: '', postmarkToken: '', from: '' });
  assert.equal(c.transport, null);
  assert.ok(c.blockers.length >= 2);
});

// --- CAN-SPAM holds on the new road ------------------------------------------

test('the ESP road FAILS CLOSED with no postal address', async () => {
  okFetch();
  const r = await sendVia('alice', { to: 'x@example.com', subject: 's', body: 'b' },
    { ...ESP, postalAddress: '', file: storeWith(null) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /7704\(a\)\(5\)/);
});

test('the ESP road refuses a body still carrying a merge field', async () => {
  okFetch();
  const r = await sendVia('alice', { to: 'x@example.com', subject: 's', body: 'Hi {{first_name}}' },
    { ...ESP, file: storeWith(null) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /\{\{first_name\}\}/);
});

test('a successful ESP send carries the postal address and the one-click unsubscribe header', async () => {
  let seen = null;
  __setFetch(async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { status: 200, json: async () => ({ id: 'esp-1' }) }; });
  const r = await sendVia('alice', { to: 'x@example.com', subject: 's', body: 'hello' }, { ...ESP, file: storeWith(null) });
  assert.equal(r.ok, true);
  assert.equal(r.transport, 'esp');
  assert.match(seen.url, /api\.resend\.com/);
  assert.equal(seen.body.from, ESP.from);
  assert.ok(seen.body.text.includes('McKinney'), 'postal address missing from the body');
  assert.equal(seen.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(seen.body.headers['List-Unsubscribe'], /mailto:/);
});

test('an ESP error is a refusal with a reason, never a throw', async () => {
  __setFetch(async () => ({ status: 422, json: async () => ({ message: 'nope' }) }));
  const r = await sendVia('alice', { to: 'x@example.com', subject: 's', body: 'b' }, { ...ESP, file: storeWith(null) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /422/);
});

test('a thrown transport is caught', async () => {
  __setFetch(async () => { throw new Error('socket'); });
  const r = await sendVia('alice', { to: 'x@example.com', subject: 's', body: 'b' }, { ...ESP, file: storeWith(null) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /esp send error/);
});

test('sendVia with no usable transport reports the blockers instead of throwing', async () => {
  const r = await sendVia('alice', { to: 'x@example.com' }, { file: storeWith(null), resendKey: '', postmarkToken: '', from: '' });
  assert.equal(r.ok, false);
  assert.equal(r.transport, null);
  assert.ok(Array.isArray(r.blockers));
});

test('nothing throws on junk', async () => {
  for (const a of [null, undefined, '', 'alice']) {
    for (const m of [null, {}, { to: 'x@example.com' }]) {
      await assert.doesNotReject(() => sendVia(a, m, { file: storeWith(null) }));
      assert.doesNotThrow(() => chooseTransport(a, { file: storeWith(null) }));
    }
  }
});

test('espFrom reads the option ahead of the environment', () => {
  assert.equal(espFrom({ from: 'a@b.com' }), 'a@b.com');
});
