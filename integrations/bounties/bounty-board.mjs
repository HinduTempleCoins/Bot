// integrations/bounties/bounty-board.mjs — the MELEK BOUNTY BOARD funnel logic (pure + injectable store).
//
// THE FUNNEL (operator's design): a visitor LOGS IN WITH A SOCIAL (Google/GitHub/Discord) via
// MELEK-Signer → does BOUNTIES (onboarding / "prospectoral" tasks, ambassador outreach, curation, and
// advanced witness/token paths) → each completion records earnings that are HELD/pending → to UNLOCK and
// CLAIM the tokens they must CREATE AN ACCOUNT WITH A WALLET on our chains (MELEK @name / 0x). Linking a
// wallet is the whole point of the funnel: social users earn, but converting to a chain account is how
// they claim. Then they graduate to advanced paths (make a token, run a curation trail, become a witness).
//
// This module composes rails that already exist — it does NOT reinvent them:
//   • ambassadors/earnings.mjs      — the append-only earnings LEDGER; bounty rewards record here (HELD).
//   • ambassadors/attribution.mjs   — a referral bounty ties its referred signup into the referral tree.
//   • signup/welcome-grant.mjs      — validAccountName, to sanity-check a linked MELEK account name.
//
// BOUNDARY (same as the ambassador rails): this computes PLANS and records ledger lines. It NEVER signs
// and never broadcasts. A claim returns an UNSIGNED payout intent (standard tokens.transfer custom_json /
// a PRANA escrow-release call) handed to MELEK-Signer by the client. ZERO WIF in this repo. No PII beyond
// the opaque social id + a linked chain account. Deterministic — `now` is injected; pure, soft-fail.
//
//   import { BOUNTIES, makeStore, startBounty, completeBounty, linkWallet, claimable, claim, progress }
//     from './bounty-board.mjs'

import { recordEarning, totalsFor, REFERRAL_BOUNTY_UNITS, REWARD_TOKEN } from '../../ambassadors/earnings.mjs';
import { attributeSignup } from '../../ambassadors/attribution.mjs';
import { validAccountName } from '../../signup/welcome-grant.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const now = (o) => (o && o.now != null ? o.now : Date.now());
// A social id is an opaque, provider-scoped handle (e.g. "google:10894", "github:van"). Lowercase, no PII.
const normSocial = (s) => { const v = String(s || '').trim().toLowerCase(); return v || null; };
const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

// ── the bounty registry ───────────────────────────────────────────────────────────────────────────────
// Categories map the funnel: foundational + prospector = onboarding, ambassador = outreach, curation +
// witness + token = the advanced graduation paths. `verify`: 'auto' (self-serve / observable),
// 'manual' (needs proof), 'referral' (ties a real signup into the attribution tree). `tier` = the funnel
// stage (1 onboarding → 4 advanced). rewardUnits are HELD until a wallet is linked.
export const BOUNTIES = [
  // — foundational onboarding (the "prospectoral" first steps) —
  { id: 'read-intro', title: 'Read the intro post', category: 'foundational', rewardUnits: 5, rewardToken: REWARD_TOKEN(), verify: 'auto', tier: 1 },
  { id: 'verify-email', title: 'Verify your email', category: 'foundational', rewardUnits: 5, rewardToken: REWARD_TOKEN(), verify: 'auto', tier: 1 },
  { id: 'join-discord', title: 'Join the Discord', category: 'foundational', rewardUnits: 10, rewardToken: REWARD_TOKEN(), verify: 'manual', tier: 1 },
  { id: 'first-post', title: 'Make your first post', category: 'foundational', rewardUnits: 20, rewardToken: REWARD_TOKEN(), verify: 'manual', tier: 1 },
  // — prospector (light outreach before you enroll) —
  { id: 'follow-hathor', title: 'Follow @hathor', category: 'prospector', rewardUnits: 5, rewardToken: REWARD_TOKEN(), verify: 'auto', tier: 2 },
  { id: 'share-post', title: 'Share a MELEK post', category: 'prospector', rewardUnits: 15, rewardToken: REWARD_TOKEN(), verify: 'manual', tier: 2 },
  // — ambassador outreach (refer a friend → the attribution tree) —
  { id: 'refer-friend', title: 'Refer a friend who signs up', category: 'ambassador', rewardUnits: REFERRAL_BOUNTY_UNITS(), rewardToken: REWARD_TOKEN(), verify: 'referral', tier: 2 },
  // — advanced graduation paths —
  { id: 'curation-trail', title: 'Run a curation trail', category: 'curation', rewardUnits: 25, rewardToken: REWARD_TOKEN(), verify: 'manual', tier: 3 },
  { id: 'vote-witness', title: 'Vote for a witness', category: 'witness', rewardUnits: 15, rewardToken: REWARD_TOKEN(), verify: 'manual', tier: 3 },
  { id: 'run-witness', title: 'Run your own witness node', category: 'witness', rewardUnits: 100, rewardToken: REWARD_TOKEN(), verify: 'manual', tier: 4 },
  { id: 'create-token', title: 'Create your own token (MELEK-Engine)', category: 'token', rewardUnits: 100, rewardToken: REWARD_TOKEN(), verify: 'manual', tier: 4 },
];

