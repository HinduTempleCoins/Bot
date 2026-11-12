// melek-dao.test.mjs — DAO membership earned by finishing the Hathor Instructions.
// OFFLINE: in-memory roll, injected chain activity, injected broadcaster + delegator. No keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daoSummary, membershipFor, enroll, roll, isMember, forgetMember,
  MEMBERSHIP_STAGES, DAO_FUND_PCT, daoInflowPerHour, DAO_MEMBER_MP, DAO_ACCOUNT,
} from './melek-dao.mjs';

function memfs() {
  let blob = null;
  return { read: () => blob, write: (_p, s) => { blob = s; } };
}
const FILE = './.melek-dao-test.json';     // never written: memfs ignores the path
const ctx = (fs, extra = {}) => ({ fs, file: FILE, now: 1_762_900_000, ...extra });
const WHO = 'newcitizen';

// An activity object in tutorial/chain-reader.mjs's shape, satisfying every stage.
function fullActivity(acct = WHO) {
  return {
    account: acct,
    posts: [
      { author: acct, body: 'x'.repeat(250), tags: ['introduceyourself', 'melek'] },
      { author: acct, body: 'y'.repeat(900), tags: ['howto'] },
    ],
    comments: [
      { author: acct, parent_author: 'kalivankush', body: 'c'.repeat(100) },
      { author: acct, parent_author: 'nicedude', body: 'd'.repeat(100) },
      { author: acct, parent_author: 'megareigns', body: 'e'.repeat(100) },
    ],
    votes_received: [{ voter: 'kalivankush', author: acct, permlink: 'p', weight: 10000 }],
    transfers_to_vesting: [{ from: acct, to: acct, amount: '5.000 MELEK' }],
    witness_votes: ['hathor'],
  };
}

test('the DAO publishes its own numbers: 3% of emission, kept permanently', () => {
  const s = daoSummary();
  assert.equal(s.dao, 'melek.dao');
  assert.equal(s.fundSharePct, 0.03);
  assert.equal(daoInflowPerHour(), 27);                 // 0.03 x 1 MELEK/block x 21,600/day / 24
  assert.equal(s.inflowPerDay, 648);
  assert.equal(DAO_FUND_PCT(), 0.03);
  assert.match(s.fundNote, /balance already in melek\.dao is not touched/);
  assert.match(s.whatItIs, /proposal fund/);
});

test('a seat is earned by finishing every stage of the Instructions, and the chain is the judge', () => {
  const m = daoSummary().membership;
  assert.equal(m.stagesRequired, 6);
  assert.deepEqual(m.stages, [...MEMBERSHIP_STAGES]);
  assert.match(m.earnedBy, /finishing the Hathor Instructions/);
  assert.match(m.verification, /detected from the chain/);
  assert.match(m.verification, /cannot be self-reported/);
  assert.equal(m.gives.length, 2);
  assert.match(m.gives[1], /MELEK POWER delegated/);
  assert.match(m.costs, /nothing/);
});

test('with no chain reader wired, nothing is claimed either way', async () => {
  const fs = memfs();
  const m = await membershipFor(WHO, {}, ctx(fs));
  assert.equal(m.member, false);
  assert.equal(m.eligible, false);
  assert.equal(m.pctComplete, 0);
  assert.match(m.reason, /no chain reader wired/);
});

test('a half-finished account is told exactly what is left', async () => {
  const fs = memfs();
  const partial = fullActivity();
  partial.transfers_to_vesting = [];        // never powered up
  partial.witness_votes = [];               // never voted for a witness
  const m = await membershipFor(WHO, { activity: partial }, ctx(fs));
  assert.equal(m.eligible, false);
  assert.equal(m.pctComplete, 66.67);
  assert.deepEqual(m.missing, ['power_up', 'vote_for_a_witness']);
  assert.equal(m.nextStage, 'power_up');
  assert.equal(m.done.length, 4);
});

test('finishing all six makes an account eligible — and the reader can be async', async () => {
  const fs = memfs();
  const m = await membershipFor(WHO, { fetchActivity: async () => fullActivity() }, ctx(fs));
  assert.equal(m.eligible, true);
  assert.equal(m.pctComplete, 100);
  assert.deepEqual(m.missing, []);
  assert.equal(m.member, false, 'eligible is not the same as seated');
});

test('an ineligible account cannot be enrolled, and is told why', async () => {
  const fs = memfs();
  const partial = fullActivity();
  partial.posts = [];
  const r = await enroll(WHO, { activity: partial, broadcastJson: async () => ({ id: 'x' }) }, ctx(fs));
  assert.equal(r.ok, false);
  assert.match(r.reason, /Instructions are not finished/);
  assert.match(r.reason, /intro_post/);
  assert.equal(isMember(WHO, ctx(fs)), false);
});

