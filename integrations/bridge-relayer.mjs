// bridge-relayer.mjs — off-chain MELEK -> PRANA relayer/watcher logic (BI8).
//
// Implements the PROTOCOL in /workspaces/PRANA/design/bridge/melek-relayer-spec.md: the
// federated K-of-N attester that watches the MELEK (Graphene) chain for deposits to the
// bridge custody account and drives `GrapheneDepositBridge.attestDeposit(...)` on PRANA,
// plus the reverse (PRANA `GrapheneWithdrawal` -> MELEK release) leg.
//
// KEY-CUSTODY BOUNDARY (BRIEF.md §7, mirrors akasha-connect.mjs): this module holds NO
// key/WIF/seed, SIGNS nothing, BROADCASTS nothing. It is PURE derivation + planning: it
// turns observed chain events into the *calls/intents* an attester's own signer would
// broadcast. The destination PRANA address is taken ONLY from the signed MELEK op
// (memo / custom_json) — never inferred — so the relayer cannot redirect funds.
//
// Everything SOFT-FAILS (never throws on bad input; returns {ok:false,reason}). Network
// reads use an injectable fetch; tests run fully offline.
//
//   import { parseDepositIntent, deriveDeposit, scanDeposits, planAttestation,
//            attestationCall, parseWithdrawal, planRelease, scaleAmount, isFinal,
//            relayerManifest, __setFetch } from './bridge-relayer.mjs'
//
//   node integrations/bridge-relayer.mjs        # print the relayer manifest (env names only)

// ---- injectable fetch (parity with the other integrations) -----------------
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- env names (NAMES only, never secrets in code) -------------------------
export const MELEK_RPC_ENV = 'MELEK_RPC_URL';
export const PRANA_RPC_ENV = 'PRANA_RPC_URL';
export const BRIDGE_ADDRESS_ENV = 'GRAPHENE_BRIDGE_ADDRESS';   // GrapheneDepositBridge on PRANA
export const CUSTODY_ACCOUNT_ENV = 'MELEK_BRIDGE_CUSTODY';     // the MELEK account deposits go to
export const ATTESTER_ADDRESS_ENV = 'PRANA_ATTESTER_ADDRESS';  // this attester's PRANA key address

// Graphene native amounts carry 3 decimals ("1.234 MELEK"); the wMELEK ERC-20 wrapper uses 18.
export const MELEK_NATIVE_DECIMALS = 3;
export const WRAPPER_DECIMALS = 18;

// ---- helpers ---------------------------------------------------------------

