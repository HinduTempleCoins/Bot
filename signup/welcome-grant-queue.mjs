// welcome-grant-queue.mjs — the LIQUID-SAFE welcome: guaranteed POWER delegation now, a liquid grant
// ONLY when Hathor can actually afford it, and a durable QUEUE for the ones she can't yet.
//
// THE PROBLEM THIS SOLVES
//   On the MELEK chain there is (at genesis) ZERO liquid token in circulation — the only source of
//   liquid MELEK is 7-day author-reward cashouts. So the old welcome flow's liquid `transfer` is a
//   doomed op whenever Hathor holds nothing liquid: it fails at broadcast, or (worse) sends dust. The
//   POWER delegation, by contrast, costs no liquid — it is a `delegate_vesting_shares` against Hathor's
//   staked VESTS — so it ALWAYS works. This module makes the delegation the guaranteed welcome and
//   makes the liquid grant conditional + deferrable.
//
// DEGRADE-GRACEFULLY CONTRACT
//   1) DELEGATE POWER (no liquid needed) — the guaranteed welcome. Always attempted first.
//   2) Read Hathor's LIVE liquid balance (injected fetch → condenser_api.get_accounts). Only if she
//      holds at least (grant + reserve) AND the grant clears the dust floor do we broadcast the
//      liquid `transfer`. Otherwise the transfer is SKIPPED — never broadcast doomed/dust — and the
//      intent is QUEUED to a small injectable-fs store for later.
//   3) PING the welcome post (the notification) — always attempted.
//   `fulfillQueuedGrants()` drains that queue later, paying each intent once the balance allows,
//   decrementing a local balance estimate so one run never overspends.
//
// CUSTODY (BRIEF.md §7 / CLAUDE.md "zero WIF")
//   Pure library. Every chain action is an INJECTED dep that owns its own signing (delegate / transfer
//   / pingWelcome) and the balance read is an injected fetch. This file never holds, requests, logs, or
//   prints a private key, and never broadcasts on its own.
//
// SOFT-FAIL (load-bearing)
//   Nothing here throws to the caller. Every step is independently try/caught and reported; a failure
//   in one step never blocks the others. A balance we cannot read is treated as "cannot afford" — we
//   skip + queue rather than gamble on a doomed transfer.
//
//   import {
//     welcomeWithGrant, fulfillQueuedGrants, getLiquidBalance,
//     loadQueue, enqueueGrant, numericAmount, __setFetch, __setFs, __setClock,
//   } from './welcome-grant-queue.mjs'
//
// Everything injectable; CLI guarded; offline tests in welcome-grant-queue.test.mjs.

import { esc, validAccountName, normalizeGrant, WELCOME_SYMBOL, HATHOR_ACCOUNT } from './welcome-grant.mjs';

export { esc, validAccountName, normalizeGrant, WELCOME_SYMBOL, HATHOR_ACCOUNT } from './welcome-grant.mjs';

// ── config (env-overridable; safe placeholders only, no secrets/hosts) ────────────────────────────
export const WELCOME_DELEGATION = (process.env.WELCOME_DELEGATION || '0.100000 VESTS').trim();
export const WELCOME_MEMO = (process.env.WELCOME_MEMO || 'Welcome to MELEK').trim();
// Liquid Hathor keeps back after a grant (so she is never fully drained). Whole-token number.
export const WELCOME_RESERVE = Number(process.env.WELCOME_RESERVE || '0');
// Below this the grant is dust — skip rather than send a meaningless transfer.
export const WELCOME_DUST_MIN = Number(process.env.WELCOME_DUST_MIN || '0.001');
// Where deferred (queued) grant intents live. Injectable-fs in tests; on the host this is under
// .local/ (gitignored). Never contains keys — just {account, asset, amount, memo, reason, queuedAt}.
export const WELCOME_QUEUE_PATH = (process.env.WELCOME_QUEUE_PATH || '.local/welcome-grant-queue.json').trim();
export const WELCOME_RPC = (process.env.WELCOME_RPC || process.env.MELEK_RPC || '').trim();

// ── injectable seams (fetch, fs, clock) ───────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
/** Inject a fetch implementation (tests inject fixtures). Pass nothing/false to restore global fetch. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Minimal fs seam: only readFile/writeFile of a JSON file. Lazily bound to node:fs/promises so the
// module imports cleanly in any environment; tests inject an in-memory pair.
let _fs = null;
async function fs() {
  if (_fs) return _fs;
  const mod = await import('node:fs/promises');
  _fs = { readFile: mod.readFile, writeFile: mod.writeFile };
  return _fs;
}
/** Inject the fs pair: { readFile(path)->string, writeFile(path, string)->void }. */
export function __setFs(obj) {
  _fs = obj && typeof obj.readFile === 'function' && typeof obj.writeFile === 'function' ? obj : null;
}

