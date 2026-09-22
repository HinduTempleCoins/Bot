// wmelek-relayer-runner.mjs — the live MELEK L1 -> MELEK-Engine WMELEK relayer DAEMON loop.
//
// This is the SERVICE that drives the engine mint: it reads the custody account's L1
// deposits, derives finalized ones, and for each new one broadcasts a bridge.mintWrapped
// custom_json (signed by the bridge account, @hathor) through MELEK-Signer. WMELEK mints on
// the engine; the depositor (or their memo'd recipient) can then forever-lock it -> APIS-Hash.
//
// ── WHY THIS FILE WAS REWRITTEN (the #1 MELEK->APIS blocker) ────────────────────────────────
// The relayer used to read deposits with condenser_api.get_account_history(wmelek-bridge). On
// MELEK mainnet that plugin returns ZERO rows for EVERY account (hathor and initminer included,
// not just new accounts) — the account_history plugin is simply not populated on this Steem fork.
// So the relayer was BLIND: real MELEK deposited into the wmelek-bridge custody moved on-chain,
// the chain held the funds, and get_account_history reported nothing — no WMELEK was ever minted
// and the depositor's MELEK was stranded. An empty INDEX is not the same fact as an empty CHAIN;
// treating them as equal is what made the failure invisible.
//
// THE FIX: read the chain, not an index of it. We BLOCK-SCAN — walk L1 blocks with
// condenser_api.get_block (core, needs no plugin), filter `transfer` ops addressed TO custody,
// and derive {from, amount, memo, tx_id, block}. This is the same route the sibling PRANA
// attester (bridge-relayer-runner.mjs) already had to adopt against this identical chain quirk.
//
// It builds on the PURE derivation library in ./wmelek-relayer.mjs (scanDeposits, deriveDeposit,
// isFinal, buildMintOp, planMint). This file adds the LOOP, the MELEK-RPC read (block-scan),
// the PERSISTENT resumable cursor + processed-set (survives restarts -> never double-mint), and
// the SUBMIT step.
//
// BOUNDARIES (house style + BRIEF.md §7 + HARD rule "all witness tx via MELEK-Signer"):
//   - Injectable fetch (`__setFetch`) for the MELEK read; tests run fully offline.
//   - Injectable submit (`submit(op, deposit)`) for the broadcast; this module SIGNS nothing and
//     imports NO signer here. In production the submit fn is the MELEK-Signer client (scoped,
//     revocable bearer token) — that lives at the edge in the daemon, behind the injectable.
//     Tests pass a fake that records ops. ZERO-WIF is preserved: no key/WIF ever lives here.
//   - Soft-fail-never-throw: every step returns a safe shape; the loop never crashes on one bad
//     deposit, a broadcast error, or an RPC error.
//   - Idempotent + resumable ACROSS RESTARTS: the processed-set (depositRefs already broadcast)
//     and the block cursor are PERSISTED to an injectable store (JSON file by default). A restart
//     reloads them, so a tx already minted is never re-broadcast and the scan resumes above the
//     cursor rather than re-walking the world. bridge.mintWrapped is ALSO idempotent per
//     depositRef on-chain, so even a lost store can never double-mint — belt-and-braces.
//
// ── RECIPIENT / MEMO CONVENTION (who gets the WMELEK) ───────────────────────────────────────
// The recipient is taken ONLY from the signed L1 transfer (never inferred, so the relayer can't
// redirect minted WMELEK): the transfer MEMO names the engine account to credit; a BLANK memo
// credits the depositor themselves (the transfer's `from`). A non-blank memo that is not a valid
// account name fails CLOSED (skipped, not silently credited to `from`). This lives in
// wmelek-relayer.mjs parseRecipient(); documented here because it decides where value lands.
//
// ── 1:1 BACKING INVARIANT ───────────────────────────────────────────────────────────────────
// MELEK L1 native is 3dp and engine WMELEK is 3dp, so the mint amount == the deposited amount,
// passed through with no scaling. We never mint more than was custodied: one mint per L1 deposit
// tx, amount == the transfer amount, and bridge.mintWrapped is idempotent per depositRef.
//
//   import { runOnce, makeRunner, fetchDeposits, fetchByBlocks, normalizeBlocks, fetchHistory,
//            normalizeHistory, loadConfig, MemoryCursorStore, FileCursorStore,
//            __setFetch } from './wmelek-relayer-runner.mjs'
//   node integrations/wmelek-relayer-runner.mjs        # print runner config (env names only)

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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
export const STATE_FILE_ENV = 'WMELEK_RELAYER_STATE';   // JSON cursor+processed-set store path
export const SCAN_WINDOW_ENV = 'WMELEK_SCAN_WINDOW';     // first-run look-back depth (blocks)
export const SCAN_BATCH_ENV = 'WMELEK_SCAN_BATCH';       // get_block calls issued in parallel
export const MAX_PER_TICK_ENV = 'WMELEK_MAX_BLOCKS_PER_TICK'; // cap blocks scanned per tick (catch-up)
const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// Cap on the persisted processed-set. Deposits into a bridge custody are low-frequency, but the
// set must not grow without bound over the daemon's life. The cursor only ever advances, and each
// tick scans ABOVE the cursor, so a ref older than the cursor cannot reappear on the normal path;
// evicting the oldest here is therefore safe, and bridge.mintWrapped's on-chain per-ref idempotency
// backstops even a deep reorg below the cursor. Sets preserve insertion order, so eviction is FIFO.
const SEEN_MAX = 20000;

