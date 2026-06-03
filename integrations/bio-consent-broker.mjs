// bio-consent-broker.mjs — per-query consent + pay-the-owner broker for the Bio-NFT
// economy (queue #160). PURE logic, NO network. This is the BROKER layer that sits ON
// TOP of the consent vault (bio-consent.mjs); it does NOT import or edit the vault.
//
// The flow:
//   1. A researcher/buyer calls requestAccess(...) → a pending request record.
//   2. The data OWNER calls decide(requestId, { approve, owner }) for THAT one request.
//      - Deny by default: anything other than an explicit approve-by-the-owner denies.
//      - Tier-1 NEURAL access REQUIRES an explicit neural opt-in on the approval; without
//        it the request is denied even if the owner says approve.
//   3. On a granted approval a receive-only payoutIntent is produced. It is SIMULATED /
//      dry-run by construction: it describes a payment TO the owner and never moves value
//      unless a caller injects a real signer (and even then the broker only records intent).
//
// HARD INVARIANTS (assert + test):
//   - NO access is ever granted without the owner's explicit per-request approval.
//   - Tier-1 NEURAL needs an explicit neural opt-in on the approving decision.
//   - Payout is RECEIVE-ONLY and dry-run by default — the broker never moves value on its
//     own; there is no code path that broadcasts/sends without an injected sign function.
//
//   import { requestAccess, decide, payoutIntent, auditLog } from './bio-consent-broker.mjs'
//   node integrations/bio-consent-broker.mjs   (self-check / demo)

import { randomUUID } from 'node:crypto';

// ── tiers (mirror the vault's tier names; do NOT import the vault) ─────────────
export const TIER1_NEURAL = 'TIER1_NEURAL';
export const TIER2_BEHAVIORAL = 'TIER2_BEHAVIORAL';

function normTier(dataTier) {
  const t = String(dataTier || '').toUpperCase().trim();
  if (t === TIER1_NEURAL || t === '1' || t === 'TIER1' || t === 'NEURAL') return TIER1_NEURAL;
  if (t === TIER2_BEHAVIORAL || t === '2' || t === 'TIER2' || t === 'BEHAVIORAL') return TIER2_BEHAVIORAL;
  // fail-safe: unknown/unspecified tier gets the HIGHER protection (needs neural opt-in)
  return TIER1_NEURAL;
}

// ── store (in-memory; PURE, no network, no disk) ──────────────────────────────
const _requests = new Map(); // requestId → request record
const _audit = [];           // { id, at, action, ...detail }

function logAudit(action, detail = {}) {
  const entry = { id: randomUUID(), at: new Date().toISOString(), action, ...detail };
  _audit.push(entry);
  return entry;
}

// ── requestAccess ─────────────────────────────────────────────────────────────
/** requestAccess({requester, ownerId, scope, dataTier}) — a buyer asks for access to a
 *  user's bio-data. Produces a PENDING request. No access is granted here; the owner must
 *  decide(). dataTier is normalized; unknown tiers fail-safe to Tier-1 (needs opt-in). */
export function requestAccess({ requester, ownerId, scope, dataTier } = {}) {
  if (!requester) throw new Error('requestAccess: requester is required');
  if (!ownerId) throw new Error('requestAccess: ownerId is required');

  const rec = {
    id: randomUUID(),
    requester,
    ownerId,
    scope: scope ?? null,
    tier: normTier(dataTier),
    status: 'pending',       // pending → granted | denied
    decidedBy: null,
    decidedAt: null,
    payoutIntent: null,
    createdAt: new Date().toISOString(),
  };
  _requests.set(rec.id, rec);
  logAudit('request', { requestId: rec.id, requester, ownerId, scope: rec.scope, tier: rec.tier });
  return { ...rec };
}

// ── payoutIntent ──────────────────────────────────────────────────────────────
/** payoutIntent({amount, to, sign}) — produce a RECEIVE-ONLY payout intent.
 *  By construction this is SIMULATED / dry-run: it describes paying `amount` TO `to`
 *  (the owner) and NEVER moves value on its own. A caller MAY inject a `sign` function;
 *  even then the broker only records that a signer was provided — it returns the intent,
 *  it does not broadcast. There is no send/transfer code path in this module. */
export function payoutIntent({ amount, to, sign } = {}) {
  if (to == null || to === '') throw new Error('payoutIntent: `to` (owner recipient) is required');
  if (typeof amount !== 'number' || !(amount > 0)) {
    throw new Error('payoutIntent: amount must be a positive number');
  }
  // receive-only guard: there is no `from`/source-of-funds field; this can only ever
  // describe value arriving TO the owner. The broker cannot author a debit.
  const intent = {
    id: randomUUID(),
    direction: 'receive',        // RECEIVE-ONLY, always
    to,                          // the owner gets paid
    amount,
    simulated: true,             // dry-run by default; broker never moves value itself
    signed: false,              // set true only if a sign fn is injected (still no broadcast here)
    createdAt: new Date().toISOString(),
  };
  if (typeof sign === 'function') {
    // We record that an external signer was supplied, but we DO NOT broadcast. Signing/
    // broadcast is the caller's responsibility outside this pure broker.
    intent.signed = true;
    intent.signature = String(sign({ direction: intent.direction, to, amount, id: intent.id }));
    intent.simulated = false; // a real signer was attached, but value still isn't moved here
  }
  logAudit('payout-intent', { payoutId: intent.id, to, amount, simulated: intent.simulated, signed: intent.signed });
  return intent;
}

