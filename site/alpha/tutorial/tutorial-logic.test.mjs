// tutorial-logic.test.mjs — offline tests (node --test). No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  STORE_KEY, esc, readProgress, writeProgress, toggleStage, isActionable,
  stageStatus, progressSummary, nextOpenStage, stageById,
} from './tutorial-logic.mjs';
import { STAGE_DATA } from './stages-data.mjs';

// A tiny fake localStorage that records what was set.
function fakeStorage(initial) {
  let v = initial === undefined ? null : initial;
  return { getItem: () => v, setItem: (_k, val) => { v = val; }, _peek: () => v };
}

test('esc escapes interpolation', () => {
  assert.equal(esc('<b>&"\'x'), '&lt;b&gt;&amp;&quot;&#39;x');
});

test('STAGE_DATA embed has the 19 stages with the expected public shape', () => {
  assert.equal(STAGE_DATA.stages.length, 19);
  assert.equal(STAGE_DATA.currency, 'MELEK');
  const s1 = STAGE_DATA.stages[0];
  assert.deepEqual(Object.keys(s1).sort(),
    ['description', 'id', 'infra_gated', 'key', 'label', 'next_stage', 'tier'].sort());
  assert.equal(s1.id, 1);
  assert.equal(s1.key, 'intro_post');
});

test('readProgress: empty / missing / corrupt all read as empty set, never throws', () => {
  assert.equal(readProgress(fakeStorage(null)).size, 0);
  assert.equal(readProgress(fakeStorage('not json{')).size, 0);
  assert.equal(readProgress(fakeStorage('{"not":"array"}')).size, 0);
  assert.equal(readProgress(null).size, 0);
});

test('writeProgress then readProgress round-trips the completed keys', () => {
  const st = fakeStorage(null);
  assert.equal(writeProgress(st, new Set(['intro_post', 'power_up'])), true);
  assert.equal(st._peek(), JSON.stringify(['intro_post', 'power_up']));
  const back = readProgress(st);
  assert.ok(back.has('intro_post') && back.has('power_up') && back.size === 2);
});

test('writeProgress soft-fails (returns false) when storage throws', () => {
  const bad = { setItem: () => { throw new Error('quota'); } };
  assert.equal(writeProgress(bad, new Set(['x'])), false);
});

test('readProgress drops non-string entries', () => {
  assert.deepEqual([...readProgress(fakeStorage('["ok",1,null,"two"]'))], ['ok', 'two']);
});

test('toggleStage is immutable and flips / forces state', () => {
  const a = new Set(['intro_post']);
  const b = toggleStage(a, 'power_up');           // add (flip)
  assert.ok(b.has('power_up') && !a.has('power_up'));
  const c = toggleStage(b, 'intro_post');         // remove (flip)
  assert.ok(!c.has('intro_post'));
  const d = toggleStage(a, 'intro_post', true);   // force on (already on)
  assert.ok(d.has('intro_post'));
  const e = toggleStage(a, 'intro_post', false);  // force off
  assert.ok(!e.has('intro_post'));
});

test('isActionable: tier A & not infra_gated only', () => {
  assert.equal(isActionable({ tier: 'A', infra_gated: false }), true);
  assert.equal(isActionable({ tier: 'A', infra_gated: true }), false);
  assert.equal(isActionable({ tier: 'B', infra_gated: false }), false);
  assert.equal(isActionable({ tier: 'C', infra_gated: false }), false);
});

test('stageStatus reports done / gated / phase3 / open', () => {
  const done = new Set(['intro_post']);
  assert.equal(stageStatus({ key: 'intro_post', tier: 'A' }, done), 'done');
  assert.equal(stageStatus({ key: 'x', tier: 'B', infra_gated: true }, done), 'gated');
  assert.equal(stageStatus({ key: 'x', tier: 'C' }, done), 'phase3');
  assert.equal(stageStatus({ key: 'x', tier: 'A' }, done), 'open');
});

test('progressSummary counts the tier-A spine separately from total', () => {
  const s = progressSummary(STAGE_DATA.stages, new Set());
  assert.equal(s.total, 19);
  assert.equal(s.core, 10); // stages 1–10 are tier A, actionable now
  assert.equal(s.coreDone, 0);
  assert.equal(s.corePct, 0);
  const half = new Set(STAGE_DATA.stages.filter(isActionable).slice(0, 5).map((x) => x.key));
  const s2 = progressSummary(STAGE_DATA.stages, half);
  assert.equal(s2.coreDone, 5);
  assert.equal(s2.corePct, 50);
});

test('nextOpenStage walks the actionable spine in order', () => {
  assert.equal(nextOpenStage(STAGE_DATA.stages, new Set()).key, 'intro_post');
  const done = new Set(['intro_post', 'engage_three_posts']);
  assert.equal(nextOpenStage(STAGE_DATA.stages, done).key, 'share_what_you_know');
  const allCore = new Set(STAGE_DATA.stages.filter(isActionable).map((x) => x.key));
  assert.equal(nextOpenStage(STAGE_DATA.stages, allCore), null);
});

test('stageById finds by numeric id or string', () => {
  assert.equal(stageById(STAGE_DATA.stages, 1).key, 'intro_post');
  assert.equal(stageById(STAGE_DATA.stages, '6').key, 'vote_for_a_witness');
  assert.equal(stageById(STAGE_DATA.stages, 999), null);
});

test('STORE_KEY is versioned', () => {
  assert.match(STORE_KEY, /_v\d+$/);
});
