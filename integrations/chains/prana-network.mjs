// prana-network.mjs — the ONE source of truth for PRANA EVM network facts, so every game/earn
// surface (arcade, spin, casino, games hub, Move settle, the Season/Seed keeper, the wallet
// add-chain button) flips testnet⇄mainnet from a single place instead of hard-coding hosts.
//
// TWO nets, per the testnet-forever coexistence rule ([[testnet-live-coexistence-alpha-subdomains]]):
//   • testnet  — chainId 108369 (0x1a751), lives under the alpha.* subdomains. Stays up forever.
//   • mainnet  — chainId 712217, the NEW fair-launch genesis ([[prana-mainnet-fair-launch-decision]]),
//                lives on the bare domains.
//
// SELECTION: pranaNet() reads arg → env PRANA_NET → 'testnet' (safe default — surfaces keep serving
// the live testnet until the operator sets PRANA_NET=mainnet per service at cutover). Every field is
// still individually env-overridable (PRANA_RPC_URL, PRANA_CHAIN_ID, PRANA_EXPLORER_URL,
// PRANA_WALLET_URL, KULA_ADDRESS) so a single service can be pointed anywhere without a code change.
//
// KULA: the mainnet KULA ERC-20 is deployed as a launch-day step; its address is NOT committed here
// (no fabricated address). Set KULA_ADDRESS in the service env once KULA is live; until then kula is ''.
//
// Soft-fail-never-throw. No keys, no network. Pure config + URL builders.
//
//   import { pranaNet, addChainParams, explorerTx, explorerAddress, explorerToken,
//            chainIdHex, NETWORKS } from './prana-network.mjs'

const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';

// Canonical, env-free facts for each net. Endpoints follow the coexistence convention:
// testnet = alpha.* subdomains, mainnet = bare domains.
export const NETWORKS = {
  testnet: {
    key: 'testnet',
    name: 'PRANA Testnet',
    live: true,
    alpha: true,
    chainId: 108369,
    nativeSymbol: 'PRANA',
    nativeName: 'PRANA',
    rpcUrl: 'https://rpc.prana.alpha.melek.salon',
    explorerUrl: 'https://pranascan.alpha.soapbox.community',
    walletUrl: 'https://alpha.akasha.soapbox.community',
    kula: '', // testnet KULA is deployment-specific; set KULA_ADDRESS to pin it.
  },
  mainnet: {
    key: 'mainnet',
    name: 'PRANA',
    live: true,
    alpha: false,
    chainId: 712217,
    nativeSymbol: 'PRANA',
    nativeName: 'PRANA',
    rpcUrl: 'https://rpc.prana.melek.salon',
    explorerUrl: 'https://pranascan.soapbox.community',
    walletUrl: 'https://akasha.soapbox.community',
    kula: '', // set KULA_ADDRESS once the mainnet KULA ERC-20 is deployed (launch-day step).
  },
};

// 0x-prefixed, lower-case, minimal-length hex chainId (for wallet_addEthereumChain / eth_chainId compare).
export function chainIdHex(chainId) {
  const n = Number(chainId);
  if (!Number.isFinite(n) || n <= 0) return '0x0';
  return '0x' + Math.trunc(n).toString(16);
}

// Resolve the active net config. `name` (or PRANA_NET) selects the base; then any explicit env var
// overrides that field. Unknown name falls back to testnet (never throws).
export function pranaNet(name) {
  const want = String(name || env('PRANA_NET') || 'testnet').toLowerCase();
  const base = NETWORKS[want] || NETWORKS.testnet;
  const cfg = { ...base };

  const rpc = env('PRANA_RPC_URL');
  if (rpc) cfg.rpcUrl = rpc.split(',').map((s) => s.trim()).filter(Boolean)[0] || cfg.rpcUrl;

  const cid = Number(env('PRANA_CHAIN_ID'));
  if (Number.isFinite(cid) && cid > 0) cfg.chainId = cid;

  const exp = env('PRANA_EXPLORER_URL');
  if (exp) cfg.explorerUrl = exp.replace(/\/+$/, '');

  const wal = env('PRANA_WALLET_URL');
  if (wal) cfg.walletUrl = wal.replace(/\/+$/, '');

  const kula = env('KULA_ADDRESS');
  if (kula) cfg.kula = kula.trim();

  cfg.rpcUrl = String(cfg.rpcUrl || '').replace(/\/+$/, '');
  cfg.explorerUrl = String(cfg.explorerUrl || '').replace(/\/+$/, '');
  cfg.walletUrl = String(cfg.walletUrl || '').replace(/\/+$/, '');
  cfg.chainIdHex = chainIdHex(cfg.chainId);
  return cfg;
}

// EIP-3085 wallet_addEthereumChain parameter object — the one-click "Add PRANA to MetaMask" payload.
export function addChainParams(name) {
  const c = pranaNet(name);
  return {
    chainId: c.chainIdHex,
    chainName: c.name,
    nativeCurrency: { name: c.nativeName, symbol: c.nativeSymbol, decimals: 18 },
    rpcUrls: c.rpcUrl ? [c.rpcUrl] : [],
    blockExplorerUrls: c.explorerUrl ? [c.explorerUrl] : [],
  };
}

// EIP-3091 explorer deep-links. Empty string when the arg is missing (soft-fail; caller can hide link).
export function explorerTx(hash, name) {
  const c = pranaNet(name);
  return hash && c.explorerUrl ? `${c.explorerUrl}/tx/${String(hash)}` : '';
}
export function explorerAddress(addr, name) {
  const c = pranaNet(name);
  return addr && c.explorerUrl ? `${c.explorerUrl}/address/${String(addr)}` : '';
}
export function explorerToken(addr, name) {
  const c = pranaNet(name);
  return addr && c.explorerUrl ? `${c.explorerUrl}/token/${String(addr)}` : '';
}

// CLI: print the resolved config (respecting PRANA_NET + overrides) for ops sanity-checking.
if (typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  const c = pranaNet(name);
  console.log(JSON.stringify({ resolved: c, addChain: addChainParams(name) }, null, 2));
}
