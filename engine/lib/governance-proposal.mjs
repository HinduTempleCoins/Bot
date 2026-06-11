// governance-proposal.mjs — PURE off-chain DAO governance proposal lifecycle + tally.
//
// This is the "DAO governance structure / plan governance structure" itinerary
// item: a small deterministic state machine for a governance PROPOSAL — its
// options, quorum, threshold, voting window, vote tally, and computed result.
// It is intentionally distinct from its two siblings:
//
//   integrations/access-bond-dao.mjs — derives veToken-style VOTING POWER from
//     locked stake + a burn-for-access membership ledger. It answers "how much
//     weight does this account have / is it a member?" It has NO proposal,
//     quorum, threshold, or open/passed/rejected lifecycle. THIS module consumes
//     a weight (you can feed it votingPower() output) but does not compute it.
//
//   engine/contracts/rewards.mjs — Scotbot-style per-POST curation votes that
//     drive token EMISSION on a maturity window. That is reward accounting, not
//     governance decision-making. THIS module decides yes/no/options on a
//     proposal, not author/curator payouts.
//
// PURITY / SOFT-FAIL CONTRACT:
//   - No clock (caller passes nowTs), no network, no fetch, no LLM, no disk.
//   - No throw: bad input returns a safe normalized value (frozen object / the
//     tally unchanged / a soft result). esc() guards every HTML interpolation.
//   - Tallies are IMMUTABLE: castVote returns a NEW frozen tally, never mutates.
//
//   import { createProposal, castVote, tallyResult, isOpen, renderMarkdown,
//            STATES, esc } from './governance-proposal.mjs'
//   node engine/lib/governance-proposal.mjs   # print a worked example

/** Escape a string for safe HTML/Markdown interpolation. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Lifecycle states, in narrative order. Frozen. */
export const STATES = Object.freeze(['draft', 'open', 'passed', 'rejected', 'expired']);

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

