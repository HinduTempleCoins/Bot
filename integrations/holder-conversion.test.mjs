import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAINS, BLACKLISTED_ON_HIVE, actorFor, TARGETING, selectTargets, isEligibleShape,
  createLedger, plan, explain, handler,
} from './holder-conversion.mjs';

const row = (o) => ({
  account: 'someone', vkbt: 500, cure: 20, hive_last_post_days: 3,
  steem_active: true, blurt_active: true, ...o,
});

test('the Hive actor is the clean account, never a blacklisted one', () => {
  assert.equal(CHAINS.hive.account, 'melek');
  for (const bad of ['kalivankush', 'punicwax', 'vankushfamily']) {
    assert.ok(BLACKLISTED_ON_HIVE.includes(bad), `${bad} must be on the never-use list`);
  }
  assert.equal(actorFor('hive').account, 'melek');
  assert.equal(actorFor('nope'), null);
});

test('punicwax is usable on Blurt — the blacklist is a HIVE list', () => {
  assert.equal(CHAINS.blurt.account, 'punicwax');
  assert.equal(actorFor('blurt').account, 'punicwax');
  assert.match(CHAINS.blurt.note, /separate chain and unaffected/);
});

test('dust holders are excluded — the point is a channel, not a headcount', () => {
  const rows = [row({ account: 'dust', vkbt: 0.07, cure: 0.0003 }), row({ account: 'real' })];
  const t = selectTargets(rows, 'hive');
  assert.equal(t.length, 1);
  assert.equal(t[0].account, 'real');
});

test('dormant holders are excluded on Hive', () => {
  const rows = [row({ account: 'gone', hive_last_post_days: 900 }), row({ account: 'here' })];
  assert.deepEqual(selectTargets(rows, 'hive').map((x) => x.account), ['here']);
});

test('per-chain activity is respected, not assumed from Hive', () => {
  const rows = [
    row({ account: 'hiveonly', steem_active: false, blurt_active: false }),
    row({ account: 'everywhere' }),
  ];
  assert.equal(selectTargets(rows, 'hive').length, 2);
  assert.deepEqual(selectTargets(rows, 'steem').map((x) => x.account), ['everywhere']);
  assert.deepEqual(selectTargets(rows, 'blurt').map((x) => x.account), ['everywhere']);
});

test('CURE is weighted against its much smaller supply', () => {
  const rows = [row({ account: 'bigvkbt', vkbt: 1000, cure: 0 }), row({ account: 'bigcure', vkbt: 0, cure: 100 })];
  const t = selectTargets(rows, 'hive');
  assert.equal(t[0].account, 'bigcure', '100 CURE outranks 1000 VKBT at a 30x weight');
});

test('a string "true" from a CSV is honoured as well as a real boolean', () => {
  const rows = [row({ account: 'csvish', steem_active: 'true' })];
  assert.equal(selectTargets(rows, 'steem').length, 1);
});

test('the wrong input file is caught immediately, not via an empty run', () => {
  const csvShape = [{ hive_account: 'x', reach_score: '50', holds: 'VKBT+CURE', email: '' }];
  const s = isEligibleShape(csvShape);
  assert.equal(s.ok, false);
  assert.match(s.why, /HOLDERS_CONTACTS\.csv/);
  assert.match(s.why, /HOLDERS_shortlist\.json/);
  const p = plan({ rows: csvShape, chain: 'hive' });
  assert.equal(p.refused, true);
  assert.match(p.reason, /missing vkbt/);
});

test('an empty input is refused rather than silently producing nothing', () => {
  assert.equal(isEligibleShape([]).ok, false);
  assert.equal(plan({ rows: [], chain: 'hive' }).refused, true);
});

test('the ledger prevents following the same account twice, per chain', () => {
  const l = createLedger();
  assert.equal(l.has('hive', 'alice'), false);
  l.record({ chain: 'hive', account: 'Alice' });
  assert.equal(l.has('hive', 'alice'), true, 'case-insensitive');
  assert.equal(l.has('steem', 'alice'), false, 'a different chain is a different follow');
  assert.equal(l.size, 1);
});

test('already-followed accounts drop out of the next plan', () => {
  const rows = [row({ account: 'a' }), row({ account: 'b' })];
  const l = createLedger();
  const first = plan({ rows, chain: 'hive', ledger: l });
  assert.equal(first.targets.length, 2);
  l.record({ chain: 'hive', account: 'a' });
  const second = plan({ rows, chain: 'hive', ledger: l });
  assert.deepEqual(second.targets.map((x) => x.account), ['b']);
});

test('the ops are follow custom_json with POSTING auth only — they cannot move funds', () => {
  const p = plan({ rows: [row({ account: 'a' })], chain: 'hive' });
  assert.equal(p.ok, true);
  const [name, op] = p.ops[0];
  assert.equal(name, 'custom_json');
  assert.equal(op.id, 'follow');
  assert.deepEqual(op.required_auths, [], 'ACTIVE auth must be empty — that is what moves funds');
  assert.deepEqual(op.required_posting_auths, ['melek']);
  const parsed = JSON.parse(op.json);
  assert.equal(parsed[0], 'follow');
  assert.equal(parsed[1].follower, 'melek');
  assert.equal(parsed[1].following, 'a');
});

test('a run is capped and paced so it does not look like a bot farm', () => {
  const rows = Array.from({ length: 500 }, (_, i) => row({ account: `a${i}` }));
  const p = plan({ rows, chain: 'hive' });
  assert.equal(p.ops.length, TARGETING.maxPerRun);
  assert.ok(TARGETING.maxPerRun <= 50);
  assert.ok(TARGETING.minDelayMs >= 5000, 'slow enough to be human-plausible');
  assert.ok(p.pacing.estimatedMinutes >= 5);
});

test('explain reads out the exposure before anything is signed', () => {
  const p = plan({ rows: [row({ account: 'whale', vkbt: 9000, cure: 100 })], chain: 'hive' });
  const t = explain(p);
  assert.match(t, /follow 1 holders as @melek/);
  assert.match(t, /@whale/);
  assert.match(t, /posting authority only/);
  assert.match(explain(plan({ rows: [], chain: 'hive' })), /^REFUSED/);
  assert.equal(explain(null), '');
});

test('handler states the policy plainly', () => {
  const res = { statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  handler({ url: '/hc' }, res);
  const j = JSON.parse(res.body);
  assert.match(j.policy, /Follows only/);
  assert.match(j.policy, /about 800, not 25,375/);
  assert.match(j.policy, /broadcasts nothing/);
});
