// token-exams.test.mjs — OFFLINE. Every dependency is injected; no network, no clock, no disk.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  KINDS, PROCESSES, QUESTIONS, PASS_MARK, isPayableKind, verifyProcess, examHealth,
  servableQuestions, buildExam, grade, rewardEligible, seedFrom, handler,
} from './token-exams.mjs';

// A registry shaped like commands/menu.mjs COMMANDS.
const cmds = (names) => names.map((n) => ({ name: n, handler: () => {} }));
const ALL = { commands: cmds(['help', 'balance', 'price', 'witness', 'signup', 'tutorial']), headBlock: 1037959, engine: true, pool: true };

// ── the payment boundary ──────────────────────────────────────────────────────────────────────────
test('knowledge is payable, perception never is — and the reason is recorded', () => {
  assert.equal(isPayableKind('knowledge'), true);
  assert.equal(isPayableKind('perception'), false);
  assert.match(KINDS.perception.why, /measurement IS the product/);
  assert.equal(isPayableKind('anything-else'), false, 'unknown kinds are not payable');
});

test('a perception exam cannot be paid even when it passed', () => {
  const r = rewardEligible({ exam: { questions: [] }, result: { passed: true }, deps: ALL, kind: 'perception' });
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.some((x) => /never payable/.test(x)));
});

// ── the exam tests US ─────────────────────────────────────────────────────────────────────────────
test('with no dependencies NOTHING is servable — "could not check" is not "works"', () => {
  const h = examHealth({});
  assert.equal(h.servable, 0);
  assert.equal(h.withheld, QUESTIONS.length);
  assert.equal(h.healthy, false);
  assert.ok(h.brokenProcesses.length);
});

test('a missing command makes exactly the questions that test it unservable', () => {
  const deps = { ...ALL, commands: cmds(['help', 'price', 'witness', 'signup', 'tutorial']) }; // balance removed
  const h = examHealth(deps);
  const bal = h.rows.find((r) => r.id === 'q-balance');
  assert.equal(bal.servable, false);
  assert.match(bal.detail, /!balance is not in the command registry/);
  assert.ok(h.rows.find((r) => r.id === 'q-help').servable, 'other questions are unaffected');
});

test('a command present but with no handler is BROKEN, not present', () => {
  const deps = { ...ALL, commands: [...cmds(['help', 'price', 'witness', 'signup', 'tutorial']), { name: 'balance' }] };
  const v = verifyProcess('command:balance', deps);
  assert.equal(v.ok, false);
  assert.match(v.detail, /no handler/);
});

test('a stopped chain withholds every chain question', () => {
  const h = examHealth({ ...ALL, headBlock: 0 });
  assert.equal(h.rows.find((r) => r.id === 'q-blocks').servable, false);
  assert.ok(h.brokenProcesses.some((p) => p.id === 'chain:head'));
});

test('a probe that throws is a broken process, not a crash', () => {
  const boom = { get commands() { throw new Error('registry exploded'); } };
  const v = verifyProcess('command:help', boom);
  assert.equal(v.ok, false);
  assert.match(v.detail, /probe threw/);
});

test('an unknown process can never be verified', () => {
  assert.equal(verifyProcess('command:nonexistent', ALL).ok, false);
  assert.equal(verifyProcess('', ALL).ok, false);
});

test('every question in the bank points at a process that actually exists', () => {
  for (const q of QUESTIONS) {
    assert.ok(PROCESSES[q.verifies], `${q.id} references unknown process ${q.verifies}`);
    assert.ok(q.explain && q.teaches, `${q.id} must teach something and explain itself`);
  }
});

test('with everything up, the whole bank is servable and health is clean', () => {
  const h = examHealth(ALL);
  assert.equal(h.healthy, true);
  assert.equal(h.withheld, 0);
  assert.equal(servableQuestions(ALL).length, QUESTIONS.length);
});

// ── building a paper ──────────────────────────────────────────────────────────────────────────────
test('an exam is withheld entirely rather than asking about a broken system', () => {
  const e = buildExam({ candidate: 'alice', deps: {} });
  assert.equal(e.ok, false);
  assert.equal(e.code, 'no-servable-questions');
  assert.deepEqual(e.questions, []);
  assert.ok(e.brokenProcesses.length, 'and it says what is broken');
});

test('the same candidate gets the same paper twice; two candidates get different ones', () => {
  const a1 = buildExam({ candidate: 'alice', deps: ALL, count: 5 });
  const a2 = buildExam({ candidate: 'alice', deps: ALL, count: 5 });
  const b = buildExam({ candidate: 'bob', deps: ALL, count: 5 });
  assert.deepEqual(a1.questions.map((q) => q.id), a2.questions.map((q) => q.id), 'deterministic per candidate');
  assert.notDeepEqual(a1.questions.map((q) => q.id), b.questions.map((q) => q.id));
});

