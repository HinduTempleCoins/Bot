/**
 * autovote/chain.js — thin dhive wrapper for the MELEK testnet.
 *
 * Streams blocks, extracts comment + vote ops, and broadcasts vote ops with a
 * per-user posting key. Kept separate from the engine so the engine's decision
 * logic can be tested against a mock.
 */

import { Client, PrivateKey } from '@hiveio/dhive';
import { config } from './config.js';

export class Chain {
  constructor(opts = {}) {
    this.client = new Client(opts.rpcUrl || config.rpcUrl, {
      chainId: opts.chainId || config.chainId,
      addressPrefix: opts.addressPrefix || config.addressPrefix,
      timeout: 15000,
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
      const pub = PrivateKey.fromString(wif).createPublic(config.addressPrefix).toString();
      const [acc] = await this.client.database.getAccounts([account]);
      if (!acc) return false;
      const auths = acc.posting.key_auths.map((k) => k[0]);
      return auths.includes(pub);
    } catch {
      return false;
    }
  }

  /** Broadcast a single vote op. Returns { id } tx result. */
  async vote({ voter, author, permlink, weight }, wif) {
    const op = ['vote', { voter, author, permlink, weight }];
    return this.client.broadcast.sendOperations([op], PrivateKey.fromString(wif));
  }

  async getContent(author, permlink) {
    return this.client.database.call('get_content', [author, permlink]);
  }
}
