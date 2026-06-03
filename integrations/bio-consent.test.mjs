// biovault.test.mjs — OFFLINE tests for consent-gated bio-signal capture.
// Run: node --test integrations/biovault.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  capture, tierOf, query, deleteRecords, audit,
  assertReadOnly, EMITS_STIMULATION, __reset,
  TIER1_NEURAL, TIER2_BEHAVIORAL,
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
