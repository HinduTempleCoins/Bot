// pentecaust/bounties/pool-model.mjs — FUNDED BOUNTY POOLS (distinct from the onboarding /bounties catalogue).
//
// The "put up a pot, people do tasks, get paid from the pool" system. Synthesized from the systems worth
// looking at — NOT copied from any one:
//   • DevCoin / DevTome (the operator's own): contributors do the work and earn a share of a common coin
//     pool — the lineage this sits in — a contribution pool, hence ContributionBountyEscrow.
//   • Gitcoin: a funder escrows against work; the contributor claims; release on acceptance.
//   • The quest boards (Galxe / Layer3 / Zealy): connect an account via OAuth, do a task, AUTO-verify where
//     an API allows it, else claim-and-review.
// Our roles are our own: SPONSOR funds the pot → CONTRIBUTOR does the task and earns → VERIFIER confirms
// (automated where possible; the attestor role the escrow already defines). The on-chain pot is PRANA's
// ContributionBountyEscrow (sponsor escrows an ERC-20; an allowlisted attestor releases to the contributor)
// — easiest with PRANA native tokens, also MELEK / any ERC-20.
//
// This module is PURE + soft-fail + JSONL-backed (append-only; last-write-wins per id). No keys, no chain
// calls, no network — verification (./verify.mjs) and the escrow signer (./escrow.mjs) are separate and
// injected. Off-chain here means: the board, pools, submissions and review state; payout is a queued ACTION
// the attestor service executes on-chain.
//
//   createPool(input, store) · listPools(filter, store) · getPool(id, store)
//   submit(input, store) · reviewSubmission(id, decision, by, store) · listSubmissions(poolId, store)
//   poolStats(id, store) · payoutQueue(store)   (submissions verified-but-unpaid → the attestor acts on these)

import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// ── task types: the lane decides how a submission is verified ─────────────────────────────────────────
export const TASK_TYPES = [
  { slug: 'email', name: 'Send an email', lane: 'review', hint: 'Send the specified email; submit the sent-proof (headers/screenshot). Auto-verifiable when sent through our mail system.' },
  { slug: 'facebook_post', name: 'Post on Facebook', lane: 'auto', hint: 'Post the content; connect Facebook via OAuth so we can verify the post via the Graph API.' },
  { slug: 'x_post', name: 'Post on X / Twitter', lane: 'auto', hint: 'Post + connect X; verified via the API or the submitted post URL.' },
  { slug: 'join_group', name: 'Join a group / follow', lane: 'auto', hint: 'Join/follow; verified via OAuth membership check.' },
  { slug: 'referral', name: 'Referral link', lane: 'auto', hint: 'Share your referral link; verified by tracked clicks/sign-ups (Herald click-validate).' },
  { slug: 'content', name: 'Create content / contribution', lane: 'review', hint: 'Submit a link to the work; a verifier approves.' },
  { slug: 'custom', name: 'Custom task', lane: 'review', hint: 'As described by the sponsor; verifier-approved.' },
];
export const TASK_BY_SLUG = Object.fromEntries(TASK_TYPES.map((t) => [t.slug, t]));
export const laneFor = (slug) => (TASK_BY_SLUG[slug] || { lane: 'review' }).lane;

const CHAINS = new Set(['prana', 'prana-testnet', 'melek']);
const nowISO = (clock) => new Date(typeof clock === 'function' ? clock() : Date.now()).toISOString();
const id8 = () => Math.random().toString(36).slice(2, 10);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const str = (v, max = 400) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// ── JSONL store (append-only; records keyed by {kind,id}; last write wins) ────────────────────────────
export function defaultStore(file = (process.env.BOUNTY_POOLS_FILE || 'data/bounty-pools.jsonl')) {
  return {
    file,
    _append(rec) { try { mkdirSync(dirname(this.file), { recursive: true }); appendFileSync(this.file, JSON.stringify(rec) + '\n'); return true; } catch { return false; } },
    _all() { try { return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } },
    _latest(kind) { const by = new Map(); for (const r of this._all()) { if (r && r.kind === kind && r.id) by.set(r.id, r); } return [...by.values()]; },
    put(rec) { return this._append(rec); },
    pools() { return this._latest('pool'); },
    subs() { return this._latest('sub'); },
  };
}
export function memStore() {
  const rows = [];
  return { file: null, _all: () => rows, _latest(kind) { const by = new Map(); for (const r of rows) if (r.kind === kind && r.id) by.set(r.id, r); return [...by.values()]; }, put(rec) { rows.push(rec); return true; }, pools() { return this._latest('pool'); }, subs() { return this._latest('sub'); } };
}

// ── pools ─────────────────────────────────────────────────────────────────────────────────────────────
export function createPool(input = {}, store = defaultStore(), opts = {}) {
  const sponsor = str(input.sponsor, 120);
  if (!sponsor) return { ok: false, error: 'sponsor required (a logged-in account)' };
  const taskType = str(input.taskType, 40);
  if (!TASK_BY_SLUG[taskType]) return { ok: false, error: 'unknown taskType' };
  const chain = str(input.chain, 20) || 'prana-testnet';
  if (!CHAINS.has(chain)) return { ok: false, error: 'unsupported chain' };
  const pot = num(input.pot); const reward = num(input.perTaskReward);
  if (pot <= 0 || reward <= 0 || reward > pot) return { ok: false, error: 'pot and perTaskReward must be > 0 and reward <= pot' };
  const rec = {
    kind: 'pool', id: 'p_' + id8(), sponsor,
    title: str(input.title, 140) || 'Bounty',
    desc: str(input.desc, 2000),
    chain, token: str(input.token, 80) || 'PRANA',
    pot, perTaskReward: reward,
    slots: Math.max(1, Math.floor(pot / reward)),
    taskType, lane: laneFor(taskType),
    criteria: str(input.criteria, 1000),
    // on-chain linkage: filled once the sponsor funds ContributionBountyEscrow
    escrow: { contract: str(input.escrowContract, 80), bountyId: input.escrowBountyId != null ? str(input.escrowBountyId, 40) : '', funded: false, txid: '' },
    status: 'draft', // draft → funded → active → closed
    created: nowISO(opts.clock), updated: nowISO(opts.clock),
  };
  store.put(rec);
  return { ok: true, pool: rec };
}

