// hive-engine-bridge-watcher.mjs — bridge Hive-Engine tokens (VKBT, CURE, …) OUT to PRANA.
//
// THE FLOW (Hive-Engine → PRANA), the operator's "scrypt":
//   1. A holder transfers VKBT/CURE on Hive-Engine to the bridge custody account (a Hive @account),
//      putting their 0x PRANA address in the transfer MEMO.
//   2. K-of-N attesters (this watcher, one per key) read those deposits from the Hive-Engine history
//      API and call the PRANA GrapheneDepositBridge.attestDeposit(depositRef, tokenId, recipient,
//      amount). Once K agree, the bridge RELEASES the registered wrapper (wVKBT/wCURE) from its
//      pre-funded pool to the memo address (LOCK_RELEASE mode — no mint authority).
//
// PURE watcher: reads Hive-Engine over an injected fetch, validates each deposit, and builds the
// unsigned attestDeposit call (same shape as the MELEK-Engine leg via attestationCall). SIGNS
// NOTHING — the daemon injects the ethers attester. Idempotent per Hive-Engine txId. Soft-fail:
// any read/parse problem yields an empty list, never a throw.
import { isPranaAddress, toBytes32Hex, attestationCall } from './bridge-relayer.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Hive-Engine tokens are 8dp; the wVKBT/wCURE wrappers are deployed at 8dp too, so the peg is exact
// 1:1 and no scaling is needed — we parse the "X.XXXXXXXX" quantity straight to 8dp base units.
export const HE_DECIMALS = 8;

/** A deterministic, unique bytes32 deposit ref from a Hive-Engine txId. Hex tx-ids (≤32 bytes) are
 *  left-padded (toBytes32Hex); any other string is UTF-8 encoded (padded, or last 32 bytes). Null on empty. */
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

/** Parse a Hive-Engine quantity string ("100.00000000") to BigInt base units at 8dp. Null on bad input. */
export function heQuantityToBase(q) {
  const s = String(q == null ? '' : q).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, fracRaw = ''] = s.split('.');
  const frac = (fracRaw + '0'.repeat(HE_DECIMALS)).slice(0, HE_DECIMALS);
  try { return (BigInt(intPart) * 10n ** BigInt(HE_DECIMALS) + BigInt(frac || '0')).toString(); }
  catch { return null; }
}

export function loadConfig(env = process.env) {
  let tokenIds = {};
  if (env.HE_BRIDGE_TOKEN_IDS) { try { tokenIds = JSON.parse(env.HE_BRIDGE_TOKEN_IDS); } catch { tokenIds = {}; } }
  return {
    custody: (env.HE_BRIDGE_CUSTODY || '').toLowerCase(),        // the Hive @account deposits go to
    historyUrl: (env.HE_HISTORY_URL || 'https://history.hive-engine.com/accountHistory').replace(/\/$/, ''),
    symbols: Object.keys(tokenIds),                              // only these symbols are bridged
    tokenIds,                                                    // symbol -> bytes32 tokenId (from ethers.id)
    limit: Number.isFinite(+env.HE_HISTORY_LIMIT) ? +env.HE_HISTORY_LIMIT : 100,
  };
}

/**
 * deriveDeposit — turn one Hive-Engine history entry into a bridge deposit, or null if it isn't a
 * valid inbound bridge deposit. A valid deposit is: a `tokens_transfer` (or transfer) INTO the
 * custody account, of a registered symbol, whose memo is a valid 0x PRANA address, with a txId.
 */
export function deriveDeposit(entry, cfg) {
  if (!entry || typeof entry !== 'object') return null;
  const op = String(entry.operation || entry.action || '');
  if (!/transfer/i.test(op)) return null;
  if (String(entry.to || '').toLowerCase() !== cfg.custody) return null;
  const symbol = String(entry.symbol || '');
  const tokenId = cfg.tokenIds[symbol];
  if (!tokenId) return null;                                     // symbol not registered → ignore
  const recipient = String(entry.memo || '').trim();
  if (!isPranaAddress(recipient)) return null;                   // memo must be the PRANA 0x address
  const amount = heQuantityToBase(entry.quantity);
  if (!amount || amount === '0') return null;
  const txId = String(entry.transactionId || entry.txId || '');
  const depositRef = refToBytes32(txId);
  if (!depositRef) return null;
  return { depositRef, tokenId, recipient, amount, symbol, txId, from: String(entry.from || '') };
}

/** Read the custody account's Hive-Engine history and return the valid inbound deposits. Soft-fail. */
export async function readDeposits(cfg, fetchImpl = _fetch) {
  if (!cfg.custody || !cfg.symbols.length) return [];
  const out = [];
  const seen = new Set();
  for (const symbol of cfg.symbols) {
    let history = [];
    try {
      const url = `${cfg.historyUrl}?account=${encodeURIComponent(cfg.custody)}&symbol=${encodeURIComponent(symbol)}&limit=${cfg.limit}`;
      const res = await fetchImpl(url);
      if (!res || !res.ok) continue;
      const j = await res.json();
      history = Array.isArray(j) ? j : (Array.isArray(j && j.result) ? j.result : []);
    } catch { continue; }
    for (const entry of history) {
      const d = deriveDeposit(entry, cfg);
      if (d && !seen.has(d.txId)) { seen.add(d.txId); out.push(d); }
    }
  }
  return out;
}

/** Build the unsigned attestDeposit calls for all current deposits (the daemon signs + submits). */
export async function buildAttestations(cfg, fetchImpl = _fetch) {
  const deposits = await readDeposits(cfg, fetchImpl);
  return deposits.map((d) => ({ ...attestationCall(d), symbol: d.symbol, from: d.from }));
}