let _clock = () => Date.now();
/** Inject the clock: a () => epoch-ms. Default Date.now. */
export function __setClock(fn) { _clock = typeof fn === 'function' ? fn : (() => Date.now()); }

// ── small helpers ────────────────────────────────────────────────────────────────────────────────
function errMsg(e) { return String((e && e.message) || e || 'error').slice(0, 200); }

// Pull an id-ish handle out of whatever a dep returns, without assuming a shape. Soft.
function idOf(r) {
  if (!r) return true;
  if (typeof r === 'string') return r;
  return r.id || r.trx_id || r.tx_id || r.block_num || true;
}

/** Numeric token amount from an asset string ("5.000 TESTS" -> 5) or a number. NaN-safe -> 0. */
export function numericAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.trim().split(/\s+/)[0]);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ── liquid-balance read (injected fetch → condenser_api.get_accounts) ─────────────────────────────
/**
 * Read an account's LIQUID balance (the spendable token, not VESTS) via the injected fetch. Returns a
 * number, or null if it cannot be determined (no rpcUrl, transport/RPC error, missing field). NEVER
 * throws — an unreadable balance is a soft null so callers degrade to "cannot afford → queue".
 *
 * @param {string} account
 * @param {{ rpcUrl?:string, getLiquidBalance?:function, timeoutMs?:number }} [opts]
 *        getLiquidBalance(account) -> number|null : an override that bypasses the RPC entirely.
 * @returns {Promise<number|null>}
 */
export async function getLiquidBalance(account, { rpcUrl = WELCOME_RPC, getLiquidBalance, timeoutMs = 15000 } = {}) {
  if (typeof getLiquidBalance === 'function') {
    try {
      const b = await getLiquidBalance(account);
      return typeof b === 'number' && Number.isFinite(b) ? b : (b == null ? null : numericAmount(b));
    } catch { return null; }
  }
  if (!rpcUrl) return null;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await _fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[account]], id: 1 }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (res && typeof res.ok === 'boolean' && !res.ok) return null;
    const j = await res.json();
    if (!j || j.error) return null;
    const acct = Array.isArray(j.result) ? j.result[0] : null;
    if (!acct || acct.balance == null) return null;
    return numericAmount(acct.balance);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── the queue store (injectable-fs JSON array) ────────────────────────────────────────────────────
/**
 * Load the queued-grant intents. Soft: a missing/unreadable/garbage file yields []. Never throws.
 * @param {string} [path]
 * @returns {Promise<Array<object>>}
 */
