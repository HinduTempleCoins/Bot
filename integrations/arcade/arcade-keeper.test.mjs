// arcade-keeper.test.mjs — OFFLINE, pure. No chain, no network, no key. Soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planLottoRound, planLotto, planMarket, planMarkets, planActions, executable, runKeeper, EXECUTABLE,
} from './arcade-keeper.mjs';

const NOW = 1_800_000_000;
const cfg = { entryWindowSec: 3600, roundIntervalSec: 3600, expiryBlocks: 256, revealLeadBlocks: 1 };

// ---------------------------------------------------------------------------- KulaLotto planning
test('lotto: fresh empty round with no open metadata → nothing due', () => {
  const a = planLottoRound({ roundId: 0, closed: false, drawn: false, ticketCount: 0, commitBlock: 0 }, {}, 100, cfg, NOW);
  assert.equal(a, null);
});

test('lotto: window elapsed with tickets → close', () => {
  const a = planLottoRound({ roundId: 1, closed: false, drawn: false, ticketCount: 5, commitBlock: 0 }, { openedAt: NOW - 4000 }, 100, cfg, NOW);
  assert.equal(a.kind, 'lotto.close');
});

test('lotto: window elapsed but ZERO tickets → skip (contract rejects NoTickets)', () => {
  const a = planLottoRound({ roundId: 2, closed: false, drawn: false, ticketCount: 0, commitBlock: 0 }, { openedAt: NOW - 999999 }, 100, cfg, NOW);
  assert.equal(a.kind, 'lotto.skip');
});

test('lotto: closed, reveal block not yet mined → wait', () => {
  const a = planLottoRound({ roundId: 3, closed: true, drawn: false, ticketCount: 5, commitBlock: 100 }, { salt: '0xabc' }, 101, cfg, NOW);
  assert.equal(a.kind, 'lotto.wait');
});

test('lotto: closed, reveal block mined, salt present → draw with the salt', () => {
  const a = planLottoRound({ roundId: 3, closed: true, drawn: false, ticketCount: 5, commitBlock: 100 }, { salt: '0xdeadbeef' }, 102, cfg, NOW);
  assert.equal(a.kind, 'lotto.draw');
  assert.equal(a.params.salt, '0xdeadbeef');
});

test('lotto: closed but keeper LOST the salt → stuck (needs a human, never guesses)', () => {
  const a = planLottoRound({ roundId: 3, closed: true, drawn: false, ticketCount: 5, commitBlock: 100 }, {}, 102, cfg, NOW);
  assert.equal(a.kind, 'lotto.stuck');
});

test('lotto: closed past the 256-block window → rearm', () => {
  const a = planLottoRound({ roundId: 3, closed: true, drawn: false, ticketCount: 5, commitBlock: 100 }, { salt: '0xabc' }, 400, cfg, NOW);
  assert.equal(a.kind, 'lotto.rearm');
});

test('lotto: drawn round → nothing', () => {
  assert.equal(planLottoRound({ roundId: 3, closed: true, drawn: true, ticketCount: 5, commitBlock: 100 }, {}, 500, cfg, NOW), null);
});

test('lotto: no open round + interval elapsed → open a fresh round with a valid disclosed split', () => {
  const acts = planLotto({ rounds: [{ roundId: 0, closed: true, drawn: true }], block: 10, meta: {}, lastOpenedAt: NOW - 4000 }, cfg, NOW);
  const open = acts.find((a) => a.kind === 'lotto.open');
  assert.ok(open, 'should open');
  const { prizeBps, treasuryBps, burnBps } = open.params;
  assert.equal(prizeBps + treasuryBps + burnBps, 10000, 'split must sum to 100%');
});

test('lotto: an open round exists → do NOT open another', () => {
  const acts = planLotto({ rounds: [{ roundId: 0, closed: false, drawn: false, ticketCount: 0 }], block: 10, meta: {}, lastOpenedAt: 0 }, cfg, NOW);
  assert.equal(acts.find((a) => a.kind === 'lotto.open'), undefined);
});

// ---------------------------------------------------------------------------- BinaryEventMarket planning
test('market: open and still before closeTime → nothing', () => {
  assert.equal(planMarket({ marketId: 0, phase: 0, closeTime: NOW + 100 }, cfg, NOW), null);
});

test('market: closed, no resolver → HOLD for a human (never proposes blind)', () => {
  const a = planMarket({ marketId: 0, phase: 0, closeTime: NOW - 10 }, cfg, NOW);
  assert.equal(a.kind, 'market.hold');
});

test('market: closed + confident resolver → propose that outcome', () => {
  const a = planMarket({ marketId: 0, phase: 1, closeTime: NOW - 10 }, cfg, NOW, () => ({ outcome: 'Yes', source: 'kalshi', confident: true }));
  assert.equal(a.kind, 'market.propose');
  assert.equal(a.params.outcome, 'Yes');
});

test('market: closed + UNconfident resolver → hold', () => {
  const a = planMarket({ marketId: 0, phase: 1, closeTime: NOW - 10 }, cfg, NOW, () => ({ outcome: 'Yes', confident: false }));
  assert.equal(a.kind, 'market.hold');
});

test('market: resolver throws → hold (soft-fail, never crashes the pass)', () => {
  const a = planMarket({ marketId: 0, phase: 1, closeTime: NOW - 10 }, cfg, NOW, () => { throw new Error('api down'); });
  assert.equal(a.kind, 'market.hold');
});

test('market: proposed, dispute window still open → wait', () => {
  const a = planMarket({ marketId: 0, phase: 2, proposedAt: NOW - 10, disputeWindow: 3600 }, cfg, NOW);
  assert.equal(a.kind, 'market.wait');
});