/**
 * Read config from env (NAMES resolved to values here, at the edge). Returns a plain object;
 * never throws. The bridge account + sidechainId come from engine/config (single source of
 * truth — NET=mainnet gives sidechainId `mse-mainnet-melek`, bridge account `hathor`).
 * @returns {{melekRpc,custody,bridgeAccount,sidechainId,confirmations,historyLimit,
 *            stateFile,scanWindow,scanBatch,maxBlocksPerTick,timeoutMs}}
 */
export function loadConfig(env = process.env) {
  const get = (n) => (env[n] != null ? String(env[n]).trim() : '');
  const posInt = (n, dflt, cap = Infinity) => {
    const v = parseInt(get(n), 10);
    return Number.isFinite(v) && v > 0 ? Math.min(v, cap) : dflt;
  };
  return {
    melekRpc: get(MELEK_RPC_ENV),
    custody: get(CUSTODY_ACCOUNT_ENV) || DEFAULT_CUSTODY_ACCOUNT,
    bridgeAccount: (config.bridge && config.bridge.account) || '',
    sidechainId: config.sidechainId || '',
    confirmations: posInt(CONFIRMATIONS_ENV, 20),
    historyLimit: posInt(HISTORY_LIMIT_ENV, 200, 1000),
    stateFile: get(STATE_FILE_ENV) || './data/wmelek-relayer/state.json',
    scanWindow: posInt(SCAN_WINDOW_ENV, 2000, 100000),
    scanBatch: posInt(SCAN_BATCH_ENV, 25, 100),
    maxBlocksPerTick: posInt(MAX_PER_TICK_ENV, 5000, 100000),
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

/** Read the current reorg-safe head — prefer the last irreversible block over the head number. */
async function readHead(cfg) {
  const props = await rpc(cfg.melekRpc, 'condenser_api.get_dynamic_global_properties', [], cfg.timeoutMs);
  return (props && (props.last_irreversible_block_num || props.head_block_number)) || null;
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
 * Normalize transfers found by walking BLOCKS into the same entry shape scanDeposits wants.
 * This is the RELIABLE deposit-detection path (get_account_history is empty on this fork).
 * A transfer's tx id is the deterministic depositRef; block+index give a stable fallback id.
 * @param {Array} blocks   raw get_block results (each stamped with block_num)
 * @param {string} custody account to match on the transfer's `to`
 * @returns {{trxId, blockNum, seq, op:{type,...}}[]}
 */
export function normalizeBlocks(blocks, custody) {
  const want = String(custody || '').toLowerCase();
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const num = (b && (b.block_num || b.num)) || null;
    const txs = (b && b.transactions) || [];
    const ids = (b && b.transaction_ids) || [];
    txs.forEach((tx, ti) => {
      for (const op of (tx && tx.operations) || []) {
        // Ops arrive as ["transfer", {...}] on condenser, or {type:"transfer_operation", value:{}}.
        let type = null, data = null;
        if (Array.isArray(op) && op.length >= 2) { type = op[0]; data = op[1]; }
        else if (op && op.type) { type = String(op.type).replace(/_operation$/, ''); data = op.value; }
        if (type !== 'transfer' || !data) continue;
        if (String(data.to || '').toLowerCase() !== want) continue;
        out.push({
          trxId: ids[ti] || `${num}:${ti}`,
          blockNum: num,
          seq: `${num}:${ti}`,
          op: { type, ...data },
        });
      }
    });
  }
  return out;
}

/**
 * Fetch + normalize the custody account's recent history via the account_history plugin.
 * Kept as an OPPORTUNISTIC first-try (cheap when a node happens to serve it); on MELEK mainnet
 * it returns [] and the caller falls through to block-scanning. Soft-fails to a safe empty shape.
 * @param {object} cfg  from loadConfig
 * @returns {Promise<{ok:boolean, history:any[], headBlock:number|null, reason?:string}>}
 */
export async function fetchHistory(cfg) {
  if (!cfg || !cfg.melekRpc) return { ok: false, history: [], headBlock: null, reason: 'no-melek-rpc' };
  if (!cfg.custody) return { ok: false, history: [], headBlock: null, reason: 'no-custody-account' };
  try {
    const headBlock = await readHead(cfg);
    const rows = await rpc(
      cfg.melekRpc, 'condenser_api.get_account_history',
      [cfg.custody, -1, cfg.historyLimit], cfg.timeoutMs,
    );
    return { ok: true, history: normalizeHistory(rows), headBlock };
  } catch (e) {
    return { ok: false, history: [], headBlock: null, reason: String((e && e.message) || e) };
  }
}

/**
 * Block-scan the custody account's deposits. Reads a bounded window of L1 blocks and extracts
 * every native transfer addressed to custody. Resumes ABOVE the cursor (`fromBlock`) so a restart
 * does not re-walk the chain, and never scans past the reorg-safe head. Soft-fails to a safe shape.
 *
 * This fork serves condenser_api.get_block but NOT block_api.get_block_range (the live node answers
 * "Could not find method get_block_range" — verified by the sibling PRANA attester), so we issue one
 * get_block per block in bounded-parallel batches; a window of a few thousand blocks is seconds.
 *
 * @param {object} cfg  from loadConfig
 * @param {{fromBlock?:number}} [opts]  fromBlock: cursor+1 (else first-run look-back window is used)
 * @returns {Promise<{ok:boolean, history:any[], headBlock:number|null, scannedTo:number|null, reason?:string}>}
 */
export async function fetchByBlocks(cfg, { fromBlock = 0 } = {}) {
  if (!cfg || !cfg.melekRpc) return { ok: false, history: [], headBlock: null, scannedTo: null, reason: 'no-melek-rpc' };
  if (!cfg.custody) return { ok: false, history: [], headBlock: null, scannedTo: null, reason: 'no-custody-account' };
  try {
    const headBlock = await readHead(cfg);
    if (!headBlock) return { ok: false, history: [], headBlock: null, scannedTo: null, reason: 'no-head' };

    const window = cfg.scanWindow || 2000;
    const batch = cfg.scanBatch || 25;
    const maxPerTick = cfg.maxBlocksPerTick || 5000;

    // Where to start: just above the cursor, else a bounded look-back on the first run.
    let from = fromBlock > 0 ? fromBlock : Math.max(1, headBlock - window + 1);
    if (from > headBlock) return { ok: true, history: [], headBlock, scannedTo: fromBlock > 0 ? fromBlock - 1 : headBlock };
    // Cap the span scanned this tick so a huge backlog catches up over several ticks (bounded work).
    const to = Math.min(headBlock, from + maxPerTick - 1);

    const history = [];
    for (let start = from; start <= to; start += batch) {
      const nums = [];
      for (let n = start; n < Math.min(start + batch, to + 1); n++) nums.push(n);
      const got = await Promise.all(nums.map(async (n) => {
        try {
          const b = await rpc(cfg.melekRpc, 'condenser_api.get_block', [n], cfg.timeoutMs);
          return b ? { ...b, block_num: n } : null;
        } catch { return null; }   // one unreadable block must not lose the whole window
      }));
      history.push(...normalizeBlocks(got.filter(Boolean), cfg.custody));
    }
    return { ok: true, history, headBlock, scannedTo: to };
  } catch (e) {
    return { ok: false, history: [], headBlock: null, scannedTo: null, reason: String((e && e.message) || e) };
  }
}

/**
 * Read deposits by whichever route the node actually serves. Tries the cheap indexed path first and
 * falls through to BLOCK-SCANNING when it returns nothing — because an empty index is not the same
 * fact as an empty chain, and treating those two as equal is what made this failure invisible.
 * @param {object} cfg  from loadConfig
 * @param {{fromBlock?:number}} [opts]
 */
export async function fetchDeposits(cfg, opts = {}) {
  const viaHistory = await fetchHistory(cfg);
  if (viaHistory.ok && viaHistory.history.length) {
    return { ...viaHistory, scannedTo: null, via: 'account_history' };
  }
  const viaBlocks = await fetchByBlocks(cfg, opts);
  if (viaBlocks.ok) return { ...viaBlocks, via: 'block_scan' };
  // block-scan failed; surface whichever error is more informative
  return viaHistory.ok
    ? { ...viaHistory, scannedTo: null, via: 'account_history' }
    : { ...viaBlocks, via: 'block_scan' };
}

// ---- persistent cursor + processed-set store -------------------------------
// State shape: { cursor:number, seen:string[] }. A store is { read():state|null, write(state) }.
// read() returns a CLEAN empty state when there is no file yet, and null only when the stored data
// is unreadable/corrupt — in which case the runner starts clean (safe: on-chain mint idempotency
// per depositRef means a lost processed-set can never double-mint).

const EMPTY_STATE = () => ({ cursor: 0, seen: [] });

/** In-memory store (per-process; default when no state file is configured / for tests). */
export class MemoryCursorStore {
  constructor() { this._s = null; }
  read() { return this._s; }
  write(state) { try { this._s = JSON.parse(JSON.stringify(state)); } catch { /* best-effort */ } }
}

/** JSON-file store — survives restarts. Atomic temp+rename write; every op soft-fails. */
export class FileCursorStore {
  constructor(path) { this.path = path; }
  read() {
    try {
      if (!existsSync(this.path)) return EMPTY_STATE();   // no file yet = clean start, not a failure
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return null;
      const cursor = Number.isFinite(parsed.cursor) ? parsed.cursor : 0;
      const seen = Array.isArray(parsed.seen) ? parsed.seen.map(String) : [];
      return { cursor, seen };
    } catch {
      return null;   // corrupt -> start clean (on-chain idempotency backstops double-mint)
    }
  }
  write(state) {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(state));
      renameSync(tmp, this.path);
    } catch {
      /* persistence is best-effort — never crash the loop */
    }
  }
}

