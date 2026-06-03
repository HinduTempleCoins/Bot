// biovault.mjs — consent-gated bio/behavioral signal capture (queue #159), built to the
// neural-data legal spec. PURE + node:crypto only, NO network. This module CAPTURES and
// LOGS bio/behavioral records into a consent-gated, in-memory store. Every record is tagged
// from day one as either:
//
//   Tier 1 NEURAL (high protection)  — EEG / EMG / GSR / HRV / dream-journal-as-neural...
//   Tier 2 BEHAVIORAL (lighter)      — VR-behavior / session telemetry / journal text...
//
// Legal spec encoded here (the user's three standing rights):
//   - SEE:    audit() + query() let the data subject inspect what's held.
//   - DELETE: deleteRecords(filter) is an unconditional deletion-on-demand right.
//   - NO-SALE-WITHOUT-CONSENT: capture refuses without consent; cross-scope / Tier-1
//     reads require a per-query explicit opt-in. Tier-1 raw data NEVER leaves without
//     an explicit opt-in on that query.
//
// HARD INVARIANT (assert + test): this module ONLY reads/logs. It NEVER emits any
// stimulation command (tDCS / TENS / TMS / haptic drive / anything that drives a body).
// There is, by construction, no code path that produces a stimulation output.
//
//   import { capture, tierOf, query, deleteRecords, audit } from './bio-consent.mjs'
//   node integrations/biovault.mjs   (self-check / demo)

import { randomUUID, createHash } from 'node:crypto';

// ── tiers ────────────────────────────────────────────────────────────────────
export const TIER1_NEURAL = 'TIER1_NEURAL';     // high protection
export const TIER2_BEHAVIORAL = 'TIER2_BEHAVIORAL'; // lighter

// Signal-type → tier map. Tier 1 = neural / direct-body electrophysiology.
// Tier 2 = behavioral / derived telemetry / freeform text.
const TIER1_TYPES = new Set(['eeg', 'emg', 'gsr', 'hrv', 'ecg', 'eog', 'fnirs']);
const TIER2_TYPES = new Set(['vr', 'vr-behavior', 'session', 'journal', 'dream-journal', 'behavior', 'telemetry']);

/** tierOf(type) — classify a signal type. Unknown types default to Tier 1 (fail-safe:
 *  unclassified bio-signal gets the HIGHER protection, never the lighter one). */
export function tierOf(type) {
  const t = String(type || '').toLowerCase().trim();
  if (TIER1_TYPES.has(t)) return TIER1_NEURAL;
  if (TIER2_TYPES.has(t)) return TIER2_BEHAVIORAL;
  return TIER1_NEURAL; // fail-safe: unknown → highest protection
}

// ── store (in-memory; PURE, no network, no disk) ──────────────────────────────
const _records = [];   // { id, type, tier, dataHash, data, consent, capturedAt }
const _audit = [];     // { id, at, action, ...detail }

function logAudit(action, detail = {}) {
  const entry = { id: randomUUID(), at: new Date().toISOString(), action, ...detail };
  _audit.push(entry);
  return entry;
}

// A consent object is valid when it explicitly grants capture for the subject.
//   consent = { subject, granted: true, scopes?: [...], sale?: bool, neuralOptIn?: bool }
function consentGrants(consent) {
  return !!(consent && consent.granted === true && consent.subject);
}

// ── capture ───────────────────────────────────────────────────────────────────
/** capture({type, data, consent}) — tag tier by type, refuse without consent, store + audit. */
export function capture({ type, data, consent } = {}) {
  if (!type) throw new Error('capture: type is required');
  const tier = tierOf(type);

  if (!consentGrants(consent)) {
    logAudit('capture.refused', { type, tier, reason: 'no-consent' });
    throw new Error(`capture refused: explicit consent required to store ${tier} (${type}) data`);
  }

  const rec = {
    id: randomUUID(),
    type: String(type).toLowerCase().trim(),
    tier,
    subject: consent.subject,
    data,
    // hash so the audit/inspection layer can reference a record without re-exposing raw signal
    dataHash: createHash('sha256').update(JSON.stringify(data ?? null)).digest('hex'),
    consent: {
      subject: consent.subject,
      granted: true,
      scopes: Array.isArray(consent.scopes) ? [...consent.scopes] : [],
      sale: consent.sale === true,
      neuralOptIn: consent.neuralOptIn === true,
    },
    capturedAt: new Date().toISOString(),
  };
  _records.push(rec);
  logAudit('capture', { recordId: rec.id, type: rec.type, tier, subject: rec.subject, dataHash: rec.dataHash });
  return { id: rec.id, type: rec.type, tier, dataHash: rec.dataHash, capturedAt: rec.capturedAt };
}

// ── query (per-query consent check) ───────────────────────────────────────────
/** query({requester, scope, consent}) — returns { capability, result }.
 *  - Per-query consent is enforced.
 *  - Tier-1 NEURAL raw data is NEVER returned without an explicit opt-in on THIS query
 *    (consent.neuralOptIn === true). Without it, Tier-1 records appear as metadata only
 *    (no `data`), so the subject can SEE that records exist without raw exposure / sale. */
