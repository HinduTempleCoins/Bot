// welcome-grant.mjs — the VISIBLE half of onboarding (operator model).
//
// PURPOSE
//   Once an account EXISTS on the MELEK chain (the account_create + key custody happens elsewhere),
//   this is the part the newcomer actually SEES:
//     1) Hathor (the on-chain account `hathor`) transfers a small LIQUID grant of the chain token to
//        the new account (testnet TESTS, mainnet MELEK) — a few coins to get started.
//     2) Hathor PINGS the account in a `comment` reply on the WELCOME POST (a blockchain post Hathor
//        authored). The @-mention is what fires the newcomer's wallet notification — that's how they
//        discover the welcome.
//
//   The faucet/welcomer in witness/ build the raw Graphene ops and own the delegation/RC step; THIS
//   module is the thin orchestration seam the operator drives: "given an account and a couple of
//   already-wired actions (transfer, pingWelcome), do the visible grant+ping and report both."
//
// DEPENDENCY INJECTION (so this is fully offline-testable; no chain, no keys here)
//   welcomeGrant(account, deps, { grant }) takes its two chain actions as INJECTED deps:
//     deps.transfer({ to, amount, memo? })   -> the Hathor→account liquid grant (returns id-ish)
//     deps.pingWelcome({ account, memo? })   -> the comment @-mention on the welcome post
//   Each dep alone owns its signing/broadcast (MELEK-Signer / JIT-fetched key on the host). This file
//   NEVER holds, requests, logs, or prints a private key — zero WIF by construction (BRIEF.md §7).
//
// SOFT-FAIL (load-bearing)
//   The grant is the money; the ping is a notification. A ping hiccup must NEVER undo the grant. So:
//   the grant runs first; whether it succeeds or fails, the ping still runs; both outcomes are
//   reported independently in { granted, pinged, errors }. Nothing here throws to the caller.
//
//   import { welcomeGrant, describeWelcome, esc, validAccountName } from './welcome-grant.mjs'
//
// Everything injectable; CLI guarded; offline tests in welcome-grant.test.mjs.

// ── config (env-overridable; safe placeholders only, no secrets/hosts) ───────────────────────────
export const HATHOR_ACCOUNT = (process.env.HATHOR_ACCOUNT || 'hathor').trim();
export const WELCOME_SYMBOL = (process.env.WELCOME_SYMBOL || 'TESTS').trim(); // mainnet would be MELEK
export const DEFAULT_GRANT = (process.env.WELCOME_GRANT || '5.000').trim();   // whole-ish, 3dp asset
export const WELCOME_MEMO = (process.env.WELCOME_MEMO || 'Welcome to MELEK').trim();

// ── small helpers ────────────────────────────────────────────────────────────────────────────────

// Escape any value interpolated into chain output (memos / comment bodies). Mirrors the repo esc()
// house rule: strip control chars, neutralize angle brackets so an account name can't smuggle markup.
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Graphene account names: lowercase, dot-separated segments [a-z][a-z0-9-]*[a-z0-9], 3–16 each, no
// leading/trailing/double hyphen. Mirrors witness/welcomer.mjs#validAccountName.
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
 * Normalize a grant into a Graphene asset string like "5.000 TESTS".
 * Accepts a number (5), a bare amount string ("5" / "5.0" / "5.000"), or a full asset ("5.000 TESTS").
 * Returns { asset, error? }. Never throws.
 */
export function normalizeGrant(grant, symbol = WELCOME_SYMBOL) {
  // Already a full asset string? trust the shape if it validates.
  if (typeof grant === 'string' && /\s+[A-Z]{2,8}$/.test(grant.trim())) {
    const asset = grant.trim();
    if (!/^\d+\.\d{3}\s+[A-Z]{2,8}$/.test(asset)) return { error: 'bad-asset-format' };
    return { asset };
  }
  let n;
  if (typeof grant === 'number') n = grant;
  else if (typeof grant === 'string' && grant.trim() !== '') n = Number(grant);
  else if (grant == null) n = Number(DEFAULT_GRANT);
  else return { error: 'bad-grant' };
  if (!Number.isFinite(n) || n <= 0) return { error: 'bad-grant' };
  return { asset: `${n.toFixed(3)} ${symbol}` };
}

// Pull an id-ish handle out of whatever a dep returns, without assuming a shape. Soft.
function idOf(r) {
  if (!r) return true; // a falsy-but-resolved dep still counts as done; report `true`
  if (typeof r === 'string') return r;
  return r.id || r.trx_id || r.tx_id || r.block_num || true;
}
function errMsg(e) {
  return String((e && e.message) || e || 'error').slice(0, 200);
}

// ── the visible welcome: grant then ping ─────────────────────────────────────────────────────────

