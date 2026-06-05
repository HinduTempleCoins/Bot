/**
 * autovote/chain.js — per-chain dhive wrapper.
 *
 * One Chain instance per Graphene chain (see chains.js). Streams blocks,
 * extracts comment + vote ops, validates posting keys, and broadcasts vote ops.
 * Kept separate from the engine so decision logic stays testable against a mock.
 *
 * SAFETY: this wrapper never decides whether a broadcast is allowed — the engine
 * gates mainnet broadcasts (config.blockMainnetBroadcast). chain.vote() simply
 * signs and sends with the WIF it is handed.
 */

import { Client, PrivateKey } from '@hiveio/dhive';
import { getChain } from './chains.js';

export class Chain {
  /** @param {string|object} chainIdOrEntry chain id (e.g. 'hive') or a chain entry */
  constructor(chainIdOrEntry) {
    const entry = typeof chainIdOrEntry === 'string' ? getChain(chainIdOrEntry) : chainIdOrEntry;
    if (!entry) throw new Error(`unknown chain: ${chainIdOrEntry}`);
    this.entry = entry;
    this.id = entry.id;
    this.addressPrefix = entry.addressPrefix;
    this.network = entry.network;
    // dhive supports an array of RPCs with automatic failover.
    this.client = new Client(entry.rpcs.length === 1 ? entry.rpcs[0] : entry.rpcs, {
      chainId: entry.chainId,
      addressPrefix: entry.addressPrefix,
      timeout: 15000,
      failoverThreshold: 3,
    });
  }

  async headBlockNumber() {
    const props = await this.client.database.getDynamicGlobalProperties();
    return props.head_block_number;
  }

  /** Fetch a block and return its ops as a flat list with block context. */
  async getBlockOps(blockNum) {
    const block = await this.client.database.getBlock(blockNum);
    if (!block) return null;
    const out = { blockNum, timestamp: block.timestamp, ops: [] };
    for (const tx of block.transactions || []) {
      for (const op of tx.operations || []) {
        const [type, payload] = op;
        out.ops.push({ type, payload });
      }
    }
    return out;
  }

  /** Validate a posting WIF against an account; returns true if it can vote. */
  async keyAuthorizesVote(account, wif) {
    try {
      const pub = PrivateKey.fromString(wif).createPublic(this.addressPrefix).toString();
      const [acc] = await this.client.database.getAccounts([account]);
      if (!acc) return false;
      const auths = acc.posting.key_auths.map((k) => k[0]);
      return auths.includes(pub);
    } catch {
      return false;
    }
  }

  /** Broadcast a single vote op with a WIF. Returns { id } tx result. */
  async vote({ voter, author, permlink, weight }, wif) {
    const op = ['vote', { voter, author, permlink, weight }];
    return this.client.broadcast.sendOperations([op], PrivateKey.fromString(wif));
  }

  async getContent(author, permlink) {
    return this.client.database.call('get_content', [author, permlink]);
  }
}

/** Lazily-built per-chain Chain instances, shared across the engine + server. */
const _chains = new Map();
export function chainFor(chainId) {
  if (!_chains.has(chainId)) _chains.set(chainId, new Chain(chainId));
  return _chains.get(chainId);
}
