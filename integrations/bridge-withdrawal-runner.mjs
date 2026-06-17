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
 * runOnce — read withdrawals, and for each FINALIZED, native, not-yet-released one, broadcast the
 * release via the injected broadcaster `broadcast(op, {keyType:'active'})`. Idempotent per nonce
 * (ctx.released Set). Soft-fail: a broadcast throw leaves the nonce UNreleased for retry.
 */
export async function runOnce(cfg, broadcast, ctx = {}) {
  if (typeof broadcast !== 'function') return { ok: false, reason: 'no-broadcaster' };
  ctx.released = ctx.released instanceof Set ? ctx.released : new Set();
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
    } catch (e) {
      failed.push({ nonce: w.nonce, reason: String(e && e.message || e).slice(0, 200) });
    }
  }
  return { ok: true, head: got.head, released, skipped, failed };
}

/** makeRunner — a stateful tick() that keeps the released-nonce set across ticks. */
export function makeRunner(broadcast, cfg) {
  const ctx = { released: new Set() };
  return { tick: () => runOnce(cfg, broadcast, ctx), ctx };
}
