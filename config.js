/**
 * MELEK chain configuration loader.
 *
 * Reads non-secret chain-network parameters from env (RPC URL, chain ID,
 * address prefix, network name). Keys are loaded separately in
 * src/chain/keys.js — never touch them here.
 *
 * Nothing in this file is sensitive; nothing here is logged in a way that
 * could leak a key, because no key passes through here.
 */

const NETWORK = process.env.MELEK_NETWORK || 'testnet';
const RPC_URL = process.env.MELEK_RPC_URL || null;
const CHAIN_ID = process.env.MELEK_CHAIN_ID || null;
const ADDRESS_PREFIX = process.env.MELEK_ADDRESS_PREFIX || null;

export function getNetwork() {
  return NETWORK;
}

export function getRpcUrl() {
  return RPC_URL;
}

export function getChainId() {
  return CHAIN_ID;
}

export function getAddressPrefix() {
  return ADDRESS_PREFIX;
}

export function getChainConfig() {
  return {
    network: NETWORK,
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    addressPrefix: ADDRESS_PREFIX,
  };
}

/**
 * Returns { ok, missing } — `missing` is the list of required env vars that
 * are unset. Used by the smoke test to report what is needed before the
 * Witness can connect.
 */
export function validateChainConfig() {
  const missing = [];
  if (!RPC_URL) missing.push('MELEK_RPC_URL');
  if (!CHAIN_ID) missing.push('MELEK_CHAIN_ID');
  if (!ADDRESS_PREFIX) missing.push('MELEK_ADDRESS_PREFIX');
  return { ok: missing.length === 0, missing };
}
