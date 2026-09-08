import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_TYPES, AUTO_VERIFIABLE, TOKEN_REALITY, describeReward, createBounty,
  createBoard, verify, thunderclap, clapStatus, handler,
} from './bounty-board.mjs';

const REWARD = { symbol: 'VKBT', amount: 1000 };
const mk = (o = {}) => createBounty({
  title: 'Write a post', type: 'post', reward: REWARD, tag: 'melek', maxClaims: 10, ...o,
}).bounty;

test('every task type declares how a claim is proved', () => {
  for (const [id, t] of Object.entries(TASK_TYPES)) {
    assert.ok(t.proof, `${id} must declare a proof method`);
    assert.ok(t.how && t.how.length > 20, `${id} must explain the proof`);
  }
});

test('a bounty cannot exist without a reward, a cap, or a known type', () => {
  assert.deepEqual(createBounty({}).ok, false);
  const noCap = createBounty({ title: 'x', type: 'post', reward: REWARD, maxClaims: 0 });
  assert.match(noCap.problems.join(' '), /uncapped bounty is an open tap/);
  const noReward = createBounty({ title: 'x', type: 'post', reward: {}, maxClaims: 5 });
  assert.match(noReward.problems.join(' '), /no reward is a request, not a bounty/);
  const badType = createBounty({ title: 'x', type: 'invent', reward: REWARD, maxClaims: 5 });
  assert.match(badType.problems.join(' '), /every type must declare how a claim is proved/);
});

test('the reward is described by what it would FILL for, not its mark', () => {
  const d = describeReward('VKBT', 1000);
  assert.match(d.caveat, /50x the bid/);
  assert.match(d.caveat, /whole book only holds 0.36 HIVE/);
  assert.match(d.honest, /thin book/);
  assert.ok(d.markHive > 0 && d.markHive < 0.1);
});

test('CURE carries its own 2,638x caveat', () => {
  assert.match(describeReward('CURE', 100).caveat, /2,638x/);
});

test('KULA is described as not trading on Hive-Engine at all', () => {
  const d = describeReward('KULA', 50);
  assert.match(d.caveat, /KulaSwap/);
  assert.equal(d.markHive, undefined);
});

test('a bounty carries the honest reward line, not just a number', () => {
  const b = mk();
  assert.match(b.reward.honest, /1000 VKBT/);
  assert.match(b.reward.caveat, /thin|book/);
});

test('an account can only claim a bounty once', () => {
  const board = createBoard(); board.add(mk({ title: 'Once' }));
  const id = board.open()[0].id;
  assert.equal(board.claim({ bounty: id, account: 'alice' }).ok, true);
  const again = board.claim({ bounty: id, account: 'Alice' });
  assert.equal(again.ok, false);
  assert.match(again.reason, /already claimed/);
});

test('a bounty stops accepting claims at its cap', () => {
  const board = createBoard(); board.add(mk({ title: 'Two only', maxClaims: 2 }));
  const id = board.open()[0].id;
  board.claim({ bounty: id, account: 'a' });
  board.claim({ bounty: id, account: 'b' });
  const third = board.claim({ bounty: id, account: 'c' });
  assert.equal(third.ok, false);
  assert.match(third.reason, /fully claimed/);
  assert.equal(board.open().length, 0, 'a full bounty is no longer open');
});

test('a closed bounty refuses claims', () => {
  const board = createBoard();
  board.add(mk({ title: 'Closed', closesAt: '2020-01-01T00:00:00Z' }));
  const r = board.claim({ bounty: board.get('b_closed').id, account: 'a', at: '2026-01-01T00:00:00Z' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /closed/);
});

test('an on-chain post claim is verified against the chain', async () => {
  const b = mk();
  const yes = await verify({ account: 'alice' }, b, { hasPost: async () => true });
  assert.equal(yes.ok, true);
  assert.equal(yes.method, 'onchain-post');
  const no = await verify({ account: 'alice' }, b, { hasPost: async () => false });
  assert.equal(no.ok, false);
  assert.match(no.reason, /no post by @alice/);
});

test('a missing reader yields UNVERIFIABLE, never an approval', async () => {
  const r = await verify({ account: 'alice' }, mk(), {});
  assert.equal(r.ok, false);
  assert.equal(r.method, 'unverifiable');
});

test('an off-chain URL claim always routes to a human', async () => {
  const b = mk({ title: 'Tweet it', type: 'offchain_post' });
  assert.equal(b.autoVerifiable, false);
  const r = await verify({ account: 'a', proofUrl: 'https://x.com/a/1' }, b, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /needs a human/);
  const noUrl = await verify({ account: 'a' }, b, {});
  assert.match(noUrl.reason, /no proof URL/);
});

test('a reader that throws degrades to a reason, not a crash', async () => {
  const r = await verify({ account: 'a' }, mk(), { hasPost: async () => { throw new Error('rpc down'); } });
  assert.equal(r.ok, false);
  assert.equal(r.method, 'error');
  assert.match(r.reason, /rpc down/);
});

test('only on-chain and derived proofs are auto-verifiable', () => {
  assert.ok(AUTO_VERIFIABLE.includes('onchain-post'));
  assert.ok(!AUTO_VERIFIABLE.includes('url-review'));
  assert.ok(!AUTO_VERIFIABLE.includes('url-review-timed'));
});

test('a thunderclap needs a window — the moment IS the bounty', () => {
  const bad = thunderclap({ title: 'Clap', reward: REWARD });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(' '), /needs a window/);
});

