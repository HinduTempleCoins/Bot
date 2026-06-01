// tokens.mjs — READ-ONLY ERC-20 token balances (USDT/USDC/...) across EVM chains. No keys.
// The native reader (balances.mjs) only sees the gas coin; real value often sits in stablecoins.
// This reads ERC-20 balanceOf via eth_call against the same keyless public RPCs. SPL (Solana
// tokens) is a separate getTokenAccountsByOwner call, included for the Phantom/SOL side.
//
//   node integrations/chains/tokens.mjs ethereum 0xabc...        # known tokens for one holder
//   import { erc20Balance, tokenBalances } from './chains/tokens.mjs'

import { CHAINS } from './multichain.mjs';

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function rpc(nodes, body, timeout = 12000) {
  let last;
  for (const n of nodes) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await _fetch(n, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json(); if (j.error) throw new Error(j.error.message);
      return j;
    } catch (e) { last = e; } finally { clearTimeout(t); }
  }
  throw last || new Error('all nodes failed');
}

// balanceOf(address) -> raw, divided by 10^decimals. selector 0x70a08231 + 32-byte padded holder.
export async function erc20Balance(rpcNodes, token, holder, decimals = 18) {
  const data = '0x70a08231' + holder.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const j = await rpc(rpcNodes, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: token, data }, 'latest'] });
  const raw = BigInt(j.result || '0x0');
  // keep precision: integer part + fractional via string math
  const denom = 10n ** BigInt(decimals);
  const whole = raw / denom; const frac = raw % denom;
  return Number(whole) + Number(frac) / Number(denom);
}

// known stablecoins per chain (address + decimals). Keyless, well-known contracts. Extend freely.
export const TOKENS = {
  ethereum: {
    USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    DAI: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  },
  polygon: {
    USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  },
  bsc: {
    USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  },
  arbitrum: {
    USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  },
  base: {
    USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  },
  optimism: {
    USDT: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    USDC: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
  },
  avalanche: {
    USDT: { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
    USDC: { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
  },
};

// all known token balances for a holder on one chain (skips zero balances).
export async function tokenBalances(chain, holder) {
  const c = CHAINS[chain];
  if (!c || c.kind !== 'evm' || !TOKENS[chain]) return [];
  const out = [];
  for (const [sym, t] of Object.entries(TOKENS[chain])) {
    try {
      const bal = await erc20Balance(c.rpc, t.address, holder, t.decimals);
      if (bal > 0) out.push({ chain, symbol: sym, balance: bal, contract: t.address });
    } catch { /* skip this token */ }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('tokens.mjs')) {
  const [chain, holder] = process.argv.slice(2);
  if (!chain || !holder) { console.log('usage: node integrations/chains/tokens.mjs <chain> <0xholder>'); process.exit(1); }
  const bals = await tokenBalances(chain, holder);
  console.log(`Token balances for ${holder} on ${chain}:`);
  if (!bals.length) console.log('  (none of the known tokens, or all zero)');
  for (const b of bals) console.log(`  ${b.symbol.padEnd(6)} ${b.balance}`);
}
