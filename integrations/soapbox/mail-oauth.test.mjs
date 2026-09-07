import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS, provider, planBatches, tokenStatus, buildMessage,
  send, sendCampaign, handler,
} from './mail-oauth.mjs';

const GOOD = { accessToken: 'x', expiresAt: Date.now() + 60000 };

test('every provider declares the four things a caller needs', () => {
  for (const p of Object.values(PROVIDERS)) {
    assert.ok(p.id && p.label, 'id/label');
    assert.ok(['api', 'smtp'].includes(p.kind), `kind: ${p.id}`);
    assert.ok(Number.isFinite(p.consecutive) && p.consecutive > 0, `consecutive: ${p.id}`);
    assert.ok(p.dailyCap && p.dailyCap.consumer > 0, `dailyCap: ${p.id}`);
    assert.ok(p.note, `every provider must carry its gotcha: ${p.id}`);
  }
});

test('provider lookup is case-insensitive and null for unknown', () => {
  assert.equal(provider('GMAIL').id, 'gmail');
  assert.equal(provider('nope'), null);
});

test('yahoo carries the ceiling that was observed in practice, not the documented one', () => {
  assert.ok(PROVIDERS.yahoo.consecutive <= 12,
    'the connection was dropped around a dozen sends — the batch must be smaller than that');
  assert.match(PROVIDERS.yahoo.note, /OBSERVED IN PRACTICE/);
});

test('planBatches splits to the provider ceiling and flags SMTP reconnects', () => {
  const rs = Array.from({ length: 65 }, (_, i) => `m${i}@example.gov`);
  const plan = planBatches(rs, 'yahoo');
  assert.ok(plan.ok);
  assert.equal(plan.total, 65);
  assert.equal(plan.batchSize, PROVIDERS.yahoo.consecutive);
  assert.equal(plan.batches.length, Math.ceil(65 / PROVIDERS.yahoo.consecutive));
  assert.equal(plan.reconnectBetweenBatches, true);
  assert.equal(plan.batches.flat().length, 65, 'no recipient may be dropped by batching');
});

test('planBatches dedupes so nobody is emailed twice', () => {
  const plan = planBatches(['a@x.gov', 'a@x.gov', 'b@x.gov'], 'gmail');
  assert.equal(plan.total, 2);
});

test('planBatches warns BEFORE a run that would exceed the daily cap', () => {
  const rs = Array.from({ length: 600 }, (_, i) => `m${i}@example.gov`);
  const plan = planBatches(rs, 'gmail', { accountType: 'consumer' });
  assert.equal(plan.overCap, true);
  assert.match(plan.warning, /exceeds the consumer daily cap/);
  const ws = planBatches(rs, 'gmail', { accountType: 'workspace' });
  assert.equal(ws.overCap, false);
});

test('planBatches refuses an unknown provider', () => {
  const plan = planBatches(['a@x.gov'], 'carrier-pigeon');
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /unknown provider/);
});

test('tokenStatus explains WHY a token is unusable', () => {
  assert.equal(tokenStatus(null).reason, 'no token');
  assert.equal(tokenStatus({}).reason, 'no access token');
  assert.match(tokenStatus({ accessToken: 'x', expiresAt: 1 }).reason, /re-consent required/);
  const r = tokenStatus({ accessToken: 'x', expiresAt: 1, refreshToken: 'r' });
  assert.equal(r.refreshable, true);
  assert.match(r.reason, /refresh first/);
  assert.ok(tokenStatus(GOOD).ok);
});

test('tokenStatus catches a missing scope', () => {
  const t = { accessToken: 'x', grantedScopes: ['a'], requiredScopes: ['a', 'b'] };
  assert.match(tokenStatus(t).reason, /missing scope: b/);
});

test('buildMessage refuses a message that would be lost in an agency mailbox', () => {
  const r = buildMessage({ from: 'a@b.com', to: 'c@d.gov', body: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /subject is required/.test(e)));
});

test('buildMessage requires a from, because the request must be attributable', () => {
  const r = buildMessage({ to: 'c@d.gov', subject: 's', body: 'b' });
  assert.ok(r.errors.some((e) => /attributable to the requester/.test(e)));
});

test('buildMessage drops attachments with no filename rather than sending junk', () => {
  const r = buildMessage({ from: 'a@b.com', to: 'c@d.gov', subject: 's', body: 'b',
    attachments: [{ filename: 'ok.pdf' }, { }, null] });
  assert.equal(r.message.attachments.length, 1);
});

