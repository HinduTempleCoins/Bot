// kula-config.mjs — KulaSwap MULTI-CHAIN registry. KulaSwap is the unified swap front-end across the
// MELEK ecosystem chain (PRANA) AND the existing chains the ecosystem's tokens already trade on.
//
// Chain `type`:
//   'evm'  — chainId + MetaMask + a Uniswap-V2-style Router/Factory. The cp-amm quote math + the shared
//            EVM ABIs below work as-is (per-chain feeBps).
//   'tron' — TVM, base58 addrs, TronLink/TronWeb (SunSwap). NEEDS a TronWeb adapter.
//   'eos'  — Antelope/EOSIO, eosjs (Defibox). NEEDS an eosjs adapter.
//   'svm'  — Solana, @solana/web3.js (Raydium/Orca). NEEDS a Solana adapter.
//   'cosmos'/'near' — their own SDKs. Listed for reach; adapters later.
//
// ⚠️ SAFETY: a WRONG router address loses funds. So each chain carries `verified`:
//   - verified:true  → router/factory confirmed canonical; the UI may swap (chainReady()=true).
//   - verified:false → listed for reach, but the UI REFUSES to swap until a human verifies the
//                      addresses and flips the flag. Addresses present on unverified chains are a
//                      STARTING POINT from memory, NOT confirmed. Override via window.__KULA__.

const cfg = (typeof window !== 'undefined' && window.__KULA__) || {};
const Z = '0x0000000000000000000000000000000000000000';
const T = 'TODO';