function clampPct(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function finiteTs(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanStr(v, fallback = '') {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

/** Round to 2 decimals deterministically (avoids float-tail noise in output). */
function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// createProposal — normalize + freeze
// ---------------------------------------------------------------------------

/**
 * Build a normalized, frozen proposal object.
 * @returns {Readonly<{id,title,options,quorumPct,thresholdPct,opensAt,closesAt}>}
 */
export function createProposal(input = {}) {
  const p = input && typeof input === 'object' ? input : {};

  // Options: de-duplicate, drop blanks, default to a yes/no vote.
  let options = Array.isArray(p.options) ? p.options : ['yes', 'no'];
  const seen = new Set();
  options = options
    .map((o) => cleanStr(o))
    .filter((o) => {
      if (!o) return false;
      const k = o.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (options.length === 0) options = ['yes', 'no'];

  const opensAt = finiteTs(p.opensAt);
  let closesAt = finiteTs(p.closesAt);
  // A window that closes before it opens is incoherent; drop closesAt so the
  // proposal reads as open-ended rather than perpetually expired.
  if (opensAt !== null && closesAt !== null && closesAt < opensAt) closesAt = null;

  return Object.freeze({
    id: cleanStr(p.id, 'proposal'),
    title: cleanStr(p.title, '(untitled proposal)'),
    options: Object.freeze(options),
    quorumPct: clampPct(p.quorumPct, 20),
    thresholdPct: clampPct(p.thresholdPct, 50),
    opensAt,
    closesAt,
  });
}

// ---------------------------------------------------------------------------
// castVote — immutable, one-vote-per-voter (last wins)
// ---------------------------------------------------------------------------

/**
 * Apply a vote to a tally, returning a NEW frozen tally.
 * Tally shape: { votes: { [voter]: { option, weight } } }.
 * Ignores unknown options, non-positive/non-finite weight, or a missing voter.
 * The proposal is needed to validate the option against its option set; if a
 * tally is built standalone (no proposal handy), pass `null` to skip that check.
 */
export function castVote(tally, vote, proposal = null) {
  const base =
    tally && typeof tally === 'object' && tally.votes && typeof tally.votes === 'object'
      ? tally.votes
      : {};

  const v = vote && typeof vote === 'object' ? vote : {};
  const voter = cleanStr(v.voter);
  const option = cleanStr(v.option);
  const weight = Number(v.weight);

  const validOption =
    proposal && Array.isArray(proposal.options)
      ? proposal.options.some((o) => o === option)
      : option.length > 0;

  // Soft-fail: invalid vote leaves the tally semantically unchanged (still a
  // fresh frozen copy so the return value is always safe to keep).
  if (!voter || !validOption || !Number.isFinite(weight) || weight <= 0) {
    return _freezeTally({ ...base });
  }

  // Last vote wins: overwrite any prior vote by this voter.
  return _freezeTally({ ...base, [voter]: Object.freeze({ option, weight }) });
}

/** Create an empty frozen tally. */
export function emptyTally() {
  return _freezeTally({});
}

function _freezeTally(votes) {
  return Object.freeze({ votes: Object.freeze({ ...votes }) });
}

// ---------------------------------------------------------------------------
// isOpen — is the window live at nowTs?
// ---------------------------------------------------------------------------

/** True iff nowTs is within [opensAt, closesAt]. Missing bounds are open-ended. */
export function isOpen(proposal, nowTs) {
  if (!proposal || typeof proposal !== 'object') return false;
  const now = finiteTs(nowTs);
  if (now === null) return false;
  if (proposal.opensAt !== null && proposal.opensAt !== undefined && now < proposal.opensAt) {
    return false;
  }
  if (proposal.closesAt !== null && proposal.closesAt !== undefined && now > proposal.closesAt) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// tallyResult — deterministic computed outcome
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic result of a proposal against a tally.
 * @returns {{ turnoutPct, leadingOption, optionPcts, quorumMet, thresholdMet, state }}
 */
export function tallyResult(proposal, tally, totalEligibleWeight, nowTs) {
  const p = proposal && typeof proposal === 'object' ? proposal : createProposal({});
  const options = Array.isArray(p.options) ? p.options : ['yes', 'no'];

  const votes =
    tally && typeof tally === 'object' && tally.votes && typeof tally.votes === 'object'
      ? tally.votes
      : {};

  // Per-option summed weight (only options that belong to the proposal).
  const perOption = Object.create(null);
  for (const o of options) perOption[o] = 0;
  let castWeight = 0;
  for (const voter of Object.keys(votes)) {
    const rec = votes[voter];
    if (!rec || typeof rec !== 'object') continue;
    const w = Number(rec.weight);
    if (!Number.isFinite(w) || w <= 0) continue;
    if (!Object.prototype.hasOwnProperty.call(perOption, rec.option)) continue;
    perOption[rec.option] += w;
    castWeight += w;
  }

  const eligible = Number(totalEligibleWeight);
  const totalEligible = Number.isFinite(eligible) && eligible > 0 ? eligible : 0;

  // Turnout against the eligible electorate.
  const turnoutPct = totalEligible > 0 ? round2((castWeight / totalEligible) * 100) : 0;

  // Leading option + per-option share of CAST weight. Ties resolve by the
  // proposal's option order (first declared wins) for determinism.
  const optionPcts = {};
  let leadingOption = null;
  let leadingWeight = -1;
  for (const o of options) {
    const w = perOption[o] || 0;
    optionPcts[o] = castWeight > 0 ? round2((w / castWeight) * 100) : 0;
    if (w > leadingWeight) {
      leadingWeight = w;
      leadingOption = o;
    }
  }
  if (castWeight === 0) leadingOption = null;

  const quorumMet = totalEligible > 0 ? turnoutPct >= p.quorumPct : false;
  const leadingShare = leadingOption !== null ? optionPcts[leadingOption] : 0;
  const thresholdMet = leadingOption !== null && leadingShare >= p.thresholdPct;

  const state = _deriveState(p, { quorumMet, thresholdMet }, nowTs);

  return {
    turnoutPct,
    leadingOption,
    optionPcts,
    quorumMet,
    thresholdMet,
    state,
  };
}

function _deriveState(p, { quorumMet, thresholdMet }, nowTs) {
  const now = finiteTs(nowTs);

  // Not yet opened (or no window info + no now) => draft.
  if (now === null) return 'draft';
  if (p.opensAt !== null && p.opensAt !== undefined && now < p.opensAt) return 'draft';

  const closed = p.closesAt !== null && p.closesAt !== undefined && now > p.closesAt;

  if (!closed) return 'open';

  // Window has closed: decide the outcome.
  if (!quorumMet) return 'expired'; // not enough turnout to be binding
  return thresholdMet ? 'passed' : 'rejected';
}

// ---------------------------------------------------------------------------
// renderMarkdown — deterministic, esc()'d summary
// ---------------------------------------------------------------------------

/** Deterministic Markdown summary of a proposal + its computed result. */
export function renderMarkdown(proposal, result) {
  const p = proposal && typeof proposal === 'object' ? proposal : createProposal({});
  const r = result && typeof result === 'object' ? result : {};

  const options = Array.isArray(p.options) ? p.options : [];
  const optionPcts = r.optionPcts && typeof r.optionPcts === 'object' ? r.optionPcts : {};
  const state = STATES.includes(r.state) ? r.state : 'draft';

  const lines = [];
  lines.push(`# Proposal: ${esc(p.title)}`);
  lines.push('');
  lines.push(`- **ID:** ${esc(p.id)}`);
  lines.push(`- **State:** ${esc(state)}`);
  lines.push(`- **Quorum required:** ${esc(p.quorumPct)}%`);
  lines.push(`- **Threshold required:** ${esc(p.thresholdPct)}%`);
  lines.push(`- **Turnout:** ${esc(round2(Number(r.turnoutPct) || 0))}%`);
  lines.push(
    `- **Quorum met:** ${r.quorumMet ? 'yes' : 'no'}  |  **Threshold met:** ${r.thresholdMet ? 'yes' : 'no'}`,
  );
  const leading = r.leadingOption ? esc(r.leadingOption) : '(none)';
  lines.push(`- **Leading option:** ${leading}`);
  lines.push('');
  lines.push('## Options');
  for (const o of options) {
    const pct = round2(Number(optionPcts[o]) || 0);
    const mark = r.leadingOption === o ? ' ←' : '';
    lines.push(`- ${esc(o)}: ${esc(pct)}%${mark}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI demo (guarded) — worked example, no IO beyond stdout.
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const p = createProposal({
    id: 'mip-1',
    title: 'Fund the Witness School localization wave',
    options: ['yes', 'no', 'abstain'],
    quorumPct: 20,
    thresholdPct: 50,
    opensAt: 1000,
    closesAt: 2000,
  });
  let t = emptyTally();
  t = castVote(t, { voter: 'alice', option: 'yes', weight: 30 }, p);
  t = castVote(t, { voter: 'bob', option: 'no', weight: 10 }, p);
  t = castVote(t, { voter: 'carol', option: 'yes', weight: 15 }, p);
  t = castVote(t, { voter: 'alice', option: 'abstain', weight: 30 }, p); // last wins
  const r = tallyResult(p, t, 100, 2500); // after close
  process.stdout.write(renderMarkdown(p, r) + '\n');
}
