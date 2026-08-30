// wmelek-relayer.mjs — off-chain MELEK L1 -> MELEK-Engine WMELEK relayer/watcher.
//
// THE BOOTSTRAP PIECE. This is the missing on-ramp that lets anyone get WMELEK
// onto the engine so they can forever-lock it -> APIS-Hash -> mine APIS. Without
// it there is NO way to mint engine WMELEK on mainnet (the bridge invariant
// forbids free issuance), which blocks all APIS minting.
//
// HOW A USER "GETS WMELEK":
//   They transfer native MELEK on L1 to the custody account (WMELEK_BRIDGE_CUSTODY,
//   default `wmelek-bridge`) with the transfer MEMO = the engine account that should
//   receive WMELEK. Leaving the memo blank credits the depositor themselves.
//   Real MELEK actually moves on L1 (value enforced by L1), so the deposit is
//   provable — unlike a raw custom_json, whose fields are attacker-controlled.
//
// WHAT THIS RELAYER DOES:
//   Watches the custody account's L1 history for native `transfer` deposits, derives
//   a deterministic depositRef (the L1 tx id), and — for each new, FINALIZED deposit —
//   drives the engine's bridge.mintWrapped via a Graphene `custom_json` signed by the
//   engine bridge account (@hathor). That custom_json (id = engine sidechainId, json =
//   { contractName:'bridge', contractAction:'mintWrapped', contractPayload:{to,amount,depositRef} })
//   is the engine MIRROR of the MELEK->PRANA bridge-relayer's attestDeposit call.
//
// KEY-CUSTODY BOUNDARY (BRIEF.md §7, "Zero WIF in Bot repo", HARD rule "all witness
// tx via MELEK-Signer"): this module holds NO key/WIF/seed, SIGNS nothing, BROADCASTS
// nothing. It is PURE derivation + op-building: it turns observed L1 deposits into the
// UNSIGNED custom_json mint op that the runner hands to MELEK-Signer to broadcast. The
// recipient is taken ONLY from the signed L1 op (memo, or the transfer's own `from`),
// never inferred, so the relayer cannot redirect minted WMELEK.
//
// PRECISION: MELEK L1 native carries 3 decimals ("1.234 MELEK"); the engine WMELEK side
// token is ALSO 3 decimals (bridge.mjs ensureWrapped => precision 3). So the amount is
// 1:1 — passed through as the human decimal string, no scaling (contrast the PRANA
// ERC-20 wrapper, which is 18dp and needs scaleAmount).
//
// Everything SOFT-FAILS (never throws on bad input; returns {ok:false,reason}). Network
// reads use an injectable fetch; tests run fully offline.
//
//   import { parseDepositIntent, deriveDeposit, scanDeposits, buildMintOp, planMint,
//            normalizeAmount, parseRecipient, isFinal, isValidAccount, relayerManifest,
//            __setFetch } from './wmelek-relayer.mjs'
//
//   node integrations/wmelek-relayer.mjs        # print the relayer manifest (env names only)

import { config } from '../engine/config.mjs';

// ---- injectable fetch (parity with the other integrations) -----------------
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- env names (NAMES only, never secrets in code) -------------------------
export const MELEK_RPC_ENV = 'MELEK_RPC_URL';
export const CUSTODY_ACCOUNT_ENV = 'WMELEK_BRIDGE_CUSTODY';   // the L1 MELEK account deposits lock into
export const SIGNER_URL_ENV = 'MELEK_SIGNER_URL';             // MELEK-Signer base URL
export const SIGNER_TOKEN_ENV = 'MELEK_SIGNER_TOKEN';         // scoped, revocable bearer token (NEVER a key)

// The default custody account. The operator must create this L1 account 3-of-5
// (mirroring @kula-bridge) before go-live — the relayer never creates it.
export const DEFAULT_CUSTODY_ACCOUNT = 'wmelek-bridge';

// MELEK L1 native amounts carry 3 decimals ("1.234 MELEK"); the engine WMELEK
// side token is ALSO 3 decimals — so the amount is 1:1, no scaling.
export const MELEK_NATIVE_DECIMALS = 3;
export const WMELEK_DECIMALS = 3;

