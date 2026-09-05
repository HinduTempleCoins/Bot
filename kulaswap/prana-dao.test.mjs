// prana-dao.test.mjs — offline tests for the PRANA DAO governance layer.
// node --test. No network, no deps. Verifies hand-encoded calldata against ethers reference vectors
// (captured once from ethers AbiCoder — see comments) without importing ethers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  votingPower,
  proposalState,
  buildProposeTx,
  buildVoteTx,
  buildQueueTx,
  buildExecuteTx,
  buildDelegateTx,
  buildEmissionSplitAction,
  emissionSplitPreview,
  encodeProposeArgs,
  encodeQueueArgs,
  renderDaoFragment,
  DAO_SELECTORS,
} from './prana-dao.mjs';

// ── 1. votingPower ───────────────────────────────────────────────────────────────────────────────
test('votingPower: held PRANA gets no boost, staked gets the lock boost', () => {
  assert.equal(votingPower({ pranaBalance: 100 }), 100);
  assert.equal(votingPower({ pranaBalance: 0, pranaStaked: 100, lockBoost: 1 }), 200); // 2x staked
  assert.equal(votingPower({ pranaBalance: 100, pranaStaked: 100, lockBoost: 0.5 }), 250);
});
test('votingPower: boost capped at maxBoost, soft-fails to 0', () => {
  assert.equal(votingPower({ pranaStaked: 100, lockBoost: 5, maxBoost: 1 }), 200); // capped at 1
  assert.equal(votingPower({ pranaBalance: -5, pranaStaked: -5 }), 0);
  assert.equal(votingPower(), 0);
  assert.equal(votingPower({ pranaBalance: 'x' }), 0);
});

// ── 2. proposalState ─────────────────────────────────────────────────────────────────────────────
test('proposalState: pending → active → succeeded by time + votes', () => {
  const p = { voteStart: 10, voteEnd: 20 };
  assert.equal(proposalState(p, { now: 5, quorum: 100, votesFor: 0, votesAgainst: 0 }).state, 'pending');
  assert.equal(proposalState(p, { now: 15, quorum: 100, votesFor: 0, votesAgainst: 0 }).state, 'active');
  const done = proposalState(p, { now: 25, quorum: 100, votesFor: 150, votesAgainst: 10 });
  assert.equal(done.state, 'succeeded');
  assert.equal(done.quorumReached, true);
  assert.equal(done.succeeded, true);
});
test('proposalState: defeated when quorum not met or against wins', () => {
  const p = { voteStart: 10, voteEnd: 20 };
  const noQuorum = proposalState(p, { now: 25, quorum: 100, votesFor: 50, votesAgainst: 0 });
  assert.equal(noQuorum.state, 'defeated');
  assert.equal(noQuorum.quorumReached, false);
  // For(120)+Abstain(0)=120 >= quorum(100) → quorum met, but Against(150) wins the majority → defeated.
  const againstWins = proposalState(p, { now: 25, quorum: 100, votesFor: 120, votesAgainst: 150 });
  assert.equal(againstWins.state, 'defeated');
  assert.equal(againstWins.quorumReached, true); // quorum met but majority against
  assert.equal(againstWins.succeeded, false);
});
test('proposalState: abstain counts toward quorum but not majority', () => {
  const p = { voteStart: 10, voteEnd: 20 };
  const r = proposalState(p, { now: 25, quorum: 100, votesFor: 60, votesAgainst: 10, votesAbstain: 40 });
  assert.equal(r.quorumReached, true); // 60 + 40 >= 100
  assert.equal(r.succeeded, true);     // 60 > 10
});
test('proposalState: explicit flags win (queued/executed/canceled)', () => {
  const p = { voteStart: 10, voteEnd: 20 };
  assert.equal(proposalState({ ...p, queued: true }, { now: 25, quorum: 1, votesFor: 5 }).state, 'queued');
  assert.equal(proposalState({ ...p, executed: true }, { now: 25 }).state, 'executed');
  assert.equal(proposalState({ ...p, canceled: true }, { now: 25 }).state, 'canceled');
});

