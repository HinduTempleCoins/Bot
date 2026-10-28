// soapbox-delegation-relayer.mjs — the missing half of SoapBox delegation-mining.
//
// SoapBox is our NutBox: you delegate MELEK Power and earn ALTI ("our PNUTs"), then spend ALTI in
// the Shop for a MELEK upvote (kulaswap/alti-vote-market.mjs). The PRANA side already exists —
// DelegationMint pays ALTI pro-rata to whoever holds the dMP stake token, and
// kulaswap/soapbox-staking.mjs mirrors that math. What has never existed is the piece that turns a
// REAL MELEK Power delegation into dMP. Without it nobody can actually earn by delegating, however
// well the contracts work. This is that piece.
//
//   MELEK (Graphene)                    this module                 PRANA (EVM)
//   delegate_vesting_shares  ──▶  inbound delegation ledger  ──▶  mint/burn dMP  ──▶  DelegationMint → ALTI
//
// WHAT IT IS: a pure reader + differ. It enumerates every delegation on the MELEK chain, keeps the
// ones pointing at the SoapBox delegation account, compares them with the dMP already issued, and
// emits MINT / BURN intents. Deterministic, BigInt-only (no float in a balance), injectable fetch,
// soft-fail-never-throw.
//
// WHAT IT IS NOT: a broadcaster, and it holds no key. Minting dMP needs MINTER_ROLE on PRANA; this
// module emits the unsigned intents a key-gated signer consumes — the same split as
// alti-vote-market.mjs, and the reason CLAUDE.md's "zero WIF in this repo" rule is not touched.
//
// House style: ESM .mjs, BigInt, injectable fetch (__setFetch), soft-fail, CLI guarded by argv[1].

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

// THE ACCOUNT SPLIT (operator, 2026-10-28). Two bots, two jobs:
//   @soapbox — THIS system. Delegation-mining (NutBox): delegate MELEK Power, earn ALTI, spend it
//              in the Shop for a vote. Also where the autovote / Tomoyan-style curation side hangs.
//   @kula    — other things. The weekly Silver & Gold spot-update bot the operator proposed, and
//              the pooled community fund of .local/KULA_COMMUNITY_FUND_RESEARCH.md §3.
// @soapbox did not exist when this was written (the name is free; 102 accounts on chain, none
// called soapbox). Until it is created this defaults to `kula`, which already has 2 real
// delegators — so flipping the system over is one env var, not a code change.
/** The MELEK account delegations are pointed at. Operator decision — kept in env, not hardcoded. */
export const TARGET = () => String(env('SOAPBOX_DELEGATION_ACCOUNT', 'kula')).toLowerCase();
export const MELEK_RPC = () => env('MELEK_RPC_URL', 'https://melek.salon/rpc');

/** VESTS carry 6 decimals on this chain; dMP is an 18-decimal ERC-20. */
export const VESTS_PRECISION = 6;
export const DMP_DECIMALS = 18;
/** 10^(18-6) — one VESTS unit in dMP wei. */
export const SCALE = 10n ** BigInt(DMP_DECIMALS - VESTS_PRECISION);

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/** "12.345678 VESTS" | {amount,precision} | 12.345678 → integer VESTS units (1e6), as BigInt. */
export function vestsUnits(v) {
  try {
    if (v == null) return 0n;
    if (typeof v === 'object') {
      const amt = String(v.amount == null ? '0' : v.amount);
      const p = Number(v.precision == null ? VESTS_PRECISION : v.precision);
      let n = BigInt(amt.replace(/[^0-9-]/g, '') || '0');
      // normalise an unexpected precision to ours rather than silently mis-scaling
      if (p > VESTS_PRECISION) n /= 10n ** BigInt(p - VESTS_PRECISION);
      else if (p < VESTS_PRECISION) n *= 10n ** BigInt(VESTS_PRECISION - p);
      return n < 0n ? 0n : n;
    }
    const s = String(v).trim().split(/\s+/)[0] || '0';
    const neg = s.startsWith('-');
    const [whole, frac = ''] = s.replace(/^[-+]/, '').split('.');
    const f = (frac + '0'.repeat(VESTS_PRECISION)).slice(0, VESTS_PRECISION);
    const n = BigInt((whole || '0').replace(/[^0-9]/g, '') || '0') * 10n ** BigInt(VESTS_PRECISION) + BigInt(f || '0');
    return neg ? 0n : n;
  } catch { return 0n; }
}

/** integer VESTS units → dMP wei */
export const toDmpWei = (units) => (units > 0n ? units * SCALE : 0n);

async function rpc(method, params, { rpcUrl = MELEK_RPC() } = {}) {
  const r = await _fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const j = await r.json();
  if (j && j.error) throw new Error(String(j.error.message || 'rpc error').slice(0, 200));
  return j && j.result;
}

