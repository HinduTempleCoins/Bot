// adapter.mjs — the universal ChainAdapter interface + registry (queue #164).
//
// One interface every chain family implements, so the rest of the Bot can talk
// to MELEK (Graphene), and later EVM / Cosmos / Solana / etc., through a single
// shape. The CONCRETE Graphene client is src/chain/graphene.js — this file does
// NOT replace it; it defines the generalized contract that graphene.js (and
// future families) conform to, plus a registry so callers pick a family by name.
//
//   import { ChainAdapter, registry, register, get, GrapheneAdapterStub,
//            isGrant, isInterfaceConformant } from './adapter.mjs'
//   node src/chain/adapter.mjs            # print the registered families
//
// Key-custody invariant (BRIEF.md §7, SECURITY.md): signAndSend takes a GRANT —
// a scoped, revocable capability handle (e.g. a MELEK-Signer bearer token) — and
// NEVER a raw private key (WIF). Adapters must reject raw-key-shaped arguments.

// ---- the method names every conforming adapter must provide ----
export const REQUIRED_METHODS = Object.freeze([
  'connect',
  'readBalance',
  'readAssets',
  'signAndSend',
  'resolveName',
  'fetchFile',
]);

// ---- grant shape ----------------------------------------------------------
// A grant is a scoped capability handle, never a key. We accept either:
//   { kind: 'grant', token, scope?, expiresAt? }   — explicit
// or an object that at minimum declares kind === 'grant'. We REJECT anything
// that smells like a raw private key (WIF), so a leaked key can never be passed
// in by mistake.

// Graphene/Bitcoin-family WIF: base58, ~51 chars, typically starts with '5',
// 'K', or 'L'. Also reject 0x-hex 64-char EVM private keys. Conservative on
// purpose — a false-positive here is a refused call, never a leaked key.
const WIF_RE = /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/;
const HEX_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;

/** True if the string looks like a raw private key (WIF or 0x-hex). */
export function looksLikeRawKey(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return WIF_RE.test(s) || HEX_KEY_RE.test(s);
}

/** True if `g` is a well-formed grant handle (scoped capability, not a key). */
export function isGrant(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return false;
  if (g.kind !== 'grant') return false;
  // a grant must carry SOME capability reference (token/handle/id), and must
  // not be a bare key smuggled under a token field.
  const ref = g.token ?? g.handle ?? g.id;
  if (typeof ref !== 'string' || ref.length === 0) return false;
  if (looksLikeRawKey(ref)) return false;
  return true;
}

/**
 * Guard for signAndSend implementations. Throws if `grant` is not a valid grant
 * handle — in particular if it's a raw key or a raw-key string. Call this first
 * in every concrete signAndSend.
 */
export function assertGrant(grant) {
  if (typeof grant === 'string' && looksLikeRawKey(grant)) {
    throw new Error('signAndSend: refusing raw private key — pass a scoped grant handle, never a WIF');
  }
  if (isGrant(grant)) return grant;
  // surface the most useful message: a key smuggled inside a grant field, vs a
  // plain malformed arg.
  if (grant && typeof grant === 'object') {
    const ref = grant.token ?? grant.handle ?? grant.id;
    if (typeof ref === 'string' && looksLikeRawKey(ref)) {
      throw new Error('signAndSend: grant token looks like a raw private key — refused');
    }
  }
  throw new Error('signAndSend: expected a grant handle { kind: "grant", token } — got ' + describe(grant));
}

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// ---- base / abstract adapter ---------------------------------------------
// Sensible soft-fail defaults: reads return empty, name resolution returns the
// input unchanged, fetchFile returns null, connect is a no-op. signAndSend has
// no safe default (it would be a silent drop of a grant), so the base throws
// "not implemented" — but still enforces the grant shape first, so even a
// half-built adapter can never be handed a raw key.

export class ChainAdapter {
  /** @param {{ family?: string }} [opts] */
  constructor({ family = 'abstract' } = {}) {
    this.family = family;
  }

  /** Establish/verify connectivity. Soft-fail no-op by default. */
  async connect() {
    return { connected: false, family: this.family };
  }

  /**
   * Read the native/liquid balance for an account.
   * @returns {Promise<{ account: string, balance: string|null }>}
   */
  async readBalance(account) {
    return { account: account ?? null, balance: null };
  }

  /**
   * Read all asset balances for an account (multi-asset chains).
   * @returns {Promise<Array<{ symbol: string, amount: string }>>}
   */
  async readAssets(_account) {
    return [];
  }