/** A valid PRANA (EVM) recipient: 0x + exactly 40 hex chars. */
export function isPranaAddress(s) {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

/**
 * Scale an integer-ish amount between decimal bases, 1:1 in value (no rounding loss for
 * fromDecimals <= toDecimals, which is our case 3 -> 18). Returns a decimal STRING so big
 * 18-decimal values never hit JS float limits. null on bad input.
 * @param {string|number} whole  the native amount as a human string ("1.234") or number
 * @param {number} fromDecimals
 * @param {number} toDecimals
 * @returns {string|null}  base-unit integer string at toDecimals (e.g. "1234000000000000000")
 */
export function scaleAmount(whole, fromDecimals = MELEK_NATIVE_DECIMALS, toDecimals = WRAPPER_DECIMALS) {
  if (whole == null) return null;
  const s = String(whole).trim().replace(/[, ]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, fracRaw = ''] = s.split('.');
  // pad/truncate the fractional part to fromDecimals, then append zeros to reach toDecimals
  const frac = (fracRaw + '0'.repeat(fromDecimals)).slice(0, fromDecimals);
  const baseAtFrom = `${intPart}${frac}`.replace(/^0+(?=\d)/, '');
  if (toDecimals < fromDecimals) return null; // not needed in our direction; refuse lossy
  const padded = baseAtFrom + '0'.repeat(toDecimals - fromDecimals);
  return padded.replace(/^0+(?=\d)/, '') || '0';
}

/**
 * Pull the destination PRANA address (and optional token id) out of a deposit's signed
 * fields. Supports a plain memo ("0xabc...", or "0xabc... TOKEN=MELEK") and a structured
 * custom_json payload ({ dst|to|recipient, token|tokenId }). Returns {ok,recipient,tokenId}.
 * @param {{memo?:string, json?:object|string}} fields
 * @returns {{ok:boolean, recipient?:string, tokenId?:string, reason?:string}}
 */
export function parseDestination(fields = {}) {
  let recipient, tokenId;
  // structured json wins if present
  let json = fields.json;
  if (typeof json === 'string') { try { json = JSON.parse(json); } catch { json = null; } }
  if (json && typeof json === 'object') {
    recipient = json.dst || json.to || json.recipient;
    tokenId = json.token || json.tokenId || json.tid;
  }
  // fall back to the memo
  if (!recipient && typeof fields.memo === 'string') {
    const m = fields.memo.trim();
    const addr = (m.match(/0x[0-9a-fA-F]{40}/) || [])[0];
    if (addr) recipient = addr;
    const tok = (m.match(/TOKEN=([A-Za-z0-9._-]+)/) || [])[1];
    if (tok) tokenId = tok;
  }
  if (!recipient) return { ok: false, reason: 'no-destination-address-in-signed-op' };
  if (!isPranaAddress(recipient)) return { ok: false, reason: 'destination-not-a-valid-prana-0x-address' };
  return { ok: true, recipient: recipient.trim(), tokenId: tokenId ? String(tokenId) : undefined };
}

/**
 * Parse a single MELEK operation into a deposit intent (recipient/tokenId/amount/source).
 * Recognises: a `transfer` to custody (memo = dest), a `custom_json` deposit op, and a
 * MELEK-Engine/SMT wrap op (custom_json id 'ssc-mainnet*' / engine transfer shape).
 * Does NOT yet bind the custody check or depositRef — see deriveDeposit.
 * @param {object} op  a Graphene op as {type, ...payload} (the 2nd element of [name,payload])
 * @returns {{ok:boolean, recipient?, tokenId?, amount?, asset?, to?, source?, reason?}}
 */
export function parseDepositIntent(op) {
  if (!op || typeof op !== 'object') return { ok: false, reason: 'empty-op' };
  const type = op.type || op[0];
  const p = op.payload || (Array.isArray(op) ? op[1] : op) || {};

  if (type === 'transfer') {
    const dest = parseDestination({ memo: p.memo });
    if (!dest.ok) return dest;
    // amount arrives as "1.234 MELEK" / "1.234 TESTS" on Graphene
    const [amt, asset] = String(p.amount || '').trim().split(/\s+/);
    const scaled = scaleAmount(amt);
    if (scaled == null) return { ok: false, reason: 'unparseable-transfer-amount' };
    return {
      ok: true, source: 'transfer', to: p.to,
      // tokenId comes ONLY from an explicit memo TOKEN=; the asset symbol (e.g. TESTS) is NOT a
      // tokenId — the on-chain wMELEK is registered under keccak256("MELEK"), supplied as defaultTokenId.
      recipient: dest.recipient, tokenId: dest.tokenId || undefined,
      amount: scaled, asset: asset || undefined,
    };
  }

  if (type === 'custom_json') {
    let j = p.json;
    if (typeof j === 'string') { try { j = JSON.parse(j); } catch { j = null; } }
    if (!j || typeof j !== 'object') return { ok: false, reason: 'custom_json-not-parseable' };
    const dest = parseDestination({ json: j });
    if (!dest.ok) return dest;
    const rawAmt = j.amount ?? j.qty ?? j.quantity;
    const scaled = scaleAmount(rawAmt);
    if (scaled == null) return { ok: false, reason: 'unparseable-custom_json-amount' };
    return {
      ok: true, source: 'custom_json', to: j.custody || p.required_auths?.[0],
      recipient: dest.recipient, tokenId: dest.tokenId || undefined,
      amount: scaled, asset: j.symbol || undefined,
    };
  }

  return { ok: false, reason: `unsupported-op-type:${type}` };
}

/**
 * Derive a full, attestable deposit from a chain history ENTRY, binding the custody-account
 * check and the depositRef (the MELEK tx id — globally unique, the on-chain replay key).
 * @param {{trxId?:string, transaction_id?:string, blockNum?:number, block?:number, op:object}} entry
 * @param {{custodyAccount:string, defaultTokenId?:string}} opts
 * @returns {{ok:boolean, deposit?:object, reason?:string}}
 */
export function deriveDeposit(entry, opts = {}) {
  if (!entry || !entry.op) return { ok: false, reason: 'no-op-in-entry' };
  const depositRef = entry.trxId || entry.transaction_id || entry.ref;
  if (!depositRef) return { ok: false, reason: 'no-deposit-ref (tx id)' };
  const intent = parseDepositIntent(entry.op);
  if (!intent.ok) return intent;

  const custody = String(opts.custodyAccount || '').trim();
  if (custody && intent.to && String(intent.to).trim() !== custody) {
    return { ok: false, reason: 'not-addressed-to-custody-account' };
  }
  // Precedence: an explicit memo TOKEN= > the bridge's configured defaultTokenId > the asset symbol.
  // The asset symbol is the weakest source (and on testnet it's TESTS, not MELEK) — it must NOT
  // override the configured wMELEK tokenId (keccak256("MELEK")).
  const tokenId = intent.tokenId || opts.defaultTokenId || intent.asset;
  if (!tokenId) return { ok: false, reason: 'no-token-id (set defaultTokenId or encode in op)' };

  // SECURITY (wLEO-class gateway mint — the highest-loss Hive-Engine incident): a `custom_json` op moves
  // NO value on Graphene, and its `amount` + `custody` fields are ENTIRELY attacker-controlled. A forged
  // custom_json could therefore fabricate a deposit and mint unbacked wrapped tokens out of thin air. The
  // native `transfer` op is the ONLY deposit source whose value is enforced by L1 (real MELEK actually
  // moved to the custody account). So custom_json deposits (the future engine-token / SMT wrap path) stay
  // DISABLED until the relayer confirms them against MELEK-ENGINE STATE — proof the engine truly credited
  // custody by `amount` of the token — never the raw, unverifiable op. Opt in ONLY once that exists.
  if (intent.source === 'custom_json' && !opts.allowCustomJsonDeposits) {
    return { ok: false, reason: 'custom_json-deposits-disabled (value not provable from the op; needs engine-state confirmation)' };
  }

  return {
    ok: true,
    deposit: {
      // bytes32 for the EVM contract: a Graphene tx id is 20 bytes (40 hex) — left-pad to 32.
      // A hash tokenId (0x + 64 hex) passes through unchanged; a plain name is left as-is (caller's problem).
      depositRef: toBytes32Hex(depositRef) || String(depositRef),
      tokenId: toBytes32Hex(tokenId) || String(tokenId),
      recipient: intent.recipient,
      amount: intent.amount,                 // base-unit string at WRAPPER_DECIMALS
      blockNum: entry.blockNum || entry.block || null,
      source: intent.source,
    },
  };
}

/**
 * Normalize a hex string to a 0x-prefixed 32-byte (64-hex) value for an EVM bytes32 arg.
 * Left-pads shorter hex (a 20-byte Graphene tx id -> 32 bytes); passes a 32-byte hash through.
 * Returns null if `v` isn't hex (e.g. a plain token name) or is longer than 32 bytes.
 */
export function toBytes32Hex(v) {
  const s = String(v == null ? '' : v).trim().replace(/^0x/i, '').toLowerCase();
  if (!s || !/^[0-9a-f]+$/.test(s) || s.length > 64) return null;
  return '0x' + s.padStart(64, '0');
}

/**
 * Scan a slice of MELEK account history into attestable deposits + a skip log.
 * @param {Array} history  entries [{trxId, blockNum, op}, ...]
 * @param {{custodyAccount:string, defaultTokenId?:string}} opts
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
 * Finality gate: never attest before the MELEK confirmation threshold (reorg safety, spec §6).
 * @param {{blockNum:number}} deposit
 * @param {number} headBlock  current irreversible/last MELEK block
 * @param {number} threshold  required confirmation depth
 * @returns {boolean}
 */
export function isFinal(deposit, headBlock, threshold = 20) {
  const b = deposit && deposit.blockNum;
  if (!b || !headBlock) return false;
  return headBlock - b >= threshold;
}

/**
 * The on-chain call this attester would broadcast for a deposit — descriptor only, UNSIGNED.
 * The attester's own signer (PRANA key) encodes + sends this; the Bot never does.
 * @param {{depositRef,tokenId,recipient,amount}} deposit
 * @returns {{contract:string, method:string, args:any[], unsigned:true}}
 */
export function attestationCall(deposit) {
  return {
    contract: 'GrapheneDepositBridge',
    contractAddressEnv: BRIDGE_ADDRESS_ENV,
    method: 'attestDeposit',
    args: [deposit.depositRef, deposit.tokenId, deposit.recipient, deposit.amount],
    unsigned: true,
  };
}

/**
 * Decide what to do with a derived deposit given the bridge's current on-chain state.
 * Idempotent + replay-safe per spec §6: already-processed / already-attested -> skip(success);
 * a different tuple already fixed for this ref -> mismatch (re-derive, do not tally).
 * @param {object} deposit
 * @param {{processed?:boolean, attestedByMe?:boolean, fixedTuple?:{tokenId,recipient,amount}}} state
 * @returns {{action:'skip'|'attest'|'mismatch', reason:string, call?:object}}
 */
export function planAttestation(deposit, state = {}) {
  if (!deposit || !deposit.depositRef) return { action: 'skip', reason: 'invalid-deposit' };
  if (state.processed) return { action: 'skip', reason: 'already-processed' };
  if (state.attestedByMe) return { action: 'skip', reason: 'already-attested-by-me' };
  if (state.fixedTuple) {
    const ft = state.fixedTuple;
    const same = String(ft.tokenId) === String(deposit.tokenId)
      && String(ft.recipient).toLowerCase() === String(deposit.recipient).toLowerCase()
      && String(ft.amount) === String(deposit.amount);
    if (!same) return { action: 'mismatch', reason: 'tuple-disagrees-with-fixed-first-attestation' };
  }
  return { action: 'attest', reason: 'attestable', call: attestationCall(deposit) };
}

// ---- withdrawal leg (PRANA -> MELEK) ---------------------------------------

/**
 * Parse a PRANA `GrapheneWithdrawal(nonce, tokenId, from, wrapped, amount, destinationRef)`
 * event into a release intent. `nonce` is the off-chain replay key for the release.
 * @param {object} ev  decoded event args (object or array-ish)
 * @returns {{ok:boolean, nonce?, tokenId?, from?, amount?, destinationRef?, reason?}}
 */
export function parseWithdrawal(ev) {
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'empty-event' };
  const a = ev.args || ev;
  const nonce = a.nonce ?? a[0];
  const tokenId = a.tokenId ?? a[1];
  const from = a.from ?? a[2];
  const amount = a.amount ?? a[4];
  const destinationRef = a.destinationRef ?? a[5];
  if (nonce == null) return { ok: false, reason: 'no-nonce' };
  if (!destinationRef) return { ok: false, reason: 'no-destination-ref' };
  if (amount == null) return { ok: false, reason: 'no-amount' };
  return {
    ok: true,
    nonce: String(nonce), tokenId: tokenId != null ? String(tokenId) : undefined,
    from: from != null ? String(from) : undefined, amount: String(amount),
    destinationRef: String(destinationRef),
  };
}

