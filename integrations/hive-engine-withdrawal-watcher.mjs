// hive-engine-withdrawal-watcher.mjs — the return leg: PRANA -> Hive-Engine RELEASE (wVKBT/wCURE -> VKBT/CURE).
//
// THE FLOW this closes (the reverse of hive-engine-bridge-watcher.mjs's deposit leg):
//   1. A holder burns/locks wrapped supply on PRANA: GrapheneDepositBridge.withdraw(tokenId, amount,
//      destinationRef) pulls + burns the wVKBT/wCURE wrapper and emits
//      GrapheneWithdrawal(nonce, tokenId, from, wrapped, amount, destinationRef). `destinationRef` is the
//      destination HIVE @account name encoded as a bytes32 string (ethers.encodeBytes32String).
//   2. K-of-N off-chain relayers watch that event and RELEASE the real VKBT/CURE from the Hive-Engine
//      custody account to that @account — once per nonce.
//
// This module is the PURE watcher (same shape as hive-engine-bridge-watcher.mjs's deposit leg): it reads
// the PRANA bridge's GrapheneWithdrawal logs via eth JSON-RPC over an injected fetch, decodes each event,
// resolves the on-chain tokenId back to a Hive-Engine SYMBOL, decodes destinationRef -> a Hive @account,
// and BUILDS the unsigned Hive-Engine release op (a `custom_json` ssc-mainnet-melek tokens.transfer). It
// SIGNS NOTHING and BROADCASTS NOTHING — the daemon injects the custody signer and submits. Idempotent
// per withdrawal nonce (memo `bridge-withdraw:<nonce>`). Soft-fail: any read/decode problem yields [].
//
// AMOUNT SCALING: the PRANA wrapped token (wVKBT/wCURE) is deployed at 8dp, which MATCHES Hive-Engine's
// 8dp precision, so the peg is exact 1:1 — the event's base-unit amount maps straight to an "X.XXXXXXXX"
// Hive-Engine quantity with NO scaling (contrast the native leg's 18dp->3dp scaleDownToNative).
//
// Reuses parseWithdrawal (bridge-relayer.mjs) + decodeDestination / WITHDRAWAL_TOPIC0
// (bridge-withdrawal-runner.mjs) so both return legs decode identically.

import { fileURLToPath } from 'node:url';
import { parseWithdrawal } from './bridge-relayer.mjs';
import { decodeDestination, WITHDRAWAL_TOPIC0 as DEFAULT_TOPIC0 } from './bridge-withdrawal-runner.mjs';

// ---- injectable fetch (parity with the sibling watchers) -------------------
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Hive-Engine tokens are 8dp; the wVKBT/wCURE PRANA wrappers are deployed at 8dp too, so peg == 1:1.
export const HE_DECIMALS = 8;
export const WRAPPER_DECIMALS = 8;
// The Hive-Engine side-chain id the MELEK engine listens on (matches the deposit/transfer path).
export const SSC_ID = 'ssc-mainnet-melek';
// Re-export the canonical event topic so callers/tests can reference it without computing keccak.
export { DEFAULT_TOPIC0 as WITHDRAWAL_TOPIC0 };

// ---- low-level log decode (topic0 injectable so tests need no keccak) -------
function toBigSafe(v) { try { return BigInt(v); } catch { return null; } }
function hexField(data, i) { const h = String(data || '0x').replace(/^0x/, ''); return '0x' + h.slice(i * 64, i * 64 + 64); }
function addrFromTopic(t) { return typeof t === 'string' && t.length >= 42 ? '0x' + t.slice(-40).toLowerCase() : null; }

/**
 * Decode a raw GrapheneWithdrawal log {topics,data} into the shape parseWithdrawal accepts.
 * topic0 is configurable (defaults to the canonical hash) so tests can supply their own.
 * GrapheneWithdrawal(uint256 nonce, bytes32 tokenId, address from, address wrapped, uint256 amount, bytes32 destinationRef)
 * indexed: nonce(topic1), tokenId(topic2), from(topic3); data: wrapped(32) ‖ amount(32) ‖ destinationRef(32).
 * Returns null (never throws) on anything malformed or a topic0 mismatch.
 */
