// credential-auto-issue.mjs — the bridge from LEARNING to a CREDENTIAL.
//
// The operator's tie: "it's also in Witness School." Witness School / the tutorial is where you learn;
// the Academy is where the learning becomes a credential. This module maps a completed course or tutorial
// track to the credential it earns, and issues it. PURE + offline.
//
// Only COMPLETION-type credentials auto-issue on finishing a course. Ministerial (ordination) and Press
// credentials are NEVER auto-issued — they require the gated issuing authority (an affirmation / an
// application), per site/academy's /issue gate.

import { issueCredential, getProgram, CREDENTIAL_TYPES } from './credentials-issuer.mjs';

// course/track key → credential program id. Extend as courses are added.
export const COURSE_CREDENTIALS = Object.freeze({
  'tutorial:defi': 'crypto-blockchain-literacy',
  'tutorial:crypto': 'crypto-blockchain-literacy',
  'course:angelic-ai': 'angelic-ai-foundations',
  'course:first-amendment': 'first-amendment-press-religion',
  'course:plant-medicine': 'plant-medicine-harm-reduction',
  'course:ancient-mysteries': 'ancient-mysteries',
});

// tutorial strand → the course key above (so finishing a tutorial track can grant its credential).
export const STRAND_COURSES = Object.freeze({
  defi: 'tutorial:defi',
});

// Types that may be earned by finishing a course. Ministerial/press are excluded (gated authority only).
const AUTO_TYPES = new Set(['completion', 'certification', 'badge']);

/** The program a course/track grants, or null. */
export function credentialForCourse(courseKey) {
  const pid = COURSE_CREDENTIALS[String(courseKey || '')];
  return pid ? getProgram(pid) : null;
}

/** The course key a tutorial strand maps to (or null). */
export function courseForStrand(strand) {
  return STRAND_COURSES[String(strand || '')] || null;
}

/** True only if the course maps to an auto-issuable (completion-type) credential. */
export function isAutoIssuable(courseKey) {
  const p = credentialForCourse(courseKey);
  return Boolean(p && AUTO_TYPES.has(p.type));
}

/**
 * Issue the credential a learner earned by completing `course`. Soft-fails (never throws):
 *  - unknown course            -> { ok:false, reason:'no-credential-for-course:…' }
 *  - a ministerial/press map    -> { ok:false, reason:'not-auto-issuable:… (gated)' }
 * When `registry` is injected it records into it; otherwise returns a stand-alone credential.
 * @param {{ course:string, recipientName:string, recipientId?:string, evidence?:string, now?:Date, registry?:object }} a
 */
export function issueOnCompletion({ course, recipientName, recipientId = '', evidence = '', now = new Date(), registry } = {}) {
  const program = credentialForCourse(course);
  if (!program) return { ok: false, reason: `no-credential-for-course:${String(course || '')}` };
  if (!AUTO_TYPES.has(program.type)) {
    return { ok: false, reason: `not-auto-issuable:${program.type} (${CREDENTIAL_TYPES[program.type].label} is gated to the issuing authority)` };
  }
  const args = {
    programId: program.id, recipientName, recipientId,
    evidence: evidence || `Auto-issued on completion of ${course}`, now,
  };
  return registry && typeof registry.issue === 'function' ? registry.issue(args) : issueCredential(args);
}

// CLI demo (guarded, offline)
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('credential-auto-issue.mjs')) {
  console.log('defi strand -> course:', courseForStrand('defi'));
  const r = issueOnCompletion({ course: 'tutorial:defi', recipientName: 'Ada', now: new Date('2026-08-28') });
  console.log('issue on defi completion:', r.ok ? r.credential.id + ' = ' + r.credential.program.name : r.reason);
  console.log('ordination (should refuse):', issueOnCompletion({ course: 'course:ordination', recipientName: 'X' }).reason);
}
