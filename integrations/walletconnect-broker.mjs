// walletconnect-broker.mjs — the connect-layer broker (queue #166).
//
// One interface for connecting external wallets across families:
//   - EVM / Solana / Bitcoin  via the WalletConnect protocol (Reown/WalletConnect,
//     CAIP-25 sessions: a request lists required/optional namespaces, the wallet
//     approves a subset, the result is a session of granted scopes).
//   - Graphene (Hive-family / MELEK)  via HiveSigner (OAuth2 bearer) or Keychain
//     (browser extension). These do not speak WalletConnect, so we model them as a
//     first-class namespace in the SAME CAIP-25 session shape and route them to the
//     Graphene signer path.
//
// This module is PURE session/scope logic. It performs NO live wallet calls, opens
// NO sockets, talks to NO relay, and NEVER touches a private key. It only builds the
// session-request descriptor, runs the in-memory session lifecycle, and computes the
// scoped CAPABILITIES a connected wallet authorizes. Actual signing/broadcast is done
// elsewhere by the signer — the signer is the SOLE key boundary. A capability says
// "this session may call this method on this chain"; it is never a key, seed, or WIF.
//
// LICENSING NOTE: the WalletConnect *protocol* (CAIP-25 / pairing / the relay JSON-RPC
// envelope) is open. Reown AppKit (the prebuilt connect UI + the hosted relay/Cloud
// project, formerly WalletConnect Cloud) is delivered under a Reown Community License
// and depends on Reown infrastructure (a Reown/WalletConnect project id + relay). So
// there is a decision to make at integration time: SELF-HOST the relay and pairing
// against the open protocol, or use the Reown-hosted relay (license + project id). This
// broker is relay-agnostic — it produces the session descriptors either path consumes.
//
//   import { connect, approve, reject, disconnect, grantScope, getSession, listSessions }
//     from './integrations/walletconnect-broker.mjs'
//
//   const req = connect({ chains: ['eip155:1', 'hive:melek'], methods: ['eth_sendTransaction', 'comment'] })
//   const ses = approve(req.id, { accounts: { 'eip155:1': ['0xabc...'], 'hive:melek': ['hathor'] } })
//   grantScope(ses)   // { 'eip155:1': { methods, accounts, ... }, ... }  — capabilities, NEVER keys
//   disconnect(ses.id)
//
//   node integrations/walletconnect-broker.mjs   # demo: build + approve a session, print scopes

import crypto from 'node:crypto';
import {
  parseChainId,
  buildScopes,
  parseScopes,
  scopeAllows,
  isEvm,
  isGraphene,
} from '../src/chain/caip.mjs';

// ---- error type ------------------------------------------------------------

export class BrokerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrokerError';
  }
}

// ---- session states --------------------------------------------------------

export const SESSION_PENDING = 'pending';
export const SESSION_ACTIVE = 'active';
export const SESSION_REJECTED = 'rejected';
export const SESSION_DISCONNECTED = 'disconnected';

// Default per-namespace methods. Graphene gets Graphene op names; EVM/Solana/Bitcoin
// get their conventional WalletConnect method names. These are advisory defaults used
// when a caller does not pin methods explicitly.
const DEFAULT_METHODS = {
  eip155: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4'],
  solana: ['solana_signTransaction', 'solana_signMessage'],
  bip122: ['bitcoin_sendTransfer', 'signMessage'], // CAIP namespace for Bitcoin
  // Graphene family — standard Graphene ops only (per the Bot's no-custom-ops rule).
  hive: ['comment', 'vote', 'transfer', 'custom_json'],
  steem: ['comment', 'vote', 'transfer', 'custom_json'],
  blurt: ['comment', 'vote', 'transfer', 'custom_json'],
  melek: ['comment', 'vote', 'transfer', 'custom_json'],
  graphene: ['comment', 'vote', 'transfer', 'custom_json'],
};

// Which connect transport carries a given namespace. Graphene → HiveSigner/Keychain;
// everything else → the WalletConnect protocol.
function transportFor(chainId) {
  return isGraphene(chainId) ? 'graphene' : 'walletconnect';
}

function defaultMethodsFor(chainId) {
  const parsed = parseChainId(chainId, { soft: true });
  if (!parsed) return [];
  return DEFAULT_METHODS[parsed.namespace] || [];
}

// ---- in-memory session store -----------------------------------------------
//
// Process-local only. No persistence, no I/O. A real deployment would back this with
// the vault/store, but the lifecycle logic is identical.

const _requests = new Map(); // id -> request descriptor (pending)
const _sessions = new Map(); // id -> active/closed session

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

// ---- connect: build a CAIP-25 session request ------------------------------