export function decodeWithdrawalLog(log, topic0 = DEFAULT_TOPIC0) {
  if (!log || !Array.isArray(log.topics) || log.topics.length < 4) return null;
  if (topic0 && log.topics[0] && String(log.topics[0]).toLowerCase() !== String(topic0).toLowerCase()) return null;
  const nonce = toBigSafe(log.topics[1]);
  const amount = toBigSafe(hexField(log.data, 1));
  if (nonce == null || amount == null) return null;
  return {
    args: {
      nonce: nonce.toString(),
      tokenId: log.topics[2],
      from: addrFromTopic(log.topics[3]),
      wrapped: addrFromTopic(hexField(log.data, 0)),
      amount: amount.toString(),
      destinationRef: hexField(log.data, 2),
    },
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash || null,
  };
}

/** Convert an 8dp base-unit integer (BigInt/str) to a Hive-Engine "X.XXXXXXXX" quantity (1:1). Null on bad input. */
export function baseToHeQuantity(base) {
  const a = toBigSafe(base);
  if (a == null || a < 0n) return null;
  const div = 10n ** BigInt(HE_DECIMALS);
  const whole = (a / div).toString();
  const frac = (a % div).toString().padStart(HE_DECIMALS, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

export function loadConfig(env = process.env) {
  const num = (v, d) => { const n = +v; return Number.isFinite(n) ? n : d; };
  // symbol -> bytes32 tokenId map (the daemon fills this from ethers.id(symbol); JSON env override for tests).
  // Only symbols present here are released; their tokenIds form the reverse map used to resolve events.
  let tokenIds = {};
  if (env.HE_BRIDGE_TOKEN_IDS) { try { tokenIds = JSON.parse(env.HE_BRIDGE_TOKEN_IDS); } catch { tokenIds = {}; } }
  const symbolByTokenId = {};
  for (const [sym, id] of Object.entries(tokenIds)) {
    if (id) symbolByTokenId[String(id).toLowerCase()] = String(sym).toUpperCase();
  }
  return Object.freeze({
    pranaRpc: env.PRANA_RPC_URL || '',                              // PRANA eth JSON-RPC endpoint
    bridgeAddress: env.GRAPHENE_BRIDGE_ADDRESS || '',              // the GrapheneDepositBridge on PRANA
    custody: (env.HE_BRIDGE_CUSTODY || '').toLowerCase(),          // the Hive-Engine @account holding real VKBT/CURE
    tokenIds: Object.freeze({ ...tokenIds }),                      // symbol -> bytes32 tokenId
    symbolByTokenId: Object.freeze(symbolByTokenId),              // bytes32 tokenId (lc) -> symbol
    sscId: env.HE_SSC_ID || SSC_ID,
    withdrawalTopic0: String(env.WITHDRAWAL_TOPIC0 || DEFAULT_TOPIC0).toLowerCase(),
    lookbackBlocks: num(env.WITHDRAWAL_LOOKBACK, 5000),
  });
}

async function rpc(fetchImpl, url, method, params) {
  const res = await fetchImpl(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j && j.error) throw new Error((j.error && j.error.message) || 'rpc-error');
  return j && j.result;
}

/**
 * deriveRelease — one raw GrapheneWithdrawal log -> a release intent, or null. Decodes the event,
 * resolves tokenId -> symbol (unmapped => null), decodes destinationRef -> a Hive @account (bad => null),
 * and maps the 8dp amount 1:1 to a Hive-Engine quantity. Pure; never throws.
 * @returns {{nonce, symbol, amount, toAccount, tokenId, txHash}|null}
 */
export function deriveRelease(log, cfg) {
  if (!cfg) return null;
  const ev = decodeWithdrawalLog(log, cfg.withdrawalTopic0);
  if (!ev) return null;
  const w = parseWithdrawal(ev);
  if (!w.ok) return null;
  const symbol = cfg.symbolByTokenId && cfg.symbolByTokenId[String(w.tokenId).toLowerCase()];
  if (!symbol) return null;                                        // tokenId not registered -> ignore
  const toAccount = decodeDestination(w.destinationRef);
  if (!toAccount) return null;                                     // destinationRef not a valid @account
  const amount = baseToHeQuantity(w.amount);
  if (amount == null || amount === '0') return null;
  return { nonce: w.nonce, symbol, amount, toAccount, tokenId: String(w.tokenId), txHash: ev.transactionHash };
}

/**
 * readWithdrawals — query the PRANA bridge's GrapheneWithdrawal logs and return the valid, resolved
 * release intents, deduped by nonce. Soft-fails to [] on any RPC/parse problem.
 */
export async function readWithdrawals(cfg, fetchImpl = _fetch) {
  if (!cfg || !cfg.pranaRpc || !cfg.bridgeAddress) return [];
  try {
    const headHex = await rpc(fetchImpl, cfg.pranaRpc, 'eth_blockNumber', []);
    const head = Number(BigInt(headHex));
    const from = Math.max(0, head - cfg.lookbackBlocks);
    const logs = await rpc(fetchImpl, cfg.pranaRpc, 'eth_getLogs', [{
      address: cfg.bridgeAddress,
      topics: [cfg.withdrawalTopic0],
      fromBlock: '0x' + from.toString(16),
      toBlock: 'latest',
    }]);
    const out = [];
    const seen = new Set();
    for (const log of Array.isArray(logs) ? logs : []) {
      const rel = deriveRelease(log, cfg);
      if (rel && !seen.has(rel.nonce)) { seen.add(rel.nonce); out.push(rel); }
    }
    return out;
  } catch { return []; }
}

/** Build one unsigned Hive-Engine release op (custom_json ssc-mainnet-melek tokens.transfer) for a release intent. */
export function releaseOp(rel, cfg) {
  const memo = `bridge-withdraw:${rel.nonce}`;
  const json = {
    contractName: 'tokens',
    contractAction: 'transfer',
    contractPayload: { symbol: rel.symbol, to: rel.toAccount, quantity: rel.amount, memo },
  };
  return {
    op: ['custom_json', {
      required_auths: [cfg.custody],       // tokens.transfer needs active auth of the custody account
      required_posting_auths: [],
      id: cfg.sscId || SSC_ID,
      json: JSON.stringify(json),
    }],
    nonce: rel.nonce,
    symbol: rel.symbol,
    amount: rel.amount,
    toAccount: rel.toAccount,
    memo,
    unsigned: true,                        // the DAEMON injects the custody signer + broadcasts; never here
  };
}

/** Build the unsigned Hive-Engine release ops for all current withdrawals (the daemon signs + submits). */
export async function buildReleases(cfg, fetchImpl = _fetch) {
  const rels = await readWithdrawals(cfg, fetchImpl);
  const seen = new Set();
  const ops = [];
  for (const rel of rels) {
    if (seen.has(rel.nonce)) continue;      // idempotent per nonce (defensive; readWithdrawals already dedups)
    seen.add(rel.nonce);
    ops.push(releaseOp(rel, cfg));
  }
  return ops;
}

/** Config + boundary manifest — env NAMES only, no secrets. */
export function watcherManifest() {
  return {
    role: 'PRANA->Hive-Engine withdrawal release watcher (wVKBT/wCURE -> VKBT/CURE)',
    drives: 'unsigned custom_json (ssc-mainnet-melek) tokens.transfer from the HE custody account',
    boundary: 'reads PRANA over an injected fetch; SIGNS nothing, BROADCASTS nothing — builds unsigned ops only',
    decimals: { wrapper: WRAPPER_DECIMALS, hiveEngine: HE_DECIMALS, peg: '1:1 (no scaling)' },
    env: {
      pranaRpc: { name: 'PRANA_RPC_URL' },
      bridgeAddress: { name: 'GRAPHENE_BRIDGE_ADDRESS' },
      custody: { name: 'HE_BRIDGE_CUSTODY' },
      tokenIds: { name: 'HE_BRIDGE_TOKEN_IDS', note: 'JSON {SYMBOL: bytes32 tokenId}' },
      topic0: { name: 'WITHDRAWAL_TOPIC0', note: 'optional override of the GrapheneWithdrawal event hash' },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(JSON.stringify(watcherManifest(), null, 2) + '\n');
}
