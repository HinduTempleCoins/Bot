// send-gate.test.mjs — OFFLINE. Pure functions, no transport, no fetch, no disk.
import { test } from 'node:test';
import assert from 'node:assert';
import { gateSend, suppressionFrom, unsubscribeMailto, SUPPRESSED_STAGES, handler } from './send-gate.mjs';

const OK = { postalAddress: '1 Test St, Dallas TX 75201', mailboxEmail: 'ray@gmail.com', senderName: 'Ryan' };

test('an address that opted out in ONE campaign is suppressed in EVERY campaign', () => {
  // The live route's own check is `lead.stage === 'unsubscribed'` on the row being sent. The same
  // person, same address, imported into a second campaign, has a second row at stage 'new'.
  const campaigns = [
    { id: 'a', leads: [{ email: 'x@e.example', stage: 'unsubscribed' }] },
    { id: 'b', leads: [{ email: 'X@E.example', stage: 'new' }] },
  ];
  const g = gateSend({ ...OK, recipient: 'x@e.example', campaigns });
  assert.equal(g.ok, false);
  assert.match(g.blockers.join(' '), /suppressed/);
});

test('bounced and complained suppress too, not just unsubscribed', () => {
  for (const stage of ['bounced', 'complained', 'unsubscribed']) {
    const campaigns = [{ id: 'a', leads: [{ email: 'x@e.example', stage }] }];
    assert.equal(gateSend({ ...OK, recipient: 'x@e.example', campaigns }).ok, false, stage);
    assert.ok(SUPPRESSED_STAGES.has(stage));
  }
});

test('a lead nobody has suppressed passes', () => {
  const campaigns = [{ id: 'a', leads: [{ email: 'other@e.example', stage: 'unsubscribed' }] }];
  const g = gateSend({ ...OK, recipient: 'fresh@e.example', campaigns });
  assert.equal(g.ok, true, g.blockers.join('; '));
  assert.equal(g.checked.suppressed, 1);
});

test('no postal address, no send — the gate fails CLOSED', () => {
  const g = gateSend({ mailboxEmail: 'ray@gmail.com', postalAddress: '', recipient: 'a@e.example' });
  assert.equal(g.ok, false);
  assert.match(g.blockers.join(' '), /postal address/i);
});

test('no mailbox means no opt-out mechanism, and that blocks as well', () => {
  const g = gateSend({ postalAddress: '1 Test St', mailboxEmail: '', recipient: 'a@e.example' });
  assert.equal(g.ok, false);
  assert.match(g.blockers.join(' '), /unsubscribe/i);
  assert.equal(g.checked.unsubscribeMechanism, 'none');
});

test('the opt-out advertised is the one that actually ships — a reply-to, not an invented URL', () => {
  assert.equal(unsubscribeMailto('ray@gmail.com'), 'mailto:ray@gmail.com?subject=unsubscribe');
  assert.equal(unsubscribeMailto(''), '');
  const g = gateSend({ ...OK, recipient: 'a@e.example' });
  assert.match(g.headers['List-Unsubscribe'], /mailto:ray@gmail\.com/);
  assert.equal(g.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('a burning domain stops the send — 2% bounces is the STOP threshold', () => {
  const g = gateSend({ ...OK, recipient: 'a@e.example', sent: 1000, bounces: 25 });
  assert.equal(g.ok, false);
  assert.match(g.blockers.join(' '), /deliverability STOP/);
  assert.equal(g.health.status, 'stop');
  // and 1% is not a stop — the gate throttles rather than refusing
  assert.equal(gateSend({ ...OK, recipient: 'a@e.example', sent: 1000, bounces: 10 }).ok, true);
});

test('0.3% complaints stops it too', () => {
  const g = gateSend({ ...OK, recipient: 'a@e.example', sent: 1000, complaints: 3 });
  assert.equal(g.ok, false);
  assert.match(g.blockers.join(' '), /complaints/);
});

test('voice and SMS need recorded consent — TCPA, and email is unaffected', () => {
  assert.equal(gateSend({ ...OK, channel: 'sms', recipient: 'a@e.example' }).ok, false);
  assert.equal(gateSend({ ...OK, channel: 'ai-voice', recipient: 'a@e.example' }).ok, false);
  assert.equal(gateSend({ ...OK, channel: 'sms', recipient: 'a@e.example', hasRecordedConsent: true }).ok, true);
});

test('the refusal is legible — what was checked comes back with it', () => {
  const g = gateSend({ ...OK, recipient: 'a@e.example' });
  assert.equal(g.checked.postalAddressSet, true);
  assert.equal(g.checked.region, 'US');
  assert.equal(g.checked.deliverability, 'ok');
  assert.match(g.checked.unsubscribeMechanism, /RFC 2369/);
});

test('suppressionFrom takes extra addresses and lowercases everything', () => {
  const s = suppressionFrom([{ leads: [{ email: 'A@B.example', stage: 'unsubscribed' }] }], ['C@D.example']);
  assert.ok(s.has('a@b.example'));
  assert.ok(s.has('c@d.example'));
  assert.equal(s.size, 2);
});

test('garbage in never throws', () => {
  assert.equal(typeof gateSend().ok, 'boolean');
  assert.equal(suppressionFrom(null, null).size, 0);
  assert.equal(suppressionFrom([null, { leads: null }, { leads: [null] }]).size, 0);
});

test('handler names what it enforces and says it fails closed', () => {
  let body = '';
  handler({ method: 'GET', url: '/' }, { setHeader() {}, end(b) { body = b; } });
  const jj = JSON.parse(body);
  assert.equal(jj.failsClosed, true);
  assert.ok(jj.enforces.some((e) => /EVERY campaign/.test(e)));
});
