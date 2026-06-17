// engine-bridge-watcher.mjs — bridge MELEK-Engine side-tokens (APIS, …) OUT to PRANA.
//
// THE FLOW (engine → PRANA, the L2-token analogue of the L1 wMELEK deposit leg):
//   1. A holder transfers an engine token to the engine bridge custody (config.bridge.custody),
//      putting their 0x PRANA address in the transfer MEMO. The engine records it append-only and
//      exposes it at /contracts/bridge/deposits.
//   2. K-of-N attesters (this watcher, one per key) read those deposits and call the SAME PRANA
//      GrapheneDepositBridge.attestDeposit(depositRef, tokenId, recipient, amount) — minting the
//      registered wrapper (e.g. wAPIS, tokenId = keccak256("APIS")) once K agree, once per txId.
//
// This module is the PURE watcher: reads the engine over an injected fetch, validates each deposit,
// scales the engine quantity to the wrapper's 18dp, and builds the unsigned attestDeposit call. It
// SIGNS NOTHING — the daemon injects the ethers attester. Idempotent per engine txId. Soft-fail.
//
// Reuses scaleAmount + toBytes32Hex + isPranaAddress + attestationCall from bridge-relayer.mjs so the
// engine leg and the L1 leg attest in exactly the same shape.

import { scaleAmount, toBytes32Hex, isPranaAddress, attestationCall } from './bridge-relayer.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/**
 * refToBytes32 — a deterministic, unique bytes32 deposit ref from an engine txId. Hex L1 trx-ids
 * (≤32 bytes) are left-padded exactly like the L1 leg (toBytes32Hex); any other string is encoded
 * from its UTF-8 bytes (padded, or the last 32 bytes if longer). Never throws; null only on empty.
 */
export function refToBytes32(txId) {
  const s = String(txId || '');
  if (!s) return null;
  const hex = toBytes32Hex(s);
  if (hex) return hex;
  let h = '';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, '0');
  h = h.length > 64 ? h.slice(-64) : h.padStart(64, '0');
  return '0x' + h;
}

export function loadConfig(env = process.env) {
  const num = (v, d) => { const n = +v; return Number.isFinite(n) ? n : d; };
  // symbol -> bytes32 tokenId map (the daemon fills this from ethers.id(symbol); a JSON env override
  // is supported for tests / extra tokens). Only symbols present here are bridged.
  let tokenIds = {};
  if (env.BRIDGE_TOKEN_IDS) { try { tokenIds = JSON.parse(env.BRIDGE_TOKEN_IDS); } catch { tokenIds = {}; } }
  return Object.freeze({
    engineApi: (env.ENGINE_API_URL || '').replace(/\/+$/, ''),
    pranaRpc: env.PRANA_RPC_URL || '',
    bridgeAddress: env.GRAPHENE_BRIDGE_ADDRESS || '',
    symbols: (env.BRIDGE_SYMBOLS || 'APIS').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    tokenIds: Object.freeze(tokenIds),
    confirmations: num(env.CONFIRMATIONS, 0), // engine deposits are final once recorded (advance only on real L1 blocks)
    keyPresent: !!env.PRANA_ATTESTER_KEY,
  });
}

/** Fetch recorded engine bridge deposits (optionally per symbol). Soft-fails to { ok:false, deposits:[] }. */
export async function fetchDeposits(cfg, symbol) {
  if (!cfg.engineApi) return { ok: false, reason: 'no-engine-api', deposits: [] };
  try {
    const url = `${cfg.engineApi}/contracts/bridge/deposits` + (symbol ? `?symbol=${encodeURIComponent(symbol)}` : '');
    const res = await _fetch(url);
    const rows = await res.json();
    return { ok: true, deposits: Array.isArray(rows) ? rows : [] };
  } catch (e) { return { ok: false, reason: String(e && e.message || e), deposits: [] }; }
}

