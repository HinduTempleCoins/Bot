// siwe-login.mjs — Sign-In With Ethereum (SIWE / EIP-4361) wallet login (task #78).
//
// This sits ALONGSIDE the Graphene/HiveSigner login half of the connect layer
// (`walletconnect-broker.mjs` carries the session/scope shape; HiveSigner carries the
// Graphene OAuth2 path). SIWE is the EVM-side authentication primitive: an EVM user proves
// control of an address by SIGNING a server-issued nonce inside a canonical EIP-4361 message.
//
// FLOW:
//   1. createNonce(address)                 -> server mints a single-use nonce, pending.
//   2. buildMessage({...nonce...})          -> client renders the canonical EIP-4361 string.
//   3. (wallet signs the message)           -> happens in the user's wallet; we never see a key.
//   4. verify({ message, signature, address }) -> server checks nonce + signature, consumes nonce.
//
// KEY BOUNDARY: this module holds NO private keys, NO seeds, NO WIFs, and NO secrets. It only
// mints/validates nonces and validates a signature via an INJECTED verifier. The signature
// itself is produced by the user's wallet; recovery/verification of it is delegated to a real
// crypto library in production (see __setVerifier below).
//
// OFFLINE-BY-DEFAULT: signature verification is injectable. With no real verifier injected we
// fall back to a deterministic stub (documented below) so the unit tests run with ZERO crypto
// dependency. PRODUCTION MUST inject a real verifier, e.g. viem's `verifyMessage` or ethers'
// `verifyMessage` / `recoverAddress`:
//
//     import { verifyMessage } from 'viem';
//     __setVerifier(async ({ message, signature, address }) =>
//       await verifyMessage({ address, message, signature }));   // returns boolean
//
//   import { createNonce, buildMessage, parseMessage, verify, caip10For } from './siwe-login.mjs'
//   node integrations/siwe-login.mjs   # demo: mint a nonce + build the canonical message

import crypto from 'node:crypto';

// ---- error type ------------------------------------------------------------

export class SiweError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SiweError';
  }
}

// ---- injectable clock + nonce source (determinism in tests) ----------------

let _now = () => Date.now();
let _nonceSource = () => crypto.randomBytes(12).toString('hex');

/** Inject a clock returning epoch-ms. Pass null to restore the real clock. */
export function __setClock(fn) { _now = typeof fn === 'function' ? fn : () => Date.now(); }
/** Inject a nonce generator (string). Pass null to restore the random default. */
export function __setNonceSource(fn) {
  _nonceSource = typeof fn === 'function' ? fn : () => crypto.randomBytes(12).toString('hex');
}

// ---- injectable signature verifier -----------------------------------------
//
// _verify is null until set. When null, verify() uses a DETERMINISTIC STUB that accepts a
// signature iff it equals the value derived by `stubSignature(message, address)`. This lets the
// full auth path be exercised offline without any crypto library. Production injects a real
// verifier (viem/ethers verifyMessage) that recovers the signer from the signature and compares
// it to `address` — see the header for the wiring.

let _verify = null;

/**
 * Inject the real signature verifier.
 * @param {(args:{message:string, signature:string, address:string}) => (boolean|Promise<boolean>)} fn
 *   Must return true iff `signature` is a valid signature of `message` by `address`.
 *   Pass null to restore the offline deterministic stub.
 */
export function __setVerifier(fn) { _verify = typeof fn === 'function' ? fn : null; }

// Deterministic offline stub signature. NOT cryptographic — it only lets tests/demos exercise
// the nonce + consume + replay logic without a real signing library. A "valid" stub signature is
// `0xstub:` + sha256(address||message). Production never reaches this branch (a verifier is set).
export function stubSignature(message, address) {
  const h = crypto.createHash('sha256').update(`${normAddr(address)}\n${message}`).digest('hex');
  return `0xstub:${h}`;
}

async function runVerifier({ message, signature, address }) {
  if (_verify) {
    try { return !!(await _verify({ message, signature, address })); }
    catch { return false; }
  }
  // offline deterministic stub
  return signature === stubSignature(message, address);
}

// ---- pure helpers ----------------------------------------------------------

// EVM addresses are case-insensitive (we don't do EIP-55 checksum validation here — the real
// verifier handles canonicalization). Normalize for storage/compare; keep the original for the
// message body when one is supplied.
function normAddr(a) { return String(a || '').trim().toLowerCase(); }

function isEvmAddress(a) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(a || '').trim());
}

function isoNow() { return new Date(_now()).toISOString(); }

// ---- nonce store -----------------------------------------------------------
//
// Process-local single-use nonce store. nonce -> { address, issuedAt, exp, consumed }.
// A real deployment injects a shared/persistent store; the lifecycle logic is identical.

const _nonces = new Map();

/** Default nonce lifetime: 10 minutes. */
export const NONCE_TTL_MS = 10 * 60 * 1000;