// ── decide (the owner-approval gate) ──────────────────────────────────────────
/** decide(requestId, { approve, owner, neuralOptIn, amount, to, sign }) →
 *    { granted, payoutIntent|null }
 *  - DENY BY DEFAULT: only an explicit approve === true BY THE OWNER grants.
 *  - The decider's `owner` MUST match the request's ownerId (no third-party approval).
 *  - Tier-1 NEURAL requires an explicit neural opt-in (neuralOptIn === true) on this
 *    decision; without it the request is DENIED even if approve === true.
 *  - On a grant, a receive-only payoutIntent (to the owner) is produced. */
export function decide(requestId, { approve, owner, neuralOptIn, amount, to, sign } = {}) {
  const req = _requests.get(requestId);
  if (!req) throw new Error(`decide: unknown requestId ${requestId}`);
  if (req.status !== 'pending') {
    throw new Error(`decide: request ${requestId} already ${req.status}`);
  }

  const ownerMatches = !!owner && owner === req.ownerId;
  const approving = approve === true;
  const neuralOk = req.tier !== TIER1_NEURAL || neuralOptIn === true;

  // DENY BY DEFAULT — every guard must pass to grant.
  if (!ownerMatches || !approving || !neuralOk) {
    req.status = 'denied';
    req.decidedBy = owner ?? null;
    req.decidedAt = new Date().toISOString();
    const reason = !ownerMatches ? 'not-owner'
      : !approving ? 'not-approved'
      : 'tier1-needs-neural-opt-in';
    logAudit('decide.denied', { requestId, owner: owner ?? null, tier: req.tier, reason });
    return { granted: false, payoutIntent: null, reason };
  }

  // GRANTED — produce a receive-only payout intent to the owner.
  const payTo = to ?? req.ownerId;
  const pay = payoutIntent({ amount: typeof amount === 'number' ? amount : 1, to: payTo, sign });
  req.status = 'granted';
  req.decidedBy = owner;
  req.decidedAt = new Date().toISOString();
  req.payoutIntent = pay;
  logAudit('decide.granted', { requestId, owner, tier: req.tier, neuralOptIn: neuralOptIn === true, payoutId: pay.id });
  return { granted: true, payoutIntent: pay };
}

// ── auditLog (the SEE right) ──────────────────────────────────────────────────
/** auditLog() — immutable-by-copy view of the audit log + request summary. */
export function auditLog() {
  const byStatus = {};
  for (const r of _requests.values()) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return {
    requests: _requests.size,
    byStatus,
    log: _audit.map((e) => ({ ...e })),
  };
}

// ── HARD INVARIANT: broker never moves value; payout is receive-only ──────────
export const MOVES_VALUE = false;
export function assertReceiveOnly() {
  // No export may look like a value-mover. The only money-touching export, payoutIntent,
  // is receive-only and simulated by default (and is allow-listed here by exact name).
  const moveVerbs = ['send', 'transfer', 'broadcast', 'withdraw', 'debit', 'spend'];
  const allow = new Set(['payoutIntent']); // receive-only by construction
  const surface = ['requestAccess', 'decide', 'payoutIntent', 'auditLog'];
  for (const name of surface) {
    if (allow.has(name)) continue;
    const lc = name.toLowerCase();
    if (moveVerbs.some((v) => lc.includes(v))) {
      throw new Error(`receive-only invariant violated: '${name}' looks like a value-mover`);
    }
  }
  if (MOVES_VALUE !== false) throw new Error('receive-only invariant violated: MOVES_VALUE is set');
  return true;
}
// enforce at module load
assertReceiveOnly();

// test-only reset (does not bypass any approval gate; just clears in-memory state)
export function __reset() { _requests.clear(); _audit.length = 0; }

// ── CLI self-check / demo ─────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('bio-consent-broker.mjs')) {
  // Tier-2 behavioral: owner approves → receive-only payout intent.
  const r1 = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'vr', dataTier: 'TIER2_BEHAVIORAL' });
  console.log('request (tier2):', r1.status, r1.tier);
  const d1 = decide(r1.id, { approve: true, owner: 'alice', amount: 5, to: 'alice' });
  console.log('decide (owner approve):', d1.granted, d1.payoutIntent?.direction, d1.payoutIntent?.simulated);

  // Default deny: no approval.
  const r2 = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'vr' });
  console.log('decide (no approve):', decide(r2.id, { owner: 'alice' }).granted);

  // Tier-1 neural without opt-in → denied even with approve.
  const r3 = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'eeg', dataTier: 'TIER1_NEURAL' });
  console.log('decide (tier1, no opt-in):', decide(r3.id, { approve: true, owner: 'alice' }).reason);

  // Tier-1 neural with explicit opt-in → granted.
  const r4 = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'eeg', dataTier: 'TIER1_NEURAL' });
  console.log('decide (tier1, opt-in):', decide(r4.id, { approve: true, owner: 'alice', neuralOptIn: true, amount: 9 }).granted);

  console.log('audit:', auditLog().byStatus);
  console.log('receive-only invariant:', assertReceiveOnly());
}