test('enrolling records the seat on-chain as a standard custom_json, then seats them', async () => {
  const fs = memfs();
  const ops = [], delegations = [];
  const r = await enroll(WHO, {
    activity: fullActivity(),
    broadcastJson: async (op, record) => { ops.push([op, record]); return { id: 'trx-dao-1' }; },
    delegate: async (d) => { delegations.push(d); return { ok: true }; },
  }, ctx(fs));

  assert.equal(r.ok, true);
  assert.equal(r.trxId, 'trx-dao-1');
  assert.equal(ops.length, 1);
  const [op, record] = ops[0];
  assert.equal(op[0], 'custom_json', 'a standard Graphene op — no custom op for the DAO');
  assert.deepEqual(op[1].required_auths, [], 'never the active authority: this moves no value');
  assert.deepEqual(op[1].required_posting_auths, ['hathor']);
  assert.equal(op[1].id, 'melek_dao_member');
  assert.deepEqual(JSON.parse(op[1].json).stages, [...MEMBERSHIP_STAGES]);
  assert.equal(record.account, WHO);

  assert.deepEqual(delegations, [{ delegator: 'hathor', delegatee: WHO, mp: DAO_MEMBER_MP() }]);
  assert.equal(r.delegation.delegated, true);

  assert.equal(isMember(WHO, ctx(fs)), true);
  const list = roll(ctx(fs));
  assert.equal(list.count, 1);
  assert.equal(list.dao, DAO_ACCOUNT());
  assert.equal(list.members[0].account, WHO);
  assert.equal(list.members[0].delegatedMp, DAO_MEMBER_MP());
});

test('enrolling twice is a no-op, not a second delegation', async () => {
  const fs = memfs();
  const deps = { activity: fullActivity(), broadcastJson: async () => ({ id: 't1' }), delegate: async () => ({ ok: true }) };
  await enroll(WHO, deps, ctx(fs));
  let second = 0;
  const again = await enroll(WHO, { ...deps, delegate: async () => { second += 1; return { ok: true }; } }, ctx(fs));
  assert.equal(again.ok, true);
  assert.equal(again.already, true);
  assert.equal(second, 0, 'no second delegation for the same seat');
  assert.equal(roll(ctx(fs)).count, 1);
});

test('with no broadcaster the seat is NOT granted — an unrecorded seat is not a seat', async () => {
  const fs = memfs();
  const r = await enroll(WHO, { activity: fullActivity() }, ctx(fs));
  assert.equal(r.ok, false);
  assert.match(r.reason, /no broadcaster wired/);
  assert.equal(r.op[0], 'custom_json', 'the op it would have sent is returned for inspection');
  assert.equal(isMember(WHO, ctx(fs)), false);
});

test('a failed broadcast leaves them off the roll, so the next run retries', async () => {
  const fs = memfs();
  const thrown = await enroll(WHO, { activity: fullActivity(), broadcastJson: async () => { throw new Error('rpc down'); } }, ctx(fs));
  assert.equal(thrown.ok, false);
  assert.match(thrown.reason, /rpc down/);
  assert.equal(isMember(WHO, ctx(fs)), false);

  const refused = await enroll(WHO, { activity: fullActivity(), broadcastJson: async () => ({ ok: false, reason: 'posting auth missing' }) }, ctx(fs));
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /posting auth missing/);
  assert.equal(isMember(WHO, ctx(fs)), false);
});

test('a failed delegation does not cost an earned seat', async () => {
  const fs = memfs();
  const r = await enroll(WHO, {
    activity: fullActivity(),
    broadcastJson: async () => ({ id: 'trx-dao-2' }),
    delegate: async () => { throw new Error('not enough MP'); },
  }, ctx(fs));
  assert.equal(r.ok, true, 'the seat stands');
  assert.equal(r.delegation.delegated, false);
  assert.match(r.delegation.reason, /not enough MP/);
  assert.equal(isMember(WHO, ctx(fs)), true);
  assert.equal(roll(ctx(fs)).members[0].delegatedMp, 0, 'and the roll does not claim MP that never moved');
});

test('junk accounts are refused, and an unknown account is simply not a member', async () => {
  const fs = memfs();
  const bad = await membershipFor('NOT A NAME', { activity: fullActivity() }, ctx(fs));
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /valid MELEK account name/);
  assert.equal(isMember('', ctx(fs)), false);
  assert.equal(isMember('nobody-here', ctx(fs)), false);
  assert.equal((await enroll('', { activity: fullActivity() }, ctx(fs))).ok, false);
});

test('a member can be forgotten from the roll (the account-deletion path)', async () => {
  const fs = memfs();
  await enroll(WHO, { activity: fullActivity(), broadcastJson: async () => ({ id: 't' }) }, ctx(fs));
  assert.equal(isMember(WHO, ctx(fs)), true);
  assert.deepEqual(forgetMember(WHO, ctx(fs)), { ok: true, removed: true });
  assert.equal(isMember(WHO, ctx(fs)), false);
  assert.deepEqual(forgetMember(WHO, ctx(fs)), { ok: true, removed: false });
});

test('a corrupt roll file never throws', async () => {
  const fs = { read: () => '}{ not json', write: () => {} };
  assert.equal(roll(ctx(fs)).count, 0);
  assert.equal(isMember(WHO, ctx(fs)), false);
  const m = await membershipFor(WHO, { activity: fullActivity() }, ctx(fs));
  assert.equal(m.eligible, true);
});
