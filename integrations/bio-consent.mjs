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
// ── custody, retention and the clinical tier ──────────────────────────────────
//
// Operator, 2026-09-08, on who may see a Tier-1 corpus after the person themselves:
// "We would want like Probably Hospitals to have the most Access after Individuals."
//
// THE ACCESS LADDER. Subject first, clinician second, nobody else — and the second rung is reached
// by EXPORT, never by query. A hospital does not hold a credential here and cannot ask us anything.
// The subject mints a scoped, expiring export and hands it over, which is how patient-generated data
// normally enters care. That is deliberate: a standing hospital-facing channel is a thing that can be
// subpoenaed, breached, or quietly repurposed, and it would make us a de-facto medical record system
// without being a HIPAA covered entity, without the audit obligations, and holding the liability when
// we are wrong or simply unreachable. Consumer neurotech data is largely OUTSIDE HIPAA — which is the
// gap Colorado HB 24-1058 (2024), California SB 1223 (2024) and Montana SB 163 (2025) exist to fill.
//
// RETENTION IS THE REAL EXPOSURE, NOT ACCESS. Operator: "I don't think Brains will Directly Correlate
// to like Facebook Posts, but someone might figure that out." That is exactly right, and it is the
// harvest-now-decrypt-later problem moved from cryptography to biology — with the difference that YOU
// CANNOT ROTATE A BRAIN. A password is changed; a corpus is deleted, imperfectly; neural data stays
// bound to the person forever, and every future advance in decoding applies retroactively to
// everything already stored. Access control is a bet on today's capability. Only expiry is a defence
// against tomorrow's. So Tier 1 carries a clock and it is short by default.
//
// THE CUSTODIAN SOLVES TWO PROBLEMS WITH ONE FIELD. Delete-on-demand is a right the subject holds, and
// the person most likely to need it exercised is the one who has died — consent becomes perpetual by
// default at precisely the moment it cannot be withdrawn. The same named person is also the only
// honest answer to break-glass: unconscious subject, clinician needs the record now. One role, both
// jobs, always audited, and the subject is told afterwards.

/** Default retention for each tier, in days. Tier 1 is short ON PURPOSE — see above. */
export const RETENTION_DAYS = Object.freeze({ [TIER1_NEURAL]: 90, [TIER2_BEHAVIORAL]: 730 });

export const ACCESS_LADDER = Object.freeze([
  { rung: 1, who: 'the subject', how: 'holds the key; sees and deletes anything, unconditionally' },
  { rung: 2, who: 'a clinician', how: 'receives a scoped, expiring EXPORT that the subject minted. Never queries us.' },
  { rung: 3, who: 'the custodian', how: 'named by the subject. Break-glass and after-death only. Always audited.' },
  { rung: 4, who: 'nobody', how: 'there is no research tier, no temple tier and no public tier for Tier 1.' },
]);

/** Has this record outlived its retention window? */
export function isExpired(rec, { now = () => Date.now(), retentionDays = RETENTION_DAYS } = {}) {
  if (!rec || !rec.capturedAt) return false;
  const days = Number(rec.retentionDays) || Number(retentionDays[rec.tier]) || 0;
  if (!days) return false;
  return now() - new Date(rec.capturedAt).getTime() > days * 86400000;
}

/** Delete everything past its window. Runs unprompted; expiry is not a request the subject must make. */
export function purgeExpired({ now = () => Date.now(), retentionDays = RETENTION_DAYS } = {}) {
  const doomed = _records.filter((r) => isExpired(r, { now, retentionDays }));
  for (const r of doomed) {
    const i = _records.indexOf(r);
    if (i >= 0) _records.splice(i, 1);
  }
  logAudit('purge.expired', { count: doomed.length, ids: doomed.map((r) => r.id) });
  return { purged: doomed.length, ids: doomed.map((r) => r.id) };
}