// A Graphene account name: 3..16 chars, dotted segments of [a-z][a-z0-9-]*.
const ACCOUNT_RE = /^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]+)*$/;

// ---- helpers ---------------------------------------------------------------

/** Validate a Graphene/MELEK account name (soft). */
export function isValidAccount(a) {
  return typeof a === 'string' && a.length >= 3 && a.length <= 32 && ACCOUNT_RE.test(a.trim());
}

/**
 * Normalize a native-amount number/string to a canonical WMELEK decimal string.
 * MELEK L1 is 3dp and WMELEK is 3dp, so there is no scaling — we only validate the
 * surface form and reject > WMELEK_DECIMALS places (would lose precision on the engine)
 * and non-positive amounts. Returns { ok, amount } where amount is the decimal string
 * bridge.mintWrapped will feed to toBaseUnits(amount, 3).
 * @param {string|number} whole  e.g. "1.234" or 1.234
 * @returns {{ok:boolean, amount?:string, reason?:string}}
 */
export function normalizeAmount(whole) {
  if (whole == null) return { ok: false, reason: 'no-amount' };
  const s = String(whole).trim().replace(/[, ]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, reason: 'unparseable-amount' };
  const frac = s.split('.')[1] || '';
  if (frac.length > WMELEK_DECIMALS) return { ok: false, reason: `amount exceeds WMELEK precision (${WMELEK_DECIMALS}dp)` };
  if (Number(s) <= 0) return { ok: false, reason: 'amount must be > 0' };
  return { ok: true, amount: s };
}

/** Split a Graphene asset string "1.234 MELEK" into [amount, symbol]. */
export function parseAmountAsset(str) {
  const [amt, asset] = String(str || '').trim().split(/\s+/);
  return [amt, asset];
}

/**
 * Decide the engine WMELEK recipient for a deposit. The destination comes ONLY from
 * the signed L1 op: the memo (an engine account name) if present + valid, else the
 * depositor's own account (`from`) — never inferred. A non-blank memo that ISN'T a
 * valid account name is an error (fail closed rather than silently crediting `from`).
 * @param {string} memo  the transfer memo
 * @param {string} from  the depositor account (the transfer's `from`)
 * @returns {{ok:boolean, recipient?:string, reason?:string}}
 */
export function parseRecipient(memo, from) {
  const m = String(memo == null ? '' : memo).trim();
  if (m) {
    // allow a leading '@' for humans; the chain account has no '@'
    const acct = m.replace(/^@/, '');
    if (!isValidAccount(acct)) return { ok: false, reason: 'memo-is-not-a-valid-engine-account-name' };
    return { ok: true, recipient: acct };
  }
  if (isValidAccount(from)) return { ok: true, recipient: String(from).trim() };
  return { ok: false, reason: 'no-recipient (blank memo and no valid depositor account)' };
}

/**
 * Parse a single MELEK L1 operation into a deposit intent. Only the native `transfer`
 * op is a valid deposit source — its value is enforced by L1 (real MELEK actually moved
 * to custody). custom_json is deliberately NOT accepted: it moves no value on L1 and its
 * amount/fields are attacker-controlled (the wLEO-class gateway-mint hazard), so it could
 * fabricate an unbacked mint. (This mirrors bridge-relayer.mjs's custom_json gate.)
 * @param {object} op  a Graphene op as {type, ...payload}
 * @returns {{ok:boolean, source?, to?, from?, recipient?, amount?, asset?, reason?}}
 */
export function parseDepositIntent(op) {
  if (!op || typeof op !== 'object') return { ok: false, reason: 'empty-op' };
  const type = op.type || op[0];
  const p = op.payload || (Array.isArray(op) ? op[1] : op) || {};

  if (type !== 'transfer') return { ok: false, reason: `unsupported-op-type:${type} (only native transfer locks value on L1)` };

  const [amt, asset] = parseAmountAsset(p.amount);
  const norm = normalizeAmount(amt);
  if (!norm.ok) return { ok: false, reason: norm.reason };

  const rcpt = parseRecipient(p.memo, p.from);
  if (!rcpt.ok) return rcpt;

  return {
    ok: true,
    source: 'transfer',
    to: p.to,
    from: p.from,
    recipient: rcpt.recipient,
    amount: norm.amount,
    asset: asset || undefined,
  };
}