/** Resolve the store: an explicit store wins; else a file store when a path is set; else memory. */
function resolveStore({ store, stateFile } = {}) {
  if (store && typeof store.read === 'function' && typeof store.write === 'function') return store;
  return stateFile ? new FileCursorStore(stateFile) : new MemoryCursorStore();
}

/** Add a ref to the processed-set with FIFO eviction past SEEN_MAX (Sets keep insertion order). */
function remember(seen, ref) {
  seen.add(ref);
  while (seen.size > SEEN_MAX) {
    const oldest = seen.values().next().value;
    seen.delete(oldest);
  }
}

// ---- the loop body ---------------------------------------------------------

/**
 * Run ONE pass of the relayer: read custody deposits (block-scan) -> keep only finalized,
 * not-yet-seen ones -> broadcast bridge.mintWrapped for each via the injected `submit` -> persist
 * the advanced cursor + processed-set. Pure orchestration over the derivation library; never throws.
 *
 * @param {object} cfg  from loadConfig (melekRpc, custody, bridgeAccount, sidechainId, confirmations, ...)
 * @param {(op:object, deposit:object)=>Promise<any>|any} submit  the MELEK-Signer broadcast (edge).
 *        Receives the UNSIGNED custom_json mint op + the deposit; returns/throws freely.
 * @param {object} [ctx]  loop state. ctx.seen: Set<string> of already-broadcast depositRefs.
 *        ctx.lastBlock: highest L1 block whose deposits are all handled (the resumable scan cursor).
 *        ctx.store: optional persistent store — when present, {cursor,seen} is written each pass.
 * @returns {Promise<{ok, headBlock, lastBlock, via, submitted:object[], skipped:object[],
 *                     failed:object[], pending:object[], reason?:string}>}
 */