/**
 * deriveAttestation — turn one engine deposit row into an unsigned attestDeposit call.
 * Returns { ok, call, deposit } or { ok:false, reason }. Pure; never throws.
 */
export function deriveAttestation(row, cfg) {
  if (!row || typeof row !== 'object') return { ok: false, reason: 'bad-row' };
  const symbol = String(row.symbol || '').toUpperCase();
  if (!cfg.symbols.includes(symbol)) return { ok: false, reason: 'symbol-not-bridged' };
  const tokenId = cfg.tokenIds[symbol];
  if (!tokenId) return { ok: false, reason: 'no-tokenId-for-symbol' };
  const recipient = String(row.memo || '').trim();
  if (!isPranaAddress(recipient)) return { ok: false, reason: 'bad-recipient-memo' };
  const amount = scaleAmount(String(row.quantity)); // decimal quantity → 18dp wei
  if (amount == null || amount === '0') return { ok: false, reason: 'bad-amount' };
  const depositRef = refToBytes32(String(row.txId || ''));
  if (!depositRef) return { ok: false, reason: 'bad-depositRef' };
  const call = attestationCall({ depositRef, tokenId, recipient, amount });
  return { ok: true, call, deposit: { ref: depositRef, txId: row.txId, symbol, recipient, amount } };
}

/**
 * runOnce — read engine deposits for every bridged symbol and submit a not-yet-seen, finalized,
 * well-formed attestation for each. Idempotent per engine txId (ctx.seen). submit(call, deposit)
 * is the injected ethers attester. A submit throw leaves the txId UNSEEN for retry. Never throws.
 */
export async function runOnce(cfg, submit, ctx = {}) {
  if (typeof submit !== 'function') return { ok: false, reason: 'no-submit-fn' };
  ctx.seen = ctx.seen instanceof Set ? ctx.seen : new Set();
  const submitted = [], skipped = [], failed = [];
  for (const symbol of cfg.symbols) {
    const got = await fetchDeposits(cfg, symbol);
    if (!got.ok) { skipped.push({ symbol, reason: got.reason }); continue; }
    for (const row of got.deposits) {
      const txId = String(row.txId || '');
      if (!txId || ctx.seen.has(txId)) { skipped.push({ txId, reason: 'already-submitted-by-this-instance' }); continue; }
      if (row.attested === true) { ctx.seen.add(txId); skipped.push({ txId, reason: 'already-attested' }); continue; }
      const d = deriveAttestation(row, cfg);
      if (!d.ok) { skipped.push({ txId, reason: d.reason }); continue; }
      try {
        const res = await submit(d.call, d.deposit);
        ctx.seen.add(txId);
        submitted.push({ txId, ref: d.deposit.ref, symbol, recipient: d.deposit.recipient, amount: d.deposit.amount, txHash: res && (res.txHash || res) });
      } catch (e) {
        failed.push({ txId, reason: String(e && e.message || e).slice(0, 200) });
      }
    }
  }
  return { ok: true, submitted, skipped, failed };
}

/** makeRunner — stateful tick() keeping the seen-set across ticks. */
export function makeRunner(submit, cfg) {
  const ctx = { seen: new Set() };
  return { tick: () => runOnce(cfg, submit, ctx), ctx };
}

export function watcherManifest() {
  return {
    role: 'engine→PRANA side-token bridge watcher (APIS→wAPIS, …)',
    boundary: 'reads the engine + SIGNS nothing; the daemon injects the ethers attester',
    env: {
      engineApi: { name: 'ENGINE_API_URL' },
      pranaRpc: { name: 'PRANA_RPC_URL' },
      bridgeAddress: { name: 'GRAPHENE_BRIDGE_ADDRESS' },
      symbols: { name: 'BRIDGE_SYMBOLS' },
      attesterKey: { name: 'PRANA_ATTESTER_KEY', note: 'daemon-only; never read here' },
    },
  };
}
