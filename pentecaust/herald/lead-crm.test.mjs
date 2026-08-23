// pentecaust/herald/lead-crm.test.mjs — offline, deterministic tests for the Herald lead-gen / CRM module.
// No network, no disk: an in-memory Map is the injected storage, a counter is the injected clock, and an
// explicit allow-list is the injected validateEmail so verification is fully deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeadCrm, STAGES, defaultValidateEmail } from './lead-crm.mjs';

// Deterministic factory: fresh Map, monotonic clock (1,2,3,...), and a validator that only "verifies"
// addresses in a known set — so email-shape never depends on real MX/network.
function make(validEmails) {
  let t = 0;
  const clock = () => ++t;
  const validateEmail = validEmails
    ? (e) => validEmails.has(String(e || '').trim().toLowerCase())
    : undefined;
  return createLeadCrm({ storage: new Map(), now: clock, validateEmail });
}

test('addLead normalizes + records createdAt + starts in new', () => {
  const crm = make();
  const r = crm.addLead({ email: '  Alice@Example.COM ', name: 'Alice', phone: '555', source: 'web' });
  assert.equal(r.ok, true);
  assert.equal(r.lead.email, 'alice@example.com');
  assert.equal(r.lead.stage, 'new');
  assert.equal(r.lead.createdAt, 1);
  assert.equal(r.lead.emailValid, false);
});

test('addLead dedupes by normalized email', () => {
  const crm = make();
  assert.equal(crm.addLead({ email: 'bob@x.com' }).ok, true);
  const dup = crm.addLead({ email: 'BOB@x.com' });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /duplicate/);
  assert.equal(crm.listLeads().length, 1);
});

test('addLead soft-fails on bad input (never throws)', () => {
  const crm = make();
  assert.equal(crm.addLead({}).ok, false);
  assert.equal(crm.addLead({ email: '' }).ok, false);
  assert.equal(crm.addLead().ok, false);
  assert.equal(crm.addLead(null).ok, false);
});

test('markVerified sets flags; verifiedCount counts ONLY email-verified leads', () => {
  const crm = make(new Set(['a@x.com', 'b@x.com']));
  crm.addLead({ email: 'a@x.com' });
  crm.addLead({ email: 'b@x.com' });
  crm.addLead({ email: 'c@x.com' });

  // a: derive emailValid from validator (in set → true)
  assert.equal(crm.markVerified('a@x.com').lead.emailValid, true);
  // b: explicit emailValid true, phone true
  assert.equal(crm.markVerified('b@x.com', { emailValid: true, phoneValid: true }).lead.phoneValid, true);
  // c: phone valid but email NOT valid — must NOT be counted
  assert.equal(crm.markVerified('c@x.com', { emailValid: false, phoneValid: true }).lead.emailValid, false);

  assert.equal(crm.verifiedCount(), 2); // only a + b
});

test('markVerified soft-fails on unknown lead', () => {
  const crm = make();
  const r = crm.markVerified('nobody@x.com', { emailValid: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /no such lead/);
});

test('moveStage accepts valid stages across the fixed pipeline', () => {
  const crm = make();
  crm.addLead({ email: 'd@x.com' });
  for (const s of STAGES) {
    assert.equal(crm.moveStage('d@x.com', s).ok, true);
    assert.equal(crm.getLead('d@x.com').stage, s);
  }
});

test('moveStage rejects an unknown stage (soft-fail, no mutation)', () => {
  const crm = make();
  crm.addLead({ email: 'e@x.com' });
  const r = crm.moveStage('e@x.com', 'archived');
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown stage/);
  assert.equal(crm.getLead('e@x.com').stage, 'new'); // unchanged
});

test('pipeline() returns zero-filled counts per stage', () => {
  const crm = make();
  crm.addLead({ email: 'p1@x.com' });
  crm.addLead({ email: 'p2@x.com' });
  crm.addLead({ email: 'p3@x.com' });
  crm.moveStage('p2@x.com', 'contacted');
  crm.moveStage('p3@x.com', 'won');

  const p = crm.pipeline();
  assert.equal(p.new, 1);
  assert.equal(p.contacted, 1);
  assert.equal(p.won, 1);
  assert.equal(p.replied, 0);
  assert.equal(p.qualified, 0);
  assert.equal(p.lost, 0);
});

