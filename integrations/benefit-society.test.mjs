// integrations/benefit-society.test.mjs — offline, deterministic, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeStore, foundSociety, addMember, setRole, setStanding, recordContribution,
  openClaim, reviewClaim, decideClaim, payoutIntent, poolBalance, memberHistory,
  getSociety, listSocieties, listClaims, ROLES, STANDINGS, BENEFIT_MODELS, LICENSING_NOTE,
  __setClock, esc, handler,
} from './benefit-society.mjs';

__setClock(() => 1_700_000_000_000);

const found = (over = {}) => {
  const store = makeStore();
  const f = foundSociety({ founder: 'hathor', name: 'Aid Society',
    charter: { purpose: 'mutual aid', cadence: 'monthly', quorum: 2 },
    dues: { amount: 1000, currency: 'USD', period: 'monthly' }, ...over }, store);
  return { store, sid: f.society.id, f };
};

test('foundSociety: founder becomes owner; defaults to records-only model', () => {
  const { f } = found();
  assert.equal(f.ok, true);
  assert.equal(f.society.model, 'records-only');
  const owner = f.society.members.find((m) => m.id === 'hathor');
  assert.equal(owner.role, 'owner');
  assert.equal(owner.standing, 'good');
});

test('foundSociety: bad input soft-fails, never throws', () => {
  const store = makeStore();
  assert.equal(foundSociety({ founder: '', name: 'X' }, store).ok, false);
  assert.equal(foundSociety({ founder: 'a', name: 'x' }, store).ok, false); // name too short
});

test('foundSociety: unknown model falls back to records-only (never auto-becomes an insurer)', () => {
  const { f } = found({ model: 'insurer-please' });
  assert.equal(f.society.model, 'records-only');
});

test('addMember: enrolls; probation when charter has a waiting period', () => {
  const { store, sid } = found({ charter: { purpose: 'p', quorum: 1, waitingDays: 30 } });
  const r = addMember({ societyId: sid, member: 'alice' }, store);
  assert.equal(r.status, 'joined');
  assert.equal(r.standing, 'probation');
  assert.equal(addMember({ societyId: sid, member: 'alice' }, store).status, 'already-member');
  assert.equal(addMember({ societyId: sid, member: 'has a space' }, store).ok, false);
});

test('setRole: owner promotes; rank rules enforced; ownership transfer demotes old owner', () => {
  const { store, sid } = found();
  addMember({ societyId: sid, member: 'alice' }, store);
  addMember({ societyId: sid, member: 'bob' }, store);
  assert.equal(setRole({ societyId: sid, actor: 'hathor', member: 'alice', role: 'admin' }, store).ok, true);
  // a member cannot set roles
  assert.equal(setRole({ societyId: sid, actor: 'bob', member: 'alice', role: 'member' }, store).ok, false);
  // cannot grant a role at/above your own
  assert.equal(setRole({ societyId: sid, actor: 'alice', member: 'bob', role: 'admin' }, store).ok, false);
  // transfer ownership
  const t = setRole({ societyId: sid, actor: 'hathor', member: 'alice', role: 'owner' }, store);
  assert.equal(t.ok, true);
  const s = getSociety({ societyId: sid }, store).society;
  assert.equal(s.members.find((m) => m.id === 'alice').role, 'owner');
  assert.equal(s.members.find((m) => m.id === 'hathor').role, 'admin');
});

test('recordContribution: steward+ only; records IN entry; clears arrears on dues', () => {
  const { store, sid } = found();
  addMember({ societyId: sid, member: 'alice' }, store);
  // a plain member cannot record contributions
  addMember({ societyId: sid, member: 'mallory' }, store);
  assert.equal(recordContribution({ societyId: sid, actor: 'mallory', member: 'alice', amount: 1000 }, store).ok, false);
  setStanding({ societyId: sid, actor: 'hathor', member: 'alice', standing: 'arrears' }, store);
  const r = recordContribution({ societyId: sid, actor: 'hathor', member: 'alice', amount: 1000, kind: 'dues' }, store);
  assert.equal(r.ok, true);
  assert.equal(r.entry.direction, 'in');
  assert.equal(r.entry.custodiedByUs, undefined); // ledger entries carry no custody
  assert.equal(getSociety({ societyId: sid }, store).society.members.find((m) => m.id === 'alice').standing, 'good');
});

