// bounce-webhook.test.mjs — OFFLINE. Real provider payload shapes as literals; suppress/count injected.
import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeWebhook, applyEvents, createBounceWebhook, ACTIONABLE } from './bounce-webhook.mjs';

// ── the payloads that actually arrive ────────────────────────────────────────────────────────────
const RESEND_BOUNCE = {
  type: 'email.bounced',
  created_at: '2026-09-08T00:00:00.000Z',
  data: { email_id: 'e1', from: 'ray@x.example', to: ['dead@acme.example'], subject: 'hi',
    bounce: { message: 'mailbox does not exist', subType: 'NoEmail', type: 'Permanent' } },
};
const RESEND_SOFT = {
  type: 'email.bounced',
  data: { to: ['full@acme.example'], bounce: { subType: 'MailboxFull', type: 'Transient' } },
};
const RESEND_COMPLAINT = { type: 'email.complained', data: { to: ['angry@acme.example'] } };
const POSTMARK_BOUNCE = { RecordType: 'Bounce', Email: 'dead@acme.example', Type: 'HardBounce' };
const POSTMARK_SPAM = { RecordType: 'SpamComplaint', Email: 'angry@acme.example' };
const SES_BOUNCE = {
  Type: 'Notification',
  Message: JSON.stringify({
    notificationType: 'Bounce',
    bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'dead@acme.example' }] },
  }),
};
const SES_COMPLAINT = {
  Type: 'Notification',
  Message: JSON.stringify({
    notificationType: 'Complaint',
    complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'angry@acme.example' }] },
  }),
};

test("the shape the endpoint was written against is a shape no provider sends", () => {
  // This is the defect, stated as a test: the old code read body.type and body.email.
  assert.equal(RESEND_BOUNCE.type, 'email.bounced');
  assert.equal(RESEND_BOUNCE.email, undefined, 'Resend has no top-level `email`');
  assert.equal(POSTMARK_BOUNCE.type, undefined, 'Postmark has no lowercase `type`');
  assert.equal(SES_BOUNCE.Message.includes('emailAddress'), true, 'SES buries it in a JSON string');
});

test('Resend: a permanent bounce normalizes and suppresses', () => {
  const { provider, events } = normalizeWebhook(RESEND_BOUNCE);
  assert.equal(provider, 'resend');
  assert.deepEqual(events, [{ type: 'bounce', email: 'dead@acme.example', permanent: true, detail: 'NoEmail' }]);
});

test('Resend: a TRANSIENT bounce is counted and NOT suppressed — a full mailbox is not a dead address', () => {
  const { events } = normalizeWebhook(RESEND_SOFT);
  assert.equal(events[0].permanent, false);
  const sup = []; const cnt = [];
  const r = applyEvents(events, { suppress: (e) => sup.push(e), count: (t) => cnt.push(t) });
  assert.deepEqual(sup, []);
  assert.deepEqual(cnt, ['bounce']);
  assert.equal(r.counts.ignored, 1);
});

test('Resend: a complaint always suppresses', () => {
  const { events } = normalizeWebhook(RESEND_COMPLAINT);
  assert.equal(events[0].type, 'complaint');
  assert.equal(events[0].permanent, true);
});

test('Postmark: capitalised keys normalize', () => {
  assert.deepEqual(normalizeWebhook(POSTMARK_BOUNCE),
    { provider: 'postmark', events: [{ type: 'bounce', email: 'dead@acme.example', permanent: true, detail: 'HardBounce' }] });
  assert.equal(normalizeWebhook(POSTMARK_SPAM).events[0].type, 'complaint');
  assert.equal(normalizeWebhook({ RecordType: 'Bounce', Email: 'x@y.example', Type: 'SoftBounce' }).events[0].permanent, false);
});