/**
 * Plan the MELEK-side release for a withdrawal event. Release is performed at most once per
 * PRANA nonce (spec §5/§6). Requires a DEEP PRANA confirmation first (young PoW). The actual
 * Graphene custody op is K-of-N authorised off-chain — this only NAMES the intent, unsigned.
 * @param {object} event  raw GrapheneWithdrawal event
 * @param {{releasedNonces?:Set<string>|string[], confirmed?:boolean}} ctx
 * @returns {{action:'skip'|'release', reason:string, intent?:object}}
 */
export function planRelease(event, ctx = {}) {
  const w = parseWithdrawal(event);
  if (!w.ok) return { action: 'skip', reason: w.reason };
  const released = ctx.releasedNonces instanceof Set
    ? ctx.releasedNonces
    : new Set(Array.isArray(ctx.releasedNonces) ? ctx.releasedNonces.map(String) : []);
  if (released.has(w.nonce)) return { action: 'skip', reason: 'nonce-already-released' };
  if (ctx.confirmed === false) return { action: 'skip', reason: 'awaiting-deep-prana-confirmation' };
  return {
    action: 'release',
    reason: 'releasable',
    intent: {
      chain: 'melek',
      op: 'native-transfer-from-custody',     // a K-of-N-authorised Graphene custody op
      to: w.destinationRef,
      tokenId: w.tokenId,
      amount: w.amount,
      replayKey: `prana-withdrawal-nonce:${w.nonce}`,
      unsigned: true,
    },
  };
}

