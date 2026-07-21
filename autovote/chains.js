/**
 * autovote/chains.js — chain registry for the chain-agnostic Hive.Vote clone.
 *
 * The platform serves multiple Graphene chains. Each chain entry carries the
 * RPC list, chain id, address prefix, vote-weight scale, and which auth methods
 * are usable there. A user picks their chain at login; all rules / trails /
 * fanbases / schedules / votes are scoped per (chain, account).
 *
 * SAFETY: only `melek-testnet` is a testnet. HIVE / STEEM / BLURT are LIVE
 * mainnets — voting there broadcasts REAL ops. Multi-chain logic is tested
 * against melek-testnet + mocks; mainnet support ships present-but-unverified
 * (labeled beta). We NEVER broadcast a mainnet vote during testing.
 */

/**
 * Auth methods, in operator-stated preference order per chain.
 *   melek-signer— OAuth2 bearer token from MELEK-Signer (OUR signer); the MELEK-chain analogue of
 *                 hivesigner — account + password, server-usable offline. Keyless; best for MELEK.
 *   hivesigner  — OAuth2 bearer token; server-usable while user is offline. Best for scheduled votes.
 *   whalevault  — browser-extension signing; ONLY while the user's tab is open. In-browser mode only.
 *   postingkey  — username + posting WIF stored server-side. Least-preferred; testnet default for MELEK.
 */
export const AUTH_METHODS = ['melek-signer', 'hivesigner', 'whalevault', 'postingkey'];

export const CHAINS = {
  melek: {
    id: 'melek',
    label: 'MELEK',
    network: 'mainnet',
    rpcs: ['https://melek.salon/rpc'],
    chainId: '907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b',
    addressPrefix: 'MELEK',
    // Our own mainnet. MELEK-Signer is the keyless path (account + password); a
    // posting key stays available as a fallback for scripts/bots.
    authMethods: ['melek-signer', 'postingkey'],
    signerNote: 'Log in with MELEK-Signer — your MELEK account + password. Keyless: the signer holds the keys and votes on your behalf even while you are offline; you never hand us a key.',
    explorer: 'https://melek.salon',
    stream: true,
    pollIntervalMs: 3000,
  },

  'melek-testnet': {
    id: 'melek-testnet',
    label: 'MELEK (testnet)',
    network: 'testnet',
    rpcs: ['https://alpha.melek.salon/rpc'],
    chainId: '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e',
    addressPrefix: 'TST',
    // Auth methods that actually work on this chain. HiveSigner/WhaleVault do
    // NOT know our chain (maintainer-gated). MELEK-Signer is OUR signer for this
    // chain — keyless login with account + password — so it's preferred; a
    // throwaway posting key stays available as a fallback.
    authMethods: ['melek-signer', 'postingkey'],
    signerNote: 'Log in with MELEK-Signer — your MELEK account + password. Keyless: the signer holds the keys and votes on your behalf even while you are offline; you never hand us a key.',
    explorer: 'https://alpha.melek.salon',
    // Stream blocks for active rules on this chain (it's ours; polite cadence).
    stream: true,
    pollIntervalMs: 3000,
  },

  hive: {
    id: 'hive',
    label: 'HIVE (mainnet, beta)',
    network: 'mainnet',
    rpcs: ['https://api.hive.blog', 'https://api.deathwing.me', 'https://hive-api.arcange.eu'],
    chainId: 'beeab0de00000000000000000000000000000000000000000000000000000000',
    addressPrefix: 'STM',
    authMethods: ['hivesigner', 'whalevault', 'postingkey'],
    signerNote: 'On HIVE you can sign with HiveSigner (works offline) or WhaleVault (tab open). Keyless — never hand us a key.',
    explorer: 'https://hive.blog',
    // Poll politely; only when there are active rules for hive. Public RPCs —
    // don't hammer them.
    stream: true,
    pollIntervalMs: 9000,
  },

  steem: {
    id: 'steem',
    label: 'STEEM (mainnet, beta)',
    network: 'mainnet',
    rpcs: ['https://api.steemit.com'],
    chainId: '0000000000000000000000000000000000000000000000000000000000000000',
    addressPrefix: 'STM',
    // HiveSigner is Hive-only; on Steem, WhaleVault is the keyless path.
    authMethods: ['whalevault', 'postingkey'],
    signerNote: 'On STEEM, WhaleVault signs (tab open). No HiveSigner on Steem.',
    explorer: 'https://steemit.com',
    stream: true,
    pollIntervalMs: 9000,
  },

  blurt: {
    id: 'blurt',
    label: 'BLURT (mainnet, beta)',
    network: 'mainnet',
    rpcs: ['https://rpc.blurt.world', 'https://blurtard.com'],
    chainId: 'cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f',
    addressPrefix: 'BLT',
    authMethods: ['whalevault', 'postingkey'],
    signerNote: 'On BLURT, WhaleVault signs (tab open). No HiveSigner on Blurt.',
    explorer: 'https://blurt.blog',
    stream: true,
    pollIntervalMs: 9000,
  },
};

export const DEFAULT_CHAIN = 'melek';

export function getChain(id) {
  return CHAINS[id] || null;
}

export function isMainnet(chainId) {
  const c = getChain(chainId);
  return !!c && c.network === 'mainnet';
}

/** Auth method usable on a chain? */
export function chainSupportsAuth(chainId, method) {
  const c = getChain(chainId);
  return !!c && c.authMethods.includes(method);
}

/** Public, key-free view of a chain for the client. */
export function publicChain(id) {
  const c = getChain(id);
  if (!c) return null;
  return {
    id: c.id,
    label: c.label,
    network: c.network,
    addressPrefix: c.addressPrefix,
    authMethods: c.authMethods,
    signerNote: c.signerNote,
    explorer: c.explorer,
  };
}

export function publicChains() {
  return Object.keys(CHAINS).map(publicChain);
}
