// integrations/benefit-society.mjs — a MUTUAL-AID / BENEFIT SOCIETY as coordination + records only.
//
// ⭐ WHAT THIS IS. A benefit society is the oldest form of mutual aid: members join under a charter,
// pay in regularly, and when one of them is sick, bereaved or in need the group helps them. Historically
// these are fraternal benefit societies (US 501(c)(8)), domestic fraternal societies (501(c)(10)),
// friendly societies (UK), burial societies, and ROSCAs (tandas / susus / chit funds). A benefit
// society is a SPECIALIZATION OF A PACT (site/pact/server.mjs, pentecaust/groups/model.mjs): a pact has
// a charter, members, dues and degrees of standing — a benefit society adds a mutual-aid LEDGER and a
// claims WORKFLOW on top of exactly those primitives. It does not fork them.
//
// ⛔ THE ONE LINE THAT DEFINES THE WHOLE MODULE: WE NEVER TOUCH THE MONEY. This is the same posture as
// integrations/soapbox/donate-directory.mjs, and here it is not a preference — it is the boundary
// between a buildable product and an unlicensed insurer. Two regulatory facts make it non-negotiable:
//
//   1. A society that ACTUALLY POOLS members' contributions and PAYS OUT sickness / death / burial /
//      annuity benefits is, in essentially every US state, a FRATERNAL BENEFIT SOCIETY regulated as an
//      INSURER under the state insurance code (the NAIC Model Fraternal Benefit Society Act). It must be
//      chartered and licensed, hold reserves, and file with the state insurance department. That is a
//      licensing project, not a software module, and this module WILL NOT custody funds or promise a
//      benefit as if it were the insurer. (IRC 501(c)(8) = pays benefits = insurer; IRC 501(c)(10) =
//      "domestic fraternal" = does NOT pay life/sick/accident benefits, devotes earnings to charitable
//      purposes — that is the lane a records-only tool keeps a group inside of.)
//   2. ACCEPTING members' money and passing it to another member is MONEY TRANSMISSION under FinCEN's
//      rules (31 CFR 1010.100(ff)) and state money-transmitter law. Custody is what makes you a
//      transmitter — not margin. So we hold nothing.
//
// What this module holds instead: a MEMBER REGISTRY, an append-only CONTRIBUTION LEDGER (records that a
// member paid — the payment itself happened member→society directly, or via a donate-directory direct
// link), a CLAIM WORKFLOW (request → governance review with quorum → recorded decision), POOL ACCOUNTING
// as records, and a payout that is only ever an UNSIGNED INTENT / GRANT INTENT handed off to whoever
// actually moves value (the society's own treasurer, MELEK-Signer, Hathor's discretionary grant path) —
// never a transfer performed here. See BENEFIT_MODELS below for the buildable-now vs needs-a-license split.
//
// House rules: pure, injectable store + clock, soft-fail-never-throw (bad input → {ok:false,reason}),
// esc() on any interpolation, CLI-guarded, offline `node --test`. No network, no keys, no WIF.
//
//   import { makeStore, foundSociety, addMember, setRole, setStanding, recordContribution,
//            openClaim, reviewClaim, decideClaim, poolBalance, memberHistory, payoutIntent,
//            getSociety, ROLES, STANDINGS, BENEFIT_MODELS, LICENSING_NOTE } from './benefit-society.mjs'

import crypto from 'node:crypto';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── injectable clock (deterministic tests) ──────────────────────────────────────────────────────────
let _now = () => Date.now();
export function __setClock(fn) { _now = typeof fn === 'function' ? fn : () => Date.now(); }

const str = (s) => String(s == null ? '' : s).trim();
const low = (s) => str(s).toLowerCase();
// Money is always integer MINOR UNITS (cents / smallest token unit); a float never enters the ledger.
const minor = (n) => { const v = Math.floor(Number(n)); return Number.isFinite(v) && v > 0 ? v : 0; };
const clamp = (s, n) => str(s).slice(0, n);
// A member id is an opaque identity handle — a Pentecaust ticket subject / MELEK @name / '~handle'.
// Lowercased; no PII by construction (signup is out of scope for personal-info intake per BRIEF §6).
const memId = (s) => { const v = low(s).replace(/^@/, ''); return /^~?[a-z0-9][a-z0-9.\-]{1,63}$/.test(v) ? v : null; };

