// karma.mjs — the Witness's OFF-CHAIN karma layer (BRIEF.md §9).
//
// Karma is SOCIAL, not economic. It is computed from observable on-chain BEHAVIOR — who teaches, who
// helps newcomers, who upvotes quality vs spam, who flags appropriately, how long they've been here —
// and it NEVER touches the chain's reward pool or stake-weighted voting. It lives entirely in this
// repo (forkable, per §9) and informs only the Witness's DISCRETIONARY functions: how large a grant
// to consider and how much weight to give someone's flag. The chain code stays unmodified.
//
// Design (house style):
//   • scoreActivity(activity) is a PURE function → deterministic 0..100 score + component breakdown.
//     Tests pin it; no network, no clock, no disk.
//   • computeKarma(account, {fetchActivity}) wraps it with an INJECTABLE activity fetcher. The default
//     fetcher reads chain-explorer.account() (read-only) and fills what the chain exposes; richer
//     social signals (replies-to-newcomers, votes-to-others) are fields the fetcher CAN populate as
//     deeper history reading lands — the model is already complete and forward-compatible.
//   • grantTierFor(score) maps a score to a discretionary grant multiplier + flag weight (§9).
//   • A tiny JSON store (forkable) keeps the latest score per account; rank() sorts it.
//
// SECURITY: read-only. No keys. Karma output is advisory input to grant/flag logic — it does not and
// must not move funds or cast votes by itself.
//
// CLI:  node karma/karma.mjs score <account>
//       node karma/karma.mjs tier  <account>
//       node karma/karma.mjs rank

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = process.env.KARMA_STORE || path.join(__dirname, 'data', 'karma.json');

// Saturating normalizer: x → 0..1, half-saturating at k. Diminishing returns, never exceeds 1.
const sat = (x, k) => { const v = Math.max(0, Number(x) || 0); return v / (v + k); };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number(x) || 0));

// Component weights (sum = 1.0). The §9 signals, in priority order.
export const KARMA_WEIGHTS = {
  teaches: 0.25,        // posts + comments (knowledge shared)
  helpsNewcomers: 0.25, // replies on low-rep / new accounts' content
  generosity: 0.25,     // upvotes given to OTHERS (quality), penalizing self-votes
  tenure: 0.15,         // account age — skin in the game
  flagsAppropriately: 0.05, // modest, capped (we can't fully judge appropriateness yet)
  reputation: 0.05,     // chain reputation as a weak prior
};

/**
 * Pure: turn an activity snapshot into a 0..100 karma score + component breakdown. Missing fields
 * are treated as 0 (a fresh/unknown account scores low, not undefined). Deterministic.
 * @param {object} a
 * @param {number} [a.postCount] @param {number} [a.commentCount]
 * @param {number} [a.repliesToNewcomers]
 * @param {number} [a.upvotesGiven] @param {number} [a.selfVotes]
 * @param {number} [a.accountAgeDays] @param {number} [a.flagsGiven]
 * @param {number} [a.reputation] normalized 0..100 if present
 * @returns {{ score:number, components:object }}
 */
export function scoreActivity(a = {}) {
  const teaches = 0.5 * sat(a.postCount, 20) + 0.5 * sat(a.commentCount, 100);
  const helpsNewcomers = sat(a.repliesToNewcomers, 30);
  const upGiven = Math.max(0, Number(a.upvotesGiven) || 0);
  const qualityShare = upGiven > 0 ? clamp((upGiven - (Number(a.selfVotes) || 0)) / upGiven, 0, 1) : 0;
  const generosity = qualityShare * sat(upGiven, 200); // share-to-others × volume
  const tenure = sat(a.accountAgeDays, 180);
  const flagsAppropriately = 0.5 * sat(a.flagsGiven, 20); // capped contribution
  const reputation = a.reputation != null ? clamp(a.reputation / 100, 0, 1) : 0;

  const components = { teaches, helpsNewcomers, generosity, tenure, flagsAppropriately, reputation };
  const score = Object.entries(KARMA_WEIGHTS).reduce((s, [k, w]) => s + w * (components[k] || 0), 0) * 100;
  return { score: Math.round(score * 10) / 10, components };
}