// ── 3. tx descriptors: real selectors + ABI encoding verified against ethers ───────────────────────
//
// Reference vectors captured from ethers v6 AbiCoder (see PR notes):
//   targets=["0x1111...11"], values=[0], calldatas=["0xe7739e7d"+pad(500)], description="Set DAO slice to 5%"
const T = '0x' + '11'.repeat(20);
const SETDAOBPS_500 = DAO_SELECTORS.setDaoBps + '00000000000000000000000000000000000000000000000000000000000001f4';
const DESC = 'Set DAO slice to 5%';
const DESCHASH = '0xb02abcaf7158387d427bbd20695161ae284fc96d3db15448bc5275b35d93b275'; // keccak256(DESC) per ethers

// Single unbroken literals (captured from ethers v6 AbiCoder.encode — do not reformat).
const PROPOSE_ARGS_REF = '000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000024e7739e7d00000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000135365742044414f20736c69636520746f20352500000000000000000000000000';

const QUEUE_ARGS_REF = '000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100b02abcaf7158387d427bbd20695161ae284fc96d3db15448bc5275b35d93b2750000000000000000000000000000000000000000000000000000000000000001000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000024e7739e7d00000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000';

test('encodeProposeArgs matches ethers AbiCoder byte-for-byte', () => {
  const got = encodeProposeArgs([T], [0], [SETDAOBPS_500], DESC);
  assert.equal(got, PROPOSE_ARGS_REF);
});
test('encodeQueueArgs matches ethers AbiCoder byte-for-byte', () => {
  const got = encodeQueueArgs([T], [0], [SETDAOBPS_500], DESCHASH);
  assert.equal(got, QUEUE_ARGS_REF);
});

test('buildProposeTx: selector + body + descriptor shape', () => {
  const action = buildEmissionSplitAction({ split: T, daoBps: 500 });
  assert.equal(action.calldata, SETDAOBPS_500);
  const tx = buildProposeTx({ governor: T, actions: [action], description: DESC });
  assert.equal(tx.to, T);
  assert.equal(tx.value, '0x0');
  assert.equal(tx.chainId, 712217);   // MAINNET
  assert.equal(tx.method, 'propose');
  assert.equal(tx.data, DAO_SELECTORS.propose + PROPOSE_ARGS_REF);
});

test('buildVoteTx: castVote(uint256,uint8) with correct support clamping', () => {
  const tx = buildVoteTx({ governor: T, proposalId: 123, support: 1 });
  assert.equal(tx.method, 'castVote');
  // ethers ref: castVote(123,1) args = word(123) + word(1)
  assert.equal(tx.data, DAO_SELECTORS.castVote +
    '000000000000000000000000000000000000000000000000000000000000007b' +
    '0000000000000000000000000000000000000000000000000000000000000001');
  // out-of-range support clamps into [0,2]
  assert.ok(buildVoteTx({ governor: T, proposalId: 1, support: 9 }).data.endsWith(
    '0000000000000000000000000000000000000000000000000000000000000002'));
});

test('buildVoteTx with reason uses castVoteWithReason', () => {
  const tx = buildVoteTx({ governor: T, proposalId: 1, support: 1, reason: 'gm' });
  assert.equal(tx.method, 'castVoteWithReason');
  assert.ok(tx.data.startsWith(DAO_SELECTORS.castVoteWithReason));
});

test('buildQueueTx / buildExecuteTx: same args, different selector', () => {
  const action = buildEmissionSplitAction({ split: T, daoBps: 500 });
  const q = buildQueueTx({ governor: T, actions: [action], descriptionHash: DESCHASH });
  const x = buildExecuteTx({ governor: T, actions: [action], descriptionHash: DESCHASH });
  assert.equal(q.data, DAO_SELECTORS.queue + QUEUE_ARGS_REF);
  assert.equal(x.data, DAO_SELECTORS.execute + QUEUE_ARGS_REF);
  assert.equal(q.method, 'queue');
  assert.equal(x.method, 'execute');
});

