// token-programs.mjs — Herald's AIRDROP + BOUNTY orchestrator for MELEK/PRANA tokens.
//
// The unifying layer over the on-chain primitives we already ship:
//   - allocation math:  engine/lib/airdrop-plan.mjs (allocate / capWeights / normalizeSnapshot)
//   - MELEK-Engine dist: tokens.transfer via custom_json (chain 'melek')
//   - PRANA (EVM) dist:  BatchAirdrop.airdrop(recipients,amounts) / MerkleDistributor (chain 'prana')
//   - PRANA bounties:    ContributionBountyEscrow.post / attestAndRelease / cancel
//
// This module PLANS + tracks; it SIGNS NOTHING. planAirdrop returns per-recipient allocations plus the
// UNSIGNED on-chain calls the signer/daemon executes. The bounty registry is an injectable in-memory
// store (a daemon persists it). Pure, soft-fail-never-throw, house style. No network, no keys.
import { allocate, capWeights, normalizeSnapshot } from '../../engine/lib/airdrop-plan.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CHAINS = new Set(['melek', 'prana']);
const err = (error) => ({ ok: false, error });
const ok = (data = {}) => ({ ok: true, ...data });

// ── eligibility sources → a snapshot [{account, balance}] ─────────────────────────────────────────
/** From an explicit list of accounts (each gets equal weight 1 unless a balance is given). */
export function fromList(accounts = []) {
  return (Array.isArray(accounts) ? accounts : [])
    .map((a) => (typeof a === 'string' ? { account: a, balance: 1 } : { account: a.account, balance: a.balance ?? 1 }))
    .filter((h) => h.account);
}
/** From a holder snapshot, keeping only balances at/above a threshold (sybil/dust guard).
 *  normalizeSnapshot yields {account, weight:BigInt}; we return {account, balance} for a uniform shape. */
export function fromHolders(holders = [], minBalance = 0) {
  const min = BigInt(Math.max(0, Math.floor(Number(minBalance) || 0)));
  return normalizeSnapshot(holders)
    .filter((h) => h.weight >= min)
    .map((h) => ({ account: h.account, balance: Number(h.weight) }));
}
/** From a karma map {account:score}, keeping accounts at/above minKarma; weight = score (merit airdrop). */
export function fromKarma(karma = {}, minKarma = 0) {
  return Object.entries(karma || {})
    .filter(([, s]) => Number(s) >= Number(minKarma || 0))
    .map(([account, s]) => ({ account, balance: Number(s) || 0 }));
}

// ── airdrop planning ──────────────────────────────────────────────────────────────────────────────
/**
 * planAirdrop — turn a snapshot + a pool into a distribution plan + the unsigned on-chain calls.
 * @param {{token, chain, snapshot, total, scheme, minThreshold, capFraction, memo, precision}} p
 *  chain: 'melek' (MELEK-Engine token) | 'prana' (EVM ERC-20 via BatchAirdrop).
 * Returns { ok, token, chain, allocations, distributed, dust, count, calls } or { ok:false, error }.
 */
export function planAirdrop(p = {}) {
  const { token, chain, snapshot, total, scheme = 'proportional', minThreshold = 0, capFraction = 0, memo = '' } = p;
  if (!token) return err('token required');
  if (!CHAINS.has(chain)) return err(`chain must be one of ${[...CHAINS].join('/')}`);
  let holders = normalizeSnapshot(snapshot);
  if (holders.length === 0) return err('empty eligibility snapshot');
  if (Number(capFraction) > 0) holders = capWeights(holders, Number(capFraction)); // whale-cap
  const plan = allocate({ holders, totalAirdrop: total, scheme, minThreshold });
  if (!plan.allocations.length) return err('nothing to distribute (pool too small or all below threshold)');

  const recipients = plan.allocations.map((a) => a.account);
  const amounts = plan.allocations.map((a) => a.units.toString());
  const calls = chain === 'prana'
    ? [{ chain, contract: 'BatchAirdrop', method: 'airdrop', args: [token, recipients, amounts], unsigned: true }]
    // MELEK-Engine: one custom_json tokens.transfer per recipient (batched by the daemon).
    : plan.allocations.map((a) => ({
        chain, op: 'custom_json', id: 'ssc-mainnet-melek',
        json: { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: token, to: a.account, quantity: a.units.toString(), memo: memo || 'airdrop' } },
        unsigned: true,
      }));
  return ok({
    token, chain, scheme: plan.scheme,
    allocations: plan.allocations.map((a) => ({ account: a.account, amount: a.units.toString(), pct: a.pct })),
    distributed: plan.distributed.toString(), dust: plan.dust.toString(), count: plan.allocations.length, calls,
  });
}

