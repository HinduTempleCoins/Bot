// whale-movements.test.mjs — offline, deterministic. node --test. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whaleMoves, diffSnapshots } from './whale-movements.mjs';

// Two synthetic whale lists exercising every classification:
//   alice   — grows 30% → 40%   (ACCUMULATED)
//   bob     — shrinks 25% → 10%  (DUMPED)
//   carol   — present then gone  (EXITED)
//   dave    — absent then present (NEW_WHALE)
//   erin    — tiny 5.00% → 5.20% change, below 0.5% floor (FILTERED)
const PREV = [
  { account: 'alice', total: 3000, percentOfSupply: 30 },
  { account: 'bob', total: 2500, percentOfSupply: 25 },
  { account: 'carol', total: 1500, percentOfSupply: 15 },
  { account: 'erin', total: 500, percentOfSupply: 5.0 },
];
const CURR = [
  { account: 'alice', total: 4000, percentOfSupply: 40 },
  { account: 'bob', total: 1000, percentOfSupply: 10 },
  { account: 'dave', total: 2000, percentOfSupply: 20 },
  { account: 'erin', total: 520, percentOfSupply: 5.2 },
];

function moveFor(res, account) {
  return res.moves.find(m => m.account === account);
}

test('classifies ACCUMULATED / DUMPED / NEW_WHALE / EXITED', () => {
  const res = whaleMoves(PREV, CURR);

  assert.equal(moveFor(res, 'alice').kind, 'ACCUMULATED');
  assert.equal(moveFor(res, 'alice').deltaPct, 10);
  assert.equal(moveFor(res, 'alice').deltaTotal, 1000);

  assert.equal(moveFor(res, 'bob').kind, 'DUMPED');
  assert.equal(moveFor(res, 'bob').deltaPct, -15);

  assert.equal(moveFor(res, 'carol').kind, 'EXITED');
  assert.equal(moveFor(res, 'carol').deltaPct, -15); // 0 - 15

  assert.equal(moveFor(res, 'dave').kind, 'NEW_WHALE');
  assert.equal(moveFor(res, 'dave').deltaPct, 20);
});

test('filters sub-threshold moves but keeps structural NEW/EXIT', () => {
  const res = whaleMoves(PREV, CURR, { minDeltaPct: 0.5 });
  // erin's 0.2% change is below the floor → dropped
  assert.equal(moveFor(res, 'erin'), undefined);
  // carol exited / dave entered are kept regardless of magnitude
  assert.ok(moveFor(res, 'carol'));
  assert.ok(moveFor(res, 'dave'));
  // a lower floor lets erin through
  const loose = whaleMoves(PREV, CURR, { minDeltaPct: 0.1 });
  assert.ok(moveFor(loose, 'erin'));
  assert.equal(moveFor(loose, 'erin').kind, 'ACCUMULATED');
});

test('netFlow sign and biggest accumulator/dumper', () => {
  const res = whaleMoves(PREV, CURR);
  // kept deltas: alice +10, bob -15, carol -15, dave +20  → net 0
  assert.equal(res.netFlow, 0);

  // Net-distributing case: net should go negative.
  const dumpHeavy = whaleMoves(
    [{ account: 'a', total: 100, percentOfSupply: 50 }, { account: 'b', total: 100, percentOfSupply: 40 }],
    [{ account: 'a', total: 100, percentOfSupply: 45 }, { account: 'b', total: 100, percentOfSupply: 20 }],
  );
  assert.ok(dumpHeavy.netFlow < 0, `expected negative netFlow, got ${dumpHeavy.netFlow}`);

  // Net-accumulating case: positive.
  const accHeavy = whaleMoves(
    [{ account: 'a', total: 100, percentOfSupply: 10 }],
    [{ account: 'a', total: 100, percentOfSupply: 40 }],
  );
  assert.ok(accHeavy.netFlow > 0, `expected positive netFlow, got ${accHeavy.netFlow}`);

  assert.equal(res.biggestAccumulator.account, 'dave'); // +20 is the largest gain
  assert.equal(res.biggestDumper.deltaPct, -15);        // bob or carol, both -15
});

test('soft-fail on missing / empty / malformed input', () => {
  for (const bad of [undefined, null, [], {}, 'x', 42]) {
    const res = whaleMoves(bad, bad);
    assert.deepEqual(res.moves, []);
    assert.equal(res.netFlow, 0);
    assert.equal(res.biggestAccumulator, null);
    assert.equal(res.biggestDumper, null);
  }
  // malformed entries (no account, NaN fields) are skipped, valid ones survive
  const res = whaleMoves(
    [{ total: 1 }, { account: 'good', total: 'x', percentOfSupply: 5 }],
    [{ account: 'good', total: 10, percentOfSupply: 12 }],
  );
  const good = moveFor(res, 'good');
  assert.ok(good);
  assert.equal(good.prevPct, 5);
  assert.equal(good.kind, 'ACCUMULATED');
});

test('diffSnapshots walks consecutive snapshots chronologically', () => {
  const history = [
    { timestamp: '2026-01-01T00:00:00Z', whales: PREV },
    { timestamp: '2026-01-02T00:00:00Z', whales: CURR },
    { timestamp: '2026-01-03T00:00:00Z', whales: PREV },
  ];
  const log = diffSnapshots(history);
  assert.equal(log.length, 2);
  assert.equal(log[0].from, '2026-01-01T00:00:00Z');
  assert.equal(log[0].to, '2026-01-02T00:00:00Z');
  assert.equal(log[0].fromIndex, 0);
  assert.equal(log[0].toIndex, 1);
  assert.ok(Array.isArray(log[0].moves));
  // second diff is CURR → PREV, the reverse, so alice should DUMP back
  assert.equal(moveFor(log[1], 'alice').kind, 'DUMPED');
});

test('diffSnapshots soft-fails on <2 snapshots or non-array', () => {
  assert.deepEqual(diffSnapshots([]), []);
  assert.deepEqual(diffSnapshots([{ whales: PREV }]), []);
  assert.deepEqual(diffSnapshots(null), []);
  assert.deepEqual(diffSnapshots('nope'), []);
  // snapshots missing whales arrays → empty moves, no throw
  const log = diffSnapshots([{ timestamp: 't0' }, { timestamp: 't1' }]);
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].moves, []);
});