// ── governance roles (mirror the Pact / Groups hierarchy — higher rank manages lower) ───────────────
// steward is the benefit-society name for a Groups 'mod': the officer who reviews claims. Owner/admin
// carry the same meaning as everywhere else so a Pact and a Society share one mental model.
export const ROLES = Object.freeze({ owner: 4, admin: 3, steward: 2, member: 1, suspended: 0 });
const SETTABLE_ROLES = ['admin', 'steward', 'member'];
const rankOf = (role) => ROLES[role] || 0;

// ── member standing (the Pact's "degrees of breaking it") ───────────────────────────────────────────
// Standing is health of the membership, separate from governance role. In a real friendly society a
// member "out of benefit" (in arrears) cannot claim until dues are current — that rule lives here.
export const STANDINGS = Object.freeze({
  good: 'dues current — eligible to open a claim',
  arrears: 'behind on dues — not eligible to claim until current (a benefit-society rule, not a penalty)',
  suspended: 'membership suspended by the society governance',
  probation: 'newly joined or under a waiting period before benefits are available',
});
const STANDING_KEYS = Object.keys(STANDINGS);

// ── the buildable-now vs needs-a-license map (surfaced, not hidden) ──────────────────────────────────
export const BENEFIT_MODELS = Object.freeze({
  'records-only': {
    id: 'records-only',
    what: 'Coordinate members, record who paid, run a claims review, and record a decision. Money moves '
        + 'member↔member / member↔society directly, or via a donate-directory direct link. We custody nothing.',
    custodies: false,
    licensing: 'none for the coordination layer — same posture as donate-directory. The society is on the '
             + '501(c)(10) "domestic fraternal" side: it does not itself pay insurance-type benefits.',
    buildable: true,
  },
  'insurer': {
    id: 'insurer',
    what: 'The society itself POOLS dues and PAYS sickness / death / burial / annuity benefits it promised.',
    custodies: true,
    licensing: 'REGULATED AS AN INSURER. In essentially every US state a society that pays such benefits is a '
             + 'fraternal benefit society (IRC 501(c)(8)) under the state insurance code / NAIC Model Fraternal '
             + 'Benefit Society Act — chartered, licensed, reserve and filing requirements. NOT this module.',
    buildable: false,
  },
  'transmitter': {
    id: 'transmitter',
    what: 'The society accepts members\' money and forwards it to another member (a ROSCA payout run through us).',
    custodies: true,
    licensing: 'MONEY TRANSMISSION (FinCEN 31 CFR 1010.100(ff) + state MTL). Custody is the trigger, not margin. '
             + 'NOT this module — payouts here are unsigned intents someone else settles.',
    buildable: false,
  },
});

export const LICENSING_NOTE =
  'This is a coordination and records layer, not an insurer and not a money transmitter. It never holds, '
  + 'pools, or forwards members\' money. A society that actually pays sickness/death/burial/annuity benefits '
  + 'from pooled dues is regulated as an insurer under state law (NAIC Model Fraternal Benefit Society Act); '
  + 'a society that accepts and forwards members\' money is a money transmitter (FinCEN 31 CFR 1010.100). '
  + 'Neither happens here — payouts are recorded as intents for the society\'s own treasurer to settle.';

// ── injectable store (one in-memory JSON blob; pass real fs paths in production) ─────────────────────
export function makeStore() {
  const mem = new Map();
  const fs = { read: (p) => (mem.has(p) ? mem.get(p) : null), write: (p, s) => { mem.set(p, s); } };
  return { fs, file: 'mem:societies', _mem: mem };
}
function load(store) {
  const raw = store.fs.read(store.file);
  if (!raw) return { societies: {} };
  try { const o = JSON.parse(raw); return o && o.societies ? o : { societies: {} }; }
  catch { return { societies: {} }; }
}
const save = (store, s) => store.fs.write(store.file, JSON.stringify(s));

