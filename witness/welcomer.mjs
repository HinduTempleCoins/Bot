// welcomer.mjs — Task #310: Hathor's automatic new-user welcome loop.
//
// PURPOSE
//   The full new-user loop, proven by hand on the live MELEK testnet, made into an automatic,
//   tested module. For each freshly-created account, Hathor (the on-chain account `hathor`):
//     1. DELEGATES POWER (vesting shares) so the newcomer has Resource Credits and can post.
//        A brand-new Graphene account has ZERO RC and literally cannot comment/transfer until it
//        has staked POWER or received a delegation. A TINY delegation (~0.1 VESTS) is the RC
//        bootstrap — enough to transact while learning; real weight is the user's own, built over time.
//     2. GRANTS a small amount of the chain token (testnet TESTS, mainnet MELEK) — random 5-15.
//     3. PINGS the newcomer in a `comment` reply on Hathor's WELCOME POST (a blockchain post
//        Hathor authored — NOT a web page). The @-mention is what fires the user's wallet
//        notification; that's how they discover the welcome.
//
// CHAIN NOTES (this chain is a Steem HF23 fork)
//   - `account_create_with_delegation` is a NO-OP on this fork. The faucet does a BARE create;
//     this welcomer does the delegate as a SEPARATE `delegate_vesting_shares` op.
//   - Comment rate limit is 1 per 3 seconds (STEEM_MIN_REPLY_INTERVAL_HF20). We space welcome
//     pings >= 3.5s apart, defaulting to ~7s to be safe.
//
// CUSTODY (CLAUDE.md "Zero WIF" / BRIEF.md §7)
//   - This module NEVER holds, hardcodes, or logs a private key. The active key (for delegate +
//     transfer) and posting key (for comment) are referenced ONLY as injection points:
//     process.env.HATHOR_ACTIVE_KEY / process.env.HATHOR_POSTING_KEY. The HOST fetches them JIT
//     from the operator vault at runtime and hands them to the broadcaster — this file just builds
//     standard Graphene ops and passes them to an INJECTED broadcaster.
//   - With no broadcaster injected, the module can never broadcast regardless of `live` (the
//     zero-WIF safety floor). DRY-RUN is the default.
//
// SOFT-FAIL
//   Every chain interaction soft-fails: a delegate/grant/ping error is logged into the per-account
//   result and the loop continues; nothing throws on a network/broadcast error.
//
//   import {
//     welcomeAccount, buildDelegateOp, buildGrantOp, buildWelcomePingComment,
//     findNewAccounts, __setBroadcast, __setRandom, __setSleep,
//   } from './welcomer.mjs'
//
// Everything is injectable so the tests run fully offline with no network.

// ── config (env) ──────────────────────────────────────────────────────────────────────────────
//   WELCOME_SYMBOL          token symbol for the grant (testnet TESTS, mainnet MELEK). default TESTS
//   WELCOME_POST_AUTHOR     author of the welcome post. default "hathor"
//   WELCOME_POST_PERMLINK   permlink of Hathor's welcome post (REQUIRED for a real ping)
//   HATHOR_ACCOUNT          the witness account name. default "hathor"
//   WELCOME_DELEGATION      VESTS to delegate (tiny RC bootstrap — let them communicate while they
//                           learn; they build real weight from their OWN stake over time). default
//                           "0.100000 VESTS". (Was 200 — unsustainable: Hathor holds ~200 total, so
//                           200/newcomer = one user, then tapped out. Operator spec: ~0.1.)
//   WELCOME_GRANT_MIN       min grant (whole tokens). default 5
//   WELCOME_GRANT_MAX       max grant (whole tokens). default 15
//   WELCOME_PING_SPACING_MS spacing between pings across accounts. default 7000 (>= 3500 enforced)
//   WELCOME_RPC             RPC url (used by the CLI / host wiring; not used in offline tests)
//   HATHOR_ACTIVE_KEY       injection point — host fetches JIT from vault; NEVER hardcoded/logged
//   HATHOR_POSTING_KEY      injection point — host fetches JIT from vault; NEVER hardcoded/logged