/**
 * Build a CAIP-25 session-request descriptor for a set of chains + methods.
 *
 * The result groups chains into CAIP-25 `namespaces`, each carrying its `chains`,
 * the `methods` it may call, and `events`/notifications. This is exactly the shape a
 * WalletConnect proposal expects, and the same shape we hand the Graphene signer for
 * Hive-family chains. NOTHING is connected yet — this is the proposal.
 *
 * @param {{
 *   chains: string[],                // CAIP-2 chain ids, e.g. ['eip155:1', 'hive:melek']
 *   methods?: string[],              // methods to request across all chains (else per-ns defaults)
 *   events?: string[],               // notification/event names to request
 *   optionalChains?: string[],       // chains the wallet MAY but need not approve
 *   metadata?: object,               // dapp metadata (name/url/...), opaque passthrough
 * }} params
 * @returns {{
 *   id: string,
 *   state: 'pending',
 *   createdAt: number,
 *   requiredNamespaces: Record<string, {chains:string[], methods:string[], events:string[]}>,
 *   optionalNamespaces: Record<string, {chains:string[], methods:string[], events:string[]}>,
 *   transports: Record<string, string>,   // chainId -> 'walletconnect' | 'graphene'
 *   metadata: object,
 * }}
 */
export function connect({ chains, methods, events = [], optionalChains = [], metadata = {} } = {}) {
  if (!Array.isArray(chains) || chains.length === 0) {
    throw new BrokerError('connect: `chains` must be a non-empty array of CAIP-2 chain ids');
  }
  for (const c of chains) {
    if (!parseChainId(c, { soft: true })) {
      throw new BrokerError(`connect: invalid CAIP-2 chainId "${c}"`);
    }
  }
  for (const c of optionalChains) {
    if (!parseChainId(c, { soft: true })) {
      throw new BrokerError(`connect: invalid optional CAIP-2 chainId "${c}"`);
    }
  }
  if (methods !== undefined && !Array.isArray(methods)) {
    throw new BrokerError('connect: `methods` must be an array when provided');
  }
  if (!Array.isArray(events)) {
    throw new BrokerError('connect: `events` must be an array');
  }

  const requiredNamespaces = groupNamespaces(chains, methods, events);
  const optionalNamespaces = optionalChains.length
    ? groupNamespaces(optionalChains, methods, events)
    : {};

  const transports = {};
  for (const c of [...chains, ...optionalChains]) transports[c] = transportFor(c);

  const req = {
    id: newId('wcreq'),
    state: SESSION_PENDING,
    createdAt: Date.now(),
    requiredNamespaces,
    optionalNamespaces,
    transports,
    metadata: { ...metadata },
  };
  _requests.set(req.id, req);
  return req;
}

// Group an array of chainIds by CAIP namespace into the CAIP-25 namespace map.
function groupNamespaces(chains, methods, events) {
  const out = {};
  for (const chainId of chains) {
    const { namespace } = parseChainId(chainId); // validated by caller
    if (!out[namespace]) out[namespace] = { chains: [], methods: [], events: [] };
    if (!out[namespace].chains.includes(chainId)) out[namespace].chains.push(chainId);
    const ms = methods && methods.length ? methods : defaultMethodsFor(chainId);
    out[namespace].methods = [...new Set([...out[namespace].methods, ...ms])];
    out[namespace].events = [...new Set([...out[namespace].events, ...events])];
  }
  return out;
}

// ---- lifecycle: approve / reject / disconnect ------------------------------

/**
 * Approve a pending session request, binding wallet-supplied accounts.
 *
 * @param {string} requestId  id returned by connect()
 * @param {{
 *   accounts: Record<string, string[]>,   // chainId -> [address/account, ...]
 *   methods?: Record<string, string[]>,    // optional per-chain method narrowing
 * }} approval
 * @returns {object} the active session
 */
export function approve(requestId, { accounts, methods } = {}) {
  const req = _requests.get(requestId);
  if (!req) throw new BrokerError(`approve: unknown or already-resolved request "${requestId}"`);
  if (req.state !== SESSION_PENDING) {
    throw new BrokerError(`approve: request "${requestId}" is ${req.state}, not pending`);
  }
  if (!accounts || typeof accounts !== 'object') {
    throw new BrokerError('approve: `accounts` must be a map of chainId -> address[]');
  }

  // Build the granted scope set, intersecting requested methods with any narrowing the
  // wallet applied. The wallet may approve a subset of requested chains.
  const scopeEntries = [];
  const sessionAccounts = {};
  for (const ns of Object.values(req.requiredNamespaces)) {
    for (const chainId of ns.chains) {
      const acctList = accounts[chainId];
      if (!Array.isArray(acctList) || acctList.length === 0) continue; // wallet declined this chain
      const requested = ns.methods;
      const narrowed = methods && Array.isArray(methods[chainId]) ? methods[chainId] : requested;
      const grantedMethods = requested.filter((m) => narrowed.includes(m));
      scopeEntries.push({ chainId, methods: grantedMethods, notifications: ns.events });
      sessionAccounts[chainId] = [...acctList];
    }
  }
  if (scopeEntries.length === 0) {
    throw new BrokerError('approve: no requested chains were granted accounts');
  }

  const scopes = buildScopes(scopeEntries);
  const session = {
    id: newId('wcses'),
    requestId,
    state: SESSION_ACTIVE,
    createdAt: Date.now(),
    accounts: sessionAccounts,
    scopes,
    transports: { ...req.transports },
    metadata: { ...req.metadata },
  };
  _sessions.set(session.id, session);
  req.state = SESSION_ACTIVE;
  _requests.delete(requestId);
  return session;
}