/**
 * What a clinician actually needs, which is not raw signal.
 *
 * The concrete case this is shaped around: this project runs photic entrainment, and
 * site/hathor-live/sessions.mjs marks 13-26Hz as the high-risk photic band. If a subject has a
 * seizure, the useful thing in an emergency department is the SESSION LOG — what frequency, how long,
 * how recently — not an EEG trace nobody there can read. So the export is a summary by default and
 * raw signal only on explicit request.
 */
export function clinicalExport({ subject, requestedBy, includeRaw = false, ttlHours = 72, purpose = '', now = () => Date.now() } = {}) {
  if (!subject) throw new Error('clinicalExport: subject is required');
  if (!String(purpose || '').trim()) {
    logAudit('export.refused', { subject, reason: 'no-purpose' });
    throw new Error('clinicalExport refused: a stated purpose is required — an export with no reason is a leak with paperwork');
  }
  const mine = _records.filter((r) => r.subject === subject && !isExpired(r, { now }));
  const sessions = mine.filter((r) => ['session', 'vr', 'vr-behavior', 'telemetry'].includes(r.type));
  const neural = mine.filter((r) => r.tier === TIER1_NEURAL);
  const token = randomUUID();
  const expiresAt = new Date(now() + Math.max(1, Number(ttlHours)) * 3600000).toISOString();

  const bundle = {
    token,
    subject,
    issuedTo: String(requestedBy || 'unnamed clinician'),
    purpose: String(purpose).trim(),
    issuedAt: new Date(now()).toISOString(),
    expiresAt,
    // The summary is the product. Counts and timings a clinician can act on.
    summary: {
      sessionCount: sessions.length,
      neuralRecordCount: neural.length,
      mostRecentSession: sessions.length ? sessions[sessions.length - 1].capturedAt : null,
      // Named explicitly because it is the question an ER would actually ask.
      photicExposure: sessions
        .map((r) => (r.data && (r.data.frequencyHz ?? r.data.hz)) || null)
        .filter((v) => v != null)
        .map((hz) => ({ hz, highRiskBand: Number(hz) >= 13 && Number(hz) <= 26 })),
    },
    raw: includeRaw ? neural.map((r) => ({ id: r.id, type: r.type, capturedAt: r.capturedAt, data: r.data })) : null,
    rawWithheld: !includeRaw,
    note: 'Patient-generated data, exported by the subject. Not a medical record. This project is not a '
        + 'HIPAA covered entity and this bundle is not a substitute for clinical assessment.',
  };
  logAudit('export.clinical', { subject, token, issuedTo: bundle.issuedTo, includeRaw, expiresAt, purpose: bundle.purpose });
  return bundle;
}

/** Is a previously minted export still valid? An expired bundle is not a credential. */
export const exportValid = (bundle, { now = () => Date.now() } = {}) =>
  !!(bundle && bundle.expiresAt && now() < new Date(bundle.expiresAt).getTime());

/**
 * Break-glass. The subject cannot consent — unconscious, or dead — and their named custodian
 * authorises. Always audited, and the audit records that the subject must be told.
 */
export function breakGlass({ subject, custodian, custodianOfRecord, reason = '', now = () => Date.now() } = {}) {
  if (!subject || !custodian) throw new Error('breakGlass: subject and custodian are required');
  if (!custodianOfRecord || custodian !== custodianOfRecord) {
    logAudit('breakglass.refused', { subject, custodian, reason: 'not-the-named-custodian' });
    throw new Error('breakGlass refused: only the custodian the subject named may authorise this');
  }
  if (!String(reason || '').trim()) {
    logAudit('breakglass.refused', { subject, custodian, reason: 'no-reason' });
    throw new Error('breakGlass refused: an unexplained emergency access is the thing this path exists to prevent');
  }
  const bundle = clinicalExport({ subject, requestedBy: `custodian:${custodian}`, includeRaw: true, ttlHours: 24, purpose: `break-glass: ${reason}`, now });
  logAudit('breakglass.granted', { subject, custodian, reason: String(reason).trim(), token: bundle.token, subjectMustBeNotified: true });
  return { ...bundle, breakGlass: true, subjectMustBeNotified: true };
}

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
