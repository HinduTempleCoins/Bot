// hashtag-trigger.test.mjs — offline tests for the pure hashtag trigger evaluator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTags, matchRules, computeReward, dedupeTriggers } from './hashtag-trigger.mjs';

test('parseTags: normalizes, lowercases, dedupes from a string', () => {
  const tags = parseTags('Loving #MELEK and #prana, also #Melek again');
  assert.deepEqual(tags, ['loving', 'melek', 'and', 'prana', 'also', 'again']);
});

test('parseTags: reads {title, body, tags} object', () => {
  const tags = parseTags({ title: '#Hello', body: 'a #world post', tags: ['MELEK', 'prana'] });
  assert.ok(tags.includes('hello'));
  assert.ok(tags.includes('world'));
  assert.ok(tags.includes('melek'));
  assert.ok(tags.includes('prana'));
});

test('parseTags: soft-fail on garbage input -> []', () => {
  assert.deepEqual(parseTags(null), []);
  assert.deepEqual(parseTags(42), []);
  assert.deepEqual(parseTags(undefined), []);
});

test('matchRules: only configured tags fire', () => {
  const post = { title: 'a #melek post about #prana', body: '' };
  const rules = [
    { tag: 'melek', weightPct: 50, rewardToken: 'MBD', minStake: 10 },
    { tag: 'unused', weightPct: 100, rewardToken: 'X' },
  ];
  const matched = matchRules(post, rules);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].tag, 'melek');
  assert.equal(matched[0].rewardToken, 'MBD');
});

test('matchRules: handles "#tag" prefix and case in rule config', () => {
  const matched = matchRules('post #PRANA', [{ tag: '#Prana', weightPct: 30 }]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].tag, 'prana');
});

test('matchRules: clamps weightPct to [0,100] and drops bad rules', () => {
  const matched = matchRules('#a #b', [
    { tag: 'a', weightPct: 999 },
    { tag: '', weightPct: 50 },      // bad tag -> dropped
    { notARule: true },              // -> dropped
    { tag: 'b', weightPct: -5 },
  ]);
  assert.equal(matched.length, 2);
  assert.equal(matched.find((m) => m.tag === 'a').weightPct, 100);
  assert.equal(matched.find((m) => m.tag === 'b').weightPct, 0);
});

test('matchRules: soft-fail on non-array rules -> []', () => {
  assert.deepEqual(matchRules('#x', null), []);
  assert.deepEqual(matchRules('#x', {}), []);
});

test('computeReward: stake-weighted amount within pool', () => {
  const matched = [{ tag: 'melek', weightPct: 50, rewardToken: 'MBD', minStake: 10 }];
  const r = computeReward({ matched, voterStake: 100, pools: { MBD: 1000 } });
  assert.equal(r.ok, true);
  assert.equal(r.rewards.length, 1);
  assert.equal(r.rewards[0].amount, 50); // 50% of 100
  assert.equal(r.rewards[0].capped, false);
});

test('computeReward: caps reward at remaining pool balance', () => {
  const matched = [{ tag: 'melek', weightPct: 100, rewardToken: 'MBD', minStake: 0 }];
  const r = computeReward({ matched, voterStake: 100, pools: { MBD: 30 } });
  assert.equal(r.rewards[0].amount, 30);
  assert.equal(r.rewards[0].capped, true);
});

test('computeReward: pools deplete across rules, no double-spend', () => {
  const matched = [
    { tag: 'a', weightPct: 100, rewardToken: 'MBD', minStake: 0 },
    { tag: 'b', weightPct: 100, rewardToken: 'MBD', minStake: 0 },
  ];
  const r = computeReward({ matched, voterStake: 100, pools: { MBD: 120 } });
  assert.equal(r.rewards[0].amount, 100); // takes 100
  assert.equal(r.rewards[1].amount, 20);  // only 20 left
  assert.equal(r.rewards[1].capped, true);
});

test('computeReward: minStake gate skips under-staked author', () => {
  const matched = [{ tag: 'prana', weightPct: 100, rewardToken: 'PRANA', minStake: 1000 }];
  const r = computeReward({ matched, voterStake: 100, pools: { PRANA: 5000 } });
  assert.equal(r.ok, true);
  assert.equal(r.rewards.length, 0); // gated out
});

test('computeReward: vote-only rule (no token) yields no payout row', () => {
  const matched = [{ tag: 'vouch', weightPct: 25, rewardToken: null, minStake: 0 }];
  const r = computeReward({ matched, voterStake: 100, pools: {} });
  assert.equal(r.ok, true);
  assert.equal(r.rewards.length, 0);
});

test('computeReward: soft-fail on bad input -> {ok:false}', () => {
  assert.equal(computeReward({ matched: null, voterStake: 1, pools: {} }).ok, false);
  assert.equal(computeReward({ matched: [], voterStake: -5, pools: {} }).ok, false);
  assert.equal(computeReward().ok, false);
});

test('dedupeTriggers: drops tag already fired for that author in window', () => {
  const now = 1_000_000_000_000;
  const matched = [
    { tag: 'melek', author: 'alice' },
    { tag: 'prana', author: 'alice' },
  ];
  const history = [{ author: 'alice', tag: 'melek', at: now - 60_000 }]; // 1 min ago
  const fresh = dedupeTriggers(matched, history, 3600, now); // 1h window
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].tag, 'prana');
});

test('dedupeTriggers: tag outside the window is allowed through', () => {
  const now = 1_000_000_000_000;
  const matched = [{ tag: 'melek', author: 'alice' }];
  const history = [{ author: 'alice', tag: 'melek', at: now - 7200_000 }]; // 2h ago
  const fresh = dedupeTriggers(matched, history, 3600, now); // 1h window -> expired
  assert.equal(fresh.length, 1);
});

test('dedupeTriggers: per-author scoping — other author unaffected', () => {
  const now = 1_000_000_000_000;
  const matched = [{ tag: 'melek', author: 'bob' }];
  const history = [{ author: 'alice', tag: 'melek', at: now - 60_000 }];
  const fresh = dedupeTriggers(matched, history, 3600, now);
  assert.equal(fresh.length, 1); // bob never triggered it
});

test('dedupeTriggers: collapses duplicate tag within the same batch', () => {
  const now = 1_000_000_000_000;
  const matched = [
    { tag: 'melek', author: 'alice' },
    { tag: 'melek', author: 'alice' },
  ];
  const fresh = dedupeTriggers(matched, [], 3600, now);
  assert.equal(fresh.length, 1);
});

test('dedupeTriggers: soft-fail on bad matched -> []', () => {
  assert.deepEqual(dedupeTriggers(null, [], 3600, 1), []);
});

test('dedupeTriggers: injectable now is honored (no Date.now dependence)', () => {
  const matched = [{ tag: 'x', author: 'a' }];
  const history = [{ author: 'a', tag: 'x', at: 500 }];
  // now=600, window 1s -> cutoff 500*... within window -> dropped
  assert.equal(dedupeTriggers(matched, history, 1, 600).length, 0);
  // now=2000, window 1s -> cutoff 1000, history at 500 is expired -> allowed
  assert.equal(dedupeTriggers(matched, history, 1, 2000).length, 1);
});
