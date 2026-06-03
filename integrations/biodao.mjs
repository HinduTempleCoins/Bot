// biodao.mjs — stake-weighted governance over pooled bio-data research access.
// Model: Molecule / VitaDAO. Members pool de-identified bio-data; a research buyer
// requests scoped access + pays the DAO treasury (receive-only record). Token holders
// vote on whether to grant access, weighted by held stake.
//
// PURE logic — no network, no I/O. Deterministic, in-memory.
//
// Core invariants:
//   • Voting power == held stake (no quadratic, no delegation here).
//   • Quorum is a fraction of total circulating stake (quorumRule, pure).
//   • A proposal whose dataScope touches Tier-1 neural data needs a HIGHER
//     pass threshold (super-majority) than ordinary data proposals.
//   • Research-buyer payments only ever ADD to the treasury (receive-only).
//
//   import { createProposal, vote, tally, quorumRule } from './biodao.mjs'
//   node integrations/biodao.mjs            # demo a proposal lifecycle

// ---- tunables ----
export const DEFAULTS = Object.freeze({
  totalStake: 1_000_000,        // circulating governance stake
  quorumFraction: 0.2,          // 20% of total stake must participate
  passThreshold: 0.5,           // >50% of cast stake must support (ordinary)
  tier1PassThreshold: 0.667,    // ≥66.7% for Tier-1 neural data
});

// Data sensitivity tiers. Tier-1 = neural / brain-stimulation-adjacent bio-data.
export const TIER1_SCOPES = Object.freeze(['neural', 'eeg', 'bci', 'brain', 'tdcs', 'tens']);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Does a dataScope touch Tier-1 neural data? (pure)
export function isTier1Scope(dataScope) {
  const scopes = Array.isArray(dataScope) ? dataScope : [dataScope];
  const hay = ' ' + scopes.map(norm).join(' ') + ' ';
  return TIER1_SCOPES.some((kw) => hay.includes(' ' + kw + ' ') || hay.includes(kw));
}

// PURE quorum rule: how much participating stake is required, and is it met?
//   quorumRule(totalStake, { quorumFraction }) → { required }
//   quorumRule(totalStake, { quorumFraction, participated }) → { required, met }
export function quorumRule(totalStake, params = {}) {
  const total = Math.max(0, Number(totalStake) || 0);
  const frac = params.quorumFraction == null ? DEFAULTS.quorumFraction : Number(params.quorumFraction);
  const required = total * frac;
  const out = { required };
  if (params.participated != null) {
    out.met = (Number(params.participated) || 0) >= required;
  }
  return out;
}

// ---- in-memory store ----
const _proposals = new Map();
let _seq = 0;

export function __reset() { _proposals.clear(); _seq = 0; }
export function getProposal(id) { return _proposals.get(id) || null; }
export function listProposals() { return [..._proposals.values()]; }

// Create a proposal for scoped research access to pooled bio-data.
export function createProposal({ title, requester, dataScope, fundingAsk } = {}) {
  if (!title || !String(title).trim()) throw new Error('title required');
  if (!requester || !String(requester).trim()) throw new Error('requester required');
  if (dataScope == null || (Array.isArray(dataScope) && dataScope.length === 0)) {
    throw new Error('dataScope required');
  }
  const ask = Number(fundingAsk) || 0;
  if (ask < 0) throw new Error('fundingAsk must be >= 0');

  const tier1 = isTier1Scope(dataScope);
  const id = `prop-${++_seq}`;
  const proposal = {
    id,
    title: String(title).trim(),
    requester: String(requester).trim(),
    dataScope: Array.isArray(dataScope) ? [...dataScope] : [dataScope],
    fundingAsk: ask,
    tier1,
    passThreshold: tier1 ? DEFAULTS.tier1PassThreshold : DEFAULTS.passThreshold,
    quorumFraction: DEFAULTS.quorumFraction,
    totalStake: DEFAULTS.totalStake,
    votes: new Map(),          // voter -> { stake, support }
    treasury: { balance: 0, receipts: [] }, // receive-only
    status: 'open',
  };
  _proposals.set(id, proposal);
  return proposal;
}

