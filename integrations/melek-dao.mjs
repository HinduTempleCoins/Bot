// melek-dao.mjs — the MELEK DAO: who is in it, and how you get in.
//
// Operator, 2026-11-12: "Keep like 3% in the DAO, and we need to Build the DAO into the Hathor
// Instructions where People can become Part of it by Finishing all the Instructions."
//
// WHAT THE DAO IS. `melek.dao` (STEEM_TREASURY_ACCOUNT) is the chain's proposal fund: a slice of every
// block's emission goes to it, anyone can propose a daily draw against it, stakeholders vote, and
// funded proposals are paid at each maintenance interval. It is the chain's discretionary budget. At
// the MELEK Drive flip its carve drops from 10% to MELEK_DAO_FUND_PERCENT = 3%, which it keeps
// permanently — 27.000 MELEK/hour, 648.000/day at a flat 1.000 MELEK/block.
//
// WHO IS IN IT. Membership is not bought and not granted by us: it is EARNED by finishing the Hathor
// Instructions, and every one of those stages is detected from the chain (integrations/
// tutorial-progress.mjs reads posts, comments, upvotes received, power-ups and witness votes). So the
// roll is a list of people who demonstrably did the work, and nobody can self-report their way onto
// it. The six stages are the citizenship test:
//
//   intro_post · engage_three_posts · share_what_you_know · first_organic_upvote · power_up ·
//   vote_for_a_witness
//
// WHAT MEMBERSHIP GIVES YOU. Two things, and this module is honest that they are the only two:
//   1. a place on the public roll, recorded on-chain by Hathor as a standard `custom_json` (no custom
//      op, per CLAUDE.md) so the roll is auditable by anyone, not just readable on our page;
//   2. a VESTING DELEGATION from Hathor, because the DAO votes by stake — a member holding no MELEK
//      POWER has no voice in it, so the delegation is what makes the membership real rather than a
//      badge. The amount comes from the 5-15 MP band Hathor already delegates to new accounts
//      (BRIEF.md §7 / CLAUDE.md), not from a number invented here.
//
// Proposal creation and proposal voting are plain chain operations that anyone may use; the roll is
// who the DAO recognises as having earned a seat, which is what the operator asked for.
//
// DISCIPLINE: no network and no keys in this module. The chain read and both chain writes are
// INJECTED (`deps.activity`/`deps.fetchActivity`, `deps.broadcastJson`, `deps.delegate`), the roll is
// a small injectable-fs JSON file, and everything soft-fails — a failed broadcast leaves the account
// OFF the roll so the next run retries, and a failed delegation never costs someone their seat.
//
//   import { membershipFor, enroll, roll, daoSummary } from './integrations/melek-dao.mjs';
//
// CLI:  node integrations/melek-dao.mjs [account]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { progress, STAGE_KEYS } from './tutorial-progress.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const num = (k, d) => { const v = Number(env(k, d)); return Number.isFinite(v) ? v : d; };

// ── the DAO's own numbers (mirrors the chain constants) ────────────────────────────────────────────
/** The account the chain pays the proposal fund to (chain: STEEM_TREASURY_ACCOUNT). */
export const DAO_ACCOUNT = () => String(env('MELEK_DAO_ACCOUNT', 'melek.dao')).trim().toLowerCase();
/** The DAO's retained share of emission after the Drive flip (chain: MELEK_DAO_FUND_PERCENT). */
export const DAO_FUND_PCT = () => num('DAO_FUND_PCT', 0.03);
/** MELEK into the DAO per hour at a flat 1.000/block, 21,600 blocks/day. */
export const daoInflowPerHour = () => DAO_FUND_PCT() * num('MELEK_BLOCK_REWARD', 1) * num('MELEK_BLOCKS_PER_DAY', 21600) / 24;
/** MELEK POWER delegated to a new member so their DAO vote carries weight (Hathor's 5-15 MP band). */
export const DAO_MEMBER_MP = () => Math.max(0, num('DAO_MEMBER_MP', 10));
/** The account that signs the roll record and the delegation. */
export const DAO_REGISTRAR = () => String(env('DAO_REGISTRAR', 'hathor')).trim().toLowerCase();
/** The custom_json id the roll record is broadcast under. */
export const DAO_ROLL_OP_ID = () => String(env('DAO_ROLL_OP_ID', 'melek_dao_member')).trim();
/** Every stage of the Hathor Instructions that must be finished to earn a seat. */
export const MEMBERSHIP_STAGES = Object.freeze([...STAGE_KEYS]);

export const DATA_FILE = () => env('DAO_DATA', join(process.cwd(), 'data', 'melek-dao-roll.json'));

const validAccount = (a) => /^[a-z][a-z0-9\-.]{2,15}$/.test(String(a || ''));
const nowSec = () => Math.floor(Date.now() / 1000);