/**
 * Every live delegation pointed at `target`, as integer VESTS units.
 * Pages `database_api.list_vesting_delegations` (order by_delegation) — the only call on this fork
 * that enumerates delegations by delegatee, since get_vesting_delegations is per-DELEGATOR.
 * @returns {Promise<Map<string,bigint>>} delegator → VESTS units
 */
export async function listInboundDelegations(target = TARGET(), opts = {}) {
  const want = String(target || '').toLowerCase();
  const limit = Math.max(1, Math.min(1000, Number(opts.pageLimit) || 1000));
  const out = new Map();
  if (!want) return out;

  let start = [null];
  const seen = new Set();
  for (let page = 0; page < (Number(opts.maxPages) || 500); page += 1) {
    let res;
    try {
      res = await rpc('database_api.list_vesting_delegations', { start, limit, order: 'by_delegation' }, opts);
    } catch { break; }                                     // soft-fail: return what we have
    const rows = (res && res.delegations) || [];
    if (!rows.length) break;
    let advanced = false;
    for (const d of rows) {
      const key = `${d.delegator}->${d.delegatee}`;
      if (seen.has(key)) continue;
      seen.add(key); advanced = true;
      if (String(d.delegatee || '').toLowerCase() !== want) continue;
      const units = vestsUnits(d.vesting_shares);
      if (units > 0n) out.set(String(d.delegator).toLowerCase(), units);
    }
    if (!advanced) break;
    const last = rows[rows.length - 1];
    start = [last.delegator, last.delegatee];
    if (rows.length < limit) break;
  }
  return out;
}

/**
 * Diff the on-chain delegations against the dMP already issued and say what to mint or burn.
 *
 * `inbound`  : Map<melekAccount, VESTS units>        (from listInboundDelegations)
 * `issued`   : Map<melekAccount, dMP wei already held>
 * `wallets`  : Map<melekAccount, 0x address>          — who receives the dMP
 *
 * An account with a delegation but no linked wallet is reported in `unlinked`, never dropped
 * silently: that is someone owed ALTI who cannot be paid until they link a wallet.
 *
 * @returns {{mints:Array,burns:Array,unchanged:number,unlinked:string[],totalDelegatedWei:string}}
 */
export function dmpIntents({ inbound = new Map(), issued = new Map(), wallets = new Map() } = {}) {
  const mints = []; const burns = []; const unlinked = [];
  let unchanged = 0; let total = 0n;

  const accounts = new Set([...inbound.keys(), ...issued.keys()].map((a) => String(a).toLowerCase()));
  for (const acct of [...accounts].sort()) {
    const want = toDmpWei(inbound.get(acct) || 0n);
    const have = (() => { try { return BigInt(issued.get(acct) || 0n); } catch { return 0n; } })();
    total += want;
    if (want === have) { if (want > 0n) unchanged += 1; continue; }
    const addr = wallets.get(acct);
    if (!addr) { unlinked.push(acct); continue; }
    if (want > have) mints.push({ account: acct, to: addr, amountWei: (want - have).toString() });
    else burns.push({ account: acct, from: addr, amountWei: (have - want).toString() });
  }
  return { mints, burns, unchanged, unlinked, totalDelegatedWei: total.toString() };
}

/** One pass: read the chain, diff, and return the intents. Never throws. */
export async function plan({ target = TARGET(), issued = new Map(), wallets = new Map(), ...opts } = {}) {
  let inbound = new Map();
  try { inbound = await listInboundDelegations(target, opts); } catch { inbound = new Map(); }
  return { ok: true, target, delegators: inbound.size, ...dmpIntents({ inbound, issued, wallets }) };
}

// ── CLI (guarded) — read-only; prints what WOULD be minted ────────────────────────────────────────
if (process.argv[1] && /soapbox-delegation-relayer\.mjs$/.test(process.argv[1])) {
  const target = process.argv[2] || TARGET();
  const inbound = await listInboundDelegations(target);
  console.log(`delegation account : @${target}`);
  console.log(`delegators         : ${inbound.size}`);
  let total = 0n;
  for (const [a, u] of inbound) { total += u; console.log(`   @${a}  ${(Number(u) / 1e6).toFixed(6)} VESTS  -> ${toDmpWei(u)} dMP wei`); }
  console.log(`total delegated    : ${(Number(total) / 1e6).toFixed(6)} VESTS`);
  if (!inbound.size) {
    console.log('\nNo MELEK Power is delegated to this account yet, so there is nothing to mint.');
    console.log('That is the current state of SoapBox delegation-mining: the path is built, unused.');
  }
}
