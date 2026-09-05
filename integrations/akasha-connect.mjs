// akasha-connect.mjs — Bot-side connection-point adapter for Akasha (old-queue #292).
//
// Akasha is the ecosystem's MetaMask/TronLink/Phantom: a self-custody, two-track WALLET
// (EVM track = PRANA; Graphene track = MELEK / SOAP) presenting ONE identity. Its specs
// (design/akasha/{unified-identity,graphene-signer,bridge-initiate,cashout-rails}-spec.md,
// surveyed read-only in /workspaces/PRANA) expect a host ecosystem to publish a small,
// stable DESCRIPTOR surface its `resolveSignerFor(chain)` and bridge/pool flows agree on:
//
//   1. a CHAIN-DESCRIPTOR REGISTRY  — logical chain -> { track, CAIP-2 id, RPC env,
//      address format, symbols, prefix }. This is the chain->track map AK6 routes on.
//   2. a POOL LINKAGE descriptor     — the payout-address boundary for pool.soapbox.community
//      (Miningcore /api/pools, stratum families, the stagenet-twin login rule).
//   3. a BRIDGE LINKAGE descriptor    — the two bridge routes the wallet INITIATES (it never
//      finalizes — relayer/attester federation does that). Bot side only NAMES endpoints/env.
//
// This module is PURE DESCRIPTORS + a tiny composition over modules that already exist
// (src/chain/caip.mjs, integrations/chains/multichain.mjs, pool/www/wizard.mjs,
// integrations/pool-stats.mjs). It holds NO key/WIF/seed/signer, signs NOTHING, broadcasts
// NOTHING — the signer is the SOLE key boundary and lives in Akasha / the MELEK-Signer repo
// (BRIEF.md §7; design/akasha/signer-boundary-audit-checklist.md AK23). It SOFT-FAILS until
// PRANA_RPC_URL is set: PRANA-dependent fields resolve via env getters and degrade clean,
// never throw, never fabricate beyond the documented placeholder.
//
//   import { chainRegistry, chainDescriptor, poolLinkage, bridgeLinkage,
//            resolveTrack, isLive, connectionManifest, __setFetch }
//     from './akasha-connect.mjs'
//
//   node integrations/akasha-connect.mjs            # print the connection manifest

import {
  formatChainId,
  forHive,
  forPrana,
  isEvm,
  isGraphene,
} from '../src/chain/caip.mjs';

// Defensive dynamic-import loaders supply the real modules; tests can inject overrides.
// Everything degrades to a soft-fail (a documented default) rather than throwing.
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- env names (NAMES only, never secrets in code) -------------------------
// Mirror integrations/chains/multichain.mjs so the registry and the live reader agree.
export const PRANA_RPC_ENV = 'PRANA_RPC_URL';
export const PRANA_CHAIN_ID_ENV = 'PRANA_CHAIN_ID';
export const MELEK_RPC_ENV = 'MELEK_RPC_URL';
// PRANA MAINNET chainId (0xADE19 = 712217). The alpha/testnet chain is 108369 — not this.
const PRANA_CHAIN_ID_PLACEHOLDER = '712217';

// Resolved per-access so setting env after import still takes effect (no frozen-at-import bug).
function pranaChainId() {
  return process.env[PRANA_CHAIN_ID_ENV] || PRANA_CHAIN_ID_PLACEHOLDER;
}
function pranaRpcSet() {
  return !!(process.env[PRANA_RPC_ENV] && String(process.env[PRANA_RPC_ENV]).trim());
}

// ---- the chain-descriptor registry -----------------------------------------
//
// The map Akasha's resolveSignerFor(chain) needs: logical chain -> how to address it,
// which track signs it, what its symbols/prefix/RPC env are. `track` is 'evm' | 'graphene'
// (the two Akasha tracks). Graphene chains are MELEK + SOAP; EVM is PRANA.
//
// Testnet note: MELEK testnet uses prefix `TST` and symbols TESTS/TBD (CLAUDE.md Status);
// mainnet uses `MELEK` and MELEK/MBD. We expose BOTH under one entry so a caller selects
// the network it is on without a second descriptor.