test('⭐ send does NOTHING without an injected transport', async () => {
  const r = await send({ providerId: 'gmail', token: GOOD, message: { to: 'a@b.gov' } });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'transport');
  assert.match(r.reason, /never sends by default/);
});

test('send refuses before the network when the token is bad', async () => {
  let called = false;
  const r = await send({ providerId: 'gmail', token: { accessToken: '' },
    message: { to: 'a@b.gov' }, transport: async () => { called = true; return { ok: true }; } });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'token');
  assert.equal(called, false, 'a bad token must not reach the transport');
});

test('send returns a result and classifies a dropped connection as retryable', async () => {
  const ok = await send({ providerId: 'gmail', token: GOOD, message: { to: 'a@b.gov' },
    transport: async () => ({ ok: true, id: 'abc' }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.id, 'abc');

  const drop = await send({ providerId: 'yahoo', token: GOOD, message: { to: 'a@b.gov' },
    transport: async () => { throw new Error('Connection unexpectedly closed'); } });
  assert.equal(drop.ok, false);
  assert.equal(drop.retryable, true);

  const hard = await send({ providerId: 'yahoo', token: GOOD, message: { to: 'a@b.gov' },
    transport: async () => { throw new Error('550 no such user'); } });
  assert.equal(hard.retryable, false, 'a rejected recipient is not worth retrying');
});

test('send never throws, whatever the transport does', async () => {
  const r = await send({ providerId: 'gmail', token: GOOD, message: { to: 'a@b.gov' },
    transport: async () => { throw new Error('boom'); } });
  assert.equal(r.ok, false);
});

test('sendCampaign records every outcome — a campaign log is evidence', async () => {
  const seen = [];
  const res = await sendCampaign({
    providerId: 'yahoo', token: GOOD,
    recipients: ['a@x.gov', 'b@x.gov', 'bad@x.gov'],
    makeMessage: (to) => ({ from: 'me@me.com', to, subject: 'PIA request', body: 'text' }),
    transport: async ({ message }) => {
      seen.push(message.to);
      if (message.to.startsWith('bad')) return { ok: false, reason: '550 rejected' };
      return { ok: true, id: message.to };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.counts.sent, 2);
  assert.equal(res.counts.failed, 1);
  assert.equal(res.failed[0].reason, '550 rejected');
  assert.deepEqual(seen.sort(), ['a@x.gov', 'b@x.gov', 'bad@x.gov']);
});

test('sendCampaign requires makeMessage rather than inventing a message', async () => {
  const res = await sendCampaign({ providerId: 'gmail', token: GOOD, recipients: ['a@x.gov'],
    transport: async () => ({ ok: true }) });
  assert.equal(res.ok, false);
  assert.match(res.reason, /makeMessage/);
});

test('sendCampaign surfaces a malformed message as a per-recipient failure', async () => {
  const res = await sendCampaign({ providerId: 'gmail', token: GOOD, recipients: ['a@x.gov'],
    makeMessage: (to) => ({ to, body: 'no subject, no from' }),
    transport: async () => ({ ok: true }) });
  assert.equal(res.counts.failed, 1);
  assert.equal(res.failed[0].stage, 'message');
});

test('handler explains why sending as the user matters', () => {
  const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  handler({ url: '/' }, res);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.match(j.why, /made BY A PERSON/);
  assert.ok(j.rules.some((r) => /no credential is ever stored/i.test(r)));
  assert.ok(j.providers.length >= 4);
});

test('no provider carries a credential FIELD (the word may appear in guidance prose)', () => {
  // The point is that no VALUE is stored, not that the word is unmentionable — the yahoo note
  // deliberately warns about app passwords, and that guidance is the useful part.
  const CRED_KEYS = ['password', 'secret', 'clientsecret', 'apikey', 'token',
                     'accesstoken', 'refreshtoken', 'credential', 'auth'];
  for (const p of Object.values(PROVIDERS)) {
    for (const k of Object.keys(p)) {
      assert.ok(!CRED_KEYS.includes(k.toLowerCase()),
        `provider ${p.id} must not have a credential field: ${k}`);
    }
    // and no value may look like a secret blob
    for (const [k, v] of Object.entries(p)) {
      if (typeof v !== 'string') continue;
      assert.ok(!/^[A-Za-z0-9_\-]{32,}$/.test(v),
        `provider ${p.id}.${k} looks like a stored secret`);
    }
  }
});
