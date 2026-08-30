// wmelek-relayer-runner.mjs — the live MELEK L1 -> MELEK-Engine WMELEK relayer DAEMON loop.
//
// This is the SERVICE that drives the engine mint: it reads the custody account's L1
// history, derives finalized deposits, and for each new one broadcasts a bridge.mintWrapped
// custom_json (signed by the bridge account, @hathor) through MELEK-Signer. WMELEK mints on
// the engine; the depositor (or their memo'd recipient) can then forever-lock it -> APIS-Hash.
//
// It builds on the PURE derivation library in ./wmelek-relayer.mjs (scanDeposits, deriveDeposit,
// isFinal, buildMintOp, planMint). This file adds the LOOP, the MELEK-RPC read, the resumable
// last-processed-block cursor, idempotent dedupe, and the SUBMIT step.
//
// BOUNDARIES (house style + BRIEF.md §7 + HARD rule "all witness tx via MELEK-Signer"):
//   - Injectable fetch (`__setFetch`) for the MELEK read; tests run fully offline.
//   - Injectable submit (`submit(op, deposit)`) for the broadcast; this module SIGNS nothing and
//     imports NO signer here. In production the submit fn is the MELEK-Signer client (scoped,
//     revocable bearer token) — that lives at the edge in the daemon, behind the injectable.
//     Tests pass a fake that records ops.
//   - Soft-fail-never-throw: every step returns a safe shape; the loop never crashes on one bad
//     deposit or a broadcast error.
//   - Idempotent + resumable: a depositRef this instance already broadcast is never re-broadcast
//     (client-side seen-set), and a lastBlock cursor advances so restarts don't re-scan the world.
//     bridge.mintWrapped is ALSO idempotent per depositRef, so a double-broadcast can never
//     double-mint — this is belt-and-braces.
//
//   import { runOnce, makeRunner, fetchHistory, normalizeHistory, loadConfig,
//            __setFetch } from './wmelek-relayer-runner.mjs'
//   node integrations/wmelek-relayer-runner.mjs        # print runner config (env names only)

import {
  scanDeposits, isFinal, buildMintOp,
  MELEK_RPC_ENV, CUSTODY_ACCOUNT_ENV, DEFAULT_CUSTODY_ACCOUNT,
} from './wmelek-relayer.mjs';
import { config } from '../engine/config.mjs';

// ---- injectable fetch (parity with the rest of integrations/) --------------
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- env names (NAMES only — never a secret in code) -----------------------
export const CONFIRMATIONS_ENV = 'CONFIRMATIONS';
export const HISTORY_LIMIT_ENV = 'WMELEK_HISTORY_LIMIT';
const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

/**
 * Read config from env (NAMES resolved to values here, at the edge). Returns a plain object;
 * never throws. The bridge account + sidechainId come from engine/config (single source of
 * truth — NET=mainnet gives sidechainId `mse-mainnet-melek`, bridge account `hathor`).
 * @returns {{melekRpc,custody,bridgeAccount,sidechainId,confirmations,historyLimit,timeoutMs}}
 */