// ── the roll (injectable fs, exactly like the other ledgers here) ─────────────────────────────────
function ctx(opts = {}) {
  const fs = opts.fs || {
    read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
    write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
  };
  return { fs, file: opts.file || DATA_FILE(), now: Number(opts.now) || nowSec() };
}
function load(fs, file) {
  const raw = fs.read(file);
  if (!raw) return { members: {} };
  try { const o = JSON.parse(raw); return { members: o.members || {} }; }
  catch { return { members: {} }; }
}
function save(fs, file, store) { try { fs.write(file, JSON.stringify(store)); } catch { /* soft-fail */ } }

/** The whole roll, newest seat first. Counts and public facts only. */
export function roll(opts = {}) {
  const { fs, file } = ctx(opts);
  const store = load(fs, file);
  const members = Object.values(store.members)
    .map((m) => ({ account: m.account, joinedAt: m.joinedAt, trxId: m.trxId || null, delegatedMp: m.delegatedMp || 0 }))
    .sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
  return { ok: true, dao: DAO_ACCOUNT(), members, count: members.length };
}

/** Is this account on the roll? */
export function isMember(account, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  if (!validAccount(who)) return false;
  const { fs, file } = ctx(opts);
  return !!load(fs, file).members[who];
}

/** Drop an account from the roll (account-deletion path; the on-chain record is not retractable). */
export function forgetMember(account, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  const { fs, file } = ctx(opts);
  const store = load(fs, file);
  if (!store.members[who]) return { ok: true, removed: false };
  delete store.members[who];
  save(fs, file, store);
  return { ok: true, removed: true };
}

// ── eligibility: did they finish the Instructions? ─────────────────────────────────────────────────
/**
 * Where an account stands with the DAO. The stage detection is the chain's, not ours.
 * @param {string} account
 * @param {{activity?:object, fetchActivity?:function}} deps  an activity object (tutorial/chain-reader
 *   shape) or something that returns one; without either, nothing is detected and nothing is claimed.
 * @returns {Promise<{ok:boolean, account:string, member:boolean, eligible:boolean, pctComplete:number,
 *   done:string[], missing:string[], stages:Array, joinedAt:number|null, reason?:string}>}
 */
export async function membershipFor(account, deps = {}, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  const base = {
    ok: true, account: who, member: false, eligible: false, pctComplete: 0,
    done: [], missing: [...MEMBERSHIP_STAGES], stages: [], joinedAt: null,
    stagesRequired: MEMBERSHIP_STAGES.length,
  };
  if (!validAccount(who)) return { ...base, ok: false, reason: 'not a valid MELEK account name' };

  const { fs, file } = ctx(opts);
  const seat = load(fs, file).members[who] || null;

  let activity = deps.activity || null;
  if (!activity && typeof deps.fetchActivity === 'function') {
    try { activity = await deps.fetchActivity(who); } catch { activity = null; }
  }
  if (!activity) {
    return {
      ...base, member: !!seat, joinedAt: seat ? seat.joinedAt : null,
      reason: 'no chain reader wired — progress through the Instructions could not be checked',
    };
  }

  let p;
  try {
    p = await progress(who, {
      getPosts: () => activity.posts || [],
      getComments: () => activity.comments || [],
      getVotes: () => activity.votes_received || [],
      getWitnessVotes: () => activity.witness_votes || [],
      getTransfersToVesting: () => activity.transfers_to_vesting || [],
    });
  } catch (e) {
    return { ...base, member: !!seat, joinedAt: seat ? seat.joinedAt : null, reason: `could not read progress: ${String((e && e.message) || e).slice(0, 120)}` };
  }

  const stages = Array.isArray(p && p.stages) ? p.stages : [];
  const done = stages.filter((s) => s && s.done).map((s) => s.key);
  const missing = MEMBERSHIP_STAGES.filter((k) => !done.includes(k));
  return {
    ...base,
    member: !!seat,
    joinedAt: seat ? seat.joinedAt : null,
    eligible: missing.length === 0,
    pctComplete: Math.round((Number(p && p.pctComplete) || 0) * 100) / 100,
    done, missing, stages,
    nextStage: (p && p.nextStage) || null,
  };
}

// ── enrolment: the seat, the on-chain record, the delegation ───────────────────────────────────────
/**
 * Seat an account that has finished the Instructions. Idempotent and soft-failing: if the on-chain
 * record cannot be broadcast the account is NOT added, so the next run tries again; if the delegation
 * fails the seat still stands and the failure is reported.
 * @param {string} account
 * @param {{activity?:object, fetchActivity?:function, broadcastJson?:function, delegate?:function}} deps
 */