// Cast a stake-weighted vote. Voting power == held stake. One vote per voter
// (re-voting replaces the prior vote — power stays = held stake, never doubled).
export function vote(proposalId, { voter, stake, support } = {}) {
  const p = _proposals.get(proposalId);
  if (!p) throw new Error(`unknown proposal: ${proposalId}`);
  if (p.status !== 'open') throw new Error(`proposal not open: ${proposalId}`);
  if (!voter || !String(voter).trim()) throw new Error('voter required');
  const s = Number(stake);
  if (!Number.isFinite(s) || s <= 0) throw new Error('stake must be > 0');
  if (s > p.totalStake) throw new Error('stake exceeds total circulating stake');
  p.votes.set(String(voter).trim(), { stake: s, support: !!support });
  return p;
}

// Record a research-buyer payment into the DAO treasury. RECEIVE-ONLY:
// balance can only increase; there is no withdrawal path here.
export function recordPayment(proposalId, { from, amount } = {}) {
  const p = _proposals.get(proposalId);
  if (!p) throw new Error(`unknown proposal: ${proposalId}`);
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('amount must be > 0');
  p.treasury.balance += amt;
  p.treasury.receipts.push({ from: String(from || 'unknown'), amount: amt });
  return { balance: p.treasury.balance, receipts: p.treasury.receipts.length };
}

// Tally a proposal: stake-weighted for/against, quorum, and pass/fail.
export function tally(proposalId) {
  const p = _proposals.get(proposalId);
  if (!p) throw new Error(`unknown proposal: ${proposalId}`);

  let forStake = 0, againstStake = 0;
  for (const { stake, support } of p.votes.values()) {
    if (support) forStake += stake; else againstStake += stake;
  }
  const participated = forStake + againstStake;
  const { required, met: quorumMet } = quorumRule(p.totalStake, {
    quorumFraction: p.quorumFraction,
    participated,
  });
  const supportRatio = participated > 0 ? forStake / participated : 0;
  const passed = quorumMet && supportRatio > p.passThreshold && forStake > 0;

  return {
    proposalId: p.id,
    tier1: p.tier1,
    forStake,
    againstStake,
    participated,
    quorumRequired: required,
    quorumMet,
    supportRatio,
    passThreshold: p.passThreshold,
    passed,
    treasuryBalance: p.treasury.balance,
  };
}

// ---- CLI (demo only) ----
if (process.argv[1] && process.argv[1].endsWith('biodao.mjs')) {
  __reset();
  const p = createProposal({
    title: 'Longevity cohort metabolomics access',
    requester: 'acme-research-labs',
    dataScope: ['metabolomics', 'wearable-hr'],
    fundingAsk: 50_000,
  });
  vote(p.id, { voter: 'alice', stake: 120_000, support: true });
  vote(p.id, { voter: 'bob', stake: 80_000, support: true });
  vote(p.id, { voter: 'carol', stake: 60_000, support: false });
  recordPayment(p.id, { from: 'acme-research-labs', amount: 50_000 });
  console.log('proposal:', { id: p.id, tier1: p.tier1, threshold: p.passThreshold });
  console.log('tally:', tally(p.id));

  const n = createProposal({
    title: 'Neural EEG dataset access',
    requester: 'brainco',
    dataScope: ['neural', 'eeg'],
    fundingAsk: 200_000,
  });
  vote(n.id, { voter: 'alice', stake: 120_000, support: true });
  vote(n.id, { voter: 'bob', stake: 90_000, support: false });
  console.log('tier1 proposal:', { id: n.id, tier1: n.tier1, threshold: n.passThreshold });
  console.log('tier1 tally:', tally(n.id));
}
