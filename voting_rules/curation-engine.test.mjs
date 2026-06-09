/**
 * voting_rules/curation-engine.test.mjs — offline, deterministic.
 *
 * Covers: gating (body/rep/age/blacklist/self-deal), sub-score math, score→
 * weight mapping, threshold skip, whitelist bypass, penalize-tag demotion,
 * daily vote-count + weight budgets, deterministic plan ordering, op shaping,
 * and soft-fail on garbage input. No network, no clock dependence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreCandidate,
  voteplan,
  intentsToVoteOps,
  resolveRules,
  DEFAULT_RULES,
  MAX_WEIGHT,
} from './curation-engine.mjs';

// A strong candidate that comfortably clears every gate and threshold.
const GOOD = {
  author: 'alice',
  permlink: 'real-intro',
  authorRep: 60,
  tags: ['introduceyourself', 'melek'],
  bodyLen: 1600,
  payout: 0.1,
  ageMin: 45,
};

test('scoreCandidate: a genuine post passes and gets a positive weight', () => {
  const r = scoreCandidate(GOOD);
  assert.ok(r.score > 0.45, `score ${r.score} should clear threshold`);
  assert.ok(r.weightPct >= DEFAULT_RULES.minVotePct, 'at least minVotePct');
  assert.ok(r.weightPct <= DEFAULT_RULES.maxVotePct, 'no more than maxVotePct');
  assert.match(r.reason, /pass/);
  assert.ok(r.subscores && typeof r.subscores.rep === 'number');
});

test('scoreCandidate is deterministic for identical input', () => {
  assert.deepEqual(scoreCandidate(GOOD), scoreCandidate(GOOD));
});

test('gate: body too short → skip, zero weight', () => {
  const r = scoreCandidate({ ...GOOD, bodyLen: 100 });
  assert.equal(r.weightPct, 0);
  assert.equal(r.score, 0);
  assert.match(r.reason, /body too short/);
});

test('gate: author rep too low → skip', () => {
  const r = scoreCandidate({ ...GOOD, authorRep: 5 });
  assert.equal(r.weightPct, 0);
  assert.match(r.reason, /rep too low/);
});

test('gate: too fresh and past-window both skip', () => {
  assert.match(scoreCandidate({ ...GOOD, ageMin: 1 }).reason, /too fresh/);
  assert.match(scoreCandidate({ ...GOOD, ageMin: 99999 }).reason, /past payout window/);
});

test('gate: blacklisted author always skips, even if otherwise great', () => {
  const r = scoreCandidate({ ...GOOD, authorRep: 90 }, { blacklist: ['Alice'] });
  assert.equal(r.weightPct, 0);
  assert.match(r.reason, /blacklist/);
});

test('gate: self/affiliated account never curated (no self-deal)', () => {
  const r = scoreCandidate({ ...GOOD, author: 'hathor' });
  assert.equal(r.weightPct, 0);
  assert.match(r.reason, /self/);
});

test('whitelist bypasses quality gates but is still scored', () => {
  // Short body + low rep would normally be gated out.
  const thin = { ...GOOD, authorRep: 1, bodyLen: 50 };
  const gated = scoreCandidate(thin);
  assert.equal(gated.weightPct, 0, 'gated without whitelist');
  const wl = scoreCandidate(thin, { whitelist: ['alice'] });
  assert.ok(wl.weightPct > 0, 'whitelisted passes gates');
  assert.match(wl.reason, /whitelisted/);
});

test('blacklist beats whitelist', () => {
  const r = scoreCandidate(GOOD, { whitelist: ['alice'], blacklist: ['alice'] });
  assert.equal(r.weightPct, 0);
  assert.match(r.reason, /blacklist/);
});

test('penalize-tag demotes score (can push below threshold)', () => {
  const base = scoreCandidate(GOOD);
  const pen = scoreCandidate({ ...GOOD, tags: [...GOOD.tags, 'nsfw'] });
  assert.ok(pen.score < base.score, 'penalize tag lowers score');
});

test('higher reputation yields higher score (monotonic in rep)', () => {
  const lo = scoreCandidate({ ...GOOD, authorRep: 30 }).score;
  const hi = scoreCandidate({ ...GOOD, authorRep: 70 }).score;
  assert.ok(hi > lo, `rep70 (${hi}) should beat rep30 (${lo})`);
});

test('lower pending payout yields more curation room → higher score', () => {
  const fresh = scoreCandidate({ ...GOOD, payout: 0 }).score;
  const rich = scoreCandidate({ ...GOOD, payout: 4.5 }).score;
  assert.ok(fresh > rich, `low-payout (${fresh}) beats high-payout (${rich})`);
});

test('below-threshold post is reported as a skip with a clear reason', () => {
  // High rep but off-topic, low body, near-end-of-window → low score.
  const weak = { author: 'eve', permlink: 'meh', authorRep: 26, tags: ['random'], bodyLen: 300, payout: 4, ageMin: 8000 };
  const r = scoreCandidate(weak);
  assert.equal(r.weightPct, 0);
  assert.match(r.reason, /below threshold|past payout/);
});

test('soft-fail: garbage / empty input never throws, returns a skip', () => {
  for (const bad of [undefined, null, {}, { author: 123, tags: 'nope', bodyLen: 'x' }]) {
    const r = scoreCandidate(bad);
    assert.equal(typeof r.score, 'number');
    assert.equal(r.weightPct, 0);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  }
});

test('resolveRules merges weights one level deep', () => {
  const r = resolveRules({ weights: { rep: 0.9 } });
  assert.equal(r.weights.rep, 0.9, 'override applied');
  assert.equal(r.weights.body, DEFAULT_RULES.weights.body, 'untouched default kept');
});

// ── voteplan ────────────────────────────────────────────────────────────────

const BATCH = [
  GOOD,                                                              // strong, votes
  { author: 'bob', permlink: 'spam', authorRep: 40, tags: ['spam'], bodyLen: 90, payout: 0, ageMin: 20 },     // gated (short)
  { author: 'carol', permlink: 'howto', authorRep: 68, tags: ['witness-school', 'convergence'], bodyLen: 2600, payout: 0.2, ageMin: 120 }, // strong
  { author: 'hathor', permlink: 'self', authorRep: 80, tags: ['melek'], bodyLen: 3000, payout: 0, ageMin: 60 },  // self-deal skip
];

test('voteplan: never broadcasts and separates intents from skips', () => {
  const plan = voteplan(BATCH, {}, { votesToday: 0, weightSpentToday: 0 });
  assert.equal(plan.broadcast, false, 'engine NEVER broadcasts');
  assert.ok(plan.intents.length >= 2, 'alice + carol vote');
  assert.ok(plan.skipped.some((s) => s.author === 'bob'), 'bob gated out');
  assert.ok(plan.skipped.some((s) => s.author === 'hathor'), 'self-deal skipped');
});

test('voteplan: intents ordered by score descending (deterministic)', () => {
  const plan = voteplan(BATCH, {});
  for (let i = 1; i < plan.intents.length; i++) {
    assert.ok(plan.intents[i - 1].score >= plan.intents[i].score, 'sorted by score desc');
  }
  // Same input → identical plan.
  assert.deepEqual(voteplan(BATCH, {}), voteplan(BATCH, {}));
});

test('voteplan: daily vote-count budget caps the number of intents', () => {
  const plan = voteplan(BATCH, { dailyVoteBudget: 1 }, { votesToday: 0, weightSpentToday: 0 });
  assert.equal(plan.intents.length, 1, 'only one vote fits the count budget');
  assert.ok(plan.skipped.some((s) => /vote-count budget exhausted/.test(s.reason)));
  assert.equal(plan.budget.votesLeft, 0);
});

test('voteplan: respects votes already cast today in state', () => {
  const plan = voteplan(BATCH, { dailyVoteBudget: 3 }, { votesToday: 3, weightSpentToday: 0 });
  assert.equal(plan.intents.length, 0, 'budget already spent before this batch');
  assert.ok(plan.skipped.every((s) => /budget exhausted|gated|short|self|threshold|below|fresh|window|blacklist/i.test(s.reason)));
});

test('voteplan: total weight budget is enforced', () => {
  // Tiny weight budget → at most one vote even if count budget is generous.
  const plan = voteplan(BATCH, { dailyVoteBudget: 99, dailyWeightBudget: 20 }, { votesToday: 0, weightSpentToday: 0 });
  assert.ok(plan.budget.weightUsed <= 20, `weightUsed ${plan.budget.weightUsed} within budget`);
  assert.ok(plan.skipped.some((s) => /weight budget exhausted/.test(s.reason)) || plan.intents.length <= 1);
});

test('voteplan: weightUsed accounting is consistent with intents', () => {
  const plan = voteplan(BATCH, {}, { votesToday: 0, weightSpentToday: 0 });
  const sum = plan.intents.reduce((a, i) => a + i.weightPct, 0);
  assert.ok(Math.abs(sum - plan.budget.weightUsed) < 0.01, 'budget.weightUsed equals sum of intent weights');
  assert.equal(plan.budget.votesUsed, plan.intents.length);
});

test('voteplan: soft-fail on non-array posts', () => {
  const plan = voteplan(null, {});
  assert.deepEqual(plan.intents, []);
  assert.equal(plan.broadcast, false);
});

// ── intentsToVoteOps ─────────────────────────────────────────────────────────

test('intentsToVoteOps: maps % to Graphene 0..10000 weight with voter set', () => {
  const ops = intentsToVoteOps([{ author: 'Alice', permlink: 'p', weightPct: 50 }], 'Hathor');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].voter, 'hathor');
  assert.equal(ops[0].author, 'alice');
  assert.equal(ops[0].weight, MAX_WEIGHT / 2, '50% → 5000');
});

test('intentsToVoteOps: clamps and defaults voter, never exceeds MAX_WEIGHT', () => {
  const ops = intentsToVoteOps([{ author: 'x', permlink: 'p', weightPct: 999 }]);
  assert.equal(ops[0].voter, 'hathor');
  assert.equal(ops[0].weight, MAX_WEIGHT);
});

test('intentsToVoteOps: soft-fail on garbage', () => {
  assert.deepEqual(intentsToVoteOps(null), []);
  assert.deepEqual(intentsToVoteOps(undefined, 'h'), []);
});
