import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  STATES,
  createProposal,
  castVote,
  emptyTally,
  tallyResult,
  isOpen,
  renderMarkdown,
} from './governance-proposal.mjs';

test('STATES is frozen and in narrative order', () => {
  assert.deepEqual(STATES, ['draft', 'open', 'passed', 'rejected', 'expired']);
  assert.ok(Object.isFrozen(STATES));
  assert.throws(() => {
    'use strict';
    STATES.push('x');
  });
});

test('esc escapes HTML metacharacters and nullish', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('createProposal: defaults are sane and frozen', () => {
  const p = createProposal({});
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.options));
  assert.deepEqual(p.options, ['yes', 'no']);
  assert.equal(p.quorumPct, 20);
  assert.equal(p.thresholdPct, 50);
  assert.equal(p.opensAt, null);
  assert.equal(p.closesAt, null);
  assert.equal(p.title, '(untitled proposal)');
  assert.equal(p.id, 'proposal');
});

test('createProposal: clamps pcts to [0,100] and falls back on garbage', () => {
  const p = createProposal({ quorumPct: -5, thresholdPct: 250 });
  assert.equal(p.quorumPct, 0);
  assert.equal(p.thresholdPct, 100);
  const p2 = createProposal({ quorumPct: 'nope', thresholdPct: NaN });
  assert.equal(p2.quorumPct, 20);
  assert.equal(p2.thresholdPct, 50);
});

test('createProposal: de-dupes options, drops blanks, keeps order', () => {
  const p = createProposal({ options: ['Yes', '  ', 'no', 'yes', 'maybe'] });
  assert.deepEqual(p.options, ['Yes', 'no', 'maybe']);
});

test('createProposal: empty/garbage option list defaults to yes/no', () => {
  assert.deepEqual(createProposal({ options: [] }).options, ['yes', 'no']);
  assert.deepEqual(createProposal({ options: ['  ', ''] }).options, ['yes', 'no']);
  assert.deepEqual(createProposal({ options: 'notarray' }).options, ['yes', 'no']);
});

test('createProposal: drops closesAt that precedes opensAt', () => {
  const p = createProposal({ opensAt: 2000, closesAt: 1000 });
  assert.equal(p.opensAt, 2000);
  assert.equal(p.closesAt, null);
});

test('createProposal: non-object input soft-fails to defaults', () => {
  const p = createProposal(null);
  assert.equal(p.id, 'proposal');
  assert.deepEqual(p.options, ['yes', 'no']);
});

test('castVote: records a valid vote immutably and freezes', () => {
  const p = createProposal({});
  const t0 = emptyTally();
  const t1 = castVote(t0, { voter: 'alice', option: 'yes', weight: 5 }, p);
  assert.ok(Object.isFrozen(t1));
  assert.ok(Object.isFrozen(t1.votes));
  assert.deepEqual(t1.votes.alice, { option: 'yes', weight: 5 });
  // original untouched
  assert.deepEqual(t0.votes, {});
});

test('castVote: last vote wins per voter', () => {
  const p = createProposal({});
  let t = emptyTally();
  t = castVote(t, { voter: 'alice', option: 'yes', weight: 5 }, p);
  t = castVote(t, { voter: 'alice', option: 'no', weight: 9 }, p);
  assert.equal(Object.keys(t.votes).length, 1);
  assert.deepEqual(t.votes.alice, { option: 'no', weight: 9 });
});

test('castVote: ignores unknown option (against proposal option set)', () => {
  const p = createProposal({ options: ['yes', 'no'] });
  const t = castVote(emptyTally(), { voter: 'a', option: 'maybe', weight: 5 }, p);
  assert.deepEqual(t.votes, {});
});

test('castVote: ignores non-positive / non-finite weight and missing voter', () => {
  const p = createProposal({});
  assert.deepEqual(castVote(emptyTally(), { voter: 'a', option: 'yes', weight: 0 }, p).votes, {});
  assert.deepEqual(castVote(emptyTally(), { voter: 'a', option: 'yes', weight: -3 }, p).votes, {});
  assert.deepEqual(
    castVote(emptyTally(), { voter: 'a', option: 'yes', weight: NaN }, p).votes,
    {},
  );
  assert.deepEqual(castVote(emptyTally(), { voter: '', option: 'yes', weight: 5 }, p).votes, {});
});

test('castVote: without proposal, any non-empty option is accepted', () => {
  const t = castVote(emptyTally(), { voter: 'a', option: 'anything', weight: 2 }, null);
  assert.deepEqual(t.votes.a, { option: 'anything', weight: 2 });
});

test('castVote: soft-fails on garbage tally/vote without throwing', () => {
  const t = castVote(null, null, null);
  assert.ok(Object.isFrozen(t));
  assert.deepEqual(t.votes, {});
});

test('isOpen: window bounds', () => {
  const p = createProposal({ opensAt: 100, closesAt: 200 });
  assert.equal(isOpen(p, 50), false);
  assert.equal(isOpen(p, 100), true);
  assert.equal(isOpen(p, 150), true);
  assert.equal(isOpen(p, 200), true);
  assert.equal(isOpen(p, 201), false);
});

test('isOpen: open-ended bounds and bad input', () => {
  assert.equal(isOpen(createProposal({}), 999), true);
  assert.equal(isOpen(createProposal({ opensAt: 100 }), 999), true);
  assert.equal(isOpen(null, 1), false);
  assert.equal(isOpen(createProposal({}), 'nope'), false);
});