export const CATEGORIES = ['foundational', 'prospector', 'ambassador', 'curation', 'witness', 'token'];
const BY_ID = new Map(BOUNTIES.map((b) => [b.id, b]));
export const getBounty = (id) => BY_ID.get(String(id || '')) || null;
export function bountiesByCategory() {
  const out = {};
  for (const c of CATEGORIES) out[c] = [];
  for (const b of BOUNTIES) (out[b.category] || (out[b.category] = [])).push(b);
  return out;
}

// A bounty's earnings leg on the shared ledger (legs are: referral | curation | outreach).
function legForBounty(b) {
  if (b.verify === 'referral') return 'referral';
  if (b.category === 'curation') return 'curation';
  return 'outreach';
}

// ── injectable store ────────────────────────────────────────────────────────────────────────────────
// One in-memory fs shared by the bounty state AND the composed earnings / attribution ledgers, so the
// whole funnel is deterministic and offline-testable through a single object. In production, pass real
// file paths + the real fs via opts instead.
export function makeStore() {
  const mem = new Map();
  const fs = {
    read: (p) => (mem.has(p) ? mem.get(p) : null),
    write: (p, s) => { mem.set(p, s); },
  };
  return {
    fs,
    bountyFile: 'mem:bounties',
    earningsFile: 'mem:earnings',
    referralsFile: 'mem:referrals',
    registryFile: 'mem:registry',
    _mem: mem,
  };
}

const earnOpts = (store, o = {}) => ({ fs: store.fs, file: store.earningsFile, now: o.now });
const attrOpts = (store, o = {}) => ({
  fs: store.fs, file: store.referralsFile, registryFile: store.registryFile,
  now: o.now, redeem: o.redeem, registry: o.registry, invites: o.invites, qr: o.qr,
});

function loadState(store) {
  const raw = store.fs.read(store.bountyFile);
  if (!raw) return { social: {} };
  try { const o = JSON.parse(raw); return o && o.social ? o : { social: {} }; }
  catch { return { social: {} }; }
}
const saveState = (store, s) => store.fs.write(store.bountyFile, JSON.stringify(s));
function recFor(state, id) {
  return state.social[id] || (state.social[id] = { wallet: null, linkedAt: null, started: {}, completed: {} });
}