export const CHAINS = {
  // ── ecosystem home — TESTNET / alpha (chainId 108369 = 0x1a751). The `alpha.*` hosts. Nothing that
  //    handles real value should reach for this key; MAINNET is `prana` below. Named explicitly after
  //    the key `prana` silently meant TESTNET and three modules reached for it expecting mainnet —
  //    including an EIP-712 domain, where a wrong chainId makes every signature fail to verify. ──────
  'prana-testnet': { type: 'evm', key: 'prana-testnet', chainId: 108369, chainIdHex: '0x1a751', name: 'PRANA testnet', dex: 'KulaSwap',
    rpcUrl: 'https://rpc.prana.alpha.melek.salon', explorer: 'https://pranascan.alpha.soapbox.community',
    native: { name: 'PRANA', symbol: 'PRANA', decimals: 18 }, feeBps: 30,
    router: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', factory: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    wnative: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512', verified: true /* DeployAmm.s.sol on PRANA testnet 2026-06-16 */,
    kula: '0x4c5859f0F772848b2D91F1D83E2Fe57935348029', pol: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    multiBurnMine: '0x1291Be112d480055DaFd8a610b7d1e203891C274' },

  // ── ecosystem home — MAINNET (chainId 712217). LIVE: AMM Router/Factory + WPRANA and the 4 seeded
  //    pairs are deployed and on-chain-verified from rpc.prana.melek.salon 2026-08-31 → verified:true.
  //    Factory.allPairsLength = 5; seeded pairs: KULA/WPRANA (10000 KULA / 5000 WPRANA), wVKBT/KULA,
  //    wCURE/KULA, wVKBT/wCURE. `tokens` is the tradeable dropdown set (KULA/WPRANA/wVKBT/wCURE) —
  //    ⚠ wVKBT and wCURE are 8-decimal tokens (KULA/WPRANA are 18) — decimals here drive parse/format.
  //    mMELEK is the CDP debt synthetic (kula-config-addresses.mjs / Borrow tab), NOT a seeded swap pair,
  //    so it is carried as a flat field but is not in the swap `tokens` list. (712217 = 0xADE19.) ──────
  prana: { type: 'evm', key: 'prana', chainId: 712217, chainIdHex: '0xADE19', name: 'PRANA', dex: 'KulaSwap',
    rpcUrl: 'https://rpc.prana.melek.salon', explorer: 'https://pranascan.soapbox.community',
    native: { name: 'PRANA', symbol: 'PRANA', decimals: 18 }, feeBps: 30,
    // Addresses are EIP-55 checksummed (ethers v6 REJECTS a bad checksum → "bad address checksum"),
    // so factory/WPRANA are re-cased from the raw deploy output — same 20 bytes, correct checksum.
    router: '0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5', factory: '0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6',
    wnative: '0xCAbCaAeBBF7a7312b91A92Faa635d7a32Af42a34',
    verified: true /* Router/Factory/WPRANA + 4 seeded pairs confirmed on-chain 2026-08-31 */,
    kula: '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631', mMELEK: '0x8c4B882D7379D35413E2a9202f63B53f893D1A9D',
    // MWALI, the PoL / liquidity-reward token. Emission-only: verified on-chain 2026-09-04 —
    // symbol MWALI, 18 decimals, totalSupply 0 (nothing minted until the gauge goes live). Two
    // orphan Mwali deployments exist at other nonces; this is the canonical one.
    pol: '0x36C6921e2CECe9DEc7a5AAC42bC6738011F2a1c9',
    wVKBT: '0xD915E757662c4234137aff167Bf93d588145f75e', wCURE: '0x03d613BDaAd82ecd6cf36B0fEf88Fb6AF9d977Ff',
    tokens: [
      { symbol: 'KULA', address: '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631', decimals: 18 },
      { symbol: 'WPRANA', address: '0xCAbCaAeBBF7a7312b91A92Faa635d7a32Af42a34', decimals: 18 },
      { symbol: 'wVKBT', address: '0xD915E757662c4234137aff167Bf93d588145f75e', decimals: 8 },
      { symbol: 'wCURE', address: '0x03d613BDaAd82ecd6cf36B0fEf88Fb6AF9d977Ff', decimals: 8 },
    ] },

  // ── EVM, VERIFIED canonical V2 DEXes (swap-ready) ─────────────────────────────────────────────
  ethereum: { type: 'evm', key: 'ethereum', chainId: 1, chainIdHex: '0x1', name: 'Ethereum', dex: 'Uniswap V2',
    rpcUrl: 'https://eth.llamarpc.com', explorer: 'https://etherscan.io',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, feeBps: 30,
    router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    wnative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', verified: true },
  polygon: { type: 'evm', key: 'polygon', chainId: 137, chainIdHex: '0x89', name: 'Polygon', dex: 'QuickSwap',
    rpcUrl: 'https://polygon-rpc.com', explorer: 'https://polygonscan.com',
    native: { name: 'POL', symbol: 'POL', decimals: 18 }, feeBps: 30,
    router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', factory: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
    wnative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', verified: true },
  bsc: { type: 'evm', key: 'bsc', chainId: 56, chainIdHex: '0x38', name: 'BNB Smart Chain', dex: 'PancakeSwap',
    rpcUrl: 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com',
    native: { name: 'BNB', symbol: 'BNB', decimals: 18 }, feeBps: 25,
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    wnative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', verified: true },
  avalanche: { type: 'evm', key: 'avalanche', chainId: 43114, chainIdHex: '0xa86a', name: 'Avalanche', dex: 'Trader Joe',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io',
    native: { name: 'AVAX', symbol: 'AVAX', decimals: 18 }, feeBps: 30,
    router: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4', factory: '0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10',
    wnative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', verified: true },

  // ── EVM, addresses from memory — VERIFY before flipping verified:true ──────────────────────────
  base: { type: 'evm', key: 'base', chainId: 8453, chainIdHex: '0x2105', name: 'Base', dex: 'Uniswap V2',
    rpcUrl: 'https://mainnet.base.org', explorer: 'https://basescan.org',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, feeBps: 30,
    router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', factory: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
    wnative: '0x4200000000000000000000000000000000000006', verified: false /* Coinbase L2 — verify */ },
  arbitrum: { type: 'evm', key: 'arbitrum', chainId: 42161, chainIdHex: '0xa4b1', name: 'Arbitrum One', dex: 'SushiSwap',
    rpcUrl: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, feeBps: 30,
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
    wnative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', verified: false },
  optimism: { type: 'evm', key: 'optimism', chainId: 10, chainIdHex: '0xa', name: 'Optimism', dex: 'SushiSwap',
    rpcUrl: 'https://mainnet.optimism.io', explorer: 'https://optimistic.etherscan.io',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, feeBps: 30, router: Z, factory: Z,
    wnative: '0x4200000000000000000000000000000000000006', verified: false },
  fantom: { type: 'evm', key: 'fantom', chainId: 250, chainIdHex: '0xfa', name: 'Fantom', dex: 'SpookySwap',
    rpcUrl: 'https://rpc.ftm.tools', explorer: 'https://ftmscan.com',
    native: { name: 'FTM', symbol: 'FTM', decimals: 18 }, feeBps: 30,
    router: '0xF491e7B69E4244ad4002BC14e878a34207E38c29', factory: '0x152eE697f2E276fA89E96742e9bB9aB1F2E61bE3',
    wnative: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83', verified: false },
  gnosis: { type: 'evm', key: 'gnosis', chainId: 100, chainIdHex: '0x64', name: 'Gnosis', dex: 'Honeyswap',
    rpcUrl: 'https://rpc.gnosischain.com', explorer: 'https://gnosisscan.io',
    native: { name: 'xDAI', symbol: 'XDAI', decimals: 18 }, feeBps: 30,
    router: '0x1C232F01118CB8B424793ae03F870aa7D0ac7f77', factory: '0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7',
    wnative: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', verified: false },
  cronos: { type: 'evm', key: 'cronos', chainId: 25, chainIdHex: '0x19', name: 'Cronos', dex: 'VVS Finance',
    rpcUrl: 'https://evm.cronos.org', explorer: 'https://cronoscan.com',
    native: { name: 'CRO', symbol: 'CRO', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  celo: { type: 'evm', key: 'celo', chainId: 42220, chainIdHex: '0xa4ec', name: 'Celo', dex: 'Ubeswap',
    rpcUrl: 'https://forno.celo.org', explorer: 'https://celoscan.io',
    native: { name: 'CELO', symbol: 'CELO', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  moonbeam: { type: 'evm', key: 'moonbeam', chainId: 1284, chainIdHex: '0x504', name: 'Moonbeam', dex: 'StellaSwap',
    rpcUrl: 'https://rpc.api.moonbeam.network', explorer: 'https://moonscan.io',
    native: { name: 'GLMR', symbol: 'GLMR', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  metis: { type: 'evm', key: 'metis', chainId: 1088, chainIdHex: '0x440', name: 'Metis', dex: 'Netswap',
    rpcUrl: 'https://andromeda.metis.io/?owner=1088', explorer: 'https://explorer.metis.io',
    native: { name: 'METIS', symbol: 'METIS', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  linea: { type: 'evm', key: 'linea', chainId: 59144, chainIdHex: '0xe708', name: 'Linea', dex: 'Lynex',
    rpcUrl: 'https://rpc.linea.build', explorer: 'https://lineascan.build',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  scroll: { type: 'evm', key: 'scroll', chainId: 534352, chainIdHex: '0x82750', name: 'Scroll', dex: 'Nuri/Sushi',
    rpcUrl: 'https://rpc.scroll.io', explorer: 'https://scrollscan.com',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  blast: { type: 'evm', key: 'blast', chainId: 81457, chainIdHex: '0x13e31', name: 'Blast', dex: 'Thruster',
    rpcUrl: 'https://rpc.blast.io', explorer: 'https://blastscan.io',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  mantle: { type: 'evm', key: 'mantle', chainId: 5000, chainIdHex: '0x1388', name: 'Mantle', dex: 'Merchant Moe',
    rpcUrl: 'https://rpc.mantle.xyz', explorer: 'https://mantlescan.xyz',
    native: { name: 'MNT', symbol: 'MNT', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  zksync: { type: 'evm', key: 'zksync', chainId: 324, chainIdHex: '0x144', name: 'zkSync Era', dex: 'SyncSwap',
    rpcUrl: 'https://mainnet.era.zksync.io', explorer: 'https://explorer.zksync.io',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  harmony: { type: 'evm', key: 'harmony', chainId: 1666600000, chainIdHex: '0x63564c40', name: 'Harmony', dex: 'SushiSwap',
    rpcUrl: 'https://api.harmony.one', explorer: 'https://explorer.harmony.one',
    native: { name: 'ONE', symbol: 'ONE', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },
  aurora: { type: 'evm', key: 'aurora', chainId: 1313161554, chainIdHex: '0x4e454152', name: 'Aurora', dex: 'Trisolaris',
    rpcUrl: 'https://mainnet.aurora.dev', explorer: 'https://explorer.aurora.dev',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, feeBps: 30, router: Z, factory: Z, verified: false },

  // ── non-EVM (listed for reach; each needs its own adapter, gated until built) ──────────────────
  tron: { type: 'tron', key: 'tron', name: 'TRON', dex: 'SunSwap', explorer: 'https://tronscan.org',
    native: { name: 'TRX', symbol: 'TRX', decimals: 6 }, feeBps: 30, router: T, verified: false,
    note: 'TVM/base58. TronWeb+TronLink adapter. SunSwap is the V2-style DEX (the original KULASwap was a SunSwap fork).' },
  eos: { type: 'eos', key: 'eos', name: 'EOS', dex: 'Defibox', explorer: 'https://bloks.io',
    native: { name: 'EOS', symbol: 'EOS', decimals: 4 }, feeBps: 30, router: T, verified: false,
    note: 'Antelope/EOSIO. eosjs adapter. Defibox/Defra are the AMM DEXes.' },
  solana: { type: 'svm', key: 'solana', name: 'Solana', dex: 'Raydium / Orca', explorer: 'https://solscan.io',
    native: { name: 'SOL', symbol: 'SOL', decimals: 9 }, feeBps: 30, router: T, verified: false,
    note: 'SVM. @solana/web3.js + Phantom adapter; Raydium/Orca/Jupiter for routing.' },
  near: { type: 'near', key: 'near', name: 'NEAR', dex: 'Ref Finance', explorer: 'https://nearblocks.io',
    native: { name: 'NEAR', symbol: 'NEAR', decimals: 24 }, feeBps: 30, router: T, verified: false,
    note: 'NEAR SDK adapter; Ref Finance is the AMM.' },
  osmosis: { type: 'cosmos', key: 'osmosis', name: 'Osmosis (Cosmos)', dex: 'Osmosis', explorer: 'https://www.mintscan.io/osmosis',
    native: { name: 'OSMO', symbol: 'OSMO', decimals: 6 }, feeBps: 20, router: T, verified: false,
    note: 'Cosmos SDK / IBC; CosmJS + Keplr adapter. Osmosis is the AMM hub.' },

  ...(cfg.chains || {}),
};

export const DEFAULT_CHAIN = cfg.defaultChain || 'prana';   // 'prana' IS mainnet (712217)
export const CHAIN = { ...CHAINS[DEFAULT_CHAIN], ...cfg };   // back-compat single-chain export
export const FEE_BPS = CHAIN.feeBps || 30;

// Shared EVM ABIs (Uniswap-V2 interface) — apply to every `type:'evm'` chain.
export const ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
];
export const FACTORY_ABI = ['function getPair(address tokenA, address tokenB) view returns (address pair)'];
export const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
];
export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

export function isNative(chain, token) {
  return !!token && (token.address === 'native' || String(token.symbol).toUpperCase() === (chain?.native?.symbol || '').toUpperCase());
}

/** Swap-ready ONLY if EVM AND addresses are confirmed (verified:true, non-placeholder). Non-EVM and
 *  unverified chains list in the UI but the swap action stays disabled — never route on a guessed addr. */
export function chainReady(chain) {
  if (!chain || chain.type !== 'evm' || chain.verified !== true) return false;
  return !!chain.router && chain.router !== Z && !!chain.factory && chain.factory !== Z;
}

export const allChains = () => Object.values(CHAINS);
export const evmChains = () => allChains().filter((c) => c.type === 'evm');
export const readyChains = () => allChains().filter(chainReady);