test('ANTI-SHARING: the correct letter differs between candidates on the same question', () => {
  const shared = [];
  for (const who of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank']) {
    const e = buildExam({ candidate: who, deps: ALL, count: QUESTIONS.length });
    for (const q of e.questions) shared.push(`${q.id}:${q._correctIndex}`);
  }
  const byQ = new Map();
  for (const s of shared) { const [id, idx] = s.split(':'); (byQ.get(id) || byQ.set(id, new Set()).get(id)).add(idx); }
  const varied = [...byQ.values()].filter((s) => s.size > 1).length;
  assert.ok(varied > 0, '"the answer is C" must be worthless to share');
});

test('a built paper never exceeds the servable pool, and reports what was withheld', () => {
  const deps = { ...ALL, commands: cmds(['help']) };
  const e = buildExam({ candidate: 'alice', deps, count: 99 });
  assert.equal(e.ok, true);
  assert.ok(e.count <= e.poolSize);
  assert.ok(e.withheld > 0);
});

test('only questions of the requested kind are drawn', () => {
  const e = buildExam({ candidate: 'alice', deps: ALL, count: 99, kind: 'knowledge' });
  assert.ok(e.questions.length);
  assert.equal(buildExam({ candidate: 'a', deps: ALL, kind: 'perception' }).ok, false,
    'there are no perception questions in this bank, and it says so rather than substituting');
});

test('seedFrom is stable and differs between inputs', () => {
  assert.equal(seedFrom('alice'), seedFrom('alice'));
  assert.notEqual(seedFrom('alice'), seedFrom('bob'));
});

// ── grading ───────────────────────────────────────────────────────────────────────────────────────
const answerAll = (e, correct = true) => Object.fromEntries(
  e.questions.map((q) => [q.id, correct ? q._correctIndex : (q._correctIndex + 1) % q.options.length]),
);

test('a perfect paper passes; an empty one does not', () => {
  const e = buildExam({ candidate: 'alice', deps: ALL, count: 5 });
  const g = grade(e, answerAll(e));
  assert.equal(g.score, 1);
  assert.equal(g.passed, true);
  assert.equal(grade(e, {}).passed, false);
});

test('every question returns its explanation, right or wrong — the exam exists to teach', () => {
  const e = buildExam({ candidate: 'alice', deps: ALL, count: 5 });
  const g = grade(e, answerAll(e, false));
  assert.equal(g.correct, 0);
  assert.ok(g.results.every((r) => r.explain && r.explain.length > 10), 'a wrong answer is when they will read it');
});

test('the pass mark is enforced, not advisory', () => {
  const e = buildExam({ candidate: 'alice', deps: ALL, count: 5 });
  const ans = answerAll(e);
  delete ans[e.questions[0].id];           // 4/5 = 0.8
  assert.equal(grade(e, ans).passed, PASS_MARK <= 0.8);
  const two = { ...ans }; delete two[e.questions[1].id];   // 3/5 = 0.6
  assert.equal(grade(e, two).passed, false);
});

test('grading something that is not a built exam soft-fails', () => {
  assert.equal(grade(null, {}).ok, false);
  assert.equal(grade({ ok: false }, {}).ok, false);
});

// ── payout eligibility ────────────────────────────────────────────────────────────────────────────
test('a passing knowledge exam on a healthy system is eligible', () => {
  const e = buildExam({ candidate: 'alice', deps: ALL, count: 5 });
  const g = grade(e, answerAll(e));
  const r = rewardEligible({ exam: e, result: g, deps: ALL });
  assert.equal(r.eligible, true);
  assert.match(r.note, /decides eligibility only/);
});

test('a FAILED paper is not eligible', () => {
  const e = buildExam({ candidate: 'alice', deps: ALL, count: 5 });
  const g = grade(e, answerAll(e, false));
  assert.equal(rewardEligible({ exam: e, result: g, deps: ALL }).eligible, false);
});

test('the same candidate is not paid twice for the same exam', () => {
  const e = buildExam({ candidate: 'alice', deps: ALL, count: 5 });
  const g = grade(e, answerAll(e));
  const r = rewardEligible({ exam: e, result: g, deps: ALL, alreadyPaid: true });
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.some((x) => /already been paid/.test(x)));
});

test('⭐ a process that broke BETWEEN building and grading blocks the payout', () => {
  const e = buildExam({ candidate: 'alice', deps: ALL, count: QUESTIONS.length });
  const g = grade(e, answerAll(e));
  assert.equal(rewardEligible({ exam: e, result: g, deps: ALL }).eligible, true);
  // the chain stops after the paper was set
  const r = rewardEligible({ exam: e, result: g, deps: { ...ALL, headBlock: 0 } });
  assert.equal(r.eligible, false, 'paying for a right answer about a thing that no longer works teaches something false');
  assert.ok(r.reasons.some((x) => /stopped answering before grading/.test(x)));
});

test('the handler states the rule without touching a network', () => {
  let body = '';
  handler({}, { setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.match(j.rule, /pay for knowledge, never for perception/);
  assert.match(j.rule, /never ask about a process that is not answering/);
});