const REGISTRY_BASE = {
  prana: {
    chain: 'prana',
    track: 'evm',
    namespace: 'eip155',
    // CAIP-2 reference is the eip155 chain id (decimal). Resolved per-access (env or placeholder).
    get reference() { return pranaChainId(); },
    get caip2() { return formatChainId({ namespace: 'eip155', reference: pranaChainId() }, { soft: true }); },
    addressFormat: 'evm-0x',           // 20-byte keccak address, 0x + 40 hex
    rpcEnv: PRANA_RPC_ENV,
    chainIdEnv: PRANA_CHAIN_ID_ENV,
    symbol: 'PRANA',
    feeSymbol: 'PRANA',
    // EVM accountId builder for a 0x address on PRANA.
    accountId: (addr) => forPrana(addr),
    note: 'EVM value/compute L1. DORMANT until PRANA_RPC_URL set; readers soft-fail clean.',
  },
  melek: {
    chain: 'melek',
    track: 'graphene',
    namespace: 'hive',                 // CAIP-2 namespace the Bot uses for Graphene (see caip.mjs)
    reference: 'melek',
    caip2: 'hive:melek',
    addressFormat: 'graphene-pubkey',  // PREFIX + base58(pub||ripemd160-checksum)
    rpcEnv: MELEK_RPC_ENV,
    // mainnet prefix/symbols; testnet twin alongside (CLAUDE.md: TST + TESTS/TBD)
    prefix: 'MELEK',
    symbol: 'MELEK',
    feeSymbol: 'MBD',
    testnet: { prefix: 'TST', symbol: 'TESTS', feeSymbol: 'TBD' },
    roles: ['posting', 'active', 'owner', 'memo'], // login = posting only (wallet-security rule #2)
    accountId: (account) => forHive(account, { network: 'melek' }),
    note: 'Graphene social chain. hathor is the founding witness. Standard ops only — no custom AI ops.',
  },
  soap: {
    chain: 'soap',
    track: 'graphene',
    namespace: 'hive',
    reference: 'soap',
    caip2: 'hive:soap',
    addressFormat: 'graphene-pubkey',
    rpcEnv: 'SOAP_RPC_URL',
    prefix: 'SOAP',
    symbol: 'SOAP',
    feeSymbol: 'SBD',
    roles: ['posting', 'active', 'owner', 'memo'],
    accountId: (account) => forHive(account, { network: 'soap' }),
    note: 'Graphene chain sharing the MELEK track (graphene-signer). BitShares-family DEX side.',
  },
};

/**
 * The full chain-descriptor registry, with env-resolved fields evaluated to plain values.
 * @returns {Record<string, object>} chain -> descriptor (snapshot; getters flattened)
 */
export function chainRegistry() {
  const out = {};
  for (const [k, v] of Object.entries(REGISTRY_BASE)) {
    out[k] = chainDescriptor(k);
  }
  return out;
}

/**
 * One chain descriptor by logical chain name (case-insensitive). null if unknown.
 * Env-resolved getters (PRANA reference/caip2) are flattened to current values.
 * @param {string} chain  'prana' | 'melek' | 'soap'
 * @returns {object|null}
 */
export function chainDescriptor(chain) {
  const base = REGISTRY_BASE[String(chain || '').toLowerCase()];
  if (!base) return null;
  // Flatten getters; keep the function fields (accountId) as-is.
  const d = {};
  for (const key of Object.keys(base)) {
    const desc = Object.getOwnPropertyDescriptor(base, key);
    d[key] = desc && typeof desc.get === 'function' ? base[key] : base[key];
  }
  d.live = isLive(chain);
  return d;
}

/**
 * Resolve which Akasha TRACK signs a chain — the core of resolveSignerFor(chain).
 * Accepts a logical chain name ('prana'/'melek'/'soap') OR a CAIP-2 id ('eip155:1','hive:melek').
 * @param {string} chain
 * @returns {'evm'|'graphene'|null}
 */