// ── bounty registry ────────────────────────────────────────────────────────────────────────────────
const STATUS = new Set(['open', 'submitted', 'verifying', 'paid', 'cancelled']);
/**
 * createBountyBoard — the bounty half. Sponsors post a task + a token reward; workers submit; an
 * attester verifies and it pays (release). In-memory + injectable clock; signs nothing (emits the
 * unsigned release/post call for the daemon). Mirrors ContributionBountyEscrow (PRANA) / engine transfer.
 */
export function createBountyBoard({ storage, now } = {}) {
  const store = storage || { bounties: [], seq: 0 };
  store.bounties = store.bounties || [];
  store.seq = store.seq || 0;
  const clock = typeof now === 'function' ? now : () => Date.now();
  const find = (id) => store.bounties.find((b) => b.id === id) || null;

  function post({ token, chain, amount, task, sponsor, tag = '' } = {}) {
    if (!token) return err('token required');
    if (!CHAINS.has(chain)) return err('bad chain');
    if (!(Number(amount) > 0)) return err('amount must be > 0');
    if (!task) return err('task required');
    const id = ++store.seq;
    const b = { id, token, chain, amount: String(amount), task, sponsor: sponsor || '', tag, status: 'open', worker: null, submission: null, at: clock() };
    store.bounties.push(b);
    // On PRANA the escrow is funded via ContributionBountyEscrow.post(amount); on MELEK the sponsor
    // funds a hold account. The daemon executes the escrow call; here we return the unsigned intent.
    const escrowCall = chain === 'prana'
      ? { chain, contract: 'ContributionBountyEscrow', method: 'post', args: [String(amount)], unsigned: true }
      : { chain, op: 'custom_json', id: 'ssc-mainnet-melek', json: { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: token, to: 'bounty-escrow', quantity: String(amount), memo: `bounty:${id}` } }, unsigned: true };
    return ok({ bounty: b, escrowCall });
  }
  function submit(id, { worker, submission } = {}) {
    const b = find(id); if (!b) return err('bounty not found');
    if (b.status !== 'open' && b.status !== 'submitted') return err(`bounty is ${b.status}`);
    if (!worker) return err('worker required');
    b.worker = worker; b.submission = submission || ''; b.status = 'submitted';
    return ok({ bounty: b });
  }
  /** Attester verifies → status paid + the unsigned release call to pay the worker. */
  function verify(id, { approve = true } = {}) {
    const b = find(id); if (!b) return err('bounty not found');
    if (b.status !== 'submitted' && b.status !== 'verifying') return err(`cannot verify a ${b.status} bounty`);
    if (!approve) { b.status = 'open'; b.worker = null; b.submission = null; return ok({ bounty: b, rejected: true }); }
    b.status = 'paid';
    const releaseCall = b.chain === 'prana'
      ? { chain: b.chain, contract: 'ContributionBountyEscrow', method: 'attestAndRelease', args: [b.id, b.worker], unsigned: true }
      : { chain: b.chain, op: 'custom_json', id: 'ssc-mainnet-melek', json: { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: b.token, to: b.worker, quantity: b.amount, memo: `bounty-reward:${b.id}` } }, unsigned: true };
    return ok({ bounty: b, releaseCall });
  }
  function cancel(id) {
    const b = find(id); if (!b) return err('bounty not found');
    if (b.status === 'paid') return err('already paid');
    b.status = 'cancelled';
    return ok({ bounty: b });
  }
  const list = ({ status, tag } = {}) => store.bounties.filter((b) =>
    (!status || b.status === status) && (!tag || b.tag === tag));
  const get = (id) => find(id);
  const stats = () => {
    const by = {}; for (const s of STATUS) by[s] = 0;
    for (const b of store.bounties) by[b.status] = (by[b.status] || 0) + 1;
    return { total: store.bounties.length, byStatus: by };
  };
  return { post, submit, verify, cancel, list, get, stats };
}
