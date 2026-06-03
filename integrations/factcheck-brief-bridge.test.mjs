// factcheck-brief-bridge.test.mjs — offline tests (node:test). Inject a flag source so no sibling
// package / fs / network is touched. Covers: per-path filtering, confidence sort, the advisory section
// (caveat + soft-fail empty state), count, and a thrown source → empty/no-throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  briefWarningFor,
  allBriefWarnings,
  warningsBlock,
  warningCount,
  __setFlagSource,
} from './factcheck-brief-bridge.mjs';

// Sample OPEN flags spanning two KB paths + a range of confidences (and one null-confidence flag).
const SAMPLE = [
  { kbPath: 'knowledge/a.json', statement: 'VKFRI is a Danish school', reason: 'no external source', confidence: 0.40, suggestedSource: 'https://example.com/a' },
  { kbPath: 'knowledge/a.json', statement: 'Claim two', reason: 'unverified', confidence: 0.90 },
  { kbPath: 'knowledge/b.json', statement: 'Claim three', reason: 'disputed', confidence: 0.65 },
  { kbPath: 'knowledge/b.json', statement: 'No-confidence claim', reason: 'maybe' },
];

function useSample() { __setFlagSource(() => SAMPLE.slice()); }
function reset() { __setFlagSource(null); }

test('briefWarningFor filters to one KB path', async () => {
  useSample();
  const lines = await briefWarningFor('knowledge/b.json');
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.includes('knowledge/b.json')));
  assert.ok(lines.every((l) => !l.includes('knowledge/a.json')));
  // advisory wording present
  assert.ok(lines.every((l) => l.startsWith('⚠ KB statement in') && l.includes('may be inaccurate')));
  reset();
});

test('briefWarningFor unknown path → empty', async () => {
  useSample();
  assert.deepEqual(await briefWarningFor('knowledge/nope.json'), []);
  reset();
});

test('allBriefWarnings sorts by confidence desc', async () => {
  useSample();
  const lines = await allBriefWarnings();
  assert.equal(lines.length, 4);
  // highest confidence (0.90) first; null-confidence (treated as 0) last.
  assert.ok(lines[0].includes('Claim two'));
  assert.ok(lines[0].includes('confidence 0.90'));
  assert.ok(lines[lines.length - 1].includes('No-confidence claim'));
  // confidences appear in non-increasing order across the rendered lines
  const confs = lines.map((l) => {
    const m = l.match(/confidence (\d+\.\d+)/);
    return m ? parseFloat(m[1]) : 0;
  });
  for (let i = 1; i < confs.length; i++) assert.ok(confs[i - 1] >= confs[i], `not sorted at ${i}: ${confs}`);
  reset();
});

test('warningsBlock renders the advisory section with the fallibility caveat', async () => {
  useSample();
  const md = await warningsBlock();
  assert.ok(md.includes('### Fact-check warnings (advisory)'));
  // fallibility caveat is present and explicit
  assert.ok(/fallible/i.test(md));
  assert.ok(/never edits the KB/i.test(md));
  assert.ok(/verify each statement before acting/i.test(md));
  // the actual flag lines are spliced in
  assert.ok(md.includes('Claim two'));
  assert.ok(md.includes('VKFRI is a Danish school'));
  reset();
});

test('warningsBlock soft-fails to a clean "no open flags" line on empty', async () => {
  __setFlagSource(() => []);
  const md = await warningsBlock();
  assert.ok(md.includes('### Fact-check warnings (advisory)'));
  assert.ok(/No open fact-check flags/i.test(md));
  // it must NOT render a scary empty warning marker
  assert.ok(!md.includes('⚠'));
  // caveat still present even when empty
  assert.ok(/fallible/i.test(md));
  reset();
});

test('warningCount counts open flags', async () => {
  useSample();
  assert.equal(await warningCount(), 4);
  __setFlagSource(() => []);
  assert.equal(await warningCount(), 0);
  reset();
});

test('a thrown flag source → empty / no-throw everywhere', async () => {
  __setFlagSource(() => { throw new Error('boom'); });
  // none of these may throw; all degrade to empty
  assert.deepEqual(await allBriefWarnings(), []);
  assert.deepEqual(await briefWarningFor('knowledge/a.json'), []);
  assert.equal(await warningCount(), 0);
  const md = await warningsBlock();
  assert.ok(/No open fact-check flags/i.test(md));
  assert.ok(!md.includes('⚠'));
  reset();
});

test('non-array flag source → empty / no-throw', async () => {
  __setFlagSource(() => ({ not: 'an array' }));
  assert.deepEqual(await allBriefWarnings(), []);
  assert.equal(await warningCount(), 0);
  reset();
});
