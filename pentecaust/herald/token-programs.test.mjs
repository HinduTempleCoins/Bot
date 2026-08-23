import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planAirdrop, createBountyBoard, fromList, fromHolders, fromKarma, sybilGate, esc,
} from './token-programs.mjs';

test('esc escapes html', () => assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;'));

test('fromList / fromHolders / fromKarma build snapshots', () => {
  assert.deepEqual(fromList(['a', 'b']), [{ account: 'a', balance: 1 }, { account: 'b', balance: 1 }]);
  assert.equal(fromHolders([{ account: 'a', balance: 5 }, { account: 'b', balance: 1 }], 2).length, 1);
  assert.deepEqual(fromKarma({ a: 80, b: 10 }, 50), [{ account: 'a', balance: 80 }]);
});

test('planAirdrop (MELEK-Engine) allocates proportionally + emits transfer ops', () => {
  const r = planAirdrop({ token: 'VKBT', chain: 'melek', total: '1000', scheme: 'proportional',
    snapshot: [{ account: 'a', balance: 3 }, { account: 'b', balance: 1 }] });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.distributed, '1000');
  // 3:1 split of 1000 → 750 / 250
  const amts = Object.fromEntries(r.allocations.map((x) => [x.account, x.amount]));
  assert.equal(amts.a, '750'); assert.equal(amts.b, '250');
  assert.equal(r.calls.length, 2);
  assert.equal(r.calls[0].op, 'custom_json');
  assert.equal(r.calls[0].json.contractPayload.symbol, 'VKBT');
  assert.equal(r.calls[0].unsigned, true);
});

test('planAirdrop (PRANA) emits ONE BatchAirdrop call with recipients + amounts', () => {
  const r = planAirdrop({ token: '0xTOKEN', chain: 'prana', total: '900', scheme: 'equal',
    snapshot: fromList(['x', 'y', 'z']) });
  assert.equal(r.ok, true);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].contract, 'BatchAirdrop');
  assert.equal(r.calls[0].method, 'airdrop');
  assert.deepEqual(r.calls[0].args[1], ['x', 'y', 'z']);
  assert.equal(r.calls[0].args[2].reduce((a, b) => a + Number(b), 0), 900); // equal split sums to pool
});

test('planAirdrop soft-fails on bad input', () => {
  assert.equal(planAirdrop({ chain: 'melek', total: '1', snapshot: [{ account: 'a', balance: 1 }] }).ok, false); // no token
  assert.equal(planAirdrop({ token: 'X', chain: 'solana', total: '1', snapshot: [{ account: 'a', balance: 1 }] }).ok, false); // bad chain
  assert.equal(planAirdrop({ token: 'X', chain: 'melek', total: '1', snapshot: [] }).ok, false); // empty snapshot
});

test('capFraction caps whales before allocating', () => {
  // one whale + two minnows; cap at 40% should pull the whale down
  const uncapped = planAirdrop({ token: 'T', chain: 'melek', total: '100', snapshot: [{ account: 'w', balance: 98 }, { account: 'a', balance: 1 }, { account: 'b', balance: 1 }] });
  const capped = planAirdrop({ token: 'T', chain: 'melek', total: '100', capFraction: 0.4, snapshot: [{ account: 'w', balance: 98 }, { account: 'a', balance: 1 }, { account: 'b', balance: 1 }] });
  const wUncapped = +uncapped.allocations.find((x) => x.account === 'w').amount;
  const wCapped = +capped.allocations.find((x) => x.account === 'w').amount;
  assert.ok(wCapped < wUncapped, 'whale share reduced by cap');
});

test('sybilGate drops accounts below the humanity threshold (fail-closed)', () => {
  const snap = [{ account: 'human', balance: 5 }, { account: 'bot', balance: 5 }, { account: 'nobody', balance: 5 }];
  const scores = { human: 20, bot: 0 }; // nobody has no score → treated as 0
  const gated = sybilGate(snap, { scoreOf: scores, minScore: 10 });
  assert.deepEqual(gated.map((h) => h.account), ['human']);
  // function form works too
  const gated2 = sybilGate(snap, { scoreOf: (a) => (a === 'bot' ? 99 : 0), minScore: 10 });
  assert.deepEqual(gated2.map((h) => h.account), ['bot']);
});