/**
 * Derive a full, mintable deposit from a chain history ENTRY, binding the custody-account
 * check and the depositRef (the L1 tx id — globally unique, the on-chain replay key that
 * bridge.mintWrapped is idempotent on).
 * @param {{trxId?, transaction_id?, ref?, blockNum?, block?, op:object}} entry
 * @param {{custodyAccount:string}} opts
 * @returns {{ok:boolean, deposit?:object, reason?:string}}
 */
export function deriveDeposit(entry, opts = {}) {
  if (!entry || !entry.op) return { ok: false, reason: 'no-op-in-entry' };
  const depositRef = entry.trxId || entry.transaction_id || entry.ref;
  if (!depositRef) return { ok: false, reason: 'no-deposit-ref (tx id)' };

  const intent = parseDepositIntent(entry.op);
  if (!intent.ok) return intent;

  const custody = String(opts.custodyAccount || '').trim();
  if (!custody) return { ok: false, reason: 'no-custody-account-configured' };
  if (String(intent.to || '').trim() !== custody) {
    return { ok: false, reason: 'not-addressed-to-custody-account' };
  }

  return {
    ok: true,
    deposit: {
      depositRef: String(depositRef),
      recipient: intent.recipient,
      amount: intent.amount,                 // WMELEK decimal string (3dp, 1:1 with L1 MELEK)
      from: intent.from,
      asset: intent.asset,
      blockNum: entry.blockNum || entry.block || null,
      source: intent.source,
    },
  };
}

/**
 * Scan a slice of MELEK L1 custody-account history into mintable deposits + a skip log.
 * @param {Array} history  entries [{trxId, blockNum, op}, ...]
 * @param {{custodyAccount:string}} opts
 * @returns {{deposits:object[], skipped:{ref:any,reason:string}[]}}
 */
export function scanDeposits(history, opts = {}) {
  const deposits = [];
  const skipped = [];
  for (const entry of Array.isArray(history) ? history : []) {
    const r = deriveDeposit(entry, opts);
    if (r.ok) deposits.push(r.deposit);
    else skipped.push({ ref: entry && (entry.trxId || entry.ref), reason: r.reason });
  }
  return { deposits, skipped };
}

/**
 * Finality gate: never mint before the MELEK L1 confirmation threshold (reorg safety).
 * Prefer the node's last-irreversible block as `headBlock` (then threshold 0 is already safe),
 * but keeping a depth threshold is belt-and-braces.
 * @param {{blockNum:number}} deposit
 * @param {number} headBlock  current irreversible/head MELEK block
 * @param {number} threshold  required confirmation depth
 * @returns {boolean}
 */
export function isFinal(deposit, headBlock, threshold = 20) {
  const b = deposit && deposit.blockNum;
  if (!b || !headBlock) return false;
  return headBlock - b >= threshold;
}

/**
 * Build the UNSIGNED Graphene `custom_json` that mints WMELEK for a deposit — the engine
 * bridge.mintWrapped call. This is a DESCRIPTOR only: the runner hands it to MELEK-Signer,
 * which signs it as the bridge account (@hathor, ACTIVE auth) and broadcasts. This module
 * signs nothing and holds no key.
 *
 * The op:
 *   ["custom_json", {
 *     required_auths: [bridgeAccount], required_posting_auths: [], id: <sidechainId>,
 *     json: JSON.stringify({ contractName:'bridge', contractAction:'mintWrapped',
 *                            contractPayload:{ to, amount, depositRef } })
 *   }]
 *
 * @param {{depositRef, recipient, amount}} deposit
 * @param {{bridgeAccount?:string, sidechainId?:string}} [opts]
 * @returns {{ok:boolean, op?, envelope?, unsigned?:true, reason?:string}}
 */