/**
 * Do the VISIBLE onboarding for an account that already exists: liquid grant, then welcome-post ping.
 *
 * Order & soft-fail contract:
 *   - The grant runs FIRST. The ping ALWAYS runs afterward, regardless of the grant's outcome — a
 *     ping problem can never undo or block the money, and a grant problem never skips the ping.
 *   - Both outcomes are reported independently. NEVER throws to the caller.
 *
 * @param {string} account            new account name (no leading @)
 * @param {{ transfer?:function, pingWelcome?:function }} deps  injected chain actions (own signing)
 *        deps.transfer({ from, to, amount, memo }) -> result   liquid Hathor→account grant
 *        deps.pingWelcome({ account, from, memo })  -> result   comment @-mention on the welcome post
 * @param {{ grant?:(number|string), symbol?:string, memo?:string, from?:string }} [opts]
 * @returns {Promise<{
 *   ok:boolean, account:string, amount:(string|null),
 *   granted:(string|boolean|null), pinged:(string|boolean|null), errors:string[]
 * }>}
 */
export async function welcomeGrant(account, deps = {}, opts = {}) {
  const {
    grant,
    symbol = WELCOME_SYMBOL,
    memo = WELCOME_MEMO,
    from = HATHOR_ACCOUNT,
  } = opts || {};

  const errors = [];

  // Validate the account up front — but STILL never throw; report it as an error and bail cleanly.
  if (!validAccountName(account)) {
    return { ok: false, account, amount: null, granted: null, pinged: null, errors: ['invalid-account-name'] };
  }

  const norm = normalizeGrant(grant, symbol);
  if (norm.error) {
    // Bad grant amount → don't transfer garbage, but the welcome ping is still worth firing.
    errors.push(`grant:${norm.error}`);
  }
  const amount = norm.asset || null;
  const safeMemo = esc(memo);

  // 1) THE GRANT (the money). Only if we have a valid amount and a transfer dep.
  let granted = null;
  if (amount) {
    if (typeof deps.transfer !== 'function') {
      errors.push('grant:no-transfer-dep');
    } else {
      try {
        const r = await deps.transfer({ from, to: account, amount, memo: safeMemo });
        granted = idOf(r);
      } catch (e) {
        errors.push(`grant:${errMsg(e)}`);
        granted = null;
      }
    }
  }

  // 2) THE PING (the notification). ALWAYS attempted — a ping hiccup must not undo the grant, and a
  //    grant failure must not skip the ping. Independent try/catch.
  let pinged = null;
  if (typeof deps.pingWelcome !== 'function') {
    errors.push('ping:no-pingWelcome-dep');
  } else {
    try {
      const r = await deps.pingWelcome({ account, from, memo: safeMemo });
      pinged = idOf(r);
    } catch (e) {
      errors.push(`ping:${errMsg(e)}`);
      pinged = null;
    }
  }

  // `ok` means BOTH visible steps landed. Partial success is fully reported in granted/pinged/errors.
  const ok = granted != null && pinged != null && errors.length === 0;
  return { ok, account, amount, granted, pinged, errors };
}

/**
 * Plain-language step list of what the visible welcome does. No chain calls, no keys. For the CLI,
 * docs, and the operator-facing "what happens when someone signs up" explainer.
 *
 * @returns {{ summary:string, steps:Array<{ step:number, name:string, detail:string }> }}
 */
export function describeWelcome() {
  return {
    summary:
      `After an account exists, ${HATHOR_ACCOUNT} does the visible half of onboarding: a small ` +
      `liquid ${WELCOME_SYMBOL} grant, then an @-mention ping on the welcome post so the newcomer ` +
      `gets a wallet notification. The grant is the money; the ping is the notification — a ping ` +
      `problem never undoes the grant.`,
    steps: [
      {
        step: 1,
        name: 'grant',
        detail:
          `${HATHOR_ACCOUNT} transfers a small liquid grant (default ${DEFAULT_GRANT} ${WELCOME_SYMBOL}) ` +
          `to the new account. Signing is the injected transfer dep's concern (zero WIF here).`,
      },
      {
        step: 2,
        name: 'ping',
        detail:
          `${HATHOR_ACCOUNT} replies on the welcome post @-mentioning the account, which fires the ` +
          `newcomer's wallet notification. Runs even if the grant failed; failing here never undoes ` +
          `the grant.`,
      },
    ],
  };
}

// ── CLI (guarded; booleans / dry plan only — NEVER secrets, keys, or a real broadcast) ────────────
if (process.argv[1] && process.argv[1].endsWith('welcome-grant.mjs')) {
  const arg = process.argv[2] || '--describe';
  if (arg === '--describe') {
    const d = describeWelcome();
    console.log(d.summary);
    for (const s of d.steps) console.log(`  ${s.step}. ${s.name}: ${s.detail}`);
  } else if (arg === '--sample') {
    // Dry-run with STUB deps (no chain, no keys) for a sample account — shows the report shape.
    const stub = {
      transfer: async ({ to, amount }) => ({ id: `dry-transfer-${to}-${amount.split(' ')[0]}` }),
      pingWelcome: async ({ account }) => ({ id: `dry-ping-${account}` }),
    };
    const out = await welcomeGrant('newbie-tests', stub, { grant: 7 });
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('usage: node signup/welcome-grant.mjs [--describe|--sample]');
  }
}