test('listLeads filters by stage and by verifiedOnly', () => {
  const crm = make(new Set(['v1@x.com']));
  crm.addLead({ email: 'v1@x.com' });
  crm.addLead({ email: 'v2@x.com' });
  crm.markVerified('v1@x.com');            // emailValid true
  crm.moveStage('v2@x.com', 'contacted');

  assert.equal(crm.listLeads({ stage: 'new' }).length, 1);
  assert.equal(crm.listLeads({ stage: 'contacted' }).length, 1);
  assert.equal(crm.listLeads({ verifiedOnly: true }).length, 1);
  assert.equal(crm.listLeads({ verifiedOnly: true })[0].email, 'v1@x.com');
  assert.equal(crm.listLeads().length, 2);
});

test('exportRows returns flat, sync-ready rows in stable shape', () => {
  const crm = make(new Set(['x@x.com']));
  crm.addLead({ email: 'x@x.com', name: 'X', phone: '1', source: 'ref' });
  crm.markVerified('x@x.com', { emailValid: true, phoneValid: true });
  const rows = crm.exportRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'createdAt', 'email', 'emailValid', 'name', 'phone', 'phoneValid', 'source', 'stage', 'updatedAt',
  ].sort());
  assert.equal(rows[0].emailValid, true);
  assert.equal(rows[0].phoneValid, true);
  assert.equal(typeof rows[0].createdAt, 'number');
});

test('defaultValidateEmail is deterministic + offline', () => {
  assert.equal(defaultValidateEmail('good@example.com'), true);
  assert.equal(defaultValidateEmail('no-at-sign'), false);
  assert.equal(defaultValidateEmail('a@b'), false);
  assert.equal(defaultValidateEmail(''), false);
  assert.equal(defaultValidateEmail(null), false);
});

// ── handler routes (called directly, no live server) ──────────────────────────────────────────────────
function fakeRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(s) { this.body = s || ''; },
  };
}

test('handler GET /health returns ok JSON', async () => {
  const crm = make();
  crm.addLead({ email: 'h@x.com' });
  const res = fakeRes();
  await crm.handler({ method: 'GET', url: '/health' }, res);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.leads, 1);
});

test('handler POST /api/lead adds via parsed body', async () => {
  const crm = make();
  const res = fakeRes();
  await crm.handler({ method: 'POST', url: '/api/lead', body: { email: 'new@x.com', name: 'N' } }, res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.equal(crm.getLead('new@x.com').name, 'N');
});

test('handler POST /api/lead soft-fails on bad body', async () => {
  const crm = make();
  const res = fakeRes();
  await crm.handler({ method: 'POST', url: '/api/lead', body: { email: '' } }, res);
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('handler GET /api/leads honors ?stage= and ?verifiedOnly=', async () => {
  const crm = make(new Set(['q1@x.com']));
  crm.addLead({ email: 'q1@x.com' });
  crm.addLead({ email: 'q2@x.com' });
  crm.markVerified('q1@x.com');
  crm.moveStage('q2@x.com', 'contacted');

  let res = fakeRes();
  await crm.handler({ method: 'GET', url: '/api/leads?stage=contacted' }, res);
  assert.equal(JSON.parse(res.body).count, 1);

  res = fakeRes();
  await crm.handler({ method: 'GET', url: '/api/leads?verifiedOnly=1' }, res);
  const j = JSON.parse(res.body);
  assert.equal(j.count, 1);
  assert.equal(j.leads[0].email, 'q1@x.com');
});

test('handler returns 404 for unknown route', async () => {
  const crm = make();
  const res = fakeRes();
  await crm.handler({ method: 'GET', url: '/nope' }, res);
  assert.equal(res.code, 404);
  assert.equal(JSON.parse(res.body).ok, false);
});
