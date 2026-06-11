// knowledge/cryptocurrency/karma-merit-philosophy.mjs
//
// Karma / Merit philosophy explainer — read-only, sourced knowledge module.
//
// A glossary of the *philosophy* behind MELEK's off-chain Karma / Merit
// reputation layer: karma as earned merit (service-weighted) rather than bought
// stake, off-chain accrual that only informs on-chain curation, slow decay
// toward neutral over time, free accounts with earned influence, and the
// non-punitive "credit first" posture inherited from the CHEETAH framing.
//
// This module is PHILOSOPHY / glossary only. It deliberately does NOT touch the
// karma scoring math in karma/karma.mjs — it explains the *why*, not the *how*.
//
// Pure ESM data + query module. No network, no clock, no disk, no LLM. Soft-fail:
// an unknown key returns null; renderMarkdown is deterministic. Facts sourced
// statically from knowledge/cryptocurrency/karma_merit_system_guide.json and
// BRIEF.md §9 (off-chain karma) / the CHEETAH_ADVANCED.md crediting posture.
//
// House style: ESM .mjs, esc() all HTML interpolation, CLI guarded by
// process.argv[1], soft-fail never throw.

/** HTML-escape any interpolated value. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Each entry: `key` (stable lowercase id), `name` (canonical display name),
// `plain` (one-line plain-language), `detail` (the longer explanation),
// `source` (static provenance). All frozen, no IO.
export const PRINCIPLES = Object.freeze([
  Object.freeze({
    key: 'karma-is-earned-merit',
    name: 'Karma is earned merit, not bought stake',
    plain: 'Your standing reflects what you do for others, not how much coin you hold.',
    detail:
      'The Karma / Merit philosophy replaces stake-weighted reputation with service-weighted karma: a grade reflects what an account DOES, not what it HAS. Steem-style reputation is largely log10 of vote-value received, so a large stakeholder can boost anyone instantly and vote-buying services can manufacture standing. Karma / Merit instead measures actions and outcomes — who helps newcomers, who curates quality, who teaches — so genuine contributors are not out-ranked by capital alone.',
    source: 'karma_merit_system_guide.json ch.3 (Karma Merit Model); BRIEF.md §9 (karma is social, not economic).',
  }),
  Object.freeze({
    key: 'service-ratio',
    name: 'Service ratio: self versus others',
    plain: 'The core measure is the balance between serving yourself and serving others.',
    detail:
      'The foundational metric is the ratio of service-to-others against service-to-self. The philosophy frames this as a grade scale (the guide uses a 1-99 illustration drawn from de Laurence): pure self-service sits at the bottom, a balanced contributor in the middle, and someone whose work mostly raises others near the top. The point is directional, not numerological — karma rewards the orientation of action toward lifting others, and counts applause-seeking and self-promotion against the grade.',
    source: 'karma_merit_system_guide.json ch.1 (Service Ratio Teaching), ch.3 (Core Principles).',
  }),
  Object.freeze({
    key: 'fruit-not-fragrance',
    name: 'Measure the fruit, not the fragrance',
    plain: 'Judge by actions and their impact, not by beautiful claims or appearances.',
    detail:
      'A guiding maxim: look to the fruit (what an account actually produced and whether it raised or lowered others), not the fragrance (how polished the words or the self-presentation are). A user may post eloquently, but if the effect of their actions lowers others, their standing reflects the outcome rather than the rhetoric. This keeps the reputation signal anchored to real impact and resists gaming through surface polish.',
    source: 'karma_merit_system_guide.json ch.1 (Philosophical Foundations — fruit vs fragrance).',
  }),
  Object.freeze({
    key: 'off-chain-accrual',
    name: 'Off-chain accrual feeding on-chain curation',
    plain: 'Karma is computed and stored off-chain; it never touches the reward pool.',
    detail:
      'Karma lives in an off-chain database in this repo (forkable), computed from observable on-chain behavior. It is explicitly social, not economic: it never touches the chain reward pool or stake-weighted voting and never modifies the chain code. What it does is inform the Witness\'s discretionary, off-chain functions — larger signup/curation grants and more tutorial attention for high-karma accounts, and how heavily a flag from an account is weighed. The chain stays standard Graphene; all karma logic is off-chain.',
    source: 'BRIEF.md §9 (off-chain karma — social not economic, informs discretionary functions); karma_merit_system_guide.json ch.4 (off-chain implementation).',
  }),
  Object.freeze({
    key: 'decay-over-time',
    name: 'Decay toward neutral over time',
    plain: 'Karma slowly drifts back toward neutral so old standing must be renewed by ongoing service.',
    detail:
      'Karma is not a permanent trophy: in the absence of new service it decays slowly toward the neutral midpoint (the guide illustrates roughly one grade per week toward grade 50). Decay means past contribution cannot coast forever and a single early burst of activity does not lock in influence — standing reflects sustained, recent service. It also bounds the value of any one-time gaming attempt, since manufactured standing erodes if it is not backed by continued real contribution.',
    source: 'karma_merit_system_guide.json (karma_decay — slow decay toward neutral).',
  }),
  Object.freeze({
    key: 'free-accounts-earned-influence',
    name: 'Free accounts, earned influence',
    plain: 'Anyone can get an account for free; influence is then earned through service.',
    detail:
      'The philosophy separates entry from standing: financial barriers to entry are removed (anyone who wants an account gets one, created and funded by the Witness), while influence is earned afterward through service rather than purchased. This keeps the platform open to global newcomers without capital, yet preserves quality because reputation still has to be earned by contribution. It pairs directly with the signup model where the account is always created and never gated by an interview.',
    source: 'karma_merit_system_guide.json ch.6 (Free Accounts, Earned Influence); BRIEF.md §7 (anyone who wants an account gets one).',
  }),
  Object.freeze({
    key: 'human-ai-dual-track',
    name: 'Universal application — humans and AI alike',
    plain: 'The same service-based rules apply to human and AI accounts.',
    detail:
      'Karma / Merit applies the same principles to humans and to AI participants: both can rise through service and fall through self-service, judged by the same fruit-not-fragrance standard. The guide describes a dual-track framing so that AI contributors (curation, teaching, helping newcomers) accrue standing on the same service basis rather than being privileged or excluded by being machines. This matches MELEK\'s premise that the Witness is itself an account on the chain held to ordinary terms.',
    source: 'karma_merit_system_guide.json ch.5 (Human-AI Dual Track System), ch.7 (AI-Friendly Implementation).',
  }),
  Object.freeze({
    key: 'non-punitive-crediting',
    name: 'Non-punitive crediting (CHEETAH framing)',
    plain: 'Standing is built by crediting contribution first; punishment is the last resort.',
    detail:
      'The reputation posture is corrective and crediting rather than punitive, inherited from the CHEETAH framing. First contact on any issue (such as a content match) is a friendly, crediting note that links the source, not an accusation. Escalation to "this is actually a problem" happens only after a repeated pattern and an appeals path — the system assumes it can be wrong and builds the correction path as core. Applied to karma, this means standing is built by recognizing genuine contribution, and negative judgment is reserved for sustained, demonstrated bad behavior.',
    source: 'CHEETAH_ADVANCED.md (credit first, escalate last; assume Cheetah can be wrong); karma_merit_system_guide.json ch.2 (downvote wars punish dissent, not bad behavior).',
  }),
]);

/** Case-insensitive exact-key lookup. Returns the entry or null. Soft-fail. */
export function lookup(key) {
  if (key == null) return null;
  const k = String(key).trim().toLowerCase();
  if (!k) return null;
  return PRINCIPLES.find((e) => e.key === k) || null;
}