test('a thunderclap posts for nobody and says so', () => {
  const t = thunderclap({
    title: 'Launch clap', reward: REWARD,
    window: { start: '2026-09-10T17:00:00Z', end: '2026-09-10T18:00:00Z' },
    message: 'MELEK is live', links: ['https://soapbox.community'],
  });
  assert.equal(t.ok, true);
  assert.match(t.bounty.notes, /Nothing is posted on your behalf/);
  assert.match(t.bounty.notes, /no account access is requested/);
  assert.match(t.bounty.pledgePolicy, /A pledge is not a post/);
});

test('a claim outside the thunderclap window is rejected on time alone', async () => {
  const t = thunderclap({
    title: 'Clap', reward: REWARD,
    window: { start: '2026-09-10T17:00:00Z', end: '2026-09-10T18:00:00Z' },
  }).bounty;
  const late = await verify({ account: 'a', proofUrl: 'https://x/1', at: '2026-09-11T00:00:00Z' }, t, {});
  assert.equal(late.ok, false);
  assert.equal(late.method, 'window');
  const inside = await verify({ account: 'a', proofUrl: 'https://x/1', at: '2026-09-10T17:30:00Z' }, t, {});
  assert.equal(inside.method, 'unverifiable', 'inside the window, but still a human opens the URL');
});

test('clap status separates pledges from posts from verified', () => {
  const board = createBoard();
  const t = thunderclap({
    title: 'Clap', reward: REWARD, maxClaims: 100,
    window: { start: '2026-09-10T17:00:00Z', end: '2026-09-10T18:00:00Z' },
  }).bounty;
  board.add(t);
  board.claim({ bounty: t.id, account: 'a' });                                  // pledge only
  board.claim({ bounty: t.id, account: 'b', proofUrl: 'https://x/b' });         // posted
  board.settle(t.id, 'b', { ok: true, method: 'url-review', reason: 'checked' });
  const s = clapStatus(board, t.id);
  assert.equal(s.pledged, 2);
  assert.equal(s.posted, 1);
  assert.equal(s.verified, 1);
  assert.match(s.note, /verified is the only number worth reporting/);
});

test('only verified claims become payable, and paying is recorded', () => {
  const board = createBoard(); board.add(mk({ title: 'Pay me' }));
  const id = board.get('b_pay-me').id;
  board.claim({ bounty: id, account: 'a' });
  board.claim({ bounty: id, account: 'b' });
  board.settle(id, 'a', { ok: true, method: 'onchain-post', reason: 'found' });
  board.settle(id, 'b', { ok: false, method: 'onchain-post', reason: 'not found' });
  assert.equal(board.payable().length, 1);
  assert.equal(board.payable()[0].account, 'a');
  board.markPaid(id, 'a', 'tx123');
  assert.equal(board.payable().length, 0);
});

test('the board round-trips through JSON', () => {
  const board = createBoard(); board.add(mk());
  const id = board.open()[0].id;
  board.claim({ bounty: id, account: 'a' });
  const back = createBoard(JSON.parse(JSON.stringify(board.toJSON())));
  assert.equal(back.bountyCount, 1);
  assert.equal(back.claimCount, 1);
  assert.equal(back.claim({ bounty: id, account: 'a' }).ok, false, 'dedupe survives a reload');
});

test('handler states that nothing is auto-approved and nobody is paid here', () => {
  const res = { statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  handler({ url: '/bb' }, res);
  const j = JSON.parse(res.body);
  assert.match(j.policy, /never to auto-approval/);
  assert.match(j.policy, /pays nobody/);
  assert.match(j.policy, /would actually fill for/);
  assert.ok(Object.keys(TOKEN_REALITY).includes('VKBT'));
});