/**
 * Reject a pending session request.
 * @param {string} requestId
 * @param {string} [reason]
 * @returns {{id: string, state: 'rejected', reason: string}}
 */
export function reject(requestId, reason = 'user_rejected') {
  const req = _requests.get(requestId);
  if (!req) throw new BrokerError(`reject: unknown or already-resolved request "${requestId}"`);
  if (req.state !== SESSION_PENDING) {
    throw new BrokerError(`reject: request "${requestId}" is ${req.state}, not pending`);
  }
  req.state = SESSION_REJECTED;
  _requests.delete(requestId);
  return { id: requestId, state: SESSION_REJECTED, reason: String(reason) };
}

/**
 * Disconnect (close) an active session.
 * @param {string} sessionId
 * @returns {object} the closed session
 */
export function disconnect(sessionId) {
  const ses = _sessions.get(sessionId);
  if (!ses) throw new BrokerError(`disconnect: unknown session "${sessionId}"`);
  ses.state = SESSION_DISCONNECTED;
  ses.closedAt = Date.now();
  return ses;
}

// ---- introspection ---------------------------------------------------------

/** Fetch a session (active or closed) by id, or undefined. */
export function getSession(sessionId) {
  return _sessions.get(sessionId);
}

/** Fetch a pending request by id, or undefined. */
export function getRequest(requestId) {
  return _requests.get(requestId);
}

/** List sessions, optionally filtered by state. */
export function listSessions({ state } = {}) {
  const all = [..._sessions.values()];
  return state ? all.filter((s) => s.state === state) : all;
}

// ---- grantScope: the scoped capabilities a connected wallet authorizes ------

/**
 * Compute the scoped CAPABILITIES an active session authorizes. This is the answer to
 * "what may this connected wallet do?" — a per-chain capability descriptor:
 *   { chainId: { namespace, transport, accounts, methods, notifications, signsVia } }
 *
 * It is explicitly NOT a key, seed, WIF, or any signing material. `signsVia` names the
 * boundary that will actually sign — the WalletConnect-paired wallet, or the Graphene
 * signer (HiveSigner/Keychain) — but this broker never holds or returns that material.
 *
 * @param {object} session  an active session from approve()
 * @returns {Record<string, {
 *   chainId: string,
 *   namespace: string,
 *   transport: 'walletconnect'|'graphene',
 *   accounts: string[],
 *   methods: string[],
 *   notifications: string[],
 *   signsVia: string,
 *   isEvm: boolean,
 *   isGraphene: boolean,
 * }>}
 */
export function grantScope(session) {
  if (!session || typeof session !== 'object') {
    throw new BrokerError('grantScope: expected a session object');
  }
  if (session.state !== SESSION_ACTIVE) {
    throw new BrokerError(`grantScope: session is ${session.state}, not active`);
  }
  const scopes = parseScopes(session.scopes);
  const caps = {};
  for (const [chainId, scope] of Object.entries(scopes)) {
    const parsed = parseChainId(chainId);
    const transport = session.transports?.[chainId] || transportFor(chainId);
    caps[chainId] = {
      chainId,
      namespace: parsed.namespace,
      transport,
      accounts: [...(session.accounts?.[chainId] || [])],
      methods: [...scope.methods],
      notifications: [...scope.notifications],
      // The signer is the sole key boundary. We name it; we never embody it.
      signsVia: transport === 'graphene' ? 'graphene-signer (HiveSigner/Keychain)' : 'walletconnect-wallet',
      isEvm: isEvm(chainId),
      isGraphene: isGraphene(chainId),
    };
  }
  return caps;
}

/**
 * Convenience guard: does an active session permit `method` on `chainId`?
 * @param {object} session
 * @param {string} chainId
 * @param {string} method
 * @returns {boolean}
 */
export function sessionAllows(session, chainId, method) {
  if (!session || session.state !== SESSION_ACTIVE) return false;
  return scopeAllows(session.scopes, chainId, method);
}

// ---- CLI -------------------------------------------------------------------

function runCli() {
  const req = connect({
    chains: ['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'hive:melek'],
    methods: undefined,
  });
  process.stdout.write('session request (CAIP-25 namespaces):\n');
  process.stdout.write(JSON.stringify(req.requiredNamespaces, null, 2) + '\n\n');

  const ses = approve(req.id, {
    accounts: {
      'eip155:1': ['0x1234567890abcdef1234567890abcdef12345678'],
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': ['SoLDemoAccountPubkey'],
      'hive:melek': ['hathor'],
    },
  });
  process.stdout.write('granted scope (capabilities, NEVER keys):\n');
  process.stdout.write(JSON.stringify(grantScope(ses), null, 2) + '\n');
  disconnect(ses.id);
}

if (process.argv[1] && process.argv[1].endsWith('walletconnect-broker.mjs')) {
  runCli();
}