const HATHOR_ACCOUNT = (process.env.HATHOR_ACCOUNT || 'hathor').trim();
const WELCOME_SYMBOL = (process.env.WELCOME_SYMBOL || 'TESTS').trim();
const WELCOME_POST_AUTHOR = (process.env.WELCOME_POST_AUTHOR || 'hathor').trim();
const WELCOME_POST_PERMLINK = (process.env.WELCOME_POST_PERMLINK || '').trim();
const WELCOME_DELEGATION = (process.env.WELCOME_DELEGATION || '0.100000 VESTS').trim();
const GRANT_MIN = parseInt(process.env.WELCOME_GRANT_MIN || '5', 10);
const GRANT_MAX = parseInt(process.env.WELCOME_GRANT_MAX || '15', 10);

// Comment rate limit on this fork is 1 / 3s. Floor the configurable spacing at 3.5s; default ~7s.
const MIN_PING_SPACING_MS = 3500;
const PING_SPACING_MS = Math.max(
  MIN_PING_SPACING_MS,
  parseInt(process.env.WELCOME_PING_SPACING_MS || '7000', 10),
);

// ── injectable seams (broadcast, RNG, sleep) ───────────────────────────────────────────────────

// Default broadcaster: there is NONE. With no broadcaster injected, the module can never broadcast,
// regardless of `live`. This is the zero-WIF safety floor — the host injects a broadcaster that
// holds the JIT-fetched key and signs; this file never sees a key.
//   broadcaster signature: async (op, { keyType }) => result
//     op      a single standard Graphene op tuple, e.g. ['transfer', {...}]
//     keyType 'active' (delegate/transfer) or 'posting' (comment) — tells the host which JIT key
let _broadcast = null;

// Deterministic-in-tests RNG (0 <= r < 1). Default Math.random.
let _random = Math.random;

// Sleep between pings (real ms wait in production). Injectable so tests don't actually wait.
let _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Inject the broadcaster: async (op, { keyType }) => result. It alone holds the signer key. */
export function __setBroadcast(fn) {
  _broadcast = typeof fn === 'function' ? fn : null;
}

/** Inject the RNG: a () => number in [0,1). */
export function __setRandom(fn) {
  _random = typeof fn === 'function' ? fn : Math.random;
}

/** Inject the sleep function: a (ms) => Promise. */
export function __setSleep(fn) {
  _sleep = typeof fn === 'function' ? fn : ((ms) => new Promise((r) => setTimeout(r, ms)));
}

// ── small helpers ───────────────────────────────────────────────────────────────────────────────

// Escape any value interpolated into chain output (op bodies / metadata). Mirrors the repo's esc()
// house rule. Graphene memos/comments are plain text, but we still neutralize angle brackets and
// strip control chars so nothing user-supplied (the account name) can smuggle markup downstream.
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Graphene account names: lowercase, segments [a-z][a-z0-9-]*[a-z0-9], 3-16 per segment, dots ok.
// Mirrors signup/faucet-testnet.mjs#validAccountName so the welcomer rejects garbage before it ever
// builds an op against it.
const SEGMENT_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
export function validAccountName(name) {
  if (typeof name !== 'string') return false;
  if (name.length < 3 || name.length > 16) return false;
  for (const seg of name.split('.')) {
    if (seg.length < 3 || seg.length > 16) return false;
    if (!SEGMENT_RE.test(seg)) return false;
    if (seg.includes('--')) return false;
  }
  return true;
}

/**
 * Pick a random whole-token grant in [min, max] inclusive, formatted as a 3-decimal asset string
 * with the symbol (e.g. "11.000 TESTS"). Uses the injected RNG.
 *
 * @param {{ min?:number, max?:number, symbol?:string }} opts
 * @returns {{ amount:number, asset:string }}
 */