  /**
   * Sign and broadcast a scoped grant (capability), NEVER a raw key.
   * Base enforces the grant shape, then refuses to actually send (no concrete
   * signer here). Concrete adapters override but should still call assertGrant.
   * @param {{ kind: 'grant', token: string }} grant
   */
  async signAndSend(grant) {
    assertGrant(grant);
    throw new Error(`signAndSend not implemented for family "${this.family}"`);
  }

  /**
   * Resolve a human-friendly name to a canonical on-chain account/address.
   * Soft-fail: returns the input unchanged.
   */
  async resolveName(name) {
    return name ?? null;
  }

  /**
   * Fetch a content URI (ipfs://, ar://, on-chain ref, https…). Soft-fail null.
   * @returns {Promise<{ uri: string, content: string|Uint8Array } | null>}
   */
  async fetchFile(_uri) {
    return null;
  }
}

// ---- interface conformance check -----------------------------------------
/**
 * Returns { ok, missing[] } — `ok` true when `adapter` exposes every required
 * method as a function. Used by tests and by register() to keep junk out.
 */
export function isInterfaceConformant(adapter) {
  const missing = [];
  if (!adapter || (typeof adapter !== 'object' && typeof adapter !== 'function')) {
    return { ok: false, missing: [...REQUIRED_METHODS] };
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof adapter[m] !== 'function') missing.push(m);
  }
  return { ok: missing.length === 0, missing };
}

// ---- registry -------------------------------------------------------------
export const registry = new Map();

/**
 * Register an adapter instance under a chain-family key (e.g. 'graphene').
 * Rejects non-conformant adapters so callers can trust get(family).
 */
export function register(family, adapter) {
  if (typeof family !== 'string' || !family) {
    throw new Error('register: family must be a non-empty string');
  }
  const { ok, missing } = isInterfaceConformant(adapter);
  if (!ok) {
    throw new Error(`register: adapter for "${family}" missing methods: ${missing.join(', ')}`);
  }
  registry.set(family, adapter);
  return adapter;
}

/** Look up a registered adapter by family. Returns undefined if absent. */
export function get(family) {
  return registry.get(family);
}

/** List registered family keys. */
export function families() {
  return [...registry.keys()];
}

// ---- reference GrapheneAdapter STUB --------------------------------------
// Conforms to the interface and shows how the REAL src/chain/graphene.js maps
// onto it. This is a STUB only — it does not import dhive, hold keys, or
// broadcast. The live implementation lives in graphene.js (do NOT edit it).
export class GrapheneAdapterStub extends ChainAdapter {
  constructor({ rpcUrl, network = 'MELEK' } = {}) {
    super({ family: 'graphene' });
    this.rpcUrl = rpcUrl;
    this.network = network;
  }

  async connect() {
    // real impl: new dhive Client(rpcUrl, { chainId, addressPrefix })
    return { connected: false, family: this.family, network: this.network, stub: true };
  }

  async readBalance(account) {
    // real impl: client.database.getAccounts([account]) → acct.balance
    return { account: account ?? null, balance: null, stub: true };
  }

  async readAssets(account) {
    // real impl: liquid + savings + (Hive-Engine custom_json tokens)
    return [];
  }

  async signAndSend(grant) {
    // The real graphene.js signs with a posting/active key held by MELEK-Signer.
    // Here we ONLY prove the grant gate: assert the shape, never touch a key.
    assertGrant(grant);
    return { broadcast: false, stub: true, family: this.family, via: 'grant' };
  }

  async resolveName(name) {
    // Graphene account names are already canonical; lowercase to normalize.
    return typeof name === 'string' ? name.toLowerCase() : null;
  }

  async fetchFile(uri) {
    // real impl: resolve on-chain content refs / IPFS gateways
    return null;
  }
}

// ---- CLI ------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('adapter.mjs')) {
  register('graphene', new GrapheneAdapterStub({ rpcUrl: process.env.MELEK_RPC_URL }));
  console.log('ChainAdapter registry — registered families:');
  for (const fam of families()) {
    const a = get(fam);
    const { ok } = isInterfaceConformant(a);
    console.log(`  • ${fam}  (conformant: ${ok})`);
  }
  console.log('\nRequired interface:', REQUIRED_METHODS.join(', '));
  console.log('signAndSend takes a GRANT handle { kind:"grant", token } — never a raw key.');
}
