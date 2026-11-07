// bridge-withdrawal-runner.mjs — the PRANA->MELEK withdrawal leg watcher (pure + injectable edges).
//
// THE FLOW (reverse of bridge-relayer deposit leg):
//   1. A holder burns wrapped supply on PRANA: GrapheneDepositBridge.withdraw(tokenId, amount, destinationRef)
//      pulls + burns the wrapper and emits GrapheneWithdrawal(nonce, tokenId, from, wrapped, amount, destRef).
//      `destinationRef` = the MELEK account name encoded as a bytes32 string (ethers.encodeBytes32String).
//   2. K-of-N off-chain relayers watch that event and RELEASE native MELEK from the bridge custody account
//      to that MELEK account — once per nonce, after a deep PRANA confirmation (young PoW can reorg).
//
// This module is the PURE watcher: eth_getLogs over an injected fetch, decode the event, decode the
// destination account, scale the wrapped (18dp) amount down to native MELEK (3dp), and build the standard
// Graphene `transfer` op. It SIGNS NOTHING — the host injects a broadcaster that holds the custody key
// (zero-WIF-in-module, exactly like witness/welcomer.mjs). Idempotent per nonce. Soft-fail, never throws.
//
// Reuses parseWithdrawal/planRelease from bridge-relayer.mjs for the canonical parse + once-per-nonce plan.

import { parseWithdrawal, planRelease } from './bridge-relayer.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

let _fetch = (...a) => globalThis.fetch(...a);
/** Swap the fetch impl (tests inject a fake; no arg restores the global). */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// GrapheneWithdrawal(uint256 nonce, bytes32 tokenId, address from, address wrapped, uint256 amount, bytes32 destinationRef)
// indexed: nonce(topic1), tokenId(topic2), from(topic3); data: wrapped(32) ‖ amount(32) ‖ destinationRef(32)
export const WITHDRAWAL_TOPIC0 =
  '0x5fd45b4e51cfde38d8e390703ec4d5cf37cd26c19c5fc7f2348f77728c950e10';

const WRAPPER_DECIMALS = 18;
const MELEK_NATIVE_DECIMALS = 3;

function toBigSafe(v) { try { return BigInt(v); } catch { return null; } }
function hexField(data, i) { const h = data.replace(/^0x/, ''); return '0x' + h.slice(i * 64, i * 64 + 64); }
function addrFromTopic(t) { return typeof t === 'string' && t.length >= 42 ? '0x' + t.slice(-40).toLowerCase() : null; }

/** Decode a raw GrapheneWithdrawal log {topics,data} into the same shape parseWithdrawal accepts. */
export function decodeWithdrawalLog(log) {
  if (!log || !Array.isArray(log.topics) || log.topics.length < 4) return null;
  if (log.topics[0] && log.topics[0].toLowerCase() !== WITHDRAWAL_TOPIC0) return null;
  const nonce = toBigSafe(log.topics[1]);
  const amount = toBigSafe(hexField(log.data || '0x', 1));
  if (nonce == null || amount == null) return null;
  return {
    args: {
      nonce: nonce.toString(),
      tokenId: log.topics[2],
      from: addrFromTopic(log.topics[3]),
      wrapped: addrFromTopic(hexField(log.data || '0x', 0)),
      amount: amount.toString(),
      destinationRef: hexField(log.data || '0x', 2),
    },
    blockNumber: log.blockNumber,
  };
}

/** Decode a bytes32-string destinationRef into a MELEK account name (trim trailing zero bytes). */
export function decodeDestination(ref) {
  if (typeof ref !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(ref)) return null;
  let h = ref.slice(2).replace(/(00)+$/,'');           // strip trailing zero bytes
  if (h.length % 2 !== 0) h = h.slice(0, -1);
  let s = '';
  for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  // Graphene account names: lowercase a-z, 0-9, dot, dash; 3..16 chars.
  return /^[a-z][a-z0-9.-]{2,15}$/.test(s) ? s : null;
}

/** Scale a wrapped (18dp) integer amount down to native MELEK (3dp) "X.XXX". Floors sub-milli dust. */
export function scaleDownToNative(wrappedAmount) {
  const a = toBigSafe(wrappedAmount);
  if (a == null || a < 0n) return null;
  const div = 10n ** BigInt(WRAPPER_DECIMALS - MELEK_NATIVE_DECIMALS); // 1e15
  const units = a / div;                 // integer native milli-units
  const dust = a % div;
  const whole = units / 1000n;
  const frac = (units % 1000n).toString().padStart(MELEK_NATIVE_DECIMALS, '0');
  return { amount: `${whole}.${frac}`, dust: dust.toString(), units: units.toString() };
}