export async function runOnce(cfg, submit, ctx = {}) {
  const seen = ctx.seen instanceof Set ? ctx.seen : (ctx.seen = new Set());
  if (typeof ctx.lastBlock !== 'number') ctx.lastBlock = 0;
  const submitted = [], failed = [], pending = [];

  if (typeof submit !== 'function') {
    return { ok: false, headBlock: null, lastBlock: ctx.lastBlock, via: null, submitted, skipped: [], failed, pending, reason: 'no-submit-fn' };
  }

  // Block-scan resumes above the cursor; fetchDeposits tries account_history first but it is empty
  // on this chain, so it falls through to fetchByBlocks. An empty index is not an empty chain.
  const read = await fetchDeposits(cfg, { fromBlock: ctx.lastBlock > 0 ? ctx.lastBlock + 1 : 0 });
  if (!read.ok) {
    return { ok: false, headBlock: read.headBlock, lastBlock: ctx.lastBlock, via: read.via || null, submitted, skipped: [], failed, pending, reason: read.reason };
  }

  const { deposits, skipped } = scanDeposits(read.history, { custodyAccount: cfg.custody });

  for (const dep of deposits) {
    // finality gate first — never mint before the confirmation depth (reorg safety)
    if (!isFinal(dep, read.headBlock, cfg.confirmations)) {
      pending.push({ ref: dep.depositRef, block: dep.blockNum, reason: 'awaiting-confirmations' });
      continue;
    }
    // idempotent: never re-broadcast a ref we already broadcast (persisted across restarts)
    if (seen.has(dep.depositRef)) {
      skipped.push({ ref: dep.depositRef, reason: 'already-broadcast' });
      continue;
    }
    const built = buildMintOp(dep, { bridgeAccount: cfg.bridgeAccount, sidechainId: cfg.sidechainId });
    if (!built.ok) {
      skipped.push({ ref: dep.depositRef, reason: built.reason });
      continue;
    }
    try {
      const result = await submit(built.op, dep);
      remember(seen, dep.depositRef);   // mark seen only AFTER a successful broadcast
      submitted.push({ ref: dep.depositRef, recipient: dep.recipient, amount: dep.amount, result });
    } catch (e) {
      // soft-fail: record it, leave the ref UNSEEN and hold the cursor below it so the next pass retries
      failed.push({ ref: dep.depositRef, block: dep.blockNum, reason: String((e && e.message) || e) });
    }
  }

  // Advance the resumable cursor to the highest block scanned this pass, but never PAST a block that
  // still holds an unhandled (pending or failed) deposit — so those blocks get re-scanned next tick.
  // In block-scan mode `scannedTo` is that ceiling; on the account_history path fall back to the head.
  const ceiling = (typeof read.scannedTo === 'number' && read.scannedTo > 0) ? read.scannedTo : (read.headBlock || 0);
  const blockers = [...pending, ...failed].map((x) => x.block).filter((n) => Number.isFinite(n));
  const cap = blockers.length ? Math.min(...blockers) - 1 : ceiling;
  const nextCursor = Math.max(ctx.lastBlock, Math.min(ceiling, cap));
  if (nextCursor > ctx.lastBlock) ctx.lastBlock = nextCursor;

  // Persist the cursor + processed-set so a restart neither re-mints nor re-walks the chain.
  if (ctx.store && typeof ctx.store.write === 'function') {
    try { ctx.store.write({ cursor: ctx.lastBlock, seen: [...seen] }); } catch { /* best-effort */ }
  }

  return { ok: true, headBlock: read.headBlock, lastBlock: ctx.lastBlock, via: read.via || null, submitted, skipped, failed, pending };
}

