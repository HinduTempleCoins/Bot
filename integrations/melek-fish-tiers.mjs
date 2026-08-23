// melek-fish-tiers.mjs — MELEK-Power "fish tier" classifier + Rich List reader (feature batch #2).
//
// Buckets each account by its MELEK POWER (staked/vesting MELEK) into the familiar Steem-family tiers —
// Plankton → Minnow → Dolphin → Orca → Whale — so newcomers can read the mechanics of stake at a glance,
// and marks "MELEK Club" membership (BLURT-style ownership clubs) at set thresholds. Underpins the Rich
// List page and the mechanics explainer.
//
// PURE classification is network-free and never throws. The Rich List reader uses an INJECTABLE fetch
// (__setFetch) so tests run fully offline; on any network/parse failure it soft-fails to an empty list.
//
//   node integrations/melek-fish-tiers.mjs         # demo: live Rich List against melek.salon/rpc
//
// Exports: TIERS, CLUBS, esc(), num(), vestsToMp(), classify(), clubsFor(), rankAccounts(),
//          getRichList(), __setFetch(). No keys, no writes — read-only.

const RPC = () => process.env.MELEK_RPC_URL || 'https://melek.salon/rpc';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// ── helpers ───────────────────────────────────────────────────────────────────
export const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
// parse a Graphene asset string / number: "123.456789 VESTS" → 123.456789, 5 → 5, garbage → 0
export const assetAmount = (v) => {
  if (typeof v === 'number') return num(v);
  const m = String(v == null ? '' : v).trim().match(/-?\d+(\.\d+)?/);
  return m ? num(m[0]) : 0;
};
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── fish tiers (by MELEK Power) ─────────────────────────────────────────────────
// Thresholds are the FLOOR (inclusive) of each tier, in MELEK Power. Ordered ascending; classify()
// walks from the top down. Tuned for a young chain but keeping the familiar names/shape.
export const TIERS = Object.freeze([
  { key: 'plankton', name: 'Plankton', emoji: '🦠', minMp: 0, blurb: 'Just arrived. Every whale started here.' },
  { key: 'minnow', name: 'Minnow', emoji: '🐟', minMp: 100, blurb: 'Finding your feet — your vote begins to carry.' },
  { key: 'dolphin', name: 'Dolphin', emoji: '🐬', minMp: 1000, blurb: 'A real voice in curation; people feel your upvote.' },
  { key: 'orca', name: 'Orca', emoji: '🦈', minMp: 10000, blurb: 'Heavy influence — you move the rewards pool.' },
  { key: 'whale', name: 'Whale', emoji: '🐳', minMp: 100000, blurb: 'A pillar of the chain. Great weight, great responsibility.' },
]);

// ── "MELEK Clubs" — BLURT-style ownership badges (ascending) ─────────────────────
export const CLUBS = Object.freeze([1000, 10000, 100000, 200000]);

// MELEK Power = vesting_shares * (total_vesting_fund_melek / total_vesting_shares).
// dgp = dynamic global properties (has total_vesting_fund_* + total_vesting_shares). Missing/zero → 0.
export function vestsToMp(vests, dgp = {}) {
  const v = assetAmount(vests);
  const fund = assetAmount(dgp.total_vesting_fund_melek ?? dgp.total_vesting_fund_steem ?? dgp.total_vesting_fund);
  const shares = assetAmount(dgp.total_vesting_shares);
  if (!(shares > 0) || !(fund > 0)) return 0;
  return v * (fund / shares);
}

// classify(mp) → the tier object whose minMp is the greatest floor ≤ mp. Never throws.
export function classify(mp) {
  const m = num(mp);
  let out = TIERS[0];
  for (const t of TIERS) if (m >= t.minMp) out = t;
  return out;
}

// clubsFor(mp) → the club thresholds this account has crossed (e.g. [1000, 10000]).
export function clubsFor(mp) {
  const m = num(mp);
  return CLUBS.filter((c) => m >= c);
}

// rankAccounts(accounts, dgp) → PURE: [{name, mp, vests, tier, clubs}] sorted by MP desc.
// accounts: [{name, vesting_shares, received_vesting_shares?, delegated_vesting_shares?}].
// We count OWN effective MELEK Power = vesting + received − delegated (what actually backs your vote).
export function rankAccounts(accounts = [], dgp = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  return list
    .map((a) => {
      if (!a || typeof a !== 'object' || !a.name) return null;
      const own = assetAmount(a.vesting_shares)
        + assetAmount(a.received_vesting_shares)
        - assetAmount(a.delegated_vesting_shares);
      const vests = Math.max(0, own);
      const mp = vestsToMp(vests, dgp);
      const t = classify(mp);
      return { name: String(a.name), mp, vests, tier: t.key, tierName: t.name, emoji: t.emoji, clubs: clubsFor(mp) };
    })
    .filter(Boolean)
    .sort((x, y) => y.mp - x.mp);
}

// ── network reader (injectable fetch, soft-fail) ────────────────────────────────
async function rpcCall(method, params) {
  try {
    const r = await _fetch(RPC(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return j && j.result !== undefined ? j.result : null;
  } catch { return null; }
}

// getRichList({limit}) → { accounts:[ranked...], dgp, count } — LIVE. Soft-fails to empty.
// MELEK is small: enumerate every account name, then batch-load and rank. limit caps the returned rows.
export async function getRichList({ limit = 100 } = {}) {
  const dgp = (await rpcCall('condenser_api.get_dynamic_global_properties', [])) || {};
  // enumerate all account names via lookup_accounts (paginates from a cursor)
  const names = [];
  let cursor = '';
  for (let page = 0; page < 40; page++) {
    const batch = await rpcCall('condenser_api.lookup_accounts', [cursor, 1000]);
    if (!Array.isArray(batch) || !batch.length) break;
    for (const n of batch) if (n && n !== cursor) names.push(n);
    if (batch.length < 1000) break;
    if (batch[batch.length - 1] === cursor) break;
    cursor = batch[batch.length - 1];
  }
  const uniq = [...new Set(names)];
  // batch-load accounts (100 at a time)
  const accts = [];
  for (let i = 0; i < uniq.length; i += 100) {
    const got = await rpcCall('condenser_api.get_accounts', [uniq.slice(i, i + 100)]);
    if (Array.isArray(got)) accts.push(...got);
  }
  const ranked = rankAccounts(accts, dgp);
  return { accounts: ranked.slice(0, Math.max(0, limit)), dgp, count: ranked.length };
}

// ── CLI: live demo ──────────────────────────────────────────────────────────────
if (process.argv[1] && /melek-fish-tiers\.mjs$/.test(process.argv[1])) {
  getRichList({ limit: 20 }).then(({ accounts, count }) => {
    console.log(`MELEK Rich List — ${count} accounts (top ${accounts.length}):`);
    for (const a of accounts) {
      const club = a.clubs.length ? ` · ${Math.max(...a.clubs).toLocaleString()} Club` : '';
      console.log(`  ${a.emoji} ${a.tierName.padEnd(9)} @${a.name.padEnd(16)} ${Math.round(a.mp).toLocaleString()} MP${club}`);
    }
  });
}