export function buildMintOp(deposit, opts = {}) {
  if (!deposit || !deposit.depositRef) return { ok: false, reason: 'invalid-deposit' };
  if (!isValidAccount(deposit.recipient)) return { ok: false, reason: 'invalid-recipient' };
  const norm = normalizeAmount(deposit.amount);
  if (!norm.ok) return { ok: false, reason: norm.reason };

  const bridgeAccount = String(opts.bridgeAccount || (config.bridge && config.bridge.account) || '').trim();
  if (!isValidAccount(bridgeAccount)) return { ok: false, reason: 'invalid-bridge-account' };
  const sidechainId = String(opts.sidechainId || config.sidechainId || '').trim();
  if (!sidechainId) return { ok: false, reason: 'no-sidechain-id' };

  const envelope = {
    contractName: 'bridge',
    contractAction: 'mintWrapped',
    contractPayload: { to: deposit.recipient, amount: norm.amount, depositRef: String(deposit.depositRef) },
  };
  const op = [
    'custom_json',
    {
      required_auths: [bridgeAccount],
      required_posting_auths: [],
      id: sidechainId,
      json: JSON.stringify(envelope),
    },
  ];
  return { ok: true, op, envelope, unsigned: true };
}

/**
 * Decide what to do with a derived deposit given known state. Idempotent + replay-safe
 * (bridge.mintWrapped is itself idempotent per depositRef; this is the client-side guard
 * so we don't even broadcast a duplicate): already minted on the engine, or already
 * broadcast by this instance -> skip(success). Otherwise build the mint op.
 * @param {object} deposit
 * @param {{minted?:boolean, seenByMe?:boolean, bridgeAccount?:string, sidechainId?:string}} state
 * @returns {{action:'skip'|'mint', reason:string, op?:object, envelope?:object}}
 */
export function planMint(deposit, state = {}) {
  if (!deposit || !deposit.depositRef) return { action: 'skip', reason: 'invalid-deposit' };
  if (state.minted) return { action: 'skip', reason: 'already-minted-on-engine' };
  if (state.seenByMe) return { action: 'skip', reason: 'already-broadcast-by-this-instance' };
  const built = buildMintOp(deposit, { bridgeAccount: state.bridgeAccount, sidechainId: state.sidechainId });
  if (!built.ok) return { action: 'skip', reason: built.reason };
  return { action: 'mint', reason: 'mintable', op: built.op, envelope: built.envelope };
}

// ---- manifest / CLI --------------------------------------------------------

/**
 * The relayer's config + boundary manifest — env NAMES only, no secrets, no host content.
 * @returns {object}
 */
export function relayerManifest(env = process.env) {
  const present = (n) => !!(env[n] && String(env[n]).trim());
  return {
    role: 'MELEK L1 -> MELEK-Engine WMELEK relayer (the APIS-mining bootstrap on-ramp)',
    drives: 'engine bridge.mintWrapped via custom_json (id=sidechainId), signed by the bridge account through MELEK-Signer',
    deposit: 'native MELEK transfer to the custody account; memo = engine recipient (blank = credit depositor)',
    net: config.net,
    sidechainId: config.sidechainId,
    bridgeAccount: config.bridge && config.bridge.account,
    wrappedSymbol: config.bridge && config.bridge.wrappedSymbol,
    decimals: { melekNative: MELEK_NATIVE_DECIMALS, wmelek: WMELEK_DECIMALS, scaling: 'none (1:1)' },
    env: {
      melekRpc: present(MELEK_RPC_ENV),
      custodyAccount: present(CUSTODY_ACCOUNT_ENV),
      signerUrl: present(SIGNER_URL_ENV),
      signerToken: present(SIGNER_TOKEN_ENV),   // presence only — the token never appears here
    },
    defaultCustody: DEFAULT_CUSTODY_ACCOUNT,
    live: present(SIGNER_URL_ENV) && present(SIGNER_TOKEN_ENV) && present(MELEK_RPC_ENV),
    boundary: 'holds NO key/WIF/seed; SIGNS nothing, BROADCASTS nothing — builds the unsigned mint op; MELEK-Signer signs it',
  };
}

if (process.argv[1] && process.argv[1].endsWith('wmelek-relayer.mjs')) {
  process.stdout.write(JSON.stringify(relayerManifest(), null, 2) + '\n');
}
