// integrations/parity-target.test.mjs
// Offline tests for the parity-target calculator. node:test + node:assert/strict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parityTarget,
  capAtParity,
  sustainabilityVerdict,
  compareTokens,
  format,
  renderLine,
} from './parity-target.mjs';

test('parityTarget picks the higher of current vs parity (below parity)', () => {
  const r = parityTarget({ currentPrice: 0.5, parityPrice: 1.0 });
  assert.equal(r.target, 1.0);
  assert.equal(r.atOrAbove, false);
  assert.equal(r.gapPct, 50); // (1 - 0.5)/1 * 100
});

test('parityTarget picks current when already above parity', () => {
  const r = parityTarget({ currentPrice: 2.0, parityPrice: 1.0 });
  assert.equal(r.target, 2.0);
  assert.equal(r.atOrAbove, true);
  assert.equal(r.gapPct, 0);
});

test('parityTarget exactly at parity is atOrAbove with zero gap', () => {
  const r = parityTarget({ currentPrice: 1.0 });
  assert.equal(r.target, 1.0);
  assert.equal(r.atOrAbove, true);
  assert.equal(r.gapPct, 0);
});

test('capAtParity: 1.9M supply -> $1.9M cap at 1:1, quoteUsd=1', () => {
  const r = capAtParity({ supply: 1_900_000 });
  assert.equal(r.capQuote, 1_900_000);
  assert.equal(r.capUsd, 1_900_000);
});

test('capAtParity applies quoteUsd conversion', () => {
  const r = capAtParity({ supply: 1000, parityPrice: 2, quoteUsd: 0.5 });
  assert.equal(r.capQuote, 2000);
  assert.equal(r.capUsd, 1000);
});

test('sustainabilityVerdict: under ceiling -> sustainable', () => {
  const v = sustainabilityVerdict({ supply: 500_000 }); // $500K vs $1M
  assert.equal(v.capUsd, 500_000);
  assert.equal(v.ratio, 0.5);
  assert.equal(v.sustainable, true);
  assert.equal(v.label, 'sustainable');
});

test('sustainabilityVerdict: just over 1x -> stretched', () => {
  const v = sustainabilityVerdict({ supply: 1_200_000 }); // ratio 1.2
  assert.equal(v.sustainable, false);
  assert.equal(v.label, 'stretched');
});

test('sustainabilityVerdict: well over 1.5x -> overvalued', () => {
  const v = sustainabilityVerdict({ supply: 2_000_000 }); // ratio 2.0
  assert.equal(v.sustainable, false);
  assert.equal(v.label, 'overvalued');
});

test('sustainabilityVerdict: exactly at ceiling is sustainable (boundary)', () => {
  const v = sustainabilityVerdict({ supply: 1_000_000 }); // ratio 1.0
  assert.equal(v.ratio, 1.0);
  assert.equal(v.sustainable, true);
  assert.equal(v.label, 'sustainable');
});

test('sustainabilityVerdict: custom ceiling', () => {
  const v = sustainabilityVerdict({ supply: 100, maxSustainableUsd: 50 });
  assert.equal(v.ratio, 2.0);
  assert.equal(v.label, 'overvalued');
});

test('compareTokens ranks ascending by capUsd', () => {
  const ranked = compareTokens([
    { symbol: 'BIG', supply: 2_000_000 },
    { symbol: 'SMALL', supply: 100_000 },
    { symbol: 'MID', supply: 800_000 },
  ]);
  assert.deepEqual(
    ranked.map((t) => t.symbol),
    ['SMALL', 'MID', 'BIG'],
  );
  assert.equal(ranked[0].sustainable, true);
  assert.equal(ranked[2].sustainable, false);
});

// --- edge / soft-fail ---

test('parityTarget: missing/NaN coerce to 0, never throws', () => {
  const r = parityTarget({});
  assert.equal(r.target, 1.0); // parity default still applies
  assert.equal(r.atOrAbove, false); // current 0 < parity 1
  const r2 = parityTarget({ currentPrice: 'abc', parityPrice: NaN });
  assert.equal(r2.target, 0);
  assert.equal(r2.gapPct, 0); // target 0 guarded
});

test('capAtParity: missing inputs -> zeros', () => {
  const r = capAtParity({});
  assert.equal(r.capQuote, 0);
  assert.equal(r.capUsd, 0);
});

test('sustainabilityVerdict: NaN/missing -> {sustainable:false}', () => {
  const v = sustainabilityVerdict({ supply: NaN });
  assert.equal(v.capUsd, 0);
  assert.equal(v.sustainable, false); // coerced-0 cap is the soft-fail path
  assert.equal(v.ratio, 0);
});

test('sustainabilityVerdict: missing supply entirely -> {sustainable:false}', () => {
  const v = sustainabilityVerdict({});
  assert.equal(v.capUsd, 0);
  assert.equal(v.sustainable, false);
});

test('sustainabilityVerdict: positive cap with zero ceiling -> false', () => {
  const v = sustainabilityVerdict({ supply: 5, maxSustainableUsd: 0 });
  assert.equal(v.sustainable, false);
  assert.equal(v.label, 'overvalued');
  assert.equal(v.ratio, Infinity);
});

test('compareTokens: non-array -> [], junk entries coerce', () => {
  assert.deepEqual(compareTokens(null), []);
  assert.deepEqual(compareTokens('nope'), []);
  const ranked = compareTokens([null, { symbol: 'X', supply: 10 }, 42]);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].capUsd, 0); // null entry
  assert.equal(ranked[ranked.length - 1].symbol, 'X');
});

test('format: compact units and soft-fail', () => {
  assert.equal(format(1_900_000, { usd: true }), '$1.9M');
  assert.equal(format(579_000, { usd: true }), '$579.0K');
  assert.equal(format(2_000_000), '2.0M HIVE');
  assert.equal(format(-1_000), '-1.0K HIVE');
  assert.equal(format(NaN, { usd: true }), '$0.0'); // coerced to 0
});

test('renderLine: one-line summary, soft-fail on junk', () => {
  const v = sustainabilityVerdict({ supply: 500_000 });
  const line = renderLine(v);
  assert.match(line, /^\[OK\] cap-at-parity \$500\.0K — sustainable \(0\.50x\)$/);
  const over = renderLine(sustainabilityVerdict({ supply: 2_000_000 }));
  assert.match(over, /^\[OVER\] cap-at-parity \$2\.0M — overvalued \(2\.00x\)$/);
  // junk input never throws
  assert.equal(typeof renderLine(null), 'string');
  assert.equal(typeof renderLine(undefined), 'string');
});