// Non-custodial dues terms — `rail` says where money settles and this repo is never one of the options
// (identical discipline to pentecaust/groups/model.mjs normDues).
export const DUES_RAILS = ['member-to-treasurer', 'donate-directory-link', 'wallet', 'burn'];
function normDues(d) {
  if (!d || typeof d !== 'object') return null;
  const amount = minor(d.amount);
  if (!amount) return null;
  return {
    amount,
    currency: clamp(d.currency, 12).toUpperCase() || 'USD',
    period: ['once', 'monthly', 'yearly'].includes(d.period) ? d.period : 'monthly',
    rail: DUES_RAILS.includes(d.rail) ? d.rail : 'member-to-treasurer',
    payee: clamp(d.payee, 64), // who money actually goes to; NEVER this platform
  };
}

function view(soc) {
  if (!soc) return null;
  return {
    id: soc.id, name: soc.name, charter: soc.charter || null, dues: soc.dues || null,
    model: soc.model, created: soc.created,
    members: Object.entries(soc.members).map(([id, m]) => ({ id, role: m.role, standing: m.standing, joined: m.joined }))
      .sort((a, b) => rankOf(b.role) - rankOf(a.role) || a.joined - b.joined),
    memberCount: Object.keys(soc.members).length,
    ledgerEntries: (soc.ledger || []).length,
    openClaims: Object.values(soc.claims || {}).filter((c) => c.status === 'open').length,
    balance: poolBalanceOf(soc),
  };
}

// ── found a society ─────────────────────────────────────────────────────────────────────────────────
/**
 * Found a benefit society. The founder becomes owner. `model` is pinned to 'records-only' unless the
 * caller explicitly acknowledges a licensed model — and even then this module custodies nothing; the
 * flag only records the operator's stated posture so a surface can warn correctly. Never throws.
 */