// ---- manifest / CLI --------------------------------------------------------

/**
 * The relayer's config + boundary manifest — env NAMES only, no secrets, no host content.
 * @returns {object}
 */
export function relayerManifest() {
  const env = (n) => ({ name: n, set: !!(process.env[n] && String(process.env[n]).trim()) });
  return {
    role: 'MELEK->PRANA federated attester / watcher (BI8)',
    drives: 'GrapheneDepositBridge.attestDeposit (deposit) + MELEK custody release (withdrawal)',
    trustModel: 'K-of-N FederatedBridgeValidatorSet (BI1); no on-chain MELEK proof (spec §1)',
    decimals: { melekNative: MELEK_NATIVE_DECIMALS, wrapper: WRAPPER_DECIMALS },
    env: {
      melekRpc: env(MELEK_RPC_ENV),
      pranaRpc: env(PRANA_RPC_ENV),
      bridgeAddress: env(BRIDGE_ADDRESS_ENV),
      custodyAccount: env(CUSTODY_ACCOUNT_ENV),
      attesterAddress: env(ATTESTER_ADDRESS_ENV),
    },
    live: !!(process.env[PRANA_RPC_ENV] && process.env[MELEK_RPC_ENV]),
    boundary: 'holds NO key/WIF/seed; SIGNS nothing, BROADCASTS nothing — builds unsigned calls/intents only',
  };
}

if (process.argv[1] && process.argv[1].endsWith('bridge-relayer.mjs')) {
  process.stdout.write(JSON.stringify(relayerManifest(), null, 2) + '\n');
}