export function resolveTrack(chain) {
  const c = String(chain || '').toLowerCase();
  if (REGISTRY_BASE[c]) return REGISTRY_BASE[c].track;
  // CAIP-2 fallback: classify by namespace.
  if (isEvm(chain)) return 'evm';
  if (isGraphene(chain)) return 'graphene';
  return null;
}

/**
 * Is a chain "live" / connectable from the Bot's side right now?
 * Graphene chains (melek/soap) are considered live (the condenser/steemd is queryable).
 * PRANA is live only once PRANA_RPC_URL is set (dormant otherwise — soft-fail, never throw).
 * @param {string} chain
 * @returns {boolean}
 */
export function isLive(chain) {
  const c = String(chain || '').toLowerCase();
  const base = REGISTRY_BASE[c];
  if (!base) return false;
  if (base.track === 'evm' && c === 'prana') return pranaRpcSet();
  return true; // graphene chains are queryable via condenser/steemd
}

// ---- pool linkage descriptor -----------------------------------------------
//
// Akasha is a wallet, not a miner — the pool linkage is the PAYOUT-ADDRESS boundary.
// The wallet generates MAINNET addresses; the pool's RandomX side runs Monero STAGENET, so
// a payout address is converted to its stagenet twin at the pool boundary (same keys/seed,
// claimable with the same mnemonic in stagenet mode). We delegate the actual conversion to
// pool/www/wizard.mjs::poolLoginAddress so there is ONE implementation of the twin rule.

const POOL_STATS_HOST_FALLBACK = 'pool.soapbox.community'; // public stratum host (NOT the API host)
const POOL_API_PATH = '/api/pools';                        // Miningcore multi-coin menu

let _wizard = null;   // injectable for tests
let _poolStats = null;
/** Inject a wizard module (poolLoginAddress, COINS). For tests. */
export function __setWizard(mod) { _wizard = mod || null; }
/** Inject a pool-stats module (pools, stratumUrl, POOL_STRATUM_HOST). For tests. */
export function __setPoolStats(mod) { _poolStats = mod || null; }

async function loadWizard() {
  if (_wizard) return _wizard;
  try { return await import('../pool/www/wizard.mjs'); } catch { return null; }
}
async function loadPoolStats() {
  if (_poolStats) return _poolStats;
  try { return await import('./pool-stats.mjs'); } catch { return null; }
}

/**
 * The pool linkage descriptor Akasha needs to point a payout address at the pool.
 * Pure/offline; soft-fails to a documented default if the pool modules are absent.
 *
 *   { statsApiPath, stratumHost, stratumFamilies, coins:[{symbol,family,phoneReady}],
 *     loginRule: 'stagenet-twin', poolLoginAddress(coin,address) }
 *
 * `poolLoginAddress` is delegated to pool/www/wizard.mjs (the single twin-rule impl). If the
 * wizard can't be loaded, it returns the address unconverted ({converted:false}) — never throws.
 * @returns {Promise<object>}
 */
export async function poolLinkage() {
  const wizard = await loadWizard();
  const ps = await loadPoolStats();
  const stratumHost = (ps && ps.POOL_STRATUM_HOST) || POOL_STATS_HOST_FALLBACK;

  // Coin menu + stratum families straight from the wizard's COINS (cryptonote|ethereum).
  const coins = [];
  const families = new Set();
  if (wizard && wizard.COINS) {
    for (const c of Object.values(wizard.COINS)) {
      coins.push({ symbol: c.symbol, family: c.family, phoneReady: !!c.phoneReady });
      if (c.family) families.add(c.family);
    }
  }

  const loginFn = wizard && typeof wizard.poolLoginAddress === 'function'
    ? wizard.poolLoginAddress
    : (_coin, address) => ({ address: String(address || '').trim(), converted: false });

  return {
    statsApiPath: POOL_API_PATH,
    stratumHost,
    stratumFamilies: [...families],
    coins,
    // The mainnet->stagenet payout-address rule the pool boundary applies (testing phase).
    loginRule: 'stagenet-twin',
    loginRuleNote:
      "Pool RandomX side runs Monero stagenet; a mainnet payout address is converted to its " +
      "stagenet twin at the pool boundary (same keys/seed, same mnemonic restored in stagenet mode).",
    poolLoginAddress: loginFn,
  };
}