test('planAirdrop with inline sybil gate only pays cleared accounts', () => {
  const r = planAirdrop({
    token: 'VKBT', chain: 'melek', total: '100', scheme: 'equal',
    snapshot: [{ account: 'a', balance: 1 }, { account: 'b', balance: 1 }],
    sybil: { scoreOf: { a: 30, b: 0 }, minScore: 10 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.allocations[0].account, 'a');
  // everyone gated out → soft-fail with a clear message
  const none = planAirdrop({ token: 'VKBT', chain: 'melek', total: '100', snapshot: [{ account: 'a', balance: 1 }], sybil: { scoreOf: {}, minScore: 10 } });
  assert.equal(none.ok, false);
  assert.match(none.error, /sybil/);
});

// ── bounty board ──────────────────────────────────────────────────────────────────────────────────
function board() { let t = 1000; return createBountyBoard({ storage: { bounties: [], seq: 0 }, now: () => t++ }); }

test('bounty lifecycle: post → submit → verify → paid (+ unsigned release call)', () => {
  const b = board();
  const posted = b.post({ token: 'VKBT', chain: 'melek', amount: '50', task: 'Write a guide', sponsor: 'hathor', tag: 'docs' });
  assert.equal(posted.ok, true);
  assert.equal(posted.bounty.status, 'open');
  assert.ok(posted.escrowCall.unsigned);
  const id = posted.bounty.id;
  assert.equal(b.submit(id, { worker: 'alice', submission: 'ipfs://x' }).bounty.status, 'submitted');
  const v = b.verify(id, { approve: true });
  assert.equal(v.bounty.status, 'paid');
  assert.equal(v.releaseCall.json.contractPayload.to, 'alice');
  assert.equal(v.releaseCall.json.contractPayload.quantity, '50');
});

test('bounty (PRANA) release uses ContributionBountyEscrow.attestAndRelease', () => {
  const b = board();
  const id = b.post({ token: '0xT', chain: 'prana', amount: '10', task: 't' }).bounty.id;
  b.submit(id, { worker: '0xWORKER' });
  const v = b.verify(id, { approve: true });
  assert.equal(v.releaseCall.contract, 'ContributionBountyEscrow');
  assert.equal(v.releaseCall.method, 'attestAndRelease');
  assert.deepEqual(v.releaseCall.args, [id, '0xWORKER']);
});

test('bounty verify(reject) reopens; cancel works; paid cannot cancel; stats count', () => {
  const b = board();
  const id = b.post({ token: 'T', chain: 'melek', amount: '5', task: 't' }).bounty.id;
  b.submit(id, { worker: 'w' });
  assert.equal(b.verify(id, { approve: false }).bounty.status, 'open'); // rejected → reopened
  b.submit(id, { worker: 'w2' });
  b.verify(id, { approve: true });
  assert.equal(b.cancel(id).ok, false); // already paid
  const id2 = b.post({ token: 'T', chain: 'melek', amount: '5', task: 't2' }).bounty.id;
  assert.equal(b.cancel(id2).bounty.status, 'cancelled');
  const s = b.stats();
  assert.equal(s.total, 2);
  assert.equal(s.byStatus.paid, 1);
  assert.equal(s.byStatus.cancelled, 1);
});

test('bounty soft-fails on bad input', () => {
  const b = board();
  assert.equal(b.post({ chain: 'melek', amount: '5', task: 't' }).ok, false); // no token
  assert.equal(b.post({ token: 'T', chain: 'melek', amount: '0', task: 't' }).ok, false); // amount 0
  assert.equal(b.submit(999, { worker: 'w' }).ok, false); // no such bounty
  assert.equal(b.verify(999, {}).ok, false);
});