export function pickGrantAmount({ min = GRANT_MIN, max = GRANT_MAX, symbol = WELCOME_SYMBOL } = {}) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const span = hi - lo;
  const amount = lo + Math.floor(_random() * (span + 1)); // inclusive of hi
  return { amount, asset: `${amount}.000 ${symbol}` };
}

// ── op builders (pure) ──────────────────────────────────────────────────────────────────────────

/**
 * Build the standard Graphene `delegate_vesting_shares` op. Pure.
 * Separate op (NOT account_create_with_delegation — that's a no-op on this fork).
 *
 * @param {{ to:string, vests?:string, from?:string }} args
 * @returns {[string, object]}
 */
export function buildDelegateOp({ to, vests = WELCOME_DELEGATION, from = HATHOR_ACCOUNT }) {
  if (!validAccountName(to)) throw new Error('buildDelegateOp: invalid delegatee account');
  return ['delegate_vesting_shares', {
    delegator: from,
    delegatee: to,
    vesting_shares: vests,
  }];
}

/**
 * Build the standard Graphene `transfer` op for the welcome grant. Pure.
 *
 * @param {{ to:string, asset:string, from?:string, memo?:string }} args
 * @returns {[string, object]}
 */
export function buildGrantOp({ to, asset, from = HATHOR_ACCOUNT, memo = 'Welcome to MELEK' }) {
  if (!validAccountName(to)) throw new Error('buildGrantOp: invalid recipient account');
  if (typeof asset !== 'string' || !/^\d+\.\d{3}\s+[A-Z]{2,8}$/.test(asset)) {
    throw new Error('buildGrantOp: asset must be like "10.000 TESTS"');
  }
  return ['transfer', {
    from,
    to,
    amount: asset,
    memo: esc(memo),
  }];
}

// A small set of welcome variants so the thread doesn't read like identical spam. Phase 3 replaces
// these with LLM generation in the Angelic register; the op shape stays the same.
const PING_TEMPLATES = [
  (acct) => `Welcome, @${acct}. You're on MELEK now — I've sent you a little to get started and some POWER so you can post. What brought you here?`,
  (acct) => `@${acct} — welcome aboard. There's a starter grant and a POWER delegation in your account so you can begin right away. Glad you're here.`,
  (acct) => `Welcome, @${acct}. I've staked some POWER to your account and sent a small gift to get you going. Tell me one thing you're curious about.`,
  (acct) => `@${acct}, you've arrived. A welcome grant and enough POWER to post are waiting for you. What would you like to do first?`,
];

/**
 * Build the welcome PING — a standard Graphene `comment` that replies to Hathor's welcome post and
 * @-mentions the new account. Pure. Deterministic variant per account so the same account always
 * gets the same line (no need to persist the choice).
 *
 * @param {{ account:string, postAuthor?:string, postPermlink?:string, botAccount?:string }} args
 * @returns {[string, object]}
 */
