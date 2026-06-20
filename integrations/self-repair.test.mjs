import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSignals, triage, diagnose, remediate, runSelfRepair, toMarkdown, MODES } from './self-repair.mjs';

const src = {
  failedUnits: () => ['melek-welcomer'],
  diagnostics: () => [{ file: 'src/chain/graphene.js', hits: 3 }],
  brokenTodos: () => ['condenser FAQ link still points at the wrong domain'],
};

test('collectSignals normalizes all sensor types, soft-fails missing readers', () => {
  const { signals } = collectSignals(src);
  assert.equal(signals.length, 3);
  assert.deepEqual([...new Set(signals.map((s) => s.kind))].sort(), ['diagnostic', 'service', 'todo']);
  // missing/throwing readers don't crash
  assert.deepEqual(collectSignals({ failedUnits: () => { throw new Error('x'); } }).signals, []);
  assert.deepEqual(collectSignals().signals, []);
});

test('triage orders by salience (service failure outranks a cosmetic todo)', () => {
  const t = triage(collectSignals(src));
  assert.equal(t[0].kind, 'service'); // "failed" + amygdala urgency floats it up
  assert.ok(t[0].salience >= t[t.length - 1].salience);
});

test('diagnose uses the ensemble and marks a known-safe low-risk fix autoSafe', async () => {
  const complete = async () => JSON.stringify({ likelyCause: 'timer missed', proposedFix: 'rerun the timer', kind: 'rerun-timer', confidence: 0.9, risk: 'low' });
  const dx = await diagnose({ kind: 'service', text: 'service failed: x', ref: 'x' }, { complete });
  assert.equal(dx.diagnosis.kind, 'rerun-timer');
  assert.equal(dx.autoSafe, true);
});

test('diagnose refuses autoSafe for risky or code-change fixes', async () => {
  const complete = async () => JSON.stringify({ likelyCause: 'logic bug', proposedFix: 'patch the parser', kind: 'code-change', confidence: 0.95, risk: 'medium' });
  const dx = await diagnose({ kind: 'diagnostic', text: 'bug', ref: 'f.js' }, { complete });
  assert.equal(dx.autoSafe, false);
});

test('diagnose soft-fails to investigate when no ensemble / bad output', async () => {
  const dx = await diagnose({ kind: 'todo', text: 'something' }, {});
  assert.equal(dx.diagnosis.kind, 'investigate');
  assert.equal(dx.autoSafe, false);
  const dx2 = await diagnose({ kind: 'todo', text: 'x' }, { complete: async () => 'not json at all' });
  assert.equal(dx2.diagnosis.kind, 'investigate');
});

test('advise mode reports only, never applies', async () => {
  const dx = { ref: 'x', kind: 'rerun-timer', text: 't', salience: 1, autoSafe: true, diagnosis: { likelyCause: 'c', proposedFix: 'f', confidence: 0.9, risk: 'low' } };
  let applied = false;
  const out = await remediate(dx, { mode: 'advise', apply: async () => { applied = true; } });
  assert.equal(out.action, 'advised');
  assert.equal(out.applied, false);
  assert.equal(applied, false);
});

test('assist mode drafts the fix but does not apply', async () => {
  const dx = { ref: 'x', kind: 'rerun-timer', text: 't', salience: 1, autoSafe: true, diagnosis: { likelyCause: 'c', proposedFix: 'rerun the timer', confidence: 0.9, risk: 'low' } };
  const out = await remediate(dx, { mode: 'assist' });
  assert.equal(out.action, 'drafted-fix');
  assert.equal(out.applied, false);
  assert.match(out.draft, /rerun the timer/);
});

test('auto mode applies ONLY autoSafe incidents via the actuator', async () => {
  const safe = { ref: 'x', kind: 'rerun-timer', text: 't', salience: 1, autoSafe: true, diagnosis: { likelyCause: 'c', proposedFix: 'f', confidence: 0.9, risk: 'low' } };
  const unsafe = { ref: 'y', kind: 'code-change', text: 'u', salience: 1, autoSafe: false, diagnosis: { likelyCause: 'c', proposedFix: 'f', confidence: 0.9, risk: 'medium' } };
  let calls = 0;
  const apply = async () => { calls++; return 'done'; };
  const a = await remediate(safe, { mode: 'auto', apply });
  const b = await remediate(unsafe, { mode: 'auto', apply });
  assert.equal(a.action, 'auto-applied');
  assert.equal(a.applied, true);
  assert.equal(b.action, 'escalated'); // unsafe → human, never applied
  assert.equal(calls, 1);
});

test('auto mode escalates autoSafe incident when no actuator is wired', async () => {
  const safe = { ref: 'x', kind: 'rerun-timer', text: 't', salience: 1, autoSafe: true, diagnosis: { likelyCause: 'c', proposedFix: 'f', confidence: 0.9, risk: 'low' } };
  const out = await remediate(safe, { mode: 'auto' });
  assert.equal(out.action, 'escalated');
  assert.match(out.reason, /actuator/);
});

test('runSelfRepair end-to-end in advise mode escalates nothing it cannot fix safely', async () => {
  const complete = async () => JSON.stringify({ likelyCause: 'stale key', proposedFix: 'rotate', kind: 'config-change', confidence: 0.8, risk: 'high' });
  const r = await runSelfRepair({ signals: collectSignals(src).signals, mode: 'advise', complete });
  assert.equal(r.mode, 'advise');
  assert.equal(r.incidents.length, 3);
  assert.equal(r.summary.applied, 0);
  assert.ok(r.summary.topIncident);
});

test('runSelfRepair defaults to advise (the safe stage-1 default)', async () => {
  const r = await runSelfRepair({ signals: [{ kind: 'todo', text: 'x' }] });
  assert.ok(MODES.includes(r.mode));
  assert.equal(r.mode, 'advise');
});

test('toMarkdown renders incidents and the not-bound framing', () => {
  const md = toMarkdown({ at: 'NOW', mode: 'advise', incidents: [], summary: { total: 0, applied: 0, escalated: 0 } });
  assert.match(md, /Self-repair pass/);
  assert.match(md, /not bound/);
  assert.match(md, /body is healthy/);
});