/** Clear all pending nonces (test helper). */
export function __resetNonces() { _nonces.clear(); }

/**
 * Mint a single-use nonce bound to an address, stored pending.
 * @param {string} address EVM address (0x + 40 hex)
 * @param {{ ttlMs?: number }} [opts]
 * @returns {{ nonce: string, issuedAt: string, address: string, expiresAt: string }}
 */
export function createNonce(address, { ttlMs = NONCE_TTL_MS } = {}) {
  if (!isEvmAddress(address)) {
    throw new SiweError(`createNonce: invalid EVM address "${address}"`);
  }
  const nonce = String(_nonceSource());
  if (!nonce) throw new SiweError('createNonce: nonce source returned empty');
  const now = _now();
  const issuedAt = new Date(now).toISOString();
  const rec = { address: normAddr(address), issuedAt, exp: now + ttlMs, consumed: false };
  _nonces.set(nonce, rec);
  return { nonce, issuedAt, address: normAddr(address), expiresAt: new Date(rec.exp).toISOString() };
}

// ---- EIP-4361 message build / parse ----------------------------------------
//
// Canonical EIP-4361 message format (field order per the spec):
//
//   ${domain} wants you to sign in with your Ethereum account:
//   ${address}
//
//   ${statement}            (optional; blank line above only present with a statement)
//
//   URI: ${uri}
//   Version: 1
//   Chain ID: ${chainId}
//   Nonce: ${nonce}
//   Issued At: ${issuedAt}
//   Expiration Time: ${expirationTime}   (optional)
//
// We emit the required fields in spec order and append the optional ones when present.

/**
 * Build the canonical EIP-4361 message string.
 * @param {{
 *   domain: string, address: string, uri: string, chainId: (number|string), nonce: string,
 *   statement?: string, issuedAt?: string, expirationTime?: string, version?: string,
 * }} fields
 * @returns {string}
 */
export function buildMessage({
  domain, address, uri, chainId, nonce,
  statement, issuedAt, expirationTime, version = '1',
} = {}) {
  if (!domain) throw new SiweError('buildMessage: `domain` is required');
  if (!isEvmAddress(address)) throw new SiweError(`buildMessage: invalid EVM address "${address}"`);
  if (!uri) throw new SiweError('buildMessage: `uri` is required');
  if (chainId === undefined || chainId === null || chainId === '') {
    throw new SiweError('buildMessage: `chainId` is required');
  }
  if (!nonce) throw new SiweError('buildMessage: `nonce` is required');

  const at = issuedAt || isoNow();
  const lines = [];
  lines.push(`${domain} wants you to sign in with your Ethereum account:`);
  lines.push(String(address));
  lines.push(''); // blank line after the address (spec)
  if (statement) {
    lines.push(String(statement));
    lines.push(''); // blank line after the statement
  }
  lines.push(`URI: ${uri}`);
  lines.push(`Version: ${version}`);
  lines.push(`Chain ID: ${chainId}`);
  lines.push(`Nonce: ${nonce}`);
  lines.push(`Issued At: ${at}`);
  if (expirationTime) lines.push(`Expiration Time: ${expirationTime}`);
  return lines.join('\n');
}

/**
 * Parse a canonical EIP-4361 message back into its fields. Round-trips with buildMessage.
 * @param {string} msg
 * @returns {{
 *   domain, address, uri, chainId, nonce, version,
 *   statement?, issuedAt, expirationTime?,
 * }}
 */
export function parseMessage(msg) {
  if (typeof msg !== 'string' || !msg.trim()) {
    throw new SiweError('parseMessage: expected a non-empty message string');
  }
  const lines = msg.split('\n');
  const out = {};

  const m0 = /^(.+) wants you to sign in with your Ethereum account:$/.exec(lines[0] || '');
  if (!m0) throw new SiweError('parseMessage: missing/invalid header line');
  out.domain = m0[1];

  out.address = (lines[1] || '').trim();
  if (!isEvmAddress(out.address)) {
    throw new SiweError(`parseMessage: invalid address line "${lines[1]}"`);
  }
  // line[2] is the mandatory blank line after the address.
  if (lines[2] !== '') throw new SiweError('parseMessage: expected blank line after address');

  // Everything from line 3 onward: an optional statement (terminated by a blank line) then the
  // labeled key: value fields.
  let i = 3;
  // A statement is present iff the first non-field line at i is not a known `Key: value` field.
  const FIELD_RE = /^(URI|Version|Chain ID|Nonce|Issued At|Expiration Time): (.*)$/;
  if (lines[i] !== undefined && !FIELD_RE.test(lines[i])) {
    out.statement = lines[i];
    i += 1;
    if (lines[i] !== '') throw new SiweError('parseMessage: expected blank line after statement');
    i += 1;
  }

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    const m = FIELD_RE.exec(line);
    if (!m) throw new SiweError(`parseMessage: unrecognized line "${line}"`);
    const [, key, val] = m;
    switch (key) {
      case 'URI': out.uri = val; break;
      case 'Version': out.version = val; break;
      case 'Chain ID': out.chainId = val; break;
      case 'Nonce': out.nonce = val; break;
      case 'Issued At': out.issuedAt = val; break;
      case 'Expiration Time': out.expirationTime = val; break;
      default: break;
    }
  }

  for (const req of ['uri', 'version', 'chainId', 'nonce', 'issuedAt']) {
    if (out[req] === undefined) throw new SiweError(`parseMessage: missing required field "${req}"`);
  }
  return out;
}

