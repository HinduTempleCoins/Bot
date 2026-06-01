/**
 * resolution.js — Cheetah Step 4: the resolution flow (Hathor's half).
 *
 * Per CHEETAH_ADVANCED.md: Cheetah only POINTS (states a match/connection).
 * RESOLUTION — deciding what a match means — is Hathor's job, in conversation,
 * and it is the ONLY path by which the evidenced whitelist/blacklist changes.
 * This module is the deterministic state machine underneath that conversation:
 * given an outcome, it applies the correct store transition with the right
 * guards. The conversational surface (Hathor asking, the person replying) is
 * Phase 3; this transition logic + its guards are buildable and testable now.
 *
 * Outcomes a finding can resolve to, and what each does to the store:
 *   self-quote   → resolved-self-quote   + whitelist (author proved prior authorship)
 *   licensed     → resolved-licensed     + whitelist (author showed a license/permission)
 *   coincidence  → resolved-coincidence  (common phrasing / public-domain; no list change)
 *   withdrawn    → withdrawn             (Cheetah's match was wrong; no list change)
 *   pass-off     → resolved-passoff      (confirmed copy w/o credit; eligible for blacklist
 *                                         ONLY on repeat + operator confirm — never here)
 *
 * Guard rails enforced:
 *   - whitelist transitions REQUIRE evidence (a URL/archive proving authorship).
 *   - blacklist is NEVER applied by this module automatically. It returns an
 *     escalation recommendation; addBlacklist (store.js) still requires a human
 *     addedBy and refuses cheetah-auto.
 */

import { resolveFinding, addWhitelist, _internal } from './store.js';

// outcome → { status, whitelists, needsEvidence }
export const OUTCOMES = {
  'self-quote':  { status: 'resolved-self-quote',  whitelists: true,  needsEvidence: true,  reason: 'author proved prior authorship of the material' },
  'licensed':    { status: 'resolved-licensed',    whitelists: true,  needsEvidence: true,  reason: 'author showed a license/permission to use the material' },
  'coincidence': { status: 'resolved-coincidence', whitelists: false, needsEvidence: false, reason: 'common phrasing / public-domain — not a copy' },
  'withdrawn':   { status: 'withdrawn',             whitelists: false, needsEvidence: false, reason: "Cheetah's match was incorrect on review" },
  'pass-off':    { status: 'resolved-passoff',      whitelists: false, needsEvidence: false, reason: 'confirmed use without credit' },
};

/**
 * Apply a resolution outcome to a finding. Deterministic: the OUTCOME is decided
 * by Hathor/operator (a human-ish judgement in conversation); this only enforces
 * the store transition + its evidence guard. Returns the updated finding plus,
 * for pass-off, an escalation note (blacklist is never auto-applied here).
 */
export async function applyResolution(findingId, outcome, { by, evidence, materialHash } = {}, path) {
  const spec = OUTCOMES[outcome];
  if (!spec) throw new Error(`unknown outcome: ${outcome} (one of: ${Object.keys(OUTCOMES).join(', ')})`);
  if (!by) throw new Error('applyResolution requires {by} — who resolved it (hathor/operator)');
  if (spec.needsEvidence && !evidence) {
    throw new Error(`outcome "${outcome}" requires evidence (a URL/archive proving the claim) before it can whitelist`);
  }

  const updated = await resolveFinding(findingId, { status: spec.status, by, reason: spec.reason, evidence }, path);

  if (spec.whitelists) {
    await addWhitelist({
      account: updated.post.author,
      material: materialHash || null,
      reason: spec.status.replace(/^resolved-/, ''),
      evidence,
      addedBy: by,
    }, path);
  }

  // pass-off never auto-blacklists; surface an escalation recommendation instead.
  const escalation = outcome === 'pass-off'
    ? { recommend: 'review-for-blacklist', requires: 'operator confirmation + a prior pass-off on record', auto: false }
    : null;

  return { finding: updated, whitelisted: spec.whitelists, escalation };
}

/**
 * Decide whether a confirmed pass-off author is eligible for blacklist. This is
 * the REPEAT check Cheetah's design demands — one pass-off is a conversation, a
 * pattern is a blacklist. Returns eligibility + the prior trail; the actual
 * addBlacklist call still needs a human addedBy (store.js enforces).
 */
export async function blacklistEligibility(account, path) {
  const state = await _internal.loadStore(path);
  const passoffs = state.findings.filter(
    (f) => f.post?.author === account && f.status === 'resolved-passoff'
  );
  return {
    account,
    priorPassoffs: passoffs.length,
    eligible: passoffs.length >= 2, // a pattern, not a single incident
    note: passoffs.length >= 2
      ? 'pattern of confirmed pass-off — eligible for operator-confirmed blacklist'
      : 'not yet a pattern — stays in conversation/whitelist territory',
    evidenceTrail: passoffs.map((f) => ({ permlink: f.post.permlink, source: f.source, at: f.resolution?.at })),
  };
}