/**
 * Build a long-lived runner that keeps a PERSISTENT seen-set + block cursor across passes AND
 * across process restarts (loaded from an injectable store; a JSON file by default). Returns
 * { tick, seen, config, lastBlock }. `tick()` runs one pass; a given depositRef is broadcast at
 * most once ever, and the scan resumes above the persisted cursor.
 * @param {(op,deposit)=>any} submit  the MELEK-Signer broadcast (edge)
 * @param {object} [cfg]  defaults to loadConfig()
 * @param {{store?:object}} [opts]  explicit store (overrides cfg.stateFile); for tests
 */
export function makeRunner(submit, cfg = loadConfig(), { store } = {}) {
  const resolved = resolveStore({ store, stateFile: cfg.stateFile });
  const persisted = (() => { try { return resolved.read(); } catch { return null; } })() || EMPTY_STATE();
  const ctx = {
    seen: new Set(Array.isArray(persisted.seen) ? persisted.seen : []),
    lastBlock: Number.isFinite(persisted.cursor) ? persisted.cursor : 0,
    store: resolved,
  };
  return {
    config: cfg,
    seen: ctx.seen,
    store: resolved,
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
    detection: 'BLOCK-SCAN (condenser_api.get_block) — account_history is empty on this fork; falls back to it only if it ever serves rows',
    net: cfg.sidechainId,
    bridgeAccount: cfg.bridgeAccount,
    custody: cfg.custody,
    confirmations: cfg.confirmations,
    scanWindow: cfg.scanWindow,
    scanBatch: cfg.scanBatch,
    stateFile: cfg.stateFile,
    env: {
      [MELEK_RPC_ENV]: !!cfg.melekRpc,
      [CUSTODY_ACCOUNT_ENV]: present(CUSTODY_ACCOUNT_ENV),
      [CONFIRMATIONS_ENV]: cfg.confirmations,
      [STATE_FILE_ENV]: present(STATE_FILE_ENV) || `(default ${cfg.stateFile})`,
    },
    ready: !!(cfg.melekRpc && cfg.custody && cfg.bridgeAccount && cfg.sidechainId),
    boundary: 'injectable fetch (MELEK read) + injectable submit (MELEK-Signer broadcast); SIGNS nothing, holds NO WIF in this module',
  };
}

if (process.argv[1] && process.argv[1].endsWith('wmelek-relayer-runner.mjs')) {
  process.stdout.write(JSON.stringify(runnerManifest(), null, 2) + '\n');
}