export async function loadQueue(path = WELCOME_QUEUE_PATH) {
  try {
    const { readFile } = await fs();
    const raw = await readFile(path, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Persist the queue array. Soft: a write error is swallowed and reported via the return boolean. */
export async function saveQueue(queue, path = WELCOME_QUEUE_PATH) {
  try {
    const { writeFile } = await fs();
    await writeFile(path, JSON.stringify(Array.isArray(queue) ? queue : [], null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Append one grant intent to the queue (de-duped by account: a fresh intent replaces an older one for
 * the same account so a re-run never double-queues). Returns { ok, queued, reason }.
 *
 * @param {{ account:string, asset:string, amount?:number, memo?:string, symbol?:string, reason?:string }} entry
 * @param {{ path?:string }} [opts]
 */
export async function enqueueGrant(entry, { path = WELCOME_QUEUE_PATH } = {}) {
  if (!entry || !validAccountName(entry.account) || typeof entry.asset !== 'string') {
    return { ok: false, queued: false, reason: 'bad-entry' };
  }
  const queue = await loadQueue(path);
  const record = {
    account: entry.account,
    asset: entry.asset,
    amount: typeof entry.amount === 'number' ? entry.amount : numericAmount(entry.asset),
    symbol: entry.symbol || entry.asset.trim().split(/\s+/)[1] || WELCOME_SYMBOL,
    memo: esc(entry.memo || WELCOME_MEMO),
    reason: entry.reason || 'insufficient-liquid',
    queuedAt: _clock(),
  };
  const next = queue.filter((q) => q && q.account !== record.account);
  next.push(record);
  const saved = await saveQueue(next, path);
  return { ok: saved, queued: saved, reason: record.reason };
}

// ── the liquid-safe welcome ───────────────────────────────────────────────────────────────────────
/**
 * Welcome ONE existing account with the degrade-gracefully contract: guaranteed POWER delegation,
 * balance-gated liquid grant (queued if unaffordable), then the welcome ping. NEVER throws.
 *
 * @param {string} account   new account name (no @)
 * @param {{
 *   delegate?:function,       // ({from,to,vests}) -> result   POWER delegation (no liquid needed)
 *   transfer?:function,       // ({from,to,amount,memo}) -> result   liquid grant
 *   pingWelcome?:function,    // ({account,from,memo}) -> result   comment @-mention on welcome post
 *   getLiquidBalance?:function // (account) -> number|null   balance-read override (else injected fetch)
 * }} deps
 * @param {{
 *   grant?:(number|string), symbol?:string, memo?:string, from?:string, vests?:string,
 *   reserve?:number, dustMin?:number, rpcUrl?:string, queuePath?:string, queue?:boolean
 * }} [opts]
 * @returns {Promise<{
 *   ok:boolean, account:string, amount:(string|null),
 *   delegated:(string|boolean|null), granted:(string|boolean|null),
 *   queued:boolean, pinged:(string|boolean|null), balance:(number|null), errors:string[]
 * }>}
 */
export async function welcomeWithGrant(account, deps = {}, opts = {}) {
  const {
    grant,
    symbol = WELCOME_SYMBOL,
    memo = WELCOME_MEMO,
    from = HATHOR_ACCOUNT,
    vests = WELCOME_DELEGATION,
    reserve = WELCOME_RESERVE,
    dustMin = WELCOME_DUST_MIN,
    rpcUrl = WELCOME_RPC,
    queuePath = WELCOME_QUEUE_PATH,
    queue: doQueue = true,
  } = opts || {};

  const errors = [];
  if (!validAccountName(account)) {
    return { ok: false, account, amount: null, delegated: null, granted: null, queued: false, pinged: null, balance: null, errors: ['invalid-account-name'] };
  }
  const safeMemo = esc(memo);

  // 1) DELEGATE POWER — the GUARANTEED welcome (no liquid required). Always first.
  let delegated = null;
  if (typeof deps.delegate !== 'function') {
    errors.push('delegate:no-delegate-dep');
  } else {
    try {
      const r = await deps.delegate({ from, to: account, vests });
      delegated = idOf(r);
    } catch (e) {
      errors.push(`delegate:${errMsg(e)}`);
      delegated = null;
    }
  }

  // 2) LIQUID GRANT — only if Hathor can actually afford it. Never broadcast a doomed/dust transfer.
  const norm = normalizeGrant(grant, symbol);
  if (norm.error) errors.push(`grant:${norm.error}`);
  const amount = norm.asset || null;
  const want = amount ? numericAmount(amount) : 0;

  let granted = null;
  let queued = false;
  let balance = null;

  if (amount) {
    // Read the live liquid balance (soft null on any failure → treated as "cannot afford").
    balance = await getLiquidBalance(from, { rpcUrl, getLiquidBalance: deps.getLiquidBalance });
    const affordable = balance != null && (balance - reserve) >= want;
    const nonDust = want >= dustMin;

    if (!nonDust) {
      // Dust-level grant: not worth a transfer and not worth queueing.
      errors.push('grant:below-dust-floor');
    } else if (typeof deps.transfer !== 'function') {
      errors.push('grant:no-transfer-dep');
      // Still record the intent so it can be fulfilled once a transfer path exists.
      if (doQueue) queued = (await enqueueGrant({ account, asset: amount, amount: want, symbol, memo: safeMemo, reason: 'no-transfer-dep' }, { path: queuePath })).queued;
    } else if (affordable) {
      try {
        const r = await deps.transfer({ from, to: account, amount, memo: safeMemo });
        granted = idOf(r);
      } catch (e) {
        // Broadcast failed after we thought it affordable — record + queue for a later retry.
        errors.push(`grant:${errMsg(e)}`);
        if (doQueue) queued = (await enqueueGrant({ account, asset: amount, amount: want, symbol, memo: safeMemo, reason: 'transfer-failed' }, { path: queuePath })).queued;
      }
    } else {
      // Insufficient liquid (or unknown balance): SKIP the doomed transfer, QUEUE the intent.
      const reason = balance == null ? 'balance-unknown' : 'insufficient-liquid';
      errors.push(`grant:skipped-${reason}`);
      if (doQueue) queued = (await enqueueGrant({ account, asset: amount, amount: want, symbol, memo: safeMemo, reason }, { path: queuePath })).queued;
    }
  }

  // 3) PING — the notification. Always attempted; a ping hiccup never undoes delegation/grant.
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

  // ok = the guaranteed parts landed: POWER delegated AND newcomer pinged. The liquid grant is
  // best-effort (queued when unaffordable), so a skipped/queued grant does NOT flip ok to false.
  const ok = delegated != null && pinged != null;
  return { ok, account, amount, delegated, granted, queued, pinged, balance, errors };
}

// ── draining the queue ─────────────────────────────────────────────────────────────────────────────
/**
 * Pay out queued grant intents, oldest first, as far as the balance allows. Reads Hathor's liquid
 * balance once, then decrements a LOCAL estimate per payout so a single run never overspends. Paid
 * intents are removed; unaffordable / failed ones are kept for a later run. NEVER throws.
 *
 * @param {{ transfer?:function, getLiquidBalance?:function }} deps
 * @param {{
 *   from?:string, reserve?:number, dustMin?:number, rpcUrl?:string, queuePath?:string, max?:number
 * }} [opts]
 * @returns {Promise<{
 *   paid:Array<{account:string, amount:string, id:(string|boolean)}>,
 *   remaining:number, balance:(number|null), errors:string[]
 * }>}
 */
export async function fulfillQueuedGrants(deps = {}, opts = {}) {
  const {
    from = HATHOR_ACCOUNT,
    reserve = WELCOME_RESERVE,
    dustMin = WELCOME_DUST_MIN,
    rpcUrl = WELCOME_RPC,
    queuePath = WELCOME_QUEUE_PATH,
    max = Infinity,
  } = opts || {};

  const errors = [];
  const paid = [];
  const queue = await loadQueue(queuePath);
  if (queue.length === 0) return { paid, remaining: 0, balance: null, errors };

  if (typeof deps.transfer !== 'function') {
    errors.push('no-transfer-dep');
    return { paid, remaining: queue.length, balance: null, errors };
  }

  let balance = await getLiquidBalance(from, { rpcUrl, getLiquidBalance: deps.getLiquidBalance });
  const remaining = [];
  // Oldest first (stable order — the queue is already append-order, but sort defensively by queuedAt).
  const ordered = [...queue].sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));

  for (const entry of ordered) {
    const want = numericAmount(entry.amount != null ? entry.amount : entry.asset);
    const asset = typeof entry.asset === 'string' ? entry.asset : null;
    // Can't pay: unknown balance, dust, cap reached, or would breach the reserve → keep for later.
    if (!asset || !validAccountName(entry.account) || want < dustMin) { errors.push(`${entry && entry.account}:bad-entry`); continue; }
    if (paid.length >= max || balance == null || (balance - reserve) < want) { remaining.push(entry); continue; }
    try {
      const r = await deps.transfer({ from, to: entry.account, amount: asset, memo: esc(entry.memo || WELCOME_MEMO) });
      paid.push({ account: entry.account, amount: asset, id: idOf(r) });
      balance -= want; // decrement the local estimate so we never overspend within one run
    } catch (e) {
      errors.push(`${entry.account}:${errMsg(e)}`);
      remaining.push(entry); // keep for a later retry
    }
  }

  await saveQueue(remaining, queuePath);
  return { paid, remaining: remaining.length, balance, errors };
}

// ── CLI (guarded; describe / inspect only — NEVER secrets, keys, or a real broadcast) ─────────────
if (process.argv[1] && process.argv[1].endsWith('welcome-grant-queue.mjs')) {
  const arg = process.argv[2] || '--describe';
  if (arg === '--queue') {
    const q = await loadQueue();
    console.log(`welcome-grant queue (${WELCOME_QUEUE_PATH}): ${q.length} pending`);
    for (const e of q) console.log(`  @${e.account}: ${e.asset} (${e.reason}, queued ${new Date(e.queuedAt || 0).toISOString()})`);
  } else if (arg === '--sample') {
    // Dry-run with STUB deps (no chain, no keys). Hathor is "broke" → grant skips + queues.
    const stub = {
      delegate: async ({ to }) => ({ id: `dry-delegate-${to}` }),
      transfer: async ({ to }) => ({ id: `dry-transfer-${to}` }),
      pingWelcome: async ({ account }) => ({ id: `dry-ping-${account}` }),
      getLiquidBalance: async () => 0, // no liquid exists chain-wide
    };
    const out = await welcomeWithGrant('newbie-tests', stub, { grant: 7, queue: false });
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('welcome-grant-queue: guaranteed POWER delegation now, liquid grant when affordable,');
    console.log('deferred (queued) grant when Hathor holds no liquid; fulfillQueuedGrants() drains it later.');
    console.log('usage: node signup/welcome-grant-queue.mjs [--describe|--sample|--queue]');
  }
}