/** All principle keys, in declaration order. */
export function list() {
  return PRINCIPLES.map((e) => e.key);
}

/**
 * Case-insensitive substring search across key, name, plain, and detail.
 * Returns matching entries in declaration order; empty/blank term -> []. Soft-fail.
 */
export function search(term) {
  if (term == null) return [];
  const t = String(term).trim().toLowerCase();
  if (!t) return [];
  return PRINCIPLES.filter((e) =>
    e.key.toLowerCase().includes(t) ||
    e.name.toLowerCase().includes(t) ||
    e.plain.toLowerCase().includes(t) ||
    e.detail.toLowerCase().includes(t));
}

/**
 * Deterministic Markdown doc. Renders every entry in PRINCIPLES array order,
 * with all interpolated text esc()'d. No clock, no randomness.
 */
export function renderMarkdown() {
  const lines = ['# Karma / Merit — Philosophy Explainer', ''];
  lines.push('_Philosophy / glossary only. Does not implement the karma scoring math (see karma/karma.mjs)._');
  lines.push('');
  for (const e of PRINCIPLES) {
    lines.push(`## ${esc(e.name)}`);
    lines.push('');
    lines.push(`**${esc(e.plain)}**`);
    lines.push('');
    lines.push(esc(e.detail));
    lines.push('');
    lines.push(`_Source: ${esc(e.source)}_`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

// CLI: `node karma-merit-philosophy.mjs [key-or-search-term]`. With an exact
// key, prints that entry; otherwise prints any search matches; with no arg,
// prints the full Markdown doc.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg) {
    const hit = lookup(arg);
    if (hit) {
      process.stdout.write(`${hit.name}\n  ${hit.plain}\n\n${hit.detail}\n\nSource: ${hit.source}\n`);
    } else {
      const matches = search(arg);
      if (matches.length) {
        process.stdout.write(`No exact key "${arg}". ${matches.length} search match(es):\n  ${matches.map((e) => e.key).join('\n  ')}\n`);
      } else {
        process.stdout.write(`No entry or match for "${arg}".\nKnown keys:\n  ${list().join('\n  ')}\n`);
      }
    }
  } else {
    process.stdout.write(`${renderMarkdown()}\n`);
  }
}