// ---- CAIP-10 account id ----------------------------------------------------

/**
 * Build a CAIP-10 account id for an EVM address on a chain. Uses the repo's caip helper when
 * available (defensive import), else falls back to the plain `eip155:<chainId>:<address>` form.
 * @param {string} address
 * @param {(number|string)} chainId
 * @returns {Promise<string>}
 */
export async function caip10For(address, chainId) {
  const chainNum = String(chainId);
  const fallback = `eip155:${chainNum}:${normAddr(address)}`;
  try {
    const caip = await import('../src/chain/caip.mjs');
    if (typeof caip.formatAccountId === 'function') {
      const id = caip.formatAccountId(
        { chainId: `eip155:${chainNum}`, address: normAddr(address) },
        { soft: true },
      );
      if (id) return id;
    }
  } catch { /* caip module unavailable — use the fallback below */ }
  return fallback;
}

// ---- verify: the auth check ------------------------------------------------

/**
 * Verify a SIWE login attempt. Soft-fail: returns { ok:false, reason } for ALL auth failures
 * (bad signature, unknown/expired/consumed nonce, address mismatch) — it never throws on a bad
 * signature. On success the nonce is CONSUMED (single-use; replays return ok:false).
 *
 * @param {{ message: string, signature: string, address: string }} args
 * @returns {Promise<{ ok: boolean, address?: string, caip10?: string, reason?: string }>}
 */
export async function verify({ message, signature, address } = {}) {
  if (typeof message !== 'string' || !message) return { ok: false, reason: 'no-message' };
  if (typeof signature !== 'string' || !signature) return { ok: false, reason: 'no-signature' };
  if (!isEvmAddress(address)) return { ok: false, reason: 'bad-address' };

  // 1. message must parse.
  let fields;
  try { fields = parseMessage(message); } catch { return { ok: false, reason: 'unparseable-message' }; }

  // 2. address in the message must match the claimed address.
  if (normAddr(fields.address) !== normAddr(address)) {
    return { ok: false, reason: 'address-mismatch' };
  }

  // 3. nonce must be known.
  const rec = _nonces.get(fields.nonce);
  if (!rec) return { ok: false, reason: 'unknown-nonce' };

  // 4. nonce must be bound to this address.
  if (rec.address !== normAddr(address)) return { ok: false, reason: 'nonce-address-mismatch' };

  // 5. nonce must not be consumed.
  if (rec.consumed) return { ok: false, reason: 'nonce-already-used' };

  // 6. nonce must not be expired.
  if (_now() > rec.exp) return { ok: false, reason: 'nonce-expired' };

  // 7. honor an in-message Expiration Time if present.
  if (fields.expirationTime) {
    const expMs = Date.parse(fields.expirationTime);
    if (!Number.isNaN(expMs) && _now() > expMs) return { ok: false, reason: 'message-expired' };
  }

  // 8. signature must verify (via injected verifier; offline stub otherwise). Soft-fail.
  const sigOk = await runVerifier({ message, signature, address });
  if (!sigOk) return { ok: false, reason: 'bad-signature' };

  // success — consume the nonce (single-use).
  rec.consumed = true;

  const chainId = fields.chainId ?? '1';
  const caip10 = await caip10For(address, chainId);
  return { ok: true, address: normAddr(address), caip10 };
}

// ---- CLI (guarded) ---------------------------------------------------------

async function runCli() {
  const address = '0x1234567890abcdef1234567890abcdef12345678';
  const { nonce, issuedAt } = createNonce(address);
  const msg = buildMessage({
    domain: 'soapy.blog',
    address,
    uri: 'https://soapy.blog/login',
    chainId: 1,
    nonce,
    issuedAt,
    statement: 'Sign in to the MELEK portal.',
  });
  process.stdout.write('--- EIP-4361 message ---\n');
  process.stdout.write(msg + '\n\n');
  // demonstrate the offline path with the deterministic stub signature.
  const sig = stubSignature(msg, address);
  const res = await verify({ message: msg, signature: sig, address });
  process.stdout.write('verify (offline stub): ' + JSON.stringify(res) + '\n');
  process.stdout.write('replay (same nonce):   ' + JSON.stringify(await verify({ message: msg, signature: sig, address })) + '\n');
}

if (process.argv[1] && process.argv[1].endsWith('siwe-login.mjs')) {
  runCli();
}
