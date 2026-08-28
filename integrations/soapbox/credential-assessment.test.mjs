// credential-assessment.test.mjs — offline tests for the earn-a-credential assessment. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSESSMENTS, getAssessment, hasAssessment, scoreAssessment } from './credential-assessment.mjs';
import { getProgram } from './credentials-issuer.mjs';

test('every assessment is well-formed and maps to a real completion-type program', () => {
  for (const [pid, a] of Object.entries(ASSESSMENTS)) {
    const p = getProgram(pid);
    assert.ok(p, `${pid} is a real program`);
    assert.ok(['completion', 'certification', 'badge'].includes(p.type), `${pid} is completion-type`);
    assert.ok(a.questions.length >= 3);
    for (const q of a.questions) {
      assert.ok(q.q && Array.isArray(q.options) && q.options.length >= 2);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, 'valid answer index');
    }
  }
});

test('press + ministry have NO assessment (they are application-gated)', () => {
  assert.equal(hasAssessment('melek-press-pass'), false);
  assert.equal(hasAssessment('ordination-minister'), false);
});

test('scoreAssessment: all correct passes', () => {
  const s = scoreAssessment('crypto-blockchain-literacy', [1, 1, 1]);
  assert.equal(s.ok, true);
  assert.equal(s.passed, true);
  assert.equal(s.correct, 3);
  assert.equal(s.total, 3);
});

test('scoreAssessment: one wrong fails', () => {
  const s = scoreAssessment('crypto-blockchain-literacy', [1, 0, 1]);
  assert.equal(s.passed, false);
  assert.equal(s.correct, 2);
});

test('scoreAssessment: missing/garbage answers fail, no throw', () => {
  assert.equal(scoreAssessment('crypto-blockchain-literacy', []).passed, false);
  assert.equal(scoreAssessment('crypto-blockchain-literacy', ['x', null, undefined]).passed, false);
});

test('scoreAssessment: unknown program soft-fails', () => {
  const s = scoreAssessment('nope', [1, 1, 1]);
  assert.equal(s.ok, false);
  assert.equal(s.passed, false);
});

test('getAssessment returns the questions', () => {
  assert.equal(getAssessment('angelic-ai-foundations').questions.length, 3);
  assert.equal(getAssessment('melek-press-pass'), null);
});
