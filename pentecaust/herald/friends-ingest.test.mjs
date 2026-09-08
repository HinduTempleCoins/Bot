// friends-ingest.test.mjs — OFFLINE. Seeds are literals, `addLead` is injected, no file is read.
//
// The load-bearing tests are the removals. local-outreach.mjs removes family, personal history,
// justice-involved and identity-disputed rows from its ranking; if that removal does not survive the
// trip into the CRM it may as well not exist, because the CRM is what has a send button on it.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  friendLeads, ingestFriends, routesFor, bestRoute, firstEmail, addressUsable, ROUTE_ORDER, handler,
} from './friends-ingest.mjs';

const SEEDS = [
  { id: 'jo', name: 'Jo Connector', ring: 1, why: 'DFW connector with a real audience',
    tags: ['boyd-confirmed', 'dfw'], mutualsWithOperator: 164, audience: { followers: 4600, posts: 4500 },
    public: { facebook: 'Jo Connector', website: 'jocafe.example', businessEmail: 'jo@jocafe.example', linkedin: 'https://www.linkedin.com/in/jo/' } },
  { id: 'mom', name: 'A Parent', tags: ['family'], relationship: 'mother',
    public: { facebook: 'A Parent', businessEmail: 'parent@example.com' } },
  { id: 'ex', name: 'An Ex', tags: ['dated'], public: { facebook: 'An Ex', businessEmail: 'ex@example.com' } },
  { id: 'ji', name: 'Rebuilding', tags: ['justice-involved'], public: { facebook: 'Rebuilding', businessEmail: 'r@example.com' } },
  { id: 'dis', name: 'Maybe Two Accounts', identityDisputed: true, disputeNote: 'two profiles, one name',
    public: { facebook: 'Maybe Two Accounts', businessEmail: 'd@example.com' } },
  { id: 'shop', name: 'Print Shop Pat', work: 'owner, a sign and printing shop', tags: ['boyd-confirmed'],
    business: { name: 'Pat Printing' }, public: { facebook: 'Pat', businessEmail: 'pat@patprinting.example' } },
  { id: 'owe', name: 'Owed Reply', tags: ['boyd-confirmed'], openThread: 'he messaged in March and nobody answered',
    public: { facebook: 'Owed Reply', linkedin: 'https://www.linkedin.com/in/owed/' } },
  { id: 'fbonly', name: 'Facebook Only', tags: ['cohort-adjacent'], public: { facebook: 'Facebook Only' } },
];

const names = (xs) => xs.map((l) => l.name).sort();
const all = (r) => [...r.leads, ...r.businesses, ...r.owed];

test('family never becomes a lead in ANY segment', () => {
  const r = friendLeads(SEEDS);
  assert.ok(!all(r).some((l) => l.name === 'A Parent'), 'his mother was in a send queue');
  assert.ok(r.removed.some((x) => x.name === 'A Parent' && x.rule === 'family'));
});

test('personal history and justice-involved are removals, not low scores', () => {
  const r = friendLeads(SEEDS);
  for (const n of ['An Ex', 'Rebuilding']) {
    assert.ok(!all(r).some((l) => l.name === n), `${n} reached the CRM`);
    assert.ok(r.removed.some((x) => x.name === n && x.rule === 'personal'), `${n} not recorded as removed`);
  }
  const ji = r.removed.find((x) => x.name === 'Rebuilding');
  assert.match(ji.why, /rebuilding|type yourself/i, 'the reason has to say why, not just that');
});

test('a disputed identity is excluded and recorded', () => {
  const r = friendLeads(SEEDS);
  assert.ok(!all(r).some((l) => l.name === 'Maybe Two Accounts'));
  assert.ok(r.removed.some((x) => x.rule === 'identity-disputed'));
});

test('a row carrying private data leaves before anything else looks at it', () => {
  const r = friendLeads([...SEEDS, { id: 'bad', name: 'Has A Record', criminalRecord: 'redacted', public: { facebook: 'x' } }]);
  assert.ok(!all(r).some((l) => l.name === 'Has A Record'));
  const rm = r.removed.find((x) => x.name === 'Has A Record');
  assert.equal(rm.rule, 'private-data');
});

test('businesses we know are their own segment, not buried in the ranked list', () => {
  const r = friendLeads(SEEDS);
  assert.ok(r.businesses.some((b) => b.name === 'Print Shop Pat'));
  assert.ok(!r.leads.some((l) => l.name === 'Print Shop Pat'), 'the business row is also in the outreach list');
  assert.equal(r.businesses.find((b) => b.name === 'Print Shop Pat').segment, 'businesses-we-know');
});

test('an unanswered message is a debt, not a lead', () => {
  const r = friendLeads(SEEDS);
  assert.ok(r.owed.some((l) => l.name === 'Owed Reply'));
  assert.ok(!r.leads.some((l) => l.name === 'Owed Reply'));
  // and it is not ingested unless someone asks for it by name
  const seen = [];
  ingestFriends('c1', SEEDS, { addLead: (_c, l) => { seen.push(l.name); return { ok: true }; } });
  assert.ok(!seen.includes('Owed Reply'));
});

