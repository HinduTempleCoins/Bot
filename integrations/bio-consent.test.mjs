// biovault.test.mjs — OFFLINE tests for consent-gated bio-signal capture.
// Run: node --test integrations/biovault.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  capture, tierOf, query, deleteRecords, audit,
  assertReadOnly, EMITS_STIMULATION, __reset,
  TIER1_NEURAL, TIER2_BEHAVIORAL,
  RETENTION_DAYS, ACCESS_LADDER, isExpired, purgeExpired, clinicalExport, exportValid, breakGlass,
} from './bio-consent.mjs';

const CONSENT = { subject: 'subj-1', granted: true, scopes: ['research'] };

beforeEach(() => __reset());

test('tier tagging is correct (neural → Tier1, behavioral → Tier2)', () => {
  assert.equal(tierOf('eeg'), TIER1_NEURAL);
  assert.equal(tierOf('emg'), TIER1_NEURAL);
  assert.equal(tierOf('gsr'), TIER1_NEURAL);
  assert.equal(tierOf('vr'), TIER2_BEHAVIORAL);
  assert.equal(tierOf('journal'), TIER2_BEHAVIORAL);
  assert.equal(tierOf('session'), TIER2_BEHAVIORAL);
  // fail-safe: unknown type gets the HIGHER protection
  assert.equal(tierOf('mystery-signal'), TIER1_NEURAL);
});

test('capture tags tier by type', () => {
  const a = capture({ type: 'eeg', data: { v: 1 }, consent: CONSENT });
  const b = capture({ type: 'vr', data: { v: 2 }, consent: CONSENT });
  assert.equal(a.tier, TIER1_NEURAL);
  assert.equal(b.tier, TIER2_BEHAVIORAL);
});

test('capture is REFUSED without consent', () => {
  assert.throws(() => capture({ type: 'eeg', data: { v: 1 } }), /consent/i);
  assert.throws(() => capture({ type: 'eeg', data: { v: 1 }, consent: { subject: 'x', granted: false } }), /consent/i);
  assert.equal(audit().records, 0, 'nothing stored on refusal');
  // the refusal is itself audited
  assert.ok(audit().log.some((e) => e.action === 'capture.refused'));
});

test('Tier1 raw query is BLOCKED without explicit neural opt-in', () => {
  capture({ type: 'eeg', data: { secret: 'brainwaves' }, consent: CONSENT });
  const res = query({ requester: 'subj-1', consent: CONSENT });
  assert.equal(res.capability, 'metadata-only');
  const rec = res.result[0];
  assert.equal(rec.tier, TIER1_NEURAL);
  assert.equal(rec.raw, false);
  assert.ok(!('data' in rec), 'no raw Tier1 data without opt-in');
  assert.ok(rec.dataHash, 'metadata (hash) still visible so subject can SEE');
});

test('Tier1 raw query is RETURNED with explicit neural opt-in', () => {
  capture({ type: 'eeg', data: { secret: 'brainwaves' }, consent: CONSENT });
  const res = query({ requester: 'subj-1', consent: { ...CONSENT, neuralOptIn: true } });
  assert.equal(res.capability, 'full');
  assert.deepEqual(res.result[0].data, { secret: 'brainwaves' });
  assert.equal(res.result[0].raw, true);
});

test('Tier2 data is returned without neural opt-in', () => {
  capture({ type: 'vr', data: { gaze: [0.1] }, consent: CONSENT });
  const res = query({ requester: 'subj-1', consent: CONSENT });
  assert.equal(res.capability, 'full');
  assert.deepEqual(res.result[0].data, { gaze: [0.1] });
});

test('query refused without consent (per-query check)', () => {
  capture({ type: 'vr', data: { gaze: [0.1] }, consent: CONSENT });
  const res = query({ requester: 'subj-1' });
  assert.equal(res.capability, 'denied');
  assert.deepEqual(res.result, []);
});

test('deletion-on-demand works', () => {
  capture({ type: 'eeg', data: { v: 1 }, consent: CONSENT });
  capture({ type: 'vr', data: { v: 2 }, consent: CONSENT });
  assert.equal(audit().records, 2);
  const removed = deleteRecords({ subject: 'subj-1' });
  assert.equal(removed, 2);
  assert.equal(audit().records, 0);
});

