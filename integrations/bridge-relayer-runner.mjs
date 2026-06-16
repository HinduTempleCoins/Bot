// bridge-relayer-runner.mjs — the live MELEK -> PRANA attester DAEMON (BI8).
//
// This is the SERVICE that drives the proven on-chain mint: 2-of-3 distinct attesters
// each call GrapheneDepositBridge.attestDeposit(depositRef, tokenId, recipient, amount)
// and wMELEK mints once the threshold is reached. ONE relayer instance == ONE attester key.
// Run K instances (one per key) to cover the threshold — see BRIDGE_RUNBOOK.md.
//
// It builds on the PURE derivation library in ./bridge-relayer.mjs (scanDeposits,
// deriveDeposit, parseDestination, scaleAmount, isFinal, attestationCall). This file adds
// the LOOP, the MELEK-RPC read, idempotent dedupe, and the SUBMIT step.
//
// BOUNDARIES (house style + BRIEF.md §7):
//   - Injectable fetch (`__setFetch`) for the MELEK read; tests run fully offline.
//   - Injectable submit (`submit(call)`) for the PRANA write; this module SIGNS nothing and
//     hardcodes NO ethers. In production the submit fn is an ethers wallet (THIS instance's
//     attester key from env) calling the public PRANA RPC — that lives at the edge, behind
//     the injectable. Tests pass a fake that records calls.
//   - Soft-fail-never-throw: every step returns a safe shape; the loop never crashes the
//     daemon on one bad deposit or a submit error.
//   - Idempotent: a depositRef this instance has already submitted is never re-submitted
//     (client-side seen-set), independent of the contract's own AlreadyAttested revert.
//
//   import { runOnce, makeRunner, fetchHistory, normalizeHistory, loadConfig,
//            __setFetch } from './bridge-relayer-runner.mjs'
//   node integrations/bridge-relayer-runner.mjs        # print runner config (env names only)

import {
  scanDeposits, isFinal, attestationCall,
  MELEK_RPC_ENV, PRANA_RPC_ENV, BRIDGE_ADDRESS_ENV, CUSTODY_ACCOUNT_ENV,
} from './bridge-relayer.mjs';

// ---- injectable fetch (parity with the rest of integrations/) --------------
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- env names (NAMES only — never a secret in code) -----------------------
export const ATTESTER_KEY_ENV = 'PRANA_ATTESTER_KEY';   // THIS instance's attester private key
export const CONFIRMATIONS_ENV = 'CONFIRMATIONS';
export const TOKEN_ID_ENV = 'BRIDGE_TOKEN_ID';          // keccak256("MELEK"); defaultTokenId
export const HISTORY_LIMIT_ENV = 'BRIDGE_HISTORY_LIMIT';
const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

/**
 * Read config from env (NAMES resolved to values here, at the edge). Returns a plain object;
 * never throws. `keyPresent` is a boolean only — the key value never leaves this function.
 * @returns {{melekRpc,pranaRpc,bridgeAddress,custody,tokenId,confirmations,historyLimit,keyPresent,timeoutMs}}
 */
export function loadConfig(env = process.env) {
  const get = (n) => (env[n] != null ? String(env[n]).trim() : '');
  const confirmations = parseInt(get(CONFIRMATIONS_ENV), 10);
  const historyLimit = parseInt(get(HISTORY_LIMIT_ENV), 10);
  return {
    melekRpc: get(MELEK_RPC_ENV),
    pranaRpc: get(PRANA_RPC_ENV),
    bridgeAddress: get(BRIDGE_ADDRESS_ENV),
    custody: get(CUSTODY_ACCOUNT_ENV),
    tokenId: get(TOKEN_ID_ENV) || undefined,
    confirmations: Number.isFinite(confirmations) && confirmations > 0 ? confirmations : 20,
    historyLimit: Number.isFinite(historyLimit) && historyLimit > 0 ? Math.min(historyLimit, 1000) : 200,
    keyPresent: !!get(ATTESTER_KEY_ENV),
    timeoutMs: +(env.CHAIN_TIMEOUT_MS || 12000),
  };
}

// ---- MELEK RPC read (the only network, behind the injectable fetch) --------