test('recordContribution: rejects non-positive / non-integer amounts', () => {
  const { store, sid } = found();
  addMember({ societyId: sid, member: 'alice' }, store);
  assert.equal(recordContribution({ societyId: sid, actor: 'hathor', member: 'alice', amount: 0 }, store).ok, false);
  assert.equal(recordContribution({ societyId: sid, actor: 'hathor', member: 'alice', amount: -5 }, store).ok, false);
});

test('openClaim: only a member in good standing can open', () => {
  const { store, sid } = found();
  addMember({ societyId: sid, member: 'alice' }, store);
  setStanding({ societyId: sid, actor: 'hathor', member: 'alice', standing: 'arrears' }, store);
  assert.equal(openClaim({ societyId: sid, member: 'alice', kind: 'sickness', amount: 500 }, store).ok, false);
  setStanding({ societyId: sid, actor: 'hathor', member: 'alice', standing: 'good' }, store);
  const c = openClaim({ societyId: sid, member: 'alice', kind: 'sickness', amount: 500 }, store);
  assert.equal(c.ok, true);
  assert.equal(c.claim.status, 'open');
  assert.equal(openClaim({ societyId: sid, member: 'ghost', amount: 100 }, store).ok, false);
});

test('claim workflow: quorum + majority approve → recorded benefit + unsigned intent, no custody', () => {
  const { store, sid } = found(); // quorum 2
  for (const m of ['alice', 'bob', 'carol']) addMember({ societyId: sid, member: m }, store);
  setRole({ societyId: sid, actor: 'hathor', member: 'alice', role: 'admin' }, store);
  setRole({ societyId: sid, actor: 'hathor', member: 'bob', role: 'steward' }, store);
  recordContribution({ societyId: sid, actor: 'hathor', member: 'carol', amount: 1000, kind: 'dues' }, store);
  const c = openClaim({ societyId: sid, member: 'carol', kind: 'sickness', amount: 500 }, store);
  // decide before quorum → refused
  assert.equal(decideClaim({ societyId: sid, actor: 'alice', claimId: c.claim.id }, store).ok, false);
  reviewClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id, vote: 'approve' }, store);
  reviewClaim({ societyId: sid, actor: 'bob', claimId: c.claim.id, vote: 'approve' }, store);
  const d = decideClaim({ societyId: sid, actor: 'alice', claimId: c.claim.id }, store);
  assert.equal(d.ok, true);
  assert.equal(d.decision, 'approved');
  assert.equal(d.entry.direction, 'out');
  assert.equal(d.entry.settled, false);
  assert.equal(d.intent.unsigned, true);
  assert.equal(d.intent.signed, false);
  assert.equal(d.intent.custodiedByUs, false);
  assert.equal(d.intent.to, 'carol');
  assert.equal(d.intent.amount, '500');
  assert.ok(d.intent.note.includes('not an insurer'));
});

test('claim workflow: majority deny → denied, no ledger out-entry', () => {
  const { store, sid } = found();
  for (const m of ['alice', 'bob', 'carol']) addMember({ societyId: sid, member: m }, store);
  setRole({ societyId: sid, actor: 'hathor', member: 'alice', role: 'admin' }, store);
  const c = openClaim({ societyId: sid, member: 'carol', kind: 'hardship', amount: 500 }, store);
  reviewClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id, vote: 'deny' }, store);
  reviewClaim({ societyId: sid, actor: 'alice', claimId: c.claim.id, vote: 'deny' }, store);
  const d = decideClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id }, store);
  assert.equal(d.decision, 'denied');
  assert.equal(poolBalance({ societyId: sid }, store).benefits, 0);
});

test('reviewClaim: claimant cannot review own claim; only steward+ can review', () => {
  const { store, sid } = found();
  addMember({ societyId: sid, member: 'carol' }, store);
  setRole({ societyId: sid, actor: 'hathor', member: 'carol', role: 'steward' }, store);
  const c = openClaim({ societyId: sid, member: 'carol', kind: 'sickness', amount: 100 }, store);
  assert.equal(reviewClaim({ societyId: sid, actor: 'carol', claimId: c.claim.id, vote: 'approve' }, store).ok, false);
  addMember({ societyId: sid, member: 'dave' }, store); // plain member
  assert.equal(reviewClaim({ societyId: sid, actor: 'dave', claimId: c.claim.id, vote: 'approve' }, store).ok, false);
});