// Discretionary tiers (§9): higher karma → larger grants considered + heavier flag weight. Advisory.
export const KARMA_TIERS = [
  { min: 0, tier: 'newcomer', grantMultiplier: 1.0, flagWeight: 0.25 },
  { min: 20, tier: 'member', grantMultiplier: 1.5, flagWeight: 0.5 },
  { min: 50, tier: 'trusted', grantMultiplier: 2.0, flagWeight: 1.0 },
  { min: 75, tier: 'pillar', grantMultiplier: 3.0, flagWeight: 1.5 },
];
export function grantTierFor(score) {
  let t = KARMA_TIERS[0];
  for (const c of KARMA_TIERS) if (score >= c.min) t = c;
  return { ...t };
}

// ── injectable activity fetcher (default = read-only chain-explorer) ────────────
let _fetchActivity = null;
export function __setFetchActivity(fn) { _fetchActivity = typeof fn === 'function' ? fn : null; }

async function defaultFetchActivity(account) {
  try {
    const { account: getAccount } = await import('../integrations/chain-explorer.mjs');
    const acc = await getAccount(account);
    if (!acc) return { account };
    const created = acc.created || acc.created_at;
    const ageDays = created ? Math.max(0, (Date.now() - new Date(created).getTime()) / 86400000) : 0;
    return {
      account,
      postCount: Number(acc.post_count ?? acc.comment_count ?? 0),
      commentCount: Number(acc.comment_count ?? 0),
      accountAgeDays: ageDays,
      reputation: acc.reputation != null ? normalizeReputation(acc.reputation) : null,
      // social signals (repliesToNewcomers, upvotesGiven, selfVotes, flagsGiven) require deeper op
      // history; left 0/undefined until that reader lands — scoreActivity handles their absence.
    };
  } catch { return { account }; }
}

// Steem/Hive raw reputation → ~0..100. (log10 transform, the standard ui formula, clamped.)
export function normalizeReputation(raw) {
  const r = Number(raw) || 0;
  if (r === 0) return 25;
  const neg = r < 0;
  let v = (Math.log10(Math.abs(r)) - 9) * 9 + 25;
  if (neg) v = 50 - v;
  return clamp(v, 0, 100);
}

/** Compute (and return) a karma record for an account. Does NOT persist unless save=true. */
export async function computeKarma(account, { fetchActivity = _fetchActivity || defaultFetchActivity, save = false } = {}) {
  const activity = (await fetchActivity(account)) || { account };
  const { score, components } = scoreActivity(activity);
  const tier = grantTierFor(score);
  const record = { account, score, tier: tier.tier, grantMultiplier: tier.grantMultiplier, flagWeight: tier.flagWeight, components, updatedAt: new Date().toISOString() };
  if (save) putRecord(record);
  return record;
}

// ── forkable JSON store ─────────────────────────────────────────────────────
export function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; }
}
function saveStore(s) { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + '\n'); }
export function putRecord(rec) { const s = loadStore(); s[rec.account] = rec; saveStore(s); return rec; }
export function rank(store = loadStore()) {
  return Object.values(store).sort((a, b) => b.score - a.score);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('karma.mjs');
if (isMain) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'score' && arg) {
    const r = await computeKarma(arg, { save: true });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'tier' && arg) {
    const r = await computeKarma(arg);
    console.log(`${arg}: karma ${r.score} → ${r.tier} (grant ×${r.grantMultiplier}, flag weight ${r.flagWeight})`);
  } else if (cmd === 'rank') {
    const rows = rank();
    if (!rows.length) { console.error('karma store empty — run `score <account>` first'); process.exit(1); }
    for (const r of rows) console.log(`  ${r.score.toString().padStart(5)}  ${r.tier.padEnd(8)} @${r.account}`);
  } else {
    console.error('usage: karma.mjs score <account> | tier <account> | rank');
    process.exit(1);
  }
}