export function loadConfig(env = process.env) {
  const num = (v, d) => { const n = +v; return Number.isFinite(n) ? n : d; };
  return Object.freeze({
    pranaRpc: env.PRANA_RPC_URL || '',
    bridgeAddress: env.GRAPHENE_BRIDGE_ADDRESS || '',
    custody: env.MELEK_BRIDGE_CUSTODY || '',
    confirmations: num(env.CONFIRMATIONS, 12),
    // tokenId(bytes32) -> { symbol, kind }. wMELEK releases native TESTS; others noted as engine-side.
    nativeTokenId: (env.BRIDGE_NATIVE_TOKEN_ID || '').toLowerCase(),
    nativeSymbol: env.MELEK_NATIVE_SYMBOL || 'TESTS',
    lookbackBlocks: num(env.WITHDRAWAL_LOOKBACK, 5000),
    // Persistence is ON by default. The released-nonce set used to live only in memory, so every
    // restart re-released every withdrawal inside the lookback window — see ReleasedNonceStore.
    stateFile: env.WITHDRAWAL_STATE_FILE || '/var/lib/melek-bot/bridge-withdrawal-released.json',
  });
}

async function rpc(url, method, params) {
  const res = await _fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'rpc-error');
  return j.result;
}

/** Fetch GrapheneWithdrawal logs + head block. Soft-fails to { ok:false }. */
export async function fetchWithdrawals(cfg) {
  if (!cfg.pranaRpc) return { ok: false, reason: 'no-prana-rpc', logs: [], head: 0 };
  if (!cfg.bridgeAddress) return { ok: false, reason: 'no-bridge-address', logs: [], head: 0 };
  try {
    const headHex = await rpc(cfg.pranaRpc, 'eth_blockNumber', []);
    const head = Number(BigInt(headHex));
    const from = Math.max(0, head - cfg.lookbackBlocks);
    const logs = await rpc(cfg.pranaRpc, 'eth_getLogs', [{
      address: cfg.bridgeAddress,
      topics: [WITHDRAWAL_TOPIC0],
      fromBlock: '0x' + from.toString(16),
      toBlock: 'latest',
    }]);
    return { ok: true, logs: Array.isArray(logs) ? logs : [], head };
  } catch (e) { return { ok: false, reason: String(e && e.message || e), logs: [], head: 0 }; }
}

/** Build the standard Graphene release op tuple. Pure. null if the destination/amount is unusable. */
export function buildReleaseOp(w, cfg) {
  const to = decodeDestination(w.destinationRef);
  if (!to) return null;
  const scaled = scaleDownToNative(w.amount);
  if (!scaled || scaled.units === '0') return null;
  return ['transfer', {
    from: cfg.custody,
    to,
    amount: `${scaled.amount} ${cfg.nativeSymbol}`,
    memo: `MELEK bridge withdrawal #${w.nonce}`,
  }];
}

/**
 * ReleasedNonceStore — the released-nonce set, on disk.
 *
 * WHY THIS EXISTS, because the failure it prevents is the expensive kind. The set used to be a plain
 * in-memory `new Set()` created per process, with no cursor and a 5,000-block rescan every tick. The
 * header said "idempotent per nonce" and the test said "a second tick does not re-release the same
 * nonce" — both true, and both true only WITHIN ONE PROCESS. Restarting the service therefore
 * re-released every withdrawal in the last 5,000 PRANA blocks as real MELEK out of bridge custody.
 *
 * It differs from the wmelek sibling's FileCursorStore in exactly one way, and it is the important
 * one. That store treats corrupt state as a clean start, which is safe there because the deposit leg
 * is backstopped on-chain: a repeat mint reverts with DepositAlreadyProcessed(bytes32). THIS leg
 * broadcasts a plain Graphene `transfer`, and Graphene transfers carry NO duplicate protection — the
 * chain will happily execute the same transfer twice. So here, losing the record means paying
 * everyone again, and the only safe response to "I cannot prove what I already sent" is to send
 * nothing. This store FAILS CLOSED.
 */
export class ReleasedNonceStore {
  constructor(path) { this.path = path; }