test('tallyResult: turnout, leading, pcts, quorum, threshold, passed', () => {
  const p = createProposal({
    options: ['yes', 'no'],
    quorumPct: 20,
    thresholdPct: 50,
    opensAt: 1000,
    closesAt: 2000,
  });
  let t = emptyTally();
  t = castVote(t, { voter: 'a', option: 'yes', weight: 30 }, p);
  t = castVote(t, { voter: 'b', option: 'no', weight: 10 }, p);
  // total cast = 40, eligible = 100 -> turnout 40%
  const r = tallyResult(p, t, 100, 2500); // after close
  assert.equal(r.turnoutPct, 40);
  assert.equal(r.leadingOption, 'yes');
  assert.equal(r.optionPcts.yes, 75);
  assert.equal(r.optionPcts.no, 25);
  assert.equal(r.quorumMet, true);
  assert.equal(r.thresholdMet, true);
  assert.equal(r.state, 'passed');
});

test('tallyResult: quorum not met after close => expired', () => {
  const p = createProposal({ quorumPct: 50, thresholdPct: 50, opensAt: 0, closesAt: 100 });
  let t = emptyTally();
  t = castVote(t, { voter: 'a', option: 'yes', weight: 10 }, p);
  const r = tallyResult(p, t, 100, 200); // 10% turnout < 50% quorum
  assert.equal(r.quorumMet, false);
  assert.equal(r.state, 'expired');
});

test('tallyResult: quorum met but threshold not met => rejected', () => {
  const p = createProposal({
    options: ['yes', 'no'],
    quorumPct: 20,
    thresholdPct: 60,
    opensAt: 0,
    closesAt: 100,
  });
  let t = emptyTally();
  t = castVote(t, { voter: 'a', option: 'yes', weight: 25 }, p);
  t = castVote(t, { voter: 'b', option: 'no', weight: 25 }, p);
  const r = tallyResult(p, t, 100, 200); // 50% turnout ok; yes=50% < 60%
  assert.equal(r.quorumMet, true);
  assert.equal(r.thresholdMet, false);
  assert.equal(r.state, 'rejected');
});

test('tallyResult: before open => draft, during window => open', () => {
  const p = createProposal({ opensAt: 100, closesAt: 200 });
  assert.equal(tallyResult(p, emptyTally(), 100, 50).state, 'draft');
  assert.equal(tallyResult(p, emptyTally(), 100, 150).state, 'open');
});

test('tallyResult: no nowTs => draft', () => {
  const p = createProposal({ opensAt: 100, closesAt: 200 });
  assert.equal(tallyResult(p, emptyTally(), 100, undefined).state, 'draft');
});

test('tallyResult: empty tally yields zeros and null leader', () => {
  const p = createProposal({ opensAt: 0, closesAt: 100 });
  const r = tallyResult(p, emptyTally(), 100, 50);
  assert.equal(r.turnoutPct, 0);
  assert.equal(r.leadingOption, null);
  assert.equal(r.optionPcts.yes, 0);
  assert.equal(r.quorumMet, false);
});

test('tallyResult: tie resolves to first-declared option', () => {
  const p = createProposal({ options: ['no', 'yes'], quorumPct: 0, thresholdPct: 0, opensAt: 0, closesAt: 100 });
  let t = emptyTally();
  t = castVote(t, { voter: 'a', option: 'no', weight: 5 }, p);
  t = castVote(t, { voter: 'b', option: 'yes', weight: 5 }, p);
  const r = tallyResult(p, t, 100, 200);
  assert.equal(r.leadingOption, 'no'); // first declared wins the tie
});

test('tallyResult: zero/garbage eligible weight => 0 turnout, quorum false', () => {
  const p = createProposal({ opensAt: 0, closesAt: 100 });
  let t = castVote(emptyTally(), { voter: 'a', option: 'yes', weight: 10 }, p);
  const r = tallyResult(p, t, 0, 200);
  assert.equal(r.turnoutPct, 0);
  assert.equal(r.quorumMet, false);
  const r2 = tallyResult(p, t, 'garbage', 200);
  assert.equal(r2.turnoutPct, 0);
});

test('tallyResult: ignores stray non-option votes in tally', () => {
  const p = createProposal({ options: ['yes', 'no'], quorumPct: 0, thresholdPct: 0, opensAt: 0, closesAt: 100 });
  // hand-build a tally with a stale option not in the proposal
  const tally = { votes: { a: { option: 'yes', weight: 10 }, b: { option: 'maybe', weight: 99 } } };
  const r = tallyResult(p, tally, 100, 200);
  assert.equal(r.turnoutPct, 10); // 'maybe' excluded
  assert.equal(r.leadingOption, 'yes');
});

test('tallyResult: soft-fails on null proposal/tally', () => {
  const r = tallyResult(null, null, 100, 200);
  assert.ok(STATES.includes(r.state));
  assert.equal(r.turnoutPct, 0);
});

test('renderMarkdown: deterministic, escapes, marks leader', () => {
  const p = createProposal({
    id: 'mip-1',
    title: '<Fund> "school"',
    options: ['yes', 'no'],
    opensAt: 0,
    closesAt: 100,
  });
  let t = castVote(emptyTally(), { voter: 'a', option: 'yes', weight: 30 }, p);
  const r = tallyResult(p, t, 100, 200);
  const md = renderMarkdown(p, r);
  assert.ok(md.includes('&lt;Fund&gt; &quot;school&quot;'));
  assert.ok(md.includes('**State:** passed'));
  assert.ok(md.includes('yes: 100%'));
  assert.ok(md.includes('←')); // leader marker
  // determinism
  assert.equal(md, renderMarkdown(p, r));
});

test('renderMarkdown: soft-fails on garbage args', () => {
  const md = renderMarkdown(null, null);
  assert.equal(typeof md, 'string');
  assert.ok(md.includes('# Proposal:'));
});