test('deletion can target a single tier', () => {
  capture({ type: 'eeg', data: { v: 1 }, consent: CONSENT });
  capture({ type: 'vr', data: { v: 2 }, consent: CONSENT });
  const removed = deleteRecords({ tier: TIER1_NEURAL });
  assert.equal(removed, 1);
  assert.equal(audit().byTier[TIER2_BEHAVIORAL], 1);
  assert.equal(audit().byTier[TIER1_NEURAL], undefined);
});

test('audit records capture / query / delete actions', () => {
  capture({ type: 'eeg', data: { v: 1 }, consent: CONSENT });
  query({ requester: 'subj-1', consent: CONSENT });
  deleteRecords({ subject: 'subj-1' });
  const actions = audit().log.map((e) => e.action);
  assert.ok(actions.includes('capture'));
  assert.ok(actions.includes('query'));
  assert.ok(actions.includes('delete'));
});

test('HARD invariant: module is read/log only, never stimulates', () => {
  assert.equal(EMITS_STIMULATION, false);
  assert.equal(assertReadOnly(), true);
  // the public surface exposes no stimulation emitter
  import('./bio-consent.mjs').then((mod) => {
    const names = Object.keys(mod).map((n) => n.toLowerCase());
    for (const v of ['stimulate', 'tdcs', 'tens', 'tms', 'shock', 'pulse', 'drive']) {
      assert.ok(!names.some((n) => n.includes(v)), `no '${v}' export`);
    }
  });
});

// ── custody, retention, and the clinical tier ─────────────────────────────────────────────────────
const NEURAL_CONSENT = { subject: 'subj-1', granted: true, scopes: ['self'], neuralOptIn: true };
const DAY = 86400000;

test('the ladder is subject, then clinician BY EXPORT, then custodian, then nobody', () => {
  assert.equal(ACCESS_LADDER[0].who, 'the subject');
  assert.match(ACCESS_LADDER[1].how, /Never queries us/);
  assert.match(ACCESS_LADDER[3].how, /no research tier, no temple tier and no public tier/);
});

test('Tier 1 retention is SHORTER than Tier 2 — the neural clock is the point', () => {
  assert.ok(RETENTION_DAYS.TIER1_NEURAL < RETENTION_DAYS.TIER2_BEHAVIORAL);
  assert.equal(RETENTION_DAYS.TIER1_NEURAL, 90);
});

test('a neural record expires on its own clock, and purging is not something the subject must ask for', () => {
  __reset();
  capture({ type: 'eeg', data: { v: 1 }, consent: NEURAL_CONSENT });
  const later = () => Date.now() + 91 * DAY;
  const p = purgeExpired({ now: later });
  assert.equal(p.purged, 1);
  assert.equal(audit().log.some((a) => a.action === 'purge.expired'), true);
});

test('a behavioral record outlives a neural one', () => {
  __reset();
  capture({ type: 'journal', data: { t: 'x' }, consent: NEURAL_CONSENT });
  assert.equal(purgeExpired({ now: () => Date.now() + 91 * DAY }).purged, 0, 'still inside Tier 2 retention');
  assert.equal(purgeExpired({ now: () => Date.now() + 731 * DAY }).purged, 1);
});

test('an export with no stated purpose is refused — a reasonless export is a leak with paperwork', () => {
  __reset();
  capture({ type: 'session', data: { frequencyHz: 40 }, consent: NEURAL_CONSENT });
  assert.throws(() => clinicalExport({ subject: 'subj-1', requestedBy: 'Dr X' }), /purpose is required/);
});

test('the export is a SUMMARY by default; raw neural signal is withheld unless asked for', () => {
  __reset();
  capture({ type: 'eeg', data: { v: 1 }, consent: NEURAL_CONSENT });
  const b = clinicalExport({ subject: 'subj-1', requestedBy: 'Dr X', purpose: 'post-session review' });
  assert.equal(b.raw, null);
  assert.equal(b.rawWithheld, true);
  assert.equal(b.summary.neuralRecordCount, 1);
  const withRaw = clinicalExport({ subject: 'subj-1', requestedBy: 'Dr X', purpose: 'review', includeRaw: true });
  assert.equal(withRaw.raw.length, 1);
});