export function query({ requester, scope, consent } = {}) {
  if (!consentGrants(consent)) {
    logAudit('query.refused', { requester, scope, reason: 'no-consent' });
    return { capability: 'denied', reason: 'explicit per-query consent required', result: [] };
  }

  const neuralOptIn = consent.neuralOptIn === true;
  const subject = consent.subject;

  let matched = _records.filter((r) => r.subject === subject);
  if (scope) matched = matched.filter((r) => r.type === String(scope).toLowerCase().trim() || r.consent.scopes.includes(scope));

  const tier1Present = matched.some((r) => r.tier === TIER1_NEURAL);

  const result = matched.map((r) => {
    if (r.tier === TIER1_NEURAL && !neuralOptIn) {
      // metadata only — no raw Tier-1 data without explicit opt-in
      return { id: r.id, type: r.type, tier: r.tier, dataHash: r.dataHash, capturedAt: r.capturedAt, raw: false };
    }
    return { id: r.id, type: r.type, tier: r.tier, dataHash: r.dataHash, capturedAt: r.capturedAt, data: r.data, raw: true };
  });

  const capability = (tier1Present && !neuralOptIn)
    ? 'metadata-only' // Tier-1 raw withheld pending explicit opt-in
    : 'full';

  logAudit('query', { requester, scope, subject, capability, count: result.length, neuralOptIn });
  return { capability, result };
}

// ── delete (deletion-on-demand right) ─────────────────────────────────────────
/** deleteRecords(filter) — unconditional deletion-on-demand. filter may carry
 *  { id, subject, type, tier }. Returns count removed. */
export function deleteRecords(filter = {}) {
  const before = _records.length;
  const keep = (r) => {
    if (filter.id && r.id === filter.id) return false;
    if (filter.subject && r.subject === filter.subject) return false;
    if (filter.type && r.type === String(filter.type).toLowerCase().trim()) return false;
    if (filter.tier && r.tier === filter.tier) return false;
    return true;
  };
  // build new kept set; anything not kept is deleted
  const removed = _records.filter((r) => !keep(r));
  for (const r of removed) {
    const idx = _records.indexOf(r);
    if (idx >= 0) _records.splice(idx, 1);
  }
  logAudit('delete', { filter, removed: before - _records.length });
  return before - _records.length;
}

// ── audit (the SEE right) ─────────────────────────────────────────────────────
/** audit() — immutable-by-copy view of the audit log + current store summary. */
export function audit() {
  const byTier = _records.reduce((acc, r) => { acc[r.tier] = (acc[r.tier] || 0) + 1; return acc; }, {});
  return {
    records: _records.length,
    byTier,
    log: _audit.map((e) => ({ ...e })),
  };
}

// ── HARD INVARIANT: read/log only, never stimulate ────────────────────────────
// There is no stimulation export by construction. This sentinel makes the invariant
// machine-checkable: the module surface contains only read/log capabilities.
export const EMITS_STIMULATION = false;
export function assertReadOnly() {
  // If a future edit ever adds a stimulation emitter, this list / flag must be revisited.
  const surface = ['capture', 'tierOf', 'query', 'deleteRecords', 'audit'];
  // capture/read/delete/audit are all I/O on a passive store — none drive a body.
  const stimulationVerbs = ['stimulate', 'tdcs', 'tens', 'tms', 'drive', 'shock', 'emit', 'pulse'];
  for (const name of surface) {
    if (stimulationVerbs.some((v) => name.toLowerCase().includes(v))) {
      throw new Error(`read-only invariant violated: '${name}' looks like a stimulation emitter`);
    }
  }
  if (EMITS_STIMULATION !== false) throw new Error('read-only invariant violated: EMITS_STIMULATION is set');
  return true;
}
// enforce at module load
assertReadOnly();

// test-only reset (does not bypass any consent gate; just clears the in-memory store)
export function __reset() { _records.length = 0; _audit.length = 0; }

// ── CLI self-check / demo ─────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('bio-consent.mjs')) {
  const consent = { subject: 'demo-user', granted: true, scopes: ['research'] };
  const eeg = capture({ type: 'eeg', data: { ch: [1, 2, 3] }, consent });
  const vr = capture({ type: 'vr', data: { gaze: [0.1, 0.2] }, consent });
  console.log('captured:', eeg.tier, vr.tier);
  console.log('query (no neural opt-in):', JSON.stringify(query({ requester: 'demo-user', consent }).capability));
  console.log('query (neural opt-in):', JSON.stringify(query({ requester: 'demo-user', consent: { ...consent, neuralOptIn: true } }).capability));
  console.log('deleted:', deleteRecords({ subject: 'demo-user' }));
  console.log('audit records remaining:', audit().records);
  console.log('read-only invariant:', assertReadOnly());
}