export function loadConfig(env = process.env) {
  const get = (n) => (env[n] != null ? String(env[n]).trim() : '');
  const confirmations = parseInt(get(CONFIRMATIONS_ENV), 10);
  const historyLimit = parseInt(get(HISTORY_LIMIT_ENV), 10);
  return {
    melekRpc: get(MELEK_RPC_ENV),
    custody: get(CUSTODY_ACCOUNT_ENV) || DEFAULT_CUSTODY_ACCOUNT,
    bridgeAccount: (config.bridge && config.bridge.account) || '',
    sidechainId: config.sidechainId || '',
    confirmations: Number.isFinite(confirmations) && confirmations > 0 ? confirmations : 20,
    historyLimit: Number.isFinite(historyLimit) && historyLimit > 0 ? Math.min(historyLimit, 1000) : 200,
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
 * not-yet-seen ones -> broadcast bridge.mintWrapped for each via the injected `submit`. Pure
 * orchestration over the derivation library; never throws.
 *
 * @param {object} cfg  from loadConfig (melekRpc, custody, bridgeAccount, sidechainId, confirmations, ...)
 * @param {(op:object, deposit:object)=>Promise<any>|any} submit  the MELEK-Signer broadcast (edge).
 *        Receives the UNSIGNED custom_json mint op + the deposit; returns/throws freely.
 * @param {object} [ctx]  loop state. ctx.seen: Set<string> of already-broadcast depositRefs
 *        (created if absent; mutated in place so it persists across runs). ctx.lastBlock: highest
 *        L1 block whose deposits are all handled (advanced for resumability).
 * @returns {Promise<{ok, headBlock, lastBlock, submitted:object[], skipped:object[],
 *                     failed:object[], pending:object[], reason?:string}>}
 */
export async function runOnce(cfg, submit, ctx = {}) {
  const seen = ctx.seen instanceof Set ? ctx.seen : (ctx.seen = new Set());
  if (typeof ctx.lastBlock !== 'number') ctx.lastBlock = 0;
  const submitted = [], failed = [], pending = [];

  if (typeof submit !== 'function') {
    return { ok: false, headBlock: null, lastBlock: ctx.lastBlock, submitted, skipped: [], failed, pending, reason: 'no-submit-fn' };
  }

  const read = await fetchHistory(cfg);
  if (!read.ok) {
    return { ok: false, headBlock: read.headBlock, lastBlock: ctx.lastBlock, submitted, skipped: [], failed, pending, reason: read.reason };
  }

  const { deposits, skipped } = scanDeposits(read.history, { custodyAccount: cfg.custody });
  let maxFinalizedBlock = ctx.lastBlock;

  for (const dep of deposits) {
    // finality gate first — never mint before the confirmation depth (reorg safety)
    if (!isFinal(dep, read.headBlock, cfg.confirmations)) {
      pending.push({ ref: dep.depositRef, reason: 'awaiting-confirmations' });
      continue;
    }
    // idempotent: this instance never re-broadcasts a ref it already broadcast
    if (seen.has(dep.depositRef)) {
      skipped.push({ ref: dep.depositRef, reason: 'already-broadcast-by-this-instance' });
      if (typeof dep.blockNum === 'number' && dep.blockNum > maxFinalizedBlock) maxFinalizedBlock = dep.blockNum;
      continue;
    }
    const built = buildMintOp(dep, { bridgeAccount: cfg.bridgeAccount, sidechainId: cfg.sidechainId });
    if (!built.ok) {
      skipped.push({ ref: dep.depositRef, reason: built.reason });
      continue;
    }
    try {
      const result = await submit(built.op, dep);
      seen.add(dep.depositRef);   // mark seen only AFTER a successful broadcast
      if (typeof dep.blockNum === 'number' && dep.blockNum > maxFinalizedBlock) maxFinalizedBlock = dep.blockNum;
      submitted.push({ ref: dep.depositRef, recipient: dep.recipient, amount: dep.amount, result });
    } catch (e) {
      // soft-fail: record it, leave the ref UNSEEN so the next pass retries it
      failed.push({ ref: dep.depositRef, reason: String(e && e.message || e) });
    }
  }

  // advance the resumable cursor only when nothing at/below is still failing/pending
  if (!failed.length && !pending.length && maxFinalizedBlock > ctx.lastBlock) ctx.lastBlock = maxFinalizedBlock;

  return { ok: true, headBlock: read.headBlock, lastBlock: ctx.lastBlock, submitted, skipped, failed, pending };
}

/**
 * Build a long-lived runner that keeps a persistent seen-set + lastBlock cursor across passes.
 * Returns { tick, seen, config }. `tick()` runs one pass; the seen-set + cursor survive between
 * ticks so a given depositRef is broadcast at most once per process lifetime.
 * @param {(op,deposit)=>any} submit  the MELEK-Signer broadcast (edge)
 * @param {object} [cfg]  defaults to loadConfig()
 */
export function makeRunner(submit, cfg = loadConfig()) {
  const ctx = { seen: new Set(), lastBlock: 0 };
  return {
    config: cfg,
    seen: ctx.seen,
    get lastBlock() { return ctx.lastBlock; },
    tick: () => runOnce(cfg, submit, ctx),
  };
}

// ---- manifest / CLI --------------------------------------------------------

/** Config manifest — env presence as booleans, never the secret values. */
export function runnerManifest(env = process.env) {
  const cfg = loadConfig(env);
  const present = (n) => !!(env[n] && String(env[n]).trim());
  return {
    role: 'MELEK L1 -> engine WMELEK relayer DAEMON (broadcasts bridge.mintWrapped via MELEK-Signer)',
    drives: 'custom_json { contractName:bridge, contractAction:mintWrapped } signed by the bridge account',
    net: cfg.sidechainId,
    bridgeAccount: cfg.bridgeAccount,
    custody: cfg.custody,
    confirmations: cfg.confirmations,
    historyLimit: cfg.historyLimit,
    env: {
      [MELEK_RPC_ENV]: !!cfg.melekRpc,
      [CUSTODY_ACCOUNT_ENV]: present(CUSTODY_ACCOUNT_ENV),
      [CONFIRMATIONS_ENV]: cfg.confirmations,
    },
    ready: !!(cfg.melekRpc && cfg.custody && cfg.bridgeAccount && cfg.sidechainId),
    boundary: 'injectable fetch (MELEK read) + injectable submit (MELEK-Signer broadcast); SIGNS nothing in this module',
  };
}

if (process.argv[1] && process.argv[1].endsWith('wmelek-relayer-runner.mjs')) {
  process.stdout.write(JSON.stringify(runnerManifest(), null, 2) + '\n');
}