test('the export answers the question an ER would actually ask — photic exposure and the risk band', () => {
  __reset();
  capture({ type: 'session', data: { frequencyHz: 18 }, consent: NEURAL_CONSENT });
  capture({ type: 'session', data: { frequencyHz: 40 }, consent: NEURAL_CONSENT });
  const b = clinicalExport({ subject: 'subj-1', requestedBy: 'ER', purpose: 'seizure workup' });
  const flags = b.summary.photicExposure;
  assert.equal(flags.find((f) => f.hz === 18).highRiskBand, true, '13-26Hz is the provocative band');
  assert.equal(flags.find((f) => f.hz === 40).highRiskBand, false);
});

test('an export expires, and an expired bundle is not a credential', () => {
  __reset();
  capture({ type: 'session', data: {}, consent: NEURAL_CONSENT });
  const b = clinicalExport({ subject: 'subj-1', requestedBy: 'Dr X', purpose: 'p', ttlHours: 1 });
  assert.equal(exportValid(b), true);
  assert.equal(exportValid(b, { now: () => Date.now() + 2 * 3600000 }), false);
});

test('the bundle says plainly that it is not a medical record', () => {
  __reset();
  capture({ type: 'session', data: {}, consent: NEURAL_CONSENT });
  const b = clinicalExport({ subject: 'subj-1', requestedBy: 'Dr X', purpose: 'p' });
  assert.match(b.note, /not a medical record/i);
  assert.match(b.note, /not a HIPAA covered entity/i);
});

test('expired records never reach an export', () => {
  __reset();
  capture({ type: 'eeg', data: { v: 1 }, consent: NEURAL_CONSENT });
  const b = clinicalExport({ subject: 'subj-1', requestedBy: 'Dr X', purpose: 'p', now: () => Date.now() + 91 * DAY });
  assert.equal(b.summary.neuralRecordCount, 0);
});

// ── break-glass ───────────────────────────────────────────────────────────────────────────────────
test('only the custodian the subject NAMED can break glass', () => {
  __reset();
  capture({ type: 'eeg', data: { v: 1 }, consent: NEURAL_CONSENT });
  assert.throws(
    () => breakGlass({ subject: 'subj-1', custodian: 'a-stranger', custodianOfRecord: 'named-person', reason: 'unconscious' }),
    /only the custodian the subject named/,
  );
});

test('break-glass without a reason is refused — that is the abuse this path exists to prevent', () => {
  __reset();
  capture({ type: 'eeg', data: { v: 1 }, consent: NEURAL_CONSENT });
  assert.throws(
    () => breakGlass({ subject: 'subj-1', custodian: 'kin', custodianOfRecord: 'kin' }),
    /unexplained emergency access/,
  );
});

test('a valid break-glass grants raw, is short-lived, and records that the subject MUST be told', () => {
  __reset();
  capture({ type: 'eeg', data: { v: 1 }, consent: NEURAL_CONSENT });
  const b = breakGlass({ subject: 'subj-1', custodian: 'kin', custodianOfRecord: 'kin', reason: 'unconscious in ED' });
  assert.equal(b.breakGlass, true);
  assert.equal(b.subjectMustBeNotified, true);
  assert.ok(b.raw.length, 'an emergency is the one case raw is included by default');
  const a = audit().log.find((x) => x.action === 'breakglass.granted');
  assert.ok(a, 'every break-glass is audited');
  assert.equal(a.subjectMustBeNotified, true);
});

test('a refused break-glass is audited too — the attempt is the signal', () => {
  __reset();
  try { breakGlass({ subject: 'subj-1', custodian: 'x', custodianOfRecord: 'y', reason: 'r' }); } catch { /* expected */ }
  assert.ok(audit().log.some((x) => x.action === 'breakglass.refused'));
});

test('capture still emits no stimulation — custody did not open a write path', () => {
  assert.equal(EMITS_STIMULATION, false);
  assert.doesNotThrow(() => assertReadOnly());
});