test('decideClaim: partial approval amount recorded and reflected in pool', () => {
  const { store, sid } = found({ charter: { purpose: 'p', quorum: 1 } });
  addMember({ societyId: sid, member: 'carol' }, store);
  recordContribution({ societyId: sid, actor: 'hathor', member: 'carol', amount: 2000, kind: 'dues' }, store);
  const c = openClaim({ societyId: sid, member: 'carol', kind: 'sickness', amount: 1500 }, store);
  reviewClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id, vote: 'approve' }, store);
  const d = decideClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id, amountApproved: 800 }, store);
  assert.equal(d.claim.amountApproved, 800);
  const pool = poolBalance({ societyId: sid }, store);
  assert.equal(pool.contributions, 2000);
  assert.equal(pool.benefits, 800);
  assert.equal(pool.net, 1200);
  assert.equal(pool.custodiedByUs, false);
});

test('payoutIntent: rebuildable only for an approved claim', () => {
  const { store, sid } = found({ charter: { purpose: 'p', quorum: 1 } });
  addMember({ societyId: sid, member: 'carol' }, store);
  const c = openClaim({ societyId: sid, member: 'carol', kind: 'sickness', amount: 300 }, store);
  assert.equal(payoutIntent({ societyId: sid, claimId: c.claim.id }, store).ok, false); // still open
  reviewClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id, vote: 'approve' }, store);
  decideClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id }, store);
  const p = payoutIntent({ societyId: sid, claimId: c.claim.id }, store);
  assert.equal(p.ok, true);
  assert.equal(p.intent.custodiedByUs, false);
});

test('memberHistory: totals contributions and benefits per member', () => {
  const { store, sid } = found({ charter: { purpose: 'p', quorum: 1 } });
  addMember({ societyId: sid, member: 'carol' }, store);
  recordContribution({ societyId: sid, actor: 'hathor', member: 'carol', amount: 1000, kind: 'dues' }, store);
  const c = openClaim({ societyId: sid, member: 'carol', kind: 'sickness', amount: 400 }, store);
  reviewClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id, vote: 'approve' }, store);
  decideClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id }, store);
  const h = memberHistory({ societyId: sid, member: 'carol' }, store);
  assert.equal(h.contributed, 1000);
  assert.equal(h.received, 400);
  assert.equal(h.claims.length, 1);
});

test('listSocieties / listClaims / getSociety reads', () => {
  const { store, sid } = found({ charter: { purpose: 'p', quorum: 1 } });
  addMember({ societyId: sid, member: 'carol' }, store);
  openClaim({ societyId: sid, member: 'carol', kind: 'sickness', amount: 100 }, store);
  assert.equal(listSocieties(store).length, 1);
  assert.equal(listClaims({ societyId: sid, status: 'open' }, store).length, 1);
  assert.equal(getSociety({ societyId: 'nope' }, store).ok, false);
});

test('regulatory metadata is exported and honest', () => {
  assert.equal(BENEFIT_MODELS['records-only'].custodies, false);
  assert.equal(BENEFIT_MODELS['records-only'].buildable, true);
  assert.equal(BENEFIT_MODELS.insurer.custodies, true);
  assert.equal(BENEFIT_MODELS.insurer.buildable, false);
  assert.equal(BENEFIT_MODELS.transmitter.buildable, false);
  assert.ok(/insurer/i.test(LICENSING_NOTE));
  assert.ok(/money transmitter/i.test(LICENSING_NOTE));
  assert.equal(ROLES.owner > ROLES.member, true);
  assert.ok(STANDINGS.good);
});

test('esc escapes html', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
});

test('handler returns JSON documenting the no-custody boundary', () => {
  let body = '', code = 0; const headers = {};
  const res = { statusCode: 0, setHeader: (k, v) => { headers[k] = v; }, end: (s) => { body = s; code = res.statusCode; } };
  handler({}, res);
  const j = JSON.parse(body);
  assert.equal(code, 200);
  assert.equal(j.service, 'benefit-society');
  assert.ok(j.weTakeNoMoney);
  assert.ok(j.models.some((m) => m.id === 'insurer' && m.buildable === false));
});