test('market: proposed, dispute window elapsed, not disputed → finalize', () => {
  const a = planMarket({ marketId: 0, phase: 2, proposedAt: NOW - 4000, disputeWindow: 3600, disputer: '0x0000000000000000000000000000000000000000' }, cfg, NOW);
  assert.equal(a.kind, 'market.finalize');
});

test('market: DISPUTED → human, never auto-resolved', () => {
  const a = planMarket({ marketId: 0, phase: 3 }, cfg, NOW);
  assert.equal(a.kind, 'market.human');
});

test('market: proposed but disputer set → human (do not finalize a disputed proposal)', () => {
  const a = planMarket({ marketId: 0, phase: 2, proposedAt: NOW - 4000, disputeWindow: 3600, disputer: '0x00000000000000000000000000000000000000A1' }, cfg, NOW);
  assert.equal(a.kind, 'market.human');
});

// ---------------------------------------------------------------------------- planActions + executable
test('planActions soft-fails to a plan + notes, never throws', () => {
  const { actions, notes } = planActions(null, cfg, NOW);
  assert.ok(Array.isArray(actions));
  assert.ok(Array.isArray(notes));
});

test('executable filters to only broadcastable actions', () => {
  const acts = [{ kind: 'lotto.wait' }, { kind: 'lotto.draw' }, { kind: 'market.human' }, { kind: 'market.finalize' }];
  const ex = executable(acts).map((a) => a.kind);
  assert.deepEqual(ex, ['lotto.draw', 'market.finalize']);
  for (const k of ex) assert.ok(EXECUTABLE.has(k));
});

// ---------------------------------------------------------------------------- runKeeper orchestration
function fakeStore(init = {}) {
  const data = { ...init };
  return { get: (k) => data[k], set: (k, v) => { if (v === undefined) delete data[k]; else data[k] = v; }, all: () => data, _data: data };
}

test('runKeeper: close generates + persists a secret salt, commits its hash', async () => {
  const calls = [];
  const adapter = {
    readLotto: async () => ({ rounds: [{ roundId: 0, closed: false, drawn: false, ticketCount: 3, commitBlock: 0 }], block: 50, lastOpenedAt: NOW }),
    readMarkets: async () => [],
    closeRound: async (id, saltHash) => { calls.push(['closeRound', id, saltHash]); return `tx-close-${id}`; },
  };
  const store = fakeStore({ 'round:0': { openedAt: NOW - 5000 } });
  const rng = () => '0x' + '11'.repeat(32);
  const hash = (salt) => 'HASH(' + salt + ')';
  const out = await runKeeper({ adapter, store, rng, hash, cfg, now: NOW });
  assert.equal(out.ok, true);
  assert.equal(calls[0][0], 'closeRound');
  assert.equal(calls[0][2], 'HASH(0x' + '11'.repeat(32) + ')', 'commits keccak of the salt');
  assert.equal(store.get('round:0').salt, '0x' + '11'.repeat(32), 'salt persisted for the later reveal');
});

test('runKeeper: draw reveals the stored salt then clears it', async () => {
  const calls = [];
  const adapter = {
    readLotto: async () => ({ rounds: [{ roundId: 0, closed: true, drawn: false, ticketCount: 3, commitBlock: 40 }], block: 50, lastOpenedAt: NOW }),
    readMarkets: async () => [],
    drawRound: async (id, salt) => { calls.push(['drawRound', id, salt]); return `tx-draw-${id}`; },
  };
  const store = fakeStore({ 'round:0': { salt: '0xfeed', saltHash: 'HASH(0xfeed)', closedAt: NOW - 100 } });
  const out = await runKeeper({ adapter, store, rng: () => '0x00', hash: (s) => s, cfg, now: NOW });
  assert.equal(out.ok, true);
  assert.deepEqual(calls[0], ['drawRound', 0, '0xfeed']);
  assert.equal(store.get('round:0').salt, undefined, 'salt cleared after reveal');
});

test('runKeeper: dry mode plans but never calls the adapter writes', async () => {
  let wrote = false;
  const adapter = {
    readLotto: async () => ({ rounds: [{ roundId: 0, closed: false, drawn: false, ticketCount: 3, commitBlock: 0 }], block: 50, lastOpenedAt: NOW }),
    readMarkets: async () => [],
    closeRound: async () => { wrote = true; return 'x'; },
  };
  const store = fakeStore({ 'round:0': { openedAt: NOW - 5000 } });
  const out = await runKeeper({ adapter, store, rng: () => '0x00', hash: (s) => s, cfg, now: NOW, dry: true });
  assert.equal(wrote, false, 'dry mode must not broadcast');
  assert.ok(out.executed.every((e) => e.dry === true));
});

test('runKeeper: a failing write is caught, ok=false, others still attempted', async () => {
  const adapter = {
    readLotto: async () => ({ rounds: [{ roundId: 0, closed: true, drawn: false, ticketCount: 3, commitBlock: 40 }], block: 50, lastOpenedAt: NOW }),
    readMarkets: async () => [{ marketId: 0, phase: 2, proposedAt: NOW - 9999, disputeWindow: 10, disputer: '0x0000000000000000000000000000000000000000' }],
    drawRound: async () => { throw new Error('rpc boom'); },
    finalize: async (id) => `tx-final-${id}`,
  };
  const store = fakeStore({ 'round:0': { salt: '0xfeed' } });
  const out = await runKeeper({ adapter, store, rng: () => '0x0', hash: (s) => s, cfg, now: NOW });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.kind === 'lotto.draw'));
  assert.ok(out.executed.some((e) => e.kind === 'market.finalize'), 'the other action still ran');
});

test('runKeeper: no adapter → soft-fail, ok=false, no throw', async () => {
  const out = await runKeeper({});
  assert.equal(out.ok, false);
});