export function buildWelcomePingComment({
  account,
  postAuthor = WELCOME_POST_AUTHOR,
  postPermlink = WELCOME_POST_PERMLINK,
  botAccount = HATHOR_ACCOUNT,
} = {}) {
  if (!validAccountName(account)) throw new Error('buildWelcomePingComment: invalid account');
  if (!postPermlink) throw new Error('buildWelcomePingComment: welcome post permlink required (WELCOME_POST_PERMLINK)');

  // Deterministic variant: sum char codes of the account name % N. Cheap, stable, no crypto import
  // needed for a 4-way pick.
  let h = 0;
  for (const ch of account) h = (h + ch.charCodeAt(0)) % 1000;
  const body = PING_TEMPLATES[h % PING_TEMPLATES.length](esc(account));

  // Graphene permlinks: lowercase + hyphenated, <= 256 chars. (post, account) is unique because an
  // account is welcomed once, so `welcome-<account>` is a sufficient unique tail.
  const permlink = `re-${postAuthor}-${postPermlink}-welcome-${account}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 255);

  return ['comment', {
    parent_author: postAuthor,
    parent_permlink: postPermlink,
    author: botAccount,
    permlink,
    title: '',
    body,
    json_metadata: JSON.stringify({ app: 'hathor-welcomer/1.0', tags: ['welcome'] }),
  }];
}

// ── the welcome action ──────────────────────────────────────────────────────────────────────────

/** Try a single broadcast, soft-failing. Returns { ok, id?, error? }. Never throws. */
async function tryBroadcast(op, keyType) {
  if (typeof _broadcast !== 'function') {
    // No broadcaster injected → dry-run. Report the prepared op without touching the chain.
    return { ok: true, dryRun: true, op };
  }
  try {
    const r = await _broadcast(op, { keyType });
    return { ok: true, id: (r && (r.id || r.trx_id)) || null };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || 'broadcast-failed').slice(0, 200) };
  }
}

/**
 * Welcome ONE account: delegate POWER → grant tokens → ping on the welcome post. Soft-fail at every
 * step (a failure is recorded and the next step still runs / the loop continues). Never throws.
 *
 * Broadcasting happens ONLY when live === true AND a broadcaster is injected; otherwise this is a
 * dry-run that returns the prepared ops. The host injects a broadcaster that holds the JIT-fetched
 * active/posting key — this function never sees a key.
 *
 * @param {object} args
 * @param {string}  args.account               new account name (without @)
 * @param {boolean} [args.live=false]          actually broadcast (needs an injected broadcaster)
 * @param {string}  [args.vests]               override delegation amount
 * @param {{min:number,max:number}} [args.grant] override grant range
 * @param {string}  [args.symbol]              override token symbol
 * @param {string}  [args.postPermlink]        override welcome post permlink
 * @returns {Promise<{
 *   account:string, ok:boolean, dryRun:boolean,
 *   delegate:object, grant:object, ping:object, grantAsset:string
 * }>}
 */
export async function welcomeAccount({
  account,
  live = false,
  vests = WELCOME_DELEGATION,
  grant = { min: GRANT_MIN, max: GRANT_MAX },
  symbol = WELCOME_SYMBOL,
  postPermlink = WELCOME_POST_PERMLINK,
} = {}) {
  const dryRun = !live || typeof _broadcast !== 'function';

  if (!validAccountName(account)) {
    return {
      account, ok: false, dryRun,
      delegate: { ok: false, error: 'invalid-account-name' },
      grant: { ok: false, error: 'invalid-account-name' },
      ping: { ok: false, error: 'invalid-account-name' },
      grantAsset: null,
    };
  }

  // 1. DELEGATE POWER (active key). Build first so a build error is captured, not thrown.
  let delegate;
  try {
    const op = buildDelegateOp({ to: account, vests });
    delegate = dryRun ? { ok: true, dryRun: true, op } : await tryBroadcast(op, 'active');
  } catch (e) {
    delegate = { ok: false, error: String((e && e.message) || 'delegate-build-failed') };
  }

  // 2. GRANT tokens (active key). Random 5-15 in the configured symbol.
  const { asset } = pickGrantAmount({ min: grant.min, max: grant.max, symbol });
  let grantResult;
  try {
    const op = buildGrantOp({ to: account, asset });
    grantResult = dryRun ? { ok: true, dryRun: true, op } : await tryBroadcast(op, 'active');
  } catch (e) {
    grantResult = { ok: false, error: String((e && e.message) || 'grant-build-failed') };
  }

  // 3. PING on the welcome post (posting key).
  let ping;
  try {
    const op = buildWelcomePingComment({ account, postPermlink });
    ping = dryRun ? { ok: true, dryRun: true, op } : await tryBroadcast(op, 'posting');
  } catch (e) {
    ping = { ok: false, error: String((e && e.message) || 'ping-build-failed') };
  }

  return {
    account,
    ok: delegate.ok && grantResult.ok && ping.ok,
    dryRun,
    delegate,
    grant: grantResult,
    ping,
    grantAsset: asset,
  };
}

/**
 * Welcome a LIST of accounts, spacing the pings to respect the comment rate limit (1/3s on this
 * fork; we wait PING_SPACING_MS, floored at 3.5s, between accounts). Soft-fail per account.
 *
 * @param {string[]} accounts
 * @param {{ live?:boolean, spacingMs?:number }} [opts]
 * @returns {Promise<Array<object>>} per-account results from welcomeAccount
 */
export async function welcomeBatch(accounts, { live = false, spacingMs = PING_SPACING_MS } = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const spacing = Math.max(MIN_PING_SPACING_MS, Number(spacingMs) || PING_SPACING_MS);
  const results = [];
  for (let i = 0; i < list.length; i++) {
    // Space pings: wait BEFORE every account except the first (each account fires a comment).
    if (i > 0) await _sleep(spacing);
    // eslint-disable-next-line no-await-in-loop
    results.push(await welcomeAccount({ account: list[i], live }));
  }
  return results;
}

// ── new-account discovery seam ───────────────────────────────────────────────────────────────────

/**
 * Find new accounts to welcome. SEAM/STUB: the host wires this to its real source — the faucet's
 * record of accounts it just minted, or a block scan for `account_create` ops (see the sibling
 * welcomer/discover.js). Here it simply normalizes/validates a fed-in list so the CLI and tests can
 * drive the loop deterministically and offline.
 *
 * @param {object} [args]
 * @param {string[]} [args.candidates]  account names to consider
 * @param {Set<string>|string[]} [args.skip] accounts to skip (already welcomed / system accounts)
 * @returns {Promise<string[]>} valid, de-duplicated, not-skipped account names
 */
export async function findNewAccounts({ candidates = [], skip = [] } = {}) {
  const skipSet = skip instanceof Set ? skip : new Set(skip || []);
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const name = typeof c === 'string' ? c.trim() : '';
    if (!validAccountName(name)) continue;
    if (skipSet.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// ── CLI (guarded): process a list of accounts. DRY-RUN unless --live AND a broadcaster is wired ──
// Usage:
//   node witness/welcomer.mjs alice-tests bob-tests          # dry-run, prints prepared ops
//   node witness/welcomer.mjs --live alice-tests             # live (only broadcasts if a
//                                                            #  broadcaster is wired; none here)
// NOTE: this repo wires NO broadcaster (zero-WIF). On the host, a thin wrapper imports this module,
// calls __setBroadcast() with a signer that fetches HATHOR_ACTIVE_KEY / HATHOR_POSTING_KEY JIT from
// the operator vault, then calls welcomeBatch([...], { live: true }).
if (process.argv[1] && process.argv[1].endsWith('welcomer.mjs')) {
  const argv = process.argv.slice(2);
  const live = argv.includes('--live'); // ignored unless a broadcaster is wired (none in-repo)
  const names = argv.filter((a) => !a.startsWith('--'));
  const accounts = await findNewAccounts({ candidates: names });

  if (accounts.length === 0) {
    console.log('welcomer: no valid accounts given. usage: node witness/welcomer.mjs [--live] <account> [...]');
  } else {
    console.log(`welcomer: ${accounts.length} account(s), symbol=${WELCOME_SYMBOL}, delegation=${WELCOME_DELEGATION}, spacing=${PING_SPACING_MS}ms (DRY-RUN default; no signer wired in-repo)`);
    const results = await welcomeBatch(accounts, { live });
    for (const r of results) {
      console.log(`  @${r.account}: ${r.dryRun ? 'DRY-RUN' : (r.ok ? 'OK' : 'PARTIAL/FAIL')} grant=${r.grantAsset}`);
      console.log(JSON.stringify({ delegate: r.delegate.op || r.delegate, grant: r.grant.op || r.grant, ping: r.ping.op || r.ping }, null, 2));
    }
  }
}