export function foundSociety({ founder, name, charter, dues, model } = {}, store) {
  const owner = memId(founder);
  if (!owner) return { ok: false, reason: 'founder must be a valid identity handle' };
  const nm = clamp(name, 80);
  if (nm.length < 2) return { ok: false, reason: 'society name too short' };
  const m = BENEFIT_MODELS[low(model)] ? low(model) : 'records-only';
  const st = load(store);
  const base = (nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'society';
  let id = base; for (let i = 2; st.societies[id]; i++) id = `${base}-${i}`;
  const t = _now();
  const soc = {
    id, name: nm, model: m,
    charter: charter && typeof charter === 'object'
      ? { purpose: clamp(charter.purpose, 400), cadence: clamp(charter.cadence, 60),
          waitingDays: minor(charter.waitingDays) || 0, quorum: Math.max(1, minor(charter.quorum) || 1) }
      : { purpose: '', cadence: '', waitingDays: 0, quorum: 1 },
    dues: normDues(dues),
    members: { [owner]: { role: 'owner', standing: 'good', joined: t } },
    ledger: [], claims: {}, created: t,
  };
  st.societies[id] = soc; save(store, st);
  return { ok: true, society: view(soc) };
}

// ── membership ──────────────────────────────────────────────────────────────────────────────────────
/** Enroll a member. New members start in 'probation' if the charter sets a waiting period. */
export function addMember({ societyId, member } = {}, store) {
  const who = memId(member);
  if (!who) return { ok: false, reason: 'member must be a valid identity handle' };
  const st = load(store); const soc = st.societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  if (soc.members[who]) return { ok: true, status: 'already-member', society: view(soc) };
  const standing = (soc.charter && soc.charter.waitingDays > 0) ? 'probation' : 'good';
  soc.members[who] = { role: 'member', standing, joined: _now() };
  save(store, st);
  return { ok: true, status: 'joined', standing, society: view(soc) };
}

const canManage = (soc, actor, target) => {
  const a = rankOf(soc.members[actor] && soc.members[actor].role);
  return a >= ROLES.steward && a > rankOf(soc.members[target] && soc.members[target].role);
};

/** Set a member's governance role. Admin+ only, strictly below the actor's rank; 'owner' transfers. */
export function setRole({ societyId, actor, member, role } = {}, store) {
  const st = load(store); const soc = st.societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  const by = memId(actor); const who = memId(member);
  if (!by || !who || !soc.members[by] || !soc.members[who]) return { ok: false, reason: 'actor and member must both be members' };
  if (by === who) return { ok: false, reason: 'cannot change your own role' };
  if (role === 'owner') {
    if (soc.members[by].role !== 'owner') return { ok: false, reason: 'only the owner can transfer ownership' };
    soc.members[by].role = 'admin'; soc.members[who].role = 'owner';
    save(store, st); return { ok: true, society: view(soc) };
  }
  if (!SETTABLE_ROLES.includes(role)) return { ok: false, reason: 'unknown role' };
  const byRank = rankOf(soc.members[by].role);
  if (byRank < ROLES.admin) return { ok: false, reason: 'admin or owner only' };
  if (byRank <= rankOf(soc.members[who].role)) return { ok: false, reason: 'cannot manage an equal or higher member' };
  if (rankOf(role) >= byRank) return { ok: false, reason: 'cannot grant a role at or above your own' };
  soc.members[who].role = role; save(store, st);
  return { ok: true, society: view(soc) };
}

/** Set a member's standing (good/arrears/suspended/probation). Steward+ only. */
export function setStanding({ societyId, actor, member, standing } = {}, store) {
  if (!STANDING_KEYS.includes(standing)) return { ok: false, reason: 'unknown standing' };
  const st = load(store); const soc = st.societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  const by = memId(actor); const who = memId(member);
  if (!by || !who || !soc.members[by] || !soc.members[who]) return { ok: false, reason: 'actor and member must both be members' };
  if (rankOf(soc.members[by].role) < ROLES.steward) return { ok: false, reason: 'steward or higher only' };
  soc.members[who].standing = standing; save(store, st);
  return { ok: true, standing, society: view(soc) };
}

// ── the ledger (accounting only — never a transfer) ─────────────────────────────────────────────────
function appendEntry(soc, entry) {
  soc.ledger = soc.ledger || [];
  const e = { id: crypto.randomUUID(), ts: _now(), ...entry };
  soc.ledger.push(e);
  return e;
}

/**
 * Record a contribution a member made. THIS RECORDS A PAYMENT THAT ALREADY HAPPENED on an external rail
 * — it does not accept or route money. `kind`: 'dues' | 'donation' | 'assessment'. Amount in minor units.
 */
export function recordContribution({ societyId, actor, member, amount, currency, kind, note } = {}, store) {
  const st = load(store); const soc = st.societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  const by = memId(actor); const who = memId(member);
  if (!by || !soc.members[by] || rankOf(soc.members[by].role) < ROLES.steward) {
    return { ok: false, reason: 'a steward or higher records contributions (they reconcile the external rail)' };
  }
  if (!who || !soc.members[who]) return { ok: false, reason: 'contributor must be a member' };
  const amt = minor(amount);
  if (!amt) return { ok: false, reason: 'amount must be a positive integer (minor units)' };
  const cur = clamp(currency, 12).toUpperCase() || (soc.dues && soc.dues.currency) || 'USD';
  const k = ['dues', 'donation', 'assessment'].includes(low(kind)) ? low(kind) : 'dues';
  const entry = appendEntry(soc, { type: 'contribution', direction: 'in', member: who, amount: amt, currency: cur, kind: k, note: clamp(note, 200), by });
  // Paying dues clears arrears — a records-only consequence, not a money movement.
  if (soc.members[who].standing === 'arrears' && k === 'dues') soc.members[who].standing = 'good';
  save(store, st);
  return { ok: true, entry, balance: poolBalanceOf(soc), society: view(soc) };
}

// ── claims workflow (request → review with quorum → recorded decision) ───────────────────────────────
/**
 * A member in good standing opens a benefit claim (sickness / bereavement / hardship / burial). Records
 * a REQUEST — it promises nothing and moves nothing. Members in arrears/suspended/probation cannot open.
 */
export function openClaim({ societyId, member, kind, amount, currency, reason } = {}, store) {
  const st = load(store); const soc = st.societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  const who = memId(member);
  if (!who || !soc.members[who]) return { ok: false, reason: 'claimant must be a member' };
  const standing = soc.members[who].standing;
  if (standing !== 'good') return { ok: false, reason: `not eligible to claim while standing is '${standing}' (${STANDINGS[standing] || ''})` };
  const amt = minor(amount);
  if (!amt) return { ok: false, reason: 'requested amount must be a positive integer (minor units)' };
  const id = crypto.randomUUID();
  const claim = {
    id, member: who,
    kind: clamp(kind, 40) || 'hardship',
    amountRequested: amt,
    currency: clamp(currency, 12).toUpperCase() || (soc.dues && soc.dues.currency) || 'USD',
    reason: clamp(reason, 500),
    status: 'open', reviews: {}, openedAt: _now(), decidedAt: null, decision: null, amountApproved: 0, payoutEntry: null,
  };
  soc.claims = soc.claims || {}; soc.claims[id] = claim; save(store, st);
  return { ok: true, claim: { ...claim }, society: view(soc) };
}

/** A steward+ casts one review vote on an open claim: 'approve' | 'deny'. One vote per reviewer (latest wins). */
export function reviewClaim({ societyId, actor, claimId, vote, note } = {}, store) {
  const st = load(store); const soc = st.societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  const by = memId(actor);
  if (!by || !soc.members[by] || rankOf(soc.members[by].role) < ROLES.steward) return { ok: false, reason: 'steward or higher reviews claims' };
  const claim = soc.claims && soc.claims[claimId];
  if (!claim) return { ok: false, reason: 'no such claim' };
  if (claim.status !== 'open') return { ok: false, reason: `claim is ${claim.status}, not open` };
  if (by === claim.member) return { ok: false, reason: 'a claimant cannot review their own claim' };
  const v = low(vote) === 'approve' ? 'approve' : low(vote) === 'deny' ? 'deny' : null;
  if (!v) return { ok: false, reason: "vote must be 'approve' or 'deny'" };
  claim.reviews[by] = { vote: v, note: clamp(note, 200), ts: _now() };
  save(store, st);
  const tally = tallyReviews(claim);
  return { ok: true, claim: { ...claim }, tally };
}

function tallyReviews(claim) {
  const votes = Object.values(claim.reviews || {});
  const approve = votes.filter((r) => r.vote === 'approve').length;
  const deny = votes.filter((r) => r.vote === 'deny').length;
  return { approve, deny, total: votes.length };
}

/**
 * Close an open claim. Requires quorum (charter.quorum reviews) AND a majority approving. On approval
 * the payout is recorded as a ledger 'benefit' entry (direction 'out') AND returned as an UNSIGNED
 * PAYOUT INTENT — this module settles nothing. `amountApproved` may be less than requested. Admin+ only.
 */
export function decideClaim({ societyId, actor, claimId, amountApproved } = {}, store) {
  const st = load(store); const soc = st.societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  const by = memId(actor);
  if (!by || !soc.members[by] || rankOf(soc.members[by].role) < ROLES.admin) return { ok: false, reason: 'admin or owner closes a claim' };
  const claim = soc.claims && soc.claims[claimId];
  if (!claim) return { ok: false, reason: 'no such claim' };
  if (claim.status !== 'open') return { ok: false, reason: `claim is already ${claim.status}` };
  const quorum = (soc.charter && soc.charter.quorum) || 1;
  const tally = tallyReviews(claim);
  if (tally.total < quorum) return { ok: false, reason: `quorum not met (${tally.total}/${quorum} reviews)`, tally };
  const approved = tally.approve > tally.deny;
  claim.decidedAt = _now();
  if (!approved) {
    claim.status = 'denied'; claim.decision = 'denied'; save(store, st);
    return { ok: true, decision: 'denied', tally, claim: { ...claim } };
  }
  const amt = amountApproved == null ? claim.amountRequested : minor(amountApproved);
  if (!amt) return { ok: false, reason: 'approved amount must be a positive integer (minor units)' };
  claim.status = 'approved'; claim.decision = 'approved'; claim.amountApproved = amt;
  const entry = appendEntry(soc, {
    type: 'benefit', direction: 'out', member: claim.member, amount: amt, currency: claim.currency,
    kind: claim.kind, claimId: claim.id, by, settled: false,
    note: 'RECORDED INTENT — not a transfer; the treasurer settles on an external rail',
  });
  claim.payoutEntry = entry.id; save(store, st);
  return { ok: true, decision: 'approved', tally, claim: { ...claim }, entry, intent: payoutIntentFor(soc, claim, entry) };
}

/**
 * The UNSIGNED payout intent for an approved claim — the object a treasurer / MELEK-Signer / Hathor's
 * grant path consumes to actually move value. This module signs nothing and broadcasts nothing (same
 * boundary as bounty-board.claim and grant-runner). It describes the payout; it does not perform it.
 */
function payoutIntentFor(soc, claim, entry) {
  return {
    kind: 'benefit-payout-intent',
    societyId: soc.id, claimId: claim.id, ledgerEntry: entry.id,
    to: claim.member, amount: String(claim.amountApproved), currency: claim.currency,
    rail: (soc.dues && soc.dues.rail) || 'member-to-treasurer',
    signed: false, unsigned: true, custodiedByUs: false,
    note: LICENSING_NOTE,
  };
}
/** Public accessor: rebuild the payout intent for an already-approved claim. */
export function payoutIntent({ societyId, claimId } = {}, store) {
  const soc = load(store).societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  const claim = soc.claims && soc.claims[claimId];
  if (!claim) return { ok: false, reason: 'no such claim' };
  if (claim.status !== 'approved') return { ok: false, reason: `claim is ${claim.status}, no payout intent` };
  const entry = (soc.ledger || []).find((e) => e.id === claim.payoutEntry) || null;
  return { ok: true, intent: payoutIntentFor(soc, claim, entry || { id: null }) };
}

// ── pool accounting (records, not a balance we hold) ─────────────────────────────────────────────────
function poolBalanceOf(soc) {
  const led = soc.ledger || [];
  let inSum = 0, outSum = 0;
  for (const e of led) {
    if (e.direction === 'in') inSum += minor(e.amount);
    else if (e.direction === 'out') outSum += minor(e.amount);
  }
  const currency = (soc.dues && soc.dues.currency)
    || (led.find((e) => e.currency) || {}).currency || 'USD';
  // `net` is what the RECORDS say the pool should hold on its external rail — an accounting figure, not
  // a balance in any account of ours.
  return { currency, contributions: inSum, benefits: outSum, net: inSum - outSum, custodiedByUs: false };
}
/** Public pool accounting for a society. */
export function poolBalance({ societyId } = {}, store) {
  const soc = load(store).societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  return { ok: true, ...poolBalanceOf(soc) };
}

/** One member's full history: standing, contributions in, benefits out, open/closed claims. */
export function memberHistory({ societyId, member } = {}, store) {
  const soc = load(store).societies[societyId];
  if (!soc) return { ok: false, reason: 'no such society' };
  const who = memId(member);
  if (!who || !soc.members[who]) return { ok: false, reason: 'not a member' };
  const led = (soc.ledger || []).filter((e) => e.member === who);
  const claims = Object.values(soc.claims || {}).filter((c) => c.member === who);
  const contributed = led.filter((e) => e.direction === 'in').reduce((a, e) => a + minor(e.amount), 0);
  const received = led.filter((e) => e.direction === 'out').reduce((a, e) => a + minor(e.amount), 0);
  return {
    ok: true, member: who, role: soc.members[who].role, standing: soc.members[who].standing,
    joined: soc.members[who].joined, contributed, received,
    entries: led.map((e) => ({ id: e.id, ts: e.ts, type: e.type, direction: e.direction, amount: e.amount, currency: e.currency, kind: e.kind })),
    claims: claims.map((c) => ({ id: c.id, kind: c.kind, status: c.status, amountRequested: c.amountRequested, amountApproved: c.amountApproved })),
  };
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────
export function getSociety({ societyId } = {}, store) {
  const soc = load(store).societies[societyId];
  return soc ? { ok: true, society: view(soc) } : { ok: false, reason: 'no such society' };
}
export function listSocieties(store) {
  return Object.values(load(store).societies).map(view).sort((a, b) => b.memberCount - a.memberCount);
}
export function listClaims({ societyId, status } = {}, store) {
  const soc = load(store).societies[societyId];
  if (!soc) return [];
  const want = low(status);
  return Object.values(soc.claims || {})
    .filter((c) => !want || c.status === want)
    .map((c) => ({ id: c.id, member: c.member, kind: c.kind, status: c.status, amountRequested: c.amountRequested, amountApproved: c.amountApproved, tally: tallyReviews(c) }));
}

// ── info handler (JSON; documents the boundary, like donate-directory) ───────────────────────────────
export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'benefit-society',
    roles: Object.keys(ROLES), standings: STANDINGS,
    models: Object.values(BENEFIT_MODELS).map((m) => ({ id: m.id, custodies: m.custodies, buildable: m.buildable, licensing: m.licensing })),
    weTakeNoMoney: 'Contributions and payouts are RECORDS. Money moves member↔treasurer directly or via a '
                 + 'donate-directory link; payouts are unsigned intents. Nothing routes through us.',
    licensingNote: LICENSING_NOTE,
  }, null, 2));
}

