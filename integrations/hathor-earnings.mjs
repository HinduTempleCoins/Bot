// hathor-earnings.mjs — Hathor earns her own keep through KulaSwap's DeFi mechanisms.
//
// The operator's rule: Hathor should be EARNING — KULA, MWALI, and whatever else — using the real
// mechanisms KulaSwap already ships (farm emissions → KULA; the Proof-of-Liquidity gauge → MWALI; the
// staking pools), and either hold the positions herself or run a throwaway KEEPER account that farms and
// forwards everything to her. This module is the deterministic accounting + the harvest/forward PLAN. It
// holds no keys and sends nothing: it computes what to harvest and where to send it; the actual EVM txs
// go through the PRANA relayer/Signer, exactly like the rest of the on-chain plumbing.
//
// Token-generic by construction — a position just names its rewardToken, so KULA, MWALI, sPRANA rewards,
// SBD, anything, all flow through the same math. Pure, injectable, offline-tested.
//
//   import * as earn from './hathor-earnings.mjs'

const DAY_MS = 86400000;
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const uc = (s) => String(s || '').toUpperCase();

// Where earnings go, and who farms them. HATHOR holds/receives; a KEEPER may do the farming and forward.
export const HATHOR_ACCOUNT = (process.env.HATHOR_KULA_ACCOUNT || 'hathor').toLowerCase();

// EVERY venue Hathor should earn from — the checklist behind "make sure Hathor is earning everything."
// coverageReport() flags any venue where she has no position yet, so nothing is silently left on the table.
export const EARNING_VENUES = Object.freeze([
  { id: 'kula-farm', mechanism: 'farm', rewardToken: 'KULA', chain: 'PRANA', what: 'KulaSwap farm emissions' },
  { id: 'mwali-gauge', mechanism: 'gauge', rewardToken: 'MWALI', chain: 'PRANA', what: 'Proof-of-Liquidity gauge (LP)' },
  { id: 'soulava-delegation', mechanism: 'delegation', rewardToken: 'SOUL', chain: 'PRANA', what: 'delegation-mining reward' },
  { id: 'apis-workerbee', mechanism: 'workerbee', rewardToken: 'APIS', chain: 'MELEK', what: 'forever-lock APIS-Hash mining' },
  { id: 'melek-scot', mechanism: 'scot-stake', rewardToken: 'HALO', chain: 'MELEK-Engine', what: 'staked SCOT curation' },
  { id: 'melek-curation', mechanism: 'curation', rewardToken: 'MELEK', chain: 'MELEK', what: 'witness + curation rewards' },
  { id: 'sprana-staking', mechanism: 'stake', rewardToken: 'SPRANA', chain: 'PRANA', what: 'sPRANA staking' },
  { id: 'soapbox-staking', mechanism: 'stake', rewardToken: 'SBX', chain: 'PRANA', what: 'SoapBox staking' },
]);

/**
 * "Is Hathor earning everything?" — check her positions against EARNING_VENUES. A venue counts as covered
 * if she has a position paying its rewardToken. Returns covered/missing venues + a coverage percent.
 */
export function coverageReport(positions, { venues = EARNING_VENUES } = {}) {
  const have = new Set((Array.isArray(positions) ? positions : []).map((p) => uc(p.rewardToken)).filter(Boolean));
  const covered = venues.filter((v) => have.has(uc(v.rewardToken)));
  const missing = venues.filter((v) => !have.has(uc(v.rewardToken)));
  return { covered, missing, total: venues.length, coveragePct: venues.length ? Math.round((covered.length / venues.length) * 100) : 0, complete: missing.length === 0 };
}

/** Pending rewards for one position: explicit `pending`, else staked × ratePerDay × days since last harvest. */
export function positionPending(pos, { now = Date.now() } = {}) {
  if (!pos) return 0;
  if (pos.pending != null) return round6(num(pos.pending));
  const from = num(pos.lastHarvest) || num(pos.since) || now;
  const days = Math.max(0, (now - Math.min(from, now)) / DAY_MS);
  return round6(num(pos.staked) * num(pos.ratePerDay) * days);
}

/** Aggregate pending rewards across positions, per token and per position. */
export function pendingRewards(positions, { now = Date.now() } = {}) {
  const list = Array.isArray(positions) ? positions : [];
  const byToken = {};
  const byPosition = list.map((p) => {
    const amount = positionPending(p, { now });
    const tok = uc(p.rewardToken);
    if (tok && amount > 0) byToken[tok] = round6((byToken[tok] || 0) + amount);
    return { id: p.id, mechanism: p.mechanism, rewardToken: tok, pending: amount };
  });
  return { byToken, byPosition };
}

/**
 * The harvest plan: which positions have pending rewards above `dust`, as mechanism-specific tx intents
 * (executed later by the relayer/Signer). Also returns the per-token totals that will be claimed.
 */
export function harvestPlan(positions, { now = Date.now(), dust = 0 } = {}) {
  const { byPosition } = pendingRewards(positions, { now });
  const harvests = byPosition
    .filter((p) => p.pending > num(dust))
    .map((p) => ({ id: p.id, mechanism: p.mechanism, rewardToken: p.rewardToken, amount: p.pending,
      tx: { action: 'harvest', mechanism: p.mechanism, positionId: p.id } }));
  const byToken = {};
  for (const h of harvests) byToken[h.rewardToken] = round6((byToken[h.rewardToken] || 0) + h.amount);
  return { harvests, byToken };
}

/**
 * The forward plan: send earned balances to Hathor (or from a keeper to Hathor), keeping a small reserve
 * per token for gas/fees. `balances` = { KULA: 12.3, MWALI: 4 }. `keep` = { PRANA: 0.5 } (gas reserve).
 * Returns transfer intents; a token whose amount ≤ its keep produces no transfer.
 */
export function forwardPlan(balances, { to = HATHOR_ACCOUNT, keep = {}, from } = {}) {
  const dest = String(to || HATHOR_ACCOUNT).toLowerCase();
  const transfers = [];
  for (const [tokRaw, amtRaw] of Object.entries(balances || {})) {
    const token = uc(tokRaw);
    const reserve = num(keep[token] || keep[tokRaw] || 0);
    const amount = round6(num(amtRaw) - reserve);
    if (amount > 0 && dest !== String(from || '').toLowerCase()) {
      transfers.push({ token, to: dest, ...(from ? { from: String(from).toLowerCase() } : {}), amount,
        tx: { action: 'transfer', token, to: dest, amount } });
    }
  }
  return { to: dest, transfers };
}

/** After a harvest confirms, zero the pending / reset the clock for accounting. Returns new positions. */
export function settleHarvest(positions, { now = Date.now(), ids } = {}) {
  const only = ids ? new Set(ids) : null;
  return (Array.isArray(positions) ? positions : []).map((p) =>
    (!only || only.has(p.id)) ? { ...p, pending: 0, lastHarvest: now } : { ...p });
}

/** A summary for a HUD or for Hathor to describe: per-token pending + USD (if prices given), and total USD. */
export function summary(positions, { now = Date.now(), prices = {} } = {}) {
  const { byToken } = pendingRewards(positions, { now });
  const rows = Object.entries(byToken).map(([token, pending]) => {
    const price = num(prices[token] || prices[token.toLowerCase()]);
    return { token, pending: round6(pending), usd: price ? round6(pending * price) : null };
  }).sort((a, b) => (b.usd || 0) - (a.usd || 0) || b.pending - a.pending);
  const totalUsd = rows.reduce((s, r) => s + num(r.usd), 0);
  return { account: HATHOR_ACCOUNT, tokens: rows, totalUsd: round6(totalUsd) };
}
