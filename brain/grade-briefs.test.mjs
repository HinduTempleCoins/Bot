// grade-briefs.test.mjs — OFFLINE tests for the brief grader's record-population fix.
//
// Proves the two things the operator asked for: (1) per-brief records get pct_*/hallucination_tier/
// notes actually WRITTEN (the null-record bug is fixed) via a deterministic path that needs no model,
// and (2) when a Modal assessment is available it is used — injected, never a real network call.
// PRIVACY: nothing here reaches an external API; the Modal client is injected.
//
//   node --test brain/grade-briefs.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  deriveAssessment, coerceModalAssessment, assessViaModal, writeBriefRecord, backfillRecords, gradeAll,
} from './grade-briefs.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'grade-')); }
const NOW = () => Date.parse('2026-09-22T00:00:00Z');

const SAMPLE_BRIEF = `# Brief — 2026-09-22T00:00:00.000Z
## FOR CLAUDE CODE
- Wire the Discord news feed into the !sb command
- Add a failover price source to the oracle
- Add a quantum entanglement module to the chain
`;

test('deriveAssessment: turns scorecard buckets into pct fields + tier (never null)', () => {
  const card = { total: 4, items: [{ bucket: 'hallucination', subflag: 'repo-structure-mistake' }],
    buckets: { completed: 2, leftUndone: 1, ignored: 0, unrelated: 0, hallucination: 1 } };
  const a = deriveAssessment(card);
  assert.equal(a.pct_completed, 50);
  assert.equal(a.pct_undone, 25);
  assert.equal(a.hallucination_tier, 'mistaken-structure-corrected');
  assert.equal(a.source, 'deterministic');
  assert.equal(typeof a.notes, 'string');
});

test('deriveAssessment: absolute hallucination when a hallucination item has no repo subflag', () => {
  const card = { total: 2, items: [{ bucket: 'hallucination' }], buckets: { hallucination: 1, completed: 1 } };
  assert.equal(deriveAssessment(card).hallucination_tier, 'absolute-hallucination');
});

test('coerceModalAssessment: clamps numbers, validates tier, rejects junk', () => {
  const ok = coerceModalAssessment({ pct_completed: 120, pct_undone: -5, pct_ignored: 10, pct_nonsense: 0, hallucination_tier: 'bogus', notes: 'x' });
  assert.equal(ok.pct_completed, 100);
  assert.equal(ok.pct_undone, 0);
  assert.equal(ok.hallucination_tier, 'none'); // invalid tier normalized
  assert.equal(ok.source, 'modal');
  assert.equal(coerceModalAssessment(null), null);
  assert.equal(coerceModalAssessment({ notes: 'no numbers' }), null);
});

test('assessViaModal: uses the injected Modal client (no network)', async () => {
  let asked = null;
  const deps = { askModalJson: async (opts) => { asked = opts; return { pct_completed: 40, pct_undone: 60, pct_ignored: 0, pct_nonsense: 0, hallucination_tier: 'none', notes: 'ok' }; } };
  const a = await assessViaModal(SAMPLE_BRIEF, { confirmedItems: ['x'], doneItems: [] }, deps);
  assert.equal(a.pct_completed, 40);
  assert.equal(a.source, 'modal');
  assert.ok(asked && typeof asked.prompt === 'string' && Array.isArray(asked.context));
});

test('assessViaModal: soft-fails to null when the client returns nothing', async () => {
  const a = await assessViaModal(SAMPLE_BRIEF, {}, { askModalJson: async () => null });
  assert.equal(a, null);
});

test('writeBriefRecord: writes pct_*/tier/notes into the per-brief record + flips status', () => {
  const dir = tmp();
  const rec = writeBriefRecord('brief-x', 'brief-x.md',
    { pct_completed: 100, pct_undone: 0, pct_ignored: 0, pct_nonsense: 0, hallucination_tier: 'none', notes: 'all done', source: 'deterministic' },
    { recordsDir: dir, now: NOW });
  assert.equal(rec.status, 'done');
  const onDisk = JSON.parse(readFileSync(join(dir, 'brief-x.json'), 'utf8'));
  assert.equal(onDisk.pct_completed, 100);
  assert.equal(onDisk.hallucination_tier, 'none');
  assert.equal(onDisk.notes, 'all done');
  assert.equal(onDisk.assessed_by, 'deterministic');
});

test('backfillRecords: populates a pre-existing null "unassessed" record (the 3383-null fix)', async () => {
  const briefsDir = tmp();
  const recordsDir = tmp();
  writeFileSync(join(briefsDir, 'brief-2026-09-22T00-00-00-000Z.md'), SAMPLE_BRIEF);
  // simulate the old skeleton record brief-records.mjs left behind
  const id = 'brief-2026-09-22T00-00-00-000Z';
  writeFileSync(join(recordsDir, `${id}.json`), JSON.stringify({ id, brief: `${id}.md`, items: 3, status: 'unassessed', pct_completed: null }));
  const filled = await backfillRecords({ briefsDir, recordsDir, ctx: {}, now: NOW });
  assert.equal(filled, 1);
  const r = JSON.parse(readFileSync(join(recordsDir, `${id}.json`), 'utf8'));
  assert.notEqual(r.status, 'unassessed');
  assert.equal(typeof r.pct_completed, 'number');
});

test('gradeAll: end-to-end, deterministic (useModal:false) — writes scorecards + records + rollup', async () => {
  const briefsDir = tmp();
  const recordsDir = tmp();
  const id = 'brief-2026-09-22T00-00-00-000Z';
  writeFileSync(join(briefsDir, `${id}.md`), SAMPLE_BRIEF);
  const out = join(recordsDir, 'scorecards.jsonl');
  const rollupFile = join(recordsDir, 'rollup.md');
  const r = await gradeAll({ briefsDir, asksFile: join(recordsDir, 'nope.md'), out, rollupFile, recordsDir, useModal: false, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.graded, 1);
  assert.ok(r.recordsWritten >= 1);
  assert.equal(r.modalUsed, 0, 'useModal:false → no model call');
  assert.ok(existsSync(out), 'scorecards.jsonl written');
  const rec = JSON.parse(readFileSync(join(recordsDir, `${id}.json`), 'utf8'));
  assert.equal(typeof rec.pct_completed, 'number', 'per-brief record is populated, not null');
});

test('gradeAll: uses the injected Modal assessment when useModal + deps provided', async () => {
  const briefsDir = tmp();
  const recordsDir = tmp();
  const id = 'brief-2026-09-22T00-00-00-000Z';
  writeFileSync(join(briefsDir, `${id}.md`), SAMPLE_BRIEF);
  const deps = { askModalJson: async () => ({ pct_completed: 33, pct_undone: 67, pct_ignored: 0, pct_nonsense: 0, hallucination_tier: 'none', notes: 'via modal' }) };
  const r = await gradeAll({ briefsDir, asksFile: join(recordsDir, 'nope.md'), out: join(recordsDir, 's.jsonl'), rollupFile: join(recordsDir, 'r.md'), recordsDir, useModal: true, deps, now: NOW });
  assert.equal(r.modalUsed, 1);
  const rec = JSON.parse(readFileSync(join(recordsDir, `${id}.json`), 'utf8'));
  assert.equal(rec.pct_completed, 33);
  assert.equal(rec.assessed_by, 'modal');
});
