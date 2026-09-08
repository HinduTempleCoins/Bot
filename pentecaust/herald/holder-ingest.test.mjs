// holder-ingest.test.mjs — OFFLINE. No fetch, no transport, no disk. `addLead` is always injected.
//
// The tests below are written so that REMOVING the attribution filter fails them. That is deliberate:
// the filter existed and was tested for weeks while the loader that built the live campaign ignored
// it, and a test of the filter in isolation would not have caught that.
import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeRow, gradeHolders, holderLeads, ingestHolders, handler } from './holder-ingest.mjs';

// A support desk that eighteen holders linked to, a role mailbox, an affiliate footer, and two people
// whose addresses are genuinely theirs.
const ROWS = [
  { hive_account: 'alice', email: 'alice@alicemakes.example', website: 'https://alicemakes.example' },
  { hive_account: 'bob', email: 'bob.hive@gmail.com', website: 'https://bobsblog.example', email_found_on: 'https://bobsblog.example/contact' },
  { hive_account: 'carol', email: 'contact@read.cash', website: 'https://read.cash/@carol' },
  { hive_account: 'dave', email: 'contact@read.cash', website: 'https://read.cash/@dave' },
  { hive_account: 'erin', email: 'noreply@erin.example', website: 'https://erin.example' },
  { hive_account: 'frank', email: 'only@amzn.to', website: 'https://frankwrites.example' },
  // Two holders whose declared site is the SAME service page. Both grade own-domain on their own,
  // and that is exactly the shape that mails one desk twice.
  { hive_account: 'gina', email: 'hello@shared-desk.example', website: 'https://shared-desk.example' },
  { hive_account: 'hank', email: 'hello@shared-desk.example', website: 'https://shared-desk.example' },
];

test("a platform's support desk never becomes a lead, however many holders linked to it", () => {
  const { leads, refused } = holderLeads(ROWS);
  assert.ok(!leads.some((l) => l.email === 'contact@read.cash'),
    'contact@read.cash reached the CRM — this is the Spaminator bug, restored');
  const why = refused.filter((r) => /read\.cash/.test(r.why || ''));
  assert.ok(why.length >= 1, 'the refusal has to say why, or nobody can audit it');
});

test('one inbox listed for several different holders is a service, not a person', () => {
  const { leads, refused } = holderLeads(ROWS);
  assert.ok(!leads.some((l) => l.email === 'hello@shared-desk.example'));
  assert.ok(refused.some((r) => r.verdict === 'shared'));
});

test('a role mailbox never becomes a lead', () => {
  const { leads } = holderLeads(ROWS);
  assert.ok(!leads.some((l) => l.email === 'noreply@erin.example'));
});

test("the holder's own domain, and freemail he published on his own site, both survive", () => {
  const { leads } = holderLeads(ROWS);
  const emails = leads.map((l) => l.email).sort();
  assert.deepEqual(emails, ['alice@alicemakes.example', 'bob.hive@gmail.com']);
  assert.equal(leads.find((l) => l.email === 'alice@alicemakes.example').verdict, 'own-domain');
  assert.equal(leads.find((l) => l.email === 'bob.hive@gmail.com').verdict, 'published-on-site');
});

test('the provenance column is load-bearing — without it the freemail address is refused', () => {
  const withProvenance = holderLeads(ROWS).counts.leads;
  const stripped = holderLeads(ROWS.map(({ email_found_on, ...r }) => r)).counts.leads;
  assert.equal(withProvenance, 2);
  assert.equal(stripped, 1, 'dropping email_found_on must cost the published-on-site row, not pass it silently');
});

test('every lead carries where it came from and how to reach it', () => {
  const { leads } = holderLeads(ROWS);
  for (const l of leads) {
    assert.equal(l.source, 'holders');
    assert.equal(l.route, 'email');
    assert.ok(l.signal && l.signal.length > 10, 'the reason to write has to be in the lead');
  }
});

test('nothing is written without an injected addLead', () => {
  const r = ingestHolders('c1', ROWS);
  assert.equal(r.dryRun, true);
  assert.equal(r.added, 0);
  assert.match(r.reason, /dry run/);
});

test('ingest only ever offers addLead the addresses that passed', () => {
  const seen = [];
  const r = ingestHolders('c1', ROWS, { addLead: (cid, lead) => { seen.push([cid, lead.email]); return { ok: true }; } });
  assert.equal(r.added, 2);
  assert.deepEqual(seen.map((s) => s[1]).sort(), ['alice@alicemakes.example', 'bob.hive@gmail.com']);
  assert.ok(seen.every((s) => s[0] === 'c1'));
});

test('a throwing addLead is a rejected row, not a crashed ingest', () => {
  const r = ingestHolders('c1', ROWS, { addLead: () => { throw new Error('disk full'); } });
  assert.equal(r.added, 0);
  assert.equal(r.rejected.length, 2);
  assert.match(r.rejected[0].reason, /disk full/);
});

test('counts add up and are reported honestly', () => {
  const g = gradeHolders(ROWS);
  assert.equal(g.counts.keep + g.counts.drop + g.counts.shared, g.counts.offered);
  assert.equal(g.counts.offered, ROWS.length);
});

test('rows without an address are not counted as offered', () => {
  const g = gradeHolders([...ROWS, { hive_account: 'ivan', website: 'https://ivan.example' }]);
  assert.equal(g.counts.offered, ROWS.length);
});

test('column aliases across the holder exports all normalize', () => {
  const a = normalizeRow({ hive_account: 'x', email: 'A@B.example', email_found_on: 'https://b.example/c', reach_score: '9' });
  assert.equal(a.account, 'x');
  assert.equal(a.email, 'a@b.example');
  assert.equal(a.foundOn, 'https://b.example/c');
  assert.equal(a.reach, 9);
  assert.equal(normalizeRow({ account: 'y', address: 'y@y.example' }).account, 'y');
});

test('garbage in is an empty list, never a throw', () => {
  assert.equal(holderLeads(null).counts.leads, 0);
  assert.equal(holderLeads([null, undefined, 5, 'x']).counts.leads, 0);
});

test('handler answers with the verdicts it enforces', async () => {
  let body = '';
  await handler({ method: 'GET', url: '/' }, {
    setHeader() {}, end(b) { body = b; },
  });
  const j = JSON.parse(body);
  assert.ok(j.contactable.includes('own-domain'));
  assert.ok(j.refused.includes('shared'));
});