export async function enroll(account, deps = {}, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  const { fs, file, now } = ctx(opts);
  const m = await membershipFor(who, deps, opts);
  if (!m.ok) return { ok: false, reason: m.reason, account: who };
  if (m.member) return { ok: true, already: true, account: who, joinedAt: m.joinedAt, membership: m };
  if (!m.eligible) {
    return {
      ok: false, account: who, membership: m,
      reason: m.reason || `the Instructions are not finished yet — still to do: ${m.missing.join(', ')}`,
    };
  }

  // 1. the on-chain record. A standard custom_json from the registrar; no custom op, nothing custodial.
  const record = {
    account: who, stages: m.done, pct: m.pctComplete, at: now,
    dao: DAO_ACCOUNT(), note: 'earned a DAO seat by finishing the Hathor Instructions',
  };
  const op = ['custom_json', {
    required_auths: [], required_posting_auths: [DAO_REGISTRAR()],
    id: DAO_ROLL_OP_ID(), json: JSON.stringify(record),
  }];
  if (typeof deps.broadcastJson !== 'function') {
    return { ok: false, account: who, membership: m, op, reason: 'no broadcaster wired — the seat is not recorded on-chain, so it is not granted' };
  }
  let trxId = null;
  try {
    const r = await deps.broadcastJson(op, record);
    if (r && r.ok === false) return { ok: false, account: who, membership: m, reason: r.reason || 'the roll record was not accepted on-chain' };
    trxId = (r && (r.id || r.trx_id)) || null;
  } catch (e) {
    return { ok: false, account: who, membership: m, reason: `could not record the seat on-chain: ${String((e && e.message) || e).slice(0, 140)}` };
  }

  // 2. the delegation that gives the seat a voice. Failing this must not cost them the seat.
  let delegation = { requestedMp: DAO_MEMBER_MP(), delegated: false, reason: 'no delegator wired' };
  if (DAO_MEMBER_MP() > 0 && typeof deps.delegate === 'function') {
    try {
      const d = await deps.delegate({ delegator: DAO_REGISTRAR(), delegatee: who, mp: DAO_MEMBER_MP() });
      delegation = { requestedMp: DAO_MEMBER_MP(), delegated: !(d && d.ok === false), result: d || null };
      if (d && d.ok === false) delegation.reason = d.reason || 'the delegation was refused';
    } catch (e) {
      delegation = { requestedMp: DAO_MEMBER_MP(), delegated: false, reason: String((e && e.message) || e).slice(0, 140) };
    }
  }

  const store = load(fs, file);
  store.members[who] = { account: who, joinedAt: now, trxId, delegatedMp: delegation.delegated ? DAO_MEMBER_MP() : 0, stages: m.done };
  save(fs, file, store);
  return { ok: true, account: who, joinedAt: now, trxId, delegation, membership: { ...m, member: true } };
}

/** What the DAO is, in numbers and in plain words — for /dao and the API. */
export function daoSummary() {
  return {
    dao: DAO_ACCOUNT(),
    whatItIs: 'The chain\'s proposal fund: a share of every block goes to ' + DAO_ACCOUNT() + ', anyone can propose a daily draw against it, stakeholders vote, and funded proposals are paid out at each maintenance interval.',
    fundSharePct: DAO_FUND_PCT(),
    inflowPerHour: daoInflowPerHour(),
    inflowPerDay: daoInflowPerHour() * 24,
    fundNote: 'The carve was 10% of emission and drops to ' + Math.round(DAO_FUND_PCT() * 100) + '% at the MELEK Drive flip, which it then keeps. The balance already in ' + DAO_ACCOUNT() + ' is not touched by that change.',
    membership: {
      earnedBy: 'finishing the Hathor Instructions — every stage of them',
      stages: MEMBERSHIP_STAGES,
      stagesRequired: MEMBERSHIP_STAGES.length,
      verification: 'each stage is detected from the chain (posts, comments, upvotes received, power-ups, witness votes), so a seat cannot be self-reported',
      gives: [
        'a place on the public roll, recorded on-chain by @' + DAO_REGISTRAR() + ' as a standard custom_json',
        DAO_MEMBER_MP() + ' MELEK POWER delegated by @' + DAO_REGISTRAR() + ', because the DAO votes by stake and a member with no MP has no voice in it',
      ],
      costs: 'nothing — it is not bought, and it is not granted by us',
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith('melek-dao.mjs')) {
  const who = process.argv[2] || 'someone';
  console.log(JSON.stringify(daoSummary(), null, 2));
  membershipFor(who).then((m) => {
    console.log(`\n@${who}: member=${m.member} eligible=${m.eligible} ${m.pctComplete}% — ${m.reason || 'still to do: ' + m.missing.join(', ')}`);
  });
}