test('every lead records its source and its route', () => {
  const r = friendLeads(SEEDS);
  for (const l of all(r)) {
    assert.equal(l.source, 'local-seeds');
    assert.ok(l.segment, 'the segment travels with the row');
  }
  const jo = r.leads.concat(r.businesses).find((l) => l.name === 'Jo Connector');
  assert.equal(jo.route, 'email:jo@jocafe.example');
  assert.equal(jo.email, 'jo@jocafe.example');
});

test('a Facebook name is not a route — the whole point of the research pass was to get off it', () => {
  const r = friendLeads(SEEDS);
  const fb = r.leads.find((l) => l.name === 'Facebook Only');
  assert.ok(fb, 'he is still a lead — he is just not reachable yet');
  assert.equal(fb.route, '');
  assert.match(fb.notes, /no route off Facebook/);
  assert.equal(bestRoute({ public: { facebook: 'x' } }), null);
});

test('routes come back best-first, and Facebook is always last', () => {
  const rs = routesFor({ public: { facebook: 'f', instagram: ['i'], website: 'w.example', businessEmail: 'a@w.example', linkedin: 'l' } });
  assert.deepEqual(rs.map((x) => x.net), ['email', 'website', 'linkedin', 'instagram', 'facebook']);
  assert.equal(ROUTE_ORDER[ROUTE_ORDER.length - 1], 'facebook');
});

test('a free-text contact note yields the personal address, not a bounce', () => {
  // The real row reads: "rachel@agency.example (published on the agency's own team page); agency
  // general: info@Agency.example". Taking the field whole is a guaranteed bounce.
  const e = firstEmail("rachel@agency.example (published on the team page); general: info@Agency.example");
  assert.equal(e, 'rachel@agency.example');
  assert.equal(firstEmail('no address here'), '');
});

test('role mailboxes and platform addresses are refused even from a friend row', () => {
  assert.equal(addressUsable('noreply@x.example').ok, false);
  assert.equal(addressUsable('contact@read.cash').ok, false);
  assert.match(addressUsable('contact@read.cash').why, /platform/);
  assert.equal(addressUsable('not-an-address').ok, false);
  assert.equal(addressUsable('pat@patprinting.example').ok, true);
  // and a lead built from one of those has no email, rather than a bad one
  const r = friendLeads([{ id: 'n', name: 'Role Only', tags: ['boyd-confirmed'], public: { facebook: 'n', businessEmail: 'noreply@n.example' } }]);
  assert.equal(all(r).find((l) => l.name === 'Role Only').email, '');
});

test("the own-domain test is deliberately NOT applied — a real employer address survives", () => {
  // kwhitney@communityimpact.com, on a row with no personal website. The holder list's question ("is
  // this address his?") is the wrong question for someone the operator knows by name.
  const r = friendLeads([{ id: 'k', name: 'Kat W', tags: ['boyd-confirmed'], employer: 'Community Impact',
    public: { facebook: 'k', businessEmail: 'kwhitney@communityimpact.example' } }]);
  assert.equal(all(r).find((l) => l.name === 'Kat W').email, 'kwhitney@communityimpact.example');
});

test('nothing is written without an injected addLead', () => {
  const r = ingestFriends('c1', SEEDS);
  assert.equal(r.dryRun, true);
  assert.equal(r.added, 0);
  assert.match(r.reason, /dry run/);
});

test('ingest writes exactly one segment at a time', () => {
  const seen = [];
  const a = ingestFriends('c1', SEEDS, { addLead: (_c, l) => { seen.push(l.name); return { ok: true }; }, segment: 'businesses' });
  assert.equal(a.segment, 'businesses');
  assert.deepEqual(names(a.businesses), seen.sort());
});

test('a throwing addLead is a rejected row, not a crashed ingest', () => {
  const r = ingestFriends('c1', SEEDS, { addLead: () => { throw new Error('disk full'); } });
  assert.equal(r.added, 0);
  assert.ok(r.rejected.length > 0);
  assert.match(r.rejected[0].reason, /disk full/);
});

test('counts are honest and garbage never throws', () => {
  const r = friendLeads(SEEDS);
  assert.equal(r.counts.offered, SEEDS.length);
  assert.equal(r.counts.outreach + r.counts.businesses + r.counts.owed + r.counts.removed <= SEEDS.length + 1, true);
  assert.equal(friendLeads(null).counts.outreach, 0);
  assert.equal(friendLeads([null, 5, {}]).counts.outreach, 0);
});

test('handler names the removals it honours', () => {
  let body = '';
  handler({ method: 'GET', url: '/' }, { setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.ok(j.removedByRule.some((x) => /justice-involved/.test(x)));
  assert.deepEqual(j.segments, ['outreach', 'businesses', 'owed']);
});