// ── operations ──────────────────────────────────────────────────────────────────────────────────────
/** startBounty — record that a social visitor began a bounty (idempotent; soft-fail). */
export function startBounty({ socialId, bountyId, now: nw } = {}, store, opts = {}) {
  const s = normSocial(socialId);
  const b = getBounty(bountyId);
  if (!s) return { ok: false, reason: 'invalid social id' };
  if (!b) return { ok: false, reason: 'unknown bounty' };
  const state = loadState(store);
  const rec = recFor(state, s);
  if (rec.completed[b.id]) return { ok: false, reason: 'already completed' };
  if (rec.started[b.id] == null) rec.started[b.id] = now({ now: nw });
  saveState(store, state);
  return { ok: true, socialId: s, bountyId: b.id, startedAt: rec.started[b.id] };
}

/**
 * completeBounty — mark a bounty done and record a HELD earning on the shared ledger. No double-claim.
 * For a 'referral' bounty with proof.newAccount, ties the referred signup into the attribution tree.
 * Records earnings as kind:'earned' (HELD) — nothing is claimable until a wallet is linked. Never throws.
 *
 * @param {object} params { socialId, bountyId, proof?, now? }
 *   proof (referral): { newAccount, ref?, inviteCode?, invitedBy? }
 * @param {object} store  from makeStore() (or a store carrying real fs + file paths)
 * @param {object} opts   forwarded to attribution (registry/invites/qr sub-stores) for the referral leg
 */
export async function completeBounty({ socialId, bountyId, proof, now: nw } = {}, store, opts = {}) {
  const s = normSocial(socialId);
  const b = getBounty(bountyId);
  if (!s) return { ok: false, reason: 'invalid social id' };
  if (!b) return { ok: false, reason: 'unknown bounty' };

  const state = loadState(store);
  const rec = recFor(state, s);
  if (rec.completed[b.id]) return { ok: false, reason: 'already completed' }; // no double-claim

  // manual + referral bounties need some proof; auto ones self-serve.
  if ((b.verify === 'manual' || b.verify === 'referral') && (proof == null || proof === '')) {
    return { ok: false, reason: 'proof required' };
  }

  const leg = legForBounty(b);
  const earned = recordEarning(
    { ambassador: s, leg, amount: b.rewardUnits, token: b.rewardToken, source: `bounty:${b.id}`, kind: 'earned' },
    earnOpts(store, { now: nw }),
  );
  if (!earned.ok) return { ok: false, reason: earned.reason };

  // Referral bounty → weld the referred account into the attribution tree (best-effort, soft-fail).
  let attribution = null;
  if (b.verify === 'referral' && proof && proof.newAccount) {
    try {
      attribution = await attributeSignup(
        { newAccount: proof.newAccount, ref: proof.ref, inviteCode: proof.inviteCode, invitedBy: proof.invitedBy },
        attrOpts(store, { now: nw, ...opts }),
      );
    } catch { attribution = { ok: false, reason: 'attribution error' }; }
  }

  rec.completed[b.id] = { ts: now({ now: nw }), token: b.rewardToken, units: b.rewardUnits };
  saveState(store, state);
  return {
    ok: true, socialId: s, bountyId: b.id, category: b.category, leg,
    held: { amount: b.rewardUnits, token: b.rewardToken }, entry: earned.entry, attribution,
  };
}

/**
 * linkWallet — bind a chain account (MELEK @name / 0x wallet) to the social identity. THE UNLOCK: once
 * linked, HELD earnings become claimable. Soft-fail on an invalid account name.
 */
export function linkWallet({ socialId, account, now: nw } = {}, store, opts = {}) {
  const s = normSocial(socialId);
  if (!s) return { ok: false, reason: 'invalid social id' };
  const acct = String(account || '').trim();
  const isMelek = validAccountName(acct.toLowerCase());
  const isEvm = EVM_RE.test(acct);
  if (!isMelek && !isEvm) return { ok: false, reason: 'account must be a MELEK @name or a 0x wallet' };
  const chain = isEvm ? 'prana' : 'melek';
  const value = isEvm ? acct : acct.toLowerCase();
  const state = loadState(store);
  const rec = recFor(state, s);
  rec.wallet = value;
  rec.walletChain = chain;
  rec.linkedAt = now({ now: nw });
  saveState(store, state);
  return { ok: true, socialId: s, account: value, chain, linkedAt: rec.linkedAt };
}