export function setPoolFunded(id, { bountyId, txid, contract } = {}, store = defaultStore(), opts = {}) {
  const p = getPool(id, store); if (!p) return { ok: false, error: 'no such pool' };
  const rec = { ...p, escrow: { ...p.escrow, bountyId: bountyId != null ? String(bountyId) : p.escrow.bountyId, txid: txid || p.escrow.txid, contract: contract || p.escrow.contract, funded: true }, status: 'active', updated: nowISO(opts.clock) };
  store.put(rec); return { ok: true, pool: rec };
}
export function setPoolStatus(id, status, store = defaultStore(), opts = {}) {
  const p = getPool(id, store); if (!p) return { ok: false, error: 'no such pool' };
  if (!['draft', 'funded', 'active', 'closed'].includes(status)) return { ok: false, error: 'bad status' };
  const rec = { ...p, status, updated: nowISO(opts.clock) }; store.put(rec); return { ok: true, pool: rec };
}
export const getPool = (id, store = defaultStore()) => store.pools().find((p) => p.id === id) || null;
export function listPools(filter = {}, store = defaultStore()) {
  let out = store.pools();
  if (filter.status) out = out.filter((p) => p.status === filter.status);
  if (filter.sponsor) out = out.filter((p) => p.sponsor === filter.sponsor);
  if (filter.taskType) out = out.filter((p) => p.taskType === filter.taskType);
  return out.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

// ── submissions (a worker claims a task) ──────────────────────────────────────────────────────────────
export function submit(input = {}, store = defaultStore(), opts = {}) {
  const poolId = str(input.poolId, 40); const worker = str(input.worker, 120);
  if (!poolId || !worker) return { ok: false, error: 'poolId and worker required' };
  const pool = getPool(poolId, store); if (!pool) return { ok: false, error: 'no such pool' };
  if (pool.status !== 'active') return { ok: false, error: 'pool is not active (sponsor must fund it first)' };
  const already = store.subs().filter((s) => s.poolId === poolId);
  if (already.some((s) => s.worker === worker && s.status !== 'rejected')) return { ok: false, error: 'you already have a submission for this pool' };
  const paidOrOpen = already.filter((s) => s.status !== 'rejected').length;
  if (paidOrOpen >= pool.slots) return { ok: false, error: 'pool is full (all slots claimed)' };
  const rec = {
    kind: 'sub', id: 's_' + id8(), poolId, worker,
    connectedAccount: str(input.connectedAccount, 160), // the OAuth-linked account the task was done on
    proof: str(input.proof, 1000),
    lane: pool.lane, status: 'submitted', // submitted → verified → paid ; or rejected
    reward: pool.perTaskReward, payoutTxid: '',
    created: nowISO(opts.clock), updated: nowISO(opts.clock), reviewer: '', note: '',
  };
  store.put(rec); return { ok: true, submission: rec };
}
export const getSub = (id, store = defaultStore()) => store.subs().find((s) => s.id === id) || null;
export const listSubmissions = (poolId, store = defaultStore()) => store.subs().filter((s) => !poolId || s.poolId === poolId).sort((a, b) => (b.created || '').localeCompare(a.created || ''));

/** A verifier (or the auto-verifier) sets a submission's outcome. decision: 'verify' | 'reject'. */
export function reviewSubmission(id, decision, by = '', note = '', store = defaultStore(), opts = {}) {
  const s = getSub(id, store); if (!s) return { ok: false, error: 'no such submission' };
  if (s.status !== 'submitted') return { ok: false, error: `submission is ${s.status}, not reviewable` };
  if (!['verify', 'reject'].includes(decision)) return { ok: false, error: 'decision must be verify|reject' };
  const rec = { ...s, status: decision === 'verify' ? 'verified' : 'rejected', reviewer: str(by, 120), note: str(note, 400), updated: nowISO(opts.clock) };
  store.put(rec); return { ok: true, submission: rec };
}
/** The attestor marks a verified submission paid once attestAndRelease lands on-chain. */
export function markPaid(id, txid, store = defaultStore(), opts = {}) {
  const s = getSub(id, store); if (!s) return { ok: false, error: 'no such submission' };
  if (s.status !== 'verified') return { ok: false, error: 'only verified submissions can be paid' };
  const rec = { ...s, status: 'paid', payoutTxid: str(txid, 120), updated: nowISO(opts.clock) }; store.put(rec); return { ok: true, submission: rec };
}
/** Verified-but-unpaid submissions — what the on-chain attestor service drains. */
export const payoutQueue = (store = defaultStore()) => store.subs().filter((s) => s.status === 'verified');

export function poolStats(id, store = defaultStore()) {
  const p = getPool(id, store); if (!p) return null;
  const subs = listSubmissions(id, store);
  const paid = subs.filter((s) => s.status === 'paid').length;
  const open = subs.filter((s) => s.status === 'submitted' || s.status === 'verified').length;
  return { pool: p.id, slots: p.slots, paid, open, remaining: Math.max(0, p.slots - paid - open), paidAmount: paid * p.perTaskReward, potRemaining: Math.max(0, p.pot - paid * p.perTaskReward) };
}