/** One Graphene JSON-RPC call against the MELEK node. Throws on transport/RPC error. */
async function rpc(node, method, params, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await _fetch(node, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (j && j.error) throw new Error(j.error.message || 'rpc error');
    return j ? j.result : undefined;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Normalize raw condenser_api.get_account_history rows into the entry shape scanDeposits wants.
 * Each raw row is [seq, { trx_id, block, timestamp, op:[type, data] }]. We flatten op into
 * { type, ...data } so deriveDeposit's parseDepositIntent sees a single op object.
 * @param {Array} rows
 * @returns {{trxId, blockNum, seq, op:{type,...}}[]}
 */
export function normalizeHistory(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [seq, rec] = row;
    if (!rec || !Array.isArray(rec.op) || rec.op.length < 2) continue;
    const [type, data] = rec.op;
    out.push({
      trxId: rec.trx_id || rec.transaction_id || `${seq}`,
      blockNum: rec.block || rec.block_num || null,
      seq,
      op: { type, ...(data && typeof data === 'object' ? data : {}) },
    });
  }
  return out;
}

/**
 * Fetch + normalize the custody account's recent history and the current head block.
 * Soft-fails to a safe empty shape on any error.
 * @param {object} cfg  from loadConfig
 * @returns {Promise<{ok:boolean, history:any[], headBlock:number|null, reason?:string}>}
 */
export async function fetchHistory(cfg) {
  if (!cfg || !cfg.melekRpc) return { ok: false, history: [], headBlock: null, reason: 'no-melek-rpc' };
  if (!cfg.custody) return { ok: false, history: [], headBlock: null, reason: 'no-custody-account' };
  try {
    const props = await rpc(cfg.melekRpc, 'condenser_api.get_dynamic_global_properties', [], cfg.timeoutMs);
    // reorg-safe head: prefer the last irreversible block when the node reports it
    const headBlock = (props && (props.last_irreversible_block_num || props.head_block_number)) || null;
    const rows = await rpc(
      cfg.melekRpc, 'condenser_api.get_account_history',
      [cfg.custody, -1, cfg.historyLimit], cfg.timeoutMs,
    );
    return { ok: true, history: normalizeHistory(rows), headBlock };
  } catch (e) {
    return { ok: false, history: [], headBlock: null, reason: String(e && e.message || e) };
  }
}

// ---- the loop body ---------------------------------------------------------

/**
 * Run ONE pass of the relayer: read custody history -> scan deposits -> keep only finalized,
 * not-yet-seen ones -> submit attestDeposit for each via the injected `submit`. Pure
 * orchestration over the derivation library; never throws.
 *
 * @param {object} cfg  from loadConfig (melekRpc, custody, tokenId, confirmations, ...)
 * @param {(call:object, deposit:object)=>Promise<any>|any} submit  THIS instance's signer/sender.
 *        Receives the UNSIGNED attestationCall descriptor + the deposit; returns/throws freely.
 * @param {object} [ctx]  loop state. ctx.seen: Set<string> of already-submitted depositRefs
 *        (created if absent; mutated in place so it persists across runs of the same runner).
 * @returns {Promise<{ok, headBlock, submitted:object[], skipped:object[], failed:object[],
 *                     pending:object[], reason?:string}>}
 */
export async function runOnce(cfg, submit, ctx = {}) {
  const seen = ctx.seen instanceof Set ? ctx.seen : (ctx.seen = new Set());
  const submitted = [], failed = [], pending = [];

  if (typeof submit !== 'function') {
    return { ok: false, headBlock: null, submitted, skipped: [], failed, pending, reason: 'no-submit-fn' };
  }

  const read = await fetchHistory(cfg);
  if (!read.ok) {
    return { ok: false, headBlock: read.headBlock, submitted, skipped: [], failed, pending, reason: read.reason };
  }

  const { deposits, skipped } = scanDeposits(read.history, {
    custodyAccount: cfg.custody,
    defaultTokenId: cfg.tokenId,
  });

  for (const dep of deposits) {
    // finality gate first — never attest before the confirmation depth (reorg safety)
    if (!isFinal(dep, read.headBlock, cfg.confirmations)) {
      pending.push({ ref: dep.depositRef, reason: 'awaiting-confirmations' });
      continue;
    }
    // idempotent: this instance never re-submits a ref it already submitted
    if (seen.has(dep.depositRef)) {
      skipped.push({ ref: dep.depositRef, reason: 'already-submitted-by-this-instance' });
      continue;
    }
    const call = attestationCall(dep);
    try {
      const result = await submit(call, dep);
      seen.add(dep.depositRef);   // mark seen only AFTER a successful submit
      submitted.push({ ref: dep.depositRef, recipient: dep.recipient, amount: dep.amount, tokenId: dep.tokenId, result });
    } catch (e) {
      // soft-fail: log the failure, leave the ref UNSEEN so the next pass retries it
      failed.push({ ref: dep.depositRef, reason: String(e && e.message || e) });
    }
  }

  return { ok: true, headBlock: read.headBlock, submitted, skipped, failed, pending };
}

/**
 * Build a long-lived runner that keeps a persistent seen-set across passes. Returns
 * { tick, seen, config }. `tick()` runs one pass; the seen-set survives between ticks so a
 * given depositRef is submitted at most once per process lifetime.
 * @param {(call,deposit)=>any} submit  THIS instance's signer/sender
 * @param {object} [cfg]  defaults to loadConfig()
 */
export function makeRunner(submit, cfg = loadConfig()) {
  const ctx = { seen: new Set() };
  return {
    config: cfg,
    seen: ctx.seen,
    tick: () => runOnce(cfg, submit, ctx),
  };
}

// ---- manifest / CLI --------------------------------------------------------

/** Config manifest — env presence as booleans, never the secret values. */
export function runnerManifest(env = process.env) {
  const cfg = loadConfig(env);
  return {
    role: 'MELEK->PRANA attester DAEMON (one instance = one attester key; run K of N)',
    drives: 'GrapheneDepositBridge.attestDeposit(depositRef, tokenId, recipient, amount)',
    confirmations: cfg.confirmations,
    historyLimit: cfg.historyLimit,
    env: {
      [MELEK_RPC_ENV]: !!cfg.melekRpc,
      [PRANA_RPC_ENV]: !!cfg.pranaRpc,
      [BRIDGE_ADDRESS_ENV]: !!cfg.bridgeAddress,
      [CUSTODY_ACCOUNT_ENV]: !!cfg.custody,
      [TOKEN_ID_ENV]: !!cfg.tokenId,
      [CONFIRMATIONS_ENV]: cfg.confirmations,
      [ATTESTER_KEY_ENV]: cfg.keyPresent,   // boolean only — the key never appears here
    },
    ready: !!(cfg.melekRpc && cfg.pranaRpc && cfg.bridgeAddress && cfg.custody && cfg.keyPresent),
    boundary: 'injectable fetch (MELEK read) + injectable submit (PRANA write); SIGNS nothing in this module',
  };
}

if (process.argv[1] && process.argv[1].endsWith('bridge-relayer-runner.mjs')) {
  process.stdout.write(JSON.stringify(runnerManifest(), null, 2) + '\n');
}