// held (unpaid) earnings total for a social id.
function heldFor(store, s) {
  const t = totalsFor(s, earnOpts(store, {}));
  return { token: t.token, held: Math.max(0, num(t.total) - num(t.paid)), total: num(t.total), paid: num(t.paid) };
}

/**
 * claimable — THE GATE. Reports HELD vs CLAIMABLE: earnings are claimable ONLY when a wallet is linked;
 * until then the same balance is `locked`.
 */
export function claimable({ socialId } = {}, store, opts = {}) {
  const s = normSocial(socialId);
  if (!s) return { ok: false, reason: 'invalid social id' };
  const state = loadState(store);
  const rec = state.social[s] || null;
  const wallet = (rec && rec.wallet) || null;
  const linked = !!wallet;
  const { token, held } = heldFor(store, s);
  return {
    ok: true, socialId: s, token, linked, wallet,
    held, claimable: linked ? held : 0, locked: linked ? 0 : held,
  };
}

/**
 * claim — return the UNSIGNED payout intent for the claimable balance. Requires a linked wallet (the
 * gate). Client-signed via MELEK-Signer — this holds NO keys and signs nothing.
 */
export function claim({ socialId } = {}, store, opts = {}) {
  const s = normSocial(socialId);
  if (!s) return { ok: false, reason: 'invalid social id' };
  const state = loadState(store);
  const rec = state.social[s] || null;
  if (!rec || !rec.wallet) {
    const cl = claimable({ socialId: s }, store);
    return { ok: false, reason: 'link a wallet to unlock', locked: cl.locked, held: cl.held, token: cl.token };
  }
  const { token, held } = heldFor(store, s);
  if (held <= 0) return { ok: true, socialId: s, account: rec.wallet, token, amount: '0', calls: [], signed: false, note: 'nothing to claim' };

  // UNSIGNED intent: EVM wallet → PRANA ContributionBountyEscrow release; MELEK @name → tokens.transfer.
  const calls = rec.walletChain === 'prana'
    ? [{ chain: 'prana', contract: 'ContributionBountyEscrow', method: 'release', args: { to: rec.wallet, amount: String(held), token }, unsigned: true }]
    : [{
        chain: 'melek', op: 'custom_json', id: 'ssc-mainnet-melek',
        json: { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: token, to: rec.wallet, quantity: String(held), memo: 'bounty claim' } },
        unsigned: true,
      }];
  return { ok: true, socialId: s, account: rec.wallet, chain: rec.walletChain || 'melek', token, amount: String(held), calls, signed: false, unsigned: true };
}

/** progress — a visitor's full funnel state: completed bounties by category, HELD/claimable, next steps. */
export function progress({ socialId } = {}, store, opts = {}) {
  const s = normSocial(socialId);
  if (!s) return { ok: false, reason: 'invalid social id' };
  const state = loadState(store);
  const rec = state.social[s] || { wallet: null, completed: {}, started: {} };
  const completed = Object.keys(rec.completed || {});
  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c] = { done: 0, total: 0 };
  for (const b of BOUNTIES) {
    byCategory[b.category].total += 1;
    if (rec.completed && rec.completed[b.id]) byCategory[b.category].done += 1;
  }
  const cl = claimable({ socialId: s }, store);
  const next = BOUNTIES.filter((b) => !(rec.completed && rec.completed[b.id])).slice(0, 5).map((b) => b.id);
  return {
    ok: true, socialId: s, wallet: rec.wallet || null, linked: !!rec.wallet,
    completed, completedCount: completed.length, byCategory,
    token: cl.token, held: cl.held, claimable: cl.claimable, locked: cl.locked, next,
  };
}