  /** Released nonces as an array, [] for a first run, or null when the state cannot be trusted. */
  read() {
    try {
      if (!existsSync(this.path)) return [];      // no file yet is a clean first run, not a failure
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.released)) return null;
      return parsed.released.map(String);
    } catch {
      return null;   // unreadable or corrupt — NOT a clean start, see the class comment
    }
  }

  /** Persist. Returns true only on a durable write; the caller must stop releasing on false. */
  write(released) {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ released: [...released], at: new Date().toISOString() }));
      renameSync(tmp, this.path);   // atomic, so a crash mid-write cannot truncate the record
      return true;
    } catch {
      return false;
    }
  }
}

/** A store that keeps the set in memory only — for tests, and for an explicit opt-out. */
export class MemoryNonceStore {
  constructor(released = []) { this._r = released.map(String); }
  read() { return [...this._r]; }
  write(released) { this._r = [...released].map(String); return true; }
}

/**
 * runOnce — read withdrawals, and for each FINALIZED, native, not-yet-released one, broadcast the
 * release via the injected broadcaster `broadcast(op, {keyType:'active'})`. Idempotent per nonce
 * (ctx.released Set). Soft-fail: a broadcast throw leaves the nonce UNreleased for retry.
 */
export async function runOnce(cfg, broadcast, ctx = {}) {
  if (typeof broadcast !== 'function') return { ok: false, reason: 'no-broadcaster' };
  ctx.released = ctx.released instanceof Set ? ctx.released : new Set();
  // A store whose state we cannot read is NOT a clean start on this leg — releasing now would repay
  // everything inside the lookback window. Refuse the whole tick and say so.
  if (ctx.untrustedState) {
    return { ok: false, reason: 'untrusted-state', released: [], skipped: [], failed: [] };
  }
  const got = await fetchWithdrawals(cfg);
  if (!got.ok) return { ok: false, reason: got.reason, released: [], skipped: [], failed: [] };

  const released = [], skipped = [], failed = [];
  for (const log of got.logs) {
    const ev = decodeWithdrawalLog(log);
    if (!ev) { skipped.push({ reason: 'undecodable' }); continue; }
    const w = parseWithdrawal(ev);
    if (!w.ok) { skipped.push({ reason: w.reason }); continue; }

    // only release the native (wMELEK) tokenId here; other wrappers (e.g. wAPIS) are engine-side
    if (cfg.nativeTokenId && String(w.tokenId).toLowerCase() !== cfg.nativeTokenId) {
      skipped.push({ nonce: w.nonce, reason: 'non-native-token' }); continue;
    }
    const blockNum = ev.blockNumber != null ? Number(BigInt(ev.blockNumber)) : 0;
    const confirmed = blockNum > 0 && (got.head - blockNum) >= cfg.confirmations;
    const plan = planRelease(ev, { releasedNonces: ctx.released, confirmed });
    if (plan.action !== 'release') { skipped.push({ nonce: w.nonce, reason: plan.reason }); continue; }

    const op = buildReleaseOp(w, cfg);
    if (!op) { skipped.push({ nonce: w.nonce, reason: 'bad-destination-or-amount' }); continue; }
    try {
      const r = await broadcast(op, { keyType: 'active' });
      ctx.released.add(w.nonce);
      released.push({ nonce: w.nonce, to: op[1].to, amount: op[1].amount, result: r });
      // Persist IMMEDIATELY, not at end of tick: a crash between two releases must not lose the
      // record of the one that already went out. If the write fails we cannot prove we will not
      // repay, so stop releasing for the rest of this tick.
      if (ctx.store && !ctx.store.write(ctx.released)) {
        failed.push({ nonce: w.nonce, reason: 'released-but-could-not-persist; halting this tick' });
        ctx.untrustedState = 'persist-failed';
        break;
      }
    } catch (e) {
      failed.push({ nonce: w.nonce, reason: String(e && e.message || e).slice(0, 200) });
    }
  }
  return { ok: true, head: got.head, released, skipped, failed };
}

/**
 * makeRunner — a stateful tick() whose released-nonce set SURVIVES RESTARTS.
 *
 * Pass a store, or get a ReleasedNonceStore at cfg.stateFile by default. Pass `null` to opt out
 * explicitly, which restores the old in-memory-only behaviour and is only ever right in a test.
 */
export function makeRunner(broadcast, cfg, store = undefined) {
  const st = store === undefined ? new ReleasedNonceStore(cfg && cfg.stateFile) : store;
  const ctx = { released: new Set(), store: st || null };
  if (st) {
    const prior = st.read();
    if (prior === null) ctx.untrustedState = 'unreadable-state';   // fail closed, see the class doc
    else for (const n of prior) ctx.released.add(n);
  }
  return { tick: () => runOnce(cfg, broadcast, ctx), ctx };
}