// ---- bridge linkage descriptor ---------------------------------------------
//
// Akasha INITIATES a bridge transfer (signs the one source-chain tx); it does NOT finalize —
// the relayer/attester federation does. The Bot side NEVER signs/relays/holds attester keys.
// This descriptor only NAMES the two routes + their env, mirroring bridge-initiate-spec.md.

/**
 * The bridge linkage descriptor. Two routes:
 *   - 'evm'      : EVM <-> EVM  (CanonicalLockMintBridge): approve + burn on source; watch Minted.
 *   - 'graphene' : EVM <-> Graphene (GrapheneDepositBridge): PRANA-side withdraw, or native
 *                  MELEK send for a deposit (watch-only on PRANA — attester federation mints).
 * The Bot holds NO bridge/attester key and signs NOTHING here.
 * @returns {object}
 */
export function bridgeLinkage() {
  return {
    initiatesOnly: true,        // wallet signs source tx only; finalize is off-chain (relayer/attester)
    routes: {
      evm: {
        contract: 'CanonicalLockMintBridge',
        kind: 'evm<->evm',
        sourceSteps: ['approve(bridge,amount)', 'burn(amount,dstChainId,dstAddr)'],
        completionEvent: 'Minted',         // watched on destination; never signed by the wallet
        correlationKey: ['srcChainId', 'nonce'],
      },
      graphene: {
        contract: 'GrapheneDepositBridge',
        kind: 'evm<->graphene',
        withdraw: ['approve(bridge,amount)', 'withdraw(tokenId,amount,destinationRef)'],
        deposit: 'native-graphene-send (no PRANA tx from the wallet)',
        completionEvent: 'DepositMinted',  // attester federation emits; watch-only
        correlationKey: ['recipient', 'amount', 'depositRef'],
      },
    },
    // Watch-only: the Bot/wallet never assembles K-of-N validator sigs or calls mint/attestDeposit.
    walletNeverSigns: ['mint', 'attestDeposit', 'validatorSigs'],
    note:
      'Per design/akasha/bridge-initiate-spec.md: the wallet only signs the source tx; the ' +
      'relayer/attester federation finalizes. The Bot side names routes only — holds no key.',
  };
}

// ---- connection manifest (the whole surface in one object) -----------------

/**
 * Assemble the full Bot-side connection manifest Akasha consumes: the chain registry,
 * the pool linkage, and the bridge linkage, plus a live/dormant summary. Never throws.
 * @returns {Promise<object>}
 */
export async function connectionManifest() {
  let pool;
  try { pool = await poolLinkage(); } catch { pool = null; }
  const chains = chainRegistry();
  return {
    generatedAt: new Date().toISOString(),
    chains,
    live: Object.fromEntries(Object.keys(chains).map((c) => [c, isLive(c)])),
    pranaRpcSet: pranaRpcSet(),
    pool,
    bridge: bridgeLinkage(),
    boundary: 'descriptors only — holds NO key/WIF/seed/signer, signs nothing, broadcasts nothing',
  };
}

// ---- CLI -------------------------------------------------------------------

async function runCli() {
  const m = await connectionManifest();
  // Drop function fields for a clean print.
  const pool = m.pool ? { ...m.pool, poolLoginAddress: '[fn]' } : null;
  const chains = {};
  for (const [k, v] of Object.entries(m.chains)) {
    chains[k] = { ...v, accountId: '[fn]' };
  }
  process.stdout.write(JSON.stringify({ ...m, chains, pool }, null, 2) + '\n');
}

if (process.argv[1] && process.argv[1].endsWith('akasha-connect.mjs')) {
  runCli();
}
