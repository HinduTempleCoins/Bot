// credential-auto-issue.test.mjs — offline tests for the learn->credential bridge. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COURSE_CREDENTIALS, STRAND_COURSES, credentialForCourse, courseForStrand, isAutoIssuable, issueOnCompletion,
} from './credential-auto-issue.mjs';
import { createRegistry, getProgram } from './credentials-issuer.mjs';

test('every course mapping points at a real, auto-issuable (completion-type) program', () => {
  for (const [course, pid] of Object.entries(COURSE_CREDENTIALS)) {
    const p = getProgram(pid);
    assert.ok(p, `${course} -> ${pid} is a real program`);
    assert.ok(['completion', 'certification', 'badge'].includes(p.type), `${pid} is auto-issuable`);
  }
});

test('courseForStrand maps the defi tutorial strand to its course', () => {
  assert.equal(courseForStrand('defi'), 'tutorial:defi');
  assert.equal(courseForStrand('nope'), null);
});

test('credentialForCourse resolves the program', () => {
  assert.equal(credentialForCourse('tutorial:defi').id, 'crypto-blockchain-literacy');
  assert.equal(credentialForCourse('course:angelic-ai').id, 'angelic-ai-foundations');
  assert.equal(credentialForCourse('nope'), null);
});

test('issueOnCompletion issues a completion credential (into an injected registry)', () => {
  const reg = createRegistry();
  const r = issueOnCompletion({ course: 'tutorial:defi', recipientName: 'Ada', now: new Date('2026-08-28'), registry: reg });
  assert.equal(r.ok, true);
  assert.equal(r.credential.program.id, 'crypto-blockchain-literacy');
  assert.match(r.credential.evidence, /completion of tutorial:defi/);
  assert.equal(reg.count(), 1);
});

test('issueOnCompletion without a registry returns a standalone credential', () => {
  const r = issueOnCompletion({ course: 'course:first-amendment', recipientName: 'Sam', now: new Date('2026-08-28') });
  assert.equal(r.ok, true);
  assert.equal(r.credential.program.id, 'first-amendment-press-religion');
});

test('unknown course soft-fails', () => {
  const r = issueOnCompletion({ course: 'course:does-not-exist', recipientName: 'X' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no-credential-for-course/);
});

test('a ministerial/press course is NEVER auto-issued (gated to the authority)', () => {
  // wire a temporary mapping-like call by asking for a program that is ministerial: ordination isn't in
  // COURSE_CREDENTIALS, but assert the guard via isAutoIssuable + a direct check.
  assert.equal(isAutoIssuable('tutorial:defi'), true);
  assert.equal(isAutoIssuable('course:ordination'), false); // unmapped -> not auto
  // and confirm no mapping smuggles in a ministerial/press program
  for (const pid of Object.values(COURSE_CREDENTIALS)) {
    const p = getProgram(pid);
    assert.ok(p.type !== 'ministerial' && p.type !== 'press', `${pid} is not gated-type`);
  }
});

test('STRAND_COURSES only references known courses', () => {
  for (const course of Object.values(STRAND_COURSES)) {
    assert.ok(COURSE_CREDENTIALS[course], `${course} is a known course`);
  }
});