test('SES via SNS: the JSON string inside the JSON is read', () => {
  const b = normalizeWebhook(SES_BOUNCE);
  assert.equal(b.provider, 'ses');
  assert.deepEqual(b.events.map((e) => e.email), ['dead@acme.example']);
  assert.equal(b.events[0].permanent, true);
  assert.equal(normalizeWebhook(SES_COMPLAINT).events[0].type, 'complaint');
  // a malformed inner string is no events, never a throw
  assert.deepEqual(normalizeWebhook({ Type: 'Notification', Message: '{{{' }).events, []);
});

test('the flat shape our own tools speak still works', () => {
  assert.deepEqual(normalizeWebhook({ type: 'bounce', email: 'a@b.example' }).events.map((e) => e.email), ['a@b.example']);
  assert.equal(normalizeWebhook({ type: 'complaint', recipient: 'a@b.example' }).events[0].type, 'complaint');
});

test('deliveries and opens are not actionable, and unknown payloads produce nothing', () => {
  assert.deepEqual(normalizeWebhook({ type: 'email.delivered', data: { to: ['a@b.example'] } }).events, []);
  assert.deepEqual(normalizeWebhook({ type: 'email.opened', data: { to: ['a@b.example'] } }).events, []);
  assert.deepEqual(normalizeWebhook({ hello: 'world' }), { provider: 'unknown', events: [] });
  assert.deepEqual(normalizeWebhook(null).events, []);
  assert.deepEqual(normalizeWebhook('a string').events, []);
  assert.ok(ACTIONABLE.has('bounce') && ACTIONABLE.has('complaint') && !ACTIONABLE.has('delivered'));
});

test('several recipients in one event each get their own row', () => {
  const { events } = normalizeWebhook({ type: 'email.bounced', data: { to: ['a@x.example', 'b@x.example'], bounce: { type: 'Permanent' } } });
  assert.deepEqual(events.map((e) => e.email), ['a@x.example', 'b@x.example']);
});

test('a throwing suppress does not lose the rest of the batch', () => {
  const seen = [];
  const r = applyEvents(
    [{ type: 'bounce', email: 'a@x.example', permanent: true }, { type: 'bounce', email: 'b@x.example', permanent: true }],
    { suppress: (e) => { seen.push(e); if (e === 'a@x.example') throw new Error('store down'); } },
  );
  assert.deepEqual(seen, ['a@x.example', 'b@x.example']);
  assert.equal(r.counts.suppressed, 2);
});

// ── the HTTP surface ─────────────────────────────────────────────────────────────────────────────
function cap() {
  const o = { code: 0, body: '' };
  return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o };
}
const post = (body, headers = {}) => ({ method: 'POST', url: '/api/webhook', headers, body });

test('unconfigured, the endpoint fails CLOSED — nobody suppresses our list without the secret', async () => {
  const wh = createBounceWebhook({ secret: '' });
  const { res, o } = cap();
  await wh.handler(post(RESEND_BOUNCE), res);
  assert.equal(o.code, 401);
});

test('a wrong or absent secret is 401; the right one is accepted', async () => {
  const sup = [];
  const wh = createBounceWebhook({ secret: 's3cret', suppress: (e) => sup.push(e) });
  let c = cap(); await wh.handler(post(RESEND_BOUNCE, { 'x-webhook-secret': 'nope' }), c.res);
  assert.equal(c.o.code, 401);
  c = cap(); await wh.handler(post(RESEND_BOUNCE), c.res);
  assert.equal(c.o.code, 401);
  c = cap(); await wh.handler(post(RESEND_BOUNCE, { 'x-webhook-secret': 's3cret' }), c.res);
  assert.equal(c.o.code, 200);
  assert.deepEqual(sup, ['dead@acme.example']);
  assert.equal(JSON.parse(c.o.body).provider, 'resend');
});

test('a GET says what it accepts and admits Gmail bounces are not covered', async () => {
  const { res, o } = cap();
  await createBounceWebhook({ secret: 'x' }).handler({ method: 'GET', url: '/', headers: {} }, res);
  const j = JSON.parse(o.body);
  assert.ok(j.accepts.some((a) => /resend/.test(a)));
  assert.ok(j.accepts.some((a) => /ses/.test(a)));
  assert.match(j.note, /Gmail does not POST webhooks/);
});