test('buildDelegateTx: delegate(address)', () => {
  const tx = buildDelegateTx({ token: T, delegatee: T });
  assert.equal(tx.method, 'delegate');
  assert.equal(tx.data, DAO_SELECTORS.delegate + '000000000000000000000000' + '11'.repeat(20));
});

test('descriptors soft-fail on bad input (never throw)', () => {
  assert.doesNotThrow(() => buildProposeTx());
  assert.doesNotThrow(() => buildVoteTx());
  assert.doesNotThrow(() => buildQueueTx({ actions: 'nope' }));
  assert.doesNotThrow(() => buildEmissionSplitAction({ daoBps: 'x' }));
});

// ── 4. emissionSplitPreview ────────────────────────────────────────────────────────────────────────
test('emissionSplitPreview: valid split sums to 100% and computes amounts + daoBps', () => {
  const r = emissionSplitPreview({
    totalEmission: 1000,
    splits: [{ name: 'treasury', bps: 1000 }, { name: 'contributors', bps: 8000 }, { name: 'burn', bps: 1000 }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.totalBps, 10000);
  assert.equal(r.daoBps, 2000); // everything not going to the main 'contributors' bucket
  assert.deepEqual(r.buckets.map((b) => b.amount), [100, 800, 100]);
});
test('emissionSplitPreview: rejects bad splits', () => {
  assert.equal(emissionSplitPreview({ totalEmission: 100, splits: [{ name: 'a', bps: 5000 }] }).ok, false);
  assert.equal(emissionSplitPreview({ totalEmission: 100, splits: [{ name: 'a', bps: 10001 }] }).ok, false);
  assert.equal(emissionSplitPreview({ totalEmission: 100, splits: [{ name: 'a', bps: 100.5 }, { name: 'b', bps: 9899.5 }] }).ok, false);
  assert.equal(emissionSplitPreview({ totalEmission: 100, splits: [] }).ok, false);
  assert.equal(emissionSplitPreview().ok, false);
});

// ── 5. UI fragment ───────────────────────────────────────────────────────────────────────────────
test('renderDaoFragment: shows power, proposals, and state-appropriate buttons; escapes input', () => {
  const html = renderDaoFragment({
    voter: { pranaBalance: 1000, pranaStaked: 500, lockBoost: 1 },
    now: 15,
    proposals: [
      { id: 1, title: 'Active one', voteStart: 10, voteEnd: 20, votesFor: 50, votesAgainst: 5, quorum: 10 },
      { id: 2, title: 'Won', voteStart: 1, voteEnd: 5, votesFor: 100, votesAgainst: 1, quorum: 10 },
      { id: 3, title: 'Ready', voteStart: 1, voteEnd: 5, votesFor: 100, votesAgainst: 1, quorum: 10, queued: true },
    ],
  });
  assert.match(html, /Your voting power: <strong data-dao-power>2000<\/strong>/);
  // safe data-* buttons (NO inline onclick — XSS-safe); host wires via data-dao-id
  assert.match(html, /data-dao-id="1"/);
  assert.match(html, /data-dao-vote="1"[^>]*>Vote For/);
  assert.match(html, /data-dao-action="queue"/);   // succeeded → Queue
  assert.match(html, /data-dao-action="execute"/); // queued → Execute
  assert.doesNotMatch(html, /onclick=/);           // no inline JS handlers anywhere
});
test('renderDaoFragment: esc() neutralizes HTML in title', () => {
  const html = renderDaoFragment({
    proposals: [{ id: 1, title: '<img src=x onerror=alert(1)>', voteStart: 0, voteEnd: 100, quorum: 1 }],
    now: 50,
  });
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x/);
});
test('renderDaoFragment: empty proposals → empty notice', () => {
  const html = renderDaoFragment({ voter: { pranaBalance: 0 } });
  assert.match(html, /No proposals yet/);
});