export default {
  ROLES, STANDINGS, BENEFIT_MODELS, LICENSING_NOTE, DUES_RAILS,
  makeStore, foundSociety, addMember, setRole, setStanding,
  recordContribution, openClaim, reviewClaim, decideClaim, payoutIntent,
  poolBalance, memberHistory, getSociety, listSocieties, listClaims, handler, esc,
};

// ── CLI (guarded) — offline demo of the coordination flow (no money, no keys) ────────────────────────
if (process.argv[1] && process.argv[1].endsWith('benefit-society.mjs')) {
  const store = makeStore();
  const f = foundSociety({ founder: 'hathor', name: 'Van Kush Aid Society',
    charter: { purpose: 'Mutual aid for members in hardship', cadence: 'monthly', quorum: 2 },
    dues: { amount: 1000, currency: 'USD', period: 'monthly', rail: 'member-to-treasurer' } }, store);
  const sid = f.society.id;
  addMember({ societyId: sid, member: 'alice' }, store);
  addMember({ societyId: sid, member: 'bob' }, store);
  addMember({ societyId: sid, member: 'carol' }, store);
  setRole({ societyId: sid, actor: 'hathor', member: 'alice', role: 'admin' }, store);
  setRole({ societyId: sid, actor: 'hathor', member: 'bob', role: 'steward' }, store);
  recordContribution({ societyId: sid, actor: 'hathor', member: 'alice', amount: 1000, kind: 'dues' }, store);
  recordContribution({ societyId: sid, actor: 'hathor', member: 'carol', amount: 1000, kind: 'dues' }, store);
  const c = openClaim({ societyId: sid, member: 'carol', kind: 'sickness', amount: 500, reason: 'lost a week of work' }, store);
  reviewClaim({ societyId: sid, actor: 'hathor', claimId: c.claim.id, vote: 'approve' }, store);
  reviewClaim({ societyId: sid, actor: 'bob', claimId: c.claim.id, vote: 'approve' }, store);
  const d = decideClaim({ societyId: sid, actor: 'alice', claimId: c.claim.id }, store);
  console.log('society :', sid, '| members', f.society.memberCount + 3);
  console.log('pool    :', JSON.stringify(poolBalance({ societyId: sid }, store)));
  console.log('claim   :', d.decision, '-> intent:', JSON.stringify(d.intent));
  console.log('note    :', LICENSING_NOTE);
}
