// site/yoni/applications-store.mjs — append-only JSONL store for producer applications.
//
// ⭐ AN APPLICATION IS NOT AN UPLOAD, AND NOT AN APPROVAL.
// Intake stays operator-only (surfaces.mjs INTAKE). This store is the one way in: somebody says who
// they are and what they would produce, the operator reads the log, and approval is an OUT-OF-BAND act
// — adding them to YONI_PRODUCERS. Nothing here grants publishing rights, so a flood of applications
// is a reading problem, never a compliance one. That separation is the whole point of the design.
//
// ⭐ WHAT AN APPLICATION MUST NOT CONTAIN.
// No date of birth, no ID number, no document image, no selfie — the same refusal the age gate
// enforces, reused here via assertNoPII, because an application form is exactly where someone helpfully
// attaches a driving licence. The § 2257 examination happens later, by the custodian, against the
// person. A web form is not the place for it and a JSONL file is not the place to keep it.
//
// Same shape as site/films/reviews-store.mjs: a flat file the operator can read, grep and back up.
// Nothing is rewritten. Every function soft-fails — a missing file, a torn line or a full disk
// shortens the list and never throws.

import fs from 'node:fs';
import path from 'node:path';
import { assertNoPII } from '../../integrations/agegate/model.mjs';

let _io = null;
export function __setIO(io) { _io = io && typeof io === 'object' ? io : null; }

function io() {
  return _io || {
    read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } },
    append(p, line) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.appendFileSync(p, line, 'utf8');
        return true;
      } catch { return false; }
    },
  };
}

export const storePath = (env = process.env) =>
  String(env.YONI_APPLICATIONS || '/var/lib/yoni/applications.jsonl');

const str = (s, max) => String(s == null ? '' : s).trim().slice(0, max);

/** The fields an application may carry. Anything else is dropped rather than stored. */
export const FIELDS = Object.freeze(['contact', 'name', 'what', 'where', 'links', 'notes']);

/** The acknowledgements an applicant has to make. Each must be explicitly true. */
export const ACKS = Object.freeze({
  over18: 'I am 18 or over, and so is every person who appears in anything I would submit.',
  ids: 'I can produce a government photo ID for every person depicted, examined before production.',
  consent: 'I have written consent from each depicted person covering depiction, distribution, upload and download.',
  agreement: 'I understand a written agreement with the operator is required before anything is published.',
  noUpload: 'I understand this is an application only, that it grants no publishing rights, and that nothing can be submitted until the operator approves me.',
});

/**
 * Validate and shape an application. Returns { ok, record } or { ok:false, reason }.
 * Pure: no I/O, injectable clock.
 */
export function buildApplication(input = {}, { now = () => Date.now() } = {}) {
  const contact = str(input.contact, 200);
  if (!contact) return { ok: false, reason: 'a contact address or handle is required' };
  if (contact.length < 3) return { ok: false, reason: 'that contact is too short to reach anyone' };

  const what = str(input.what, 2000);
  if (!what) return { ok: false, reason: 'say what you would produce' };

  for (const key of Object.keys(ACKS)) {
    if (input[key] !== true && input[key] !== 'true' && input[key] !== 'on') {
      return { ok: false, reason: `you have to acknowledge: ${ACKS[key]}` };
    }
  }

  const record = { at: now(), status: 'applied' };
  for (const f of FIELDS) {
    const v = str(input[f], f === 'what' || f === 'notes' ? 2000 : 300);
    if (v) record[f] = v;
  }
  record.acks = Object.keys(ACKS);

  // The same refusal the gate enforces. An application that smuggles a document is not stored at all.
  const guard = assertNoPII(input);
  if (!guard.ok) return { ok: false, reason: guard.reason };

  return { ok: true, record };
}

/** Append one application. Returns { ok } or { ok:false, reason }. */
export function appendApplication(input = {}, opts = {}) {
  const built = buildApplication(input, opts);
  if (!built.ok) return built;
  const p = opts.path || storePath(opts.env);
  const wrote = io().append(p, `${JSON.stringify(built.record)}\n`);
  return wrote ? { ok: true, record: built.record } : { ok: false, reason: 'could not write the application' };
}

/** Read the log, newest first. Torn lines are skipped, never thrown. */
export function listApplications(opts = {}) {
  const p = opts.path || storePath(opts.env);
  const out = [];
  for (const line of String(io().read(p) || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* torn line — skip */ }
  }
  return out.reverse();
}

export { assertNoPII };
