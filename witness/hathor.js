/**
 * Hathor — the Witness's hands.
 *
 * Composes the chain config (config.js), the chain client (src/chain/graphene.js),
 * and the key loader (src/chain/keys.js) into one object the rest of the Bot
 * talks to as "my account on MELEK."
 *
 * Key-safety guarantees:
 *   - This file never reads, returns, or logs the actual key material.
 *   - hasPostingKey() / hasActiveKey() are boolean probes only.
 *   - status() reports presence of keys, not the keys themselves.
 *   - Any error this file throws goes through the adapter, which itself
 *     never includes the key in the error message.
 */

import { GrapheneAdapter } from '../src/chain/graphene.js';
import { getAccount, hasPostingKey, hasActiveKey } from '../src/chain/keys.js';
import { getChainConfig, validateChainConfig } from '../config.js';

export class Hathor {
  constructor() {
    this.account = getAccount();
    this.config = getChainConfig();
    this.adapter = null;
  }

  /**
   * What does the Witness know about itself, without touching the network?
   * Safe to call before any env is set — reports what's missing.
   */
  status() {
    const validation = validateChainConfig();
    return {
      account: this.account,
      network: this.config.network,
      rpcUrlSet: Boolean(this.config.rpcUrl),
      chainIdSet: Boolean(this.config.chainId),
      addressPrefixSet: Boolean(this.config.addressPrefix),
      postingKeyLoaded: hasPostingKey(),
      activeKeyLoaded: hasActiveKey(),
      readyToConnect: validation.ok,
      missingConfig: validation.missing,
    };
  }

  /**
   * Construct (or return) the adapter. Throws with a list of missing env
   * vars if config is incomplete. Does not perform a network call.
   */
  connect() {
    if (this.adapter) return this.adapter;
    const validation = validateChainConfig();
    if (!validation.ok) {
      throw new Error(
        `cannot connect: missing env vars: ${validation.missing.join(', ')}`,
      );
    }
    this.adapter = new GrapheneAdapter({
      rpcUrl: this.config.rpcUrl,
      chainId: this.config.chainId,
      addressPrefix: this.config.addressPrefix,
      network: this.config.network,
    });
    return this.adapter;
  }

  // ---- read-only chain queries (no broadcasts, no keys touched) ----

  async getHeadBlock() {
    return this.connect().getHeadBlockNumber();
  }

  async getMyAccount() {
    return this.connect().getAccountInfo();
  }

  async getMyWitness() {
    return this.connect().getWitnessByAccount();
  }

  // ---- broadcasts (require the appropriate key in env) ----

  /**
   * Phase 1 intro post. Posting key required.
   * @param {{ permlink: string, title: string, body: string, tags?: string[] }} args
   */
  async introductionPost({ permlink, title, body, tags = ['hathor', 'melek', 'introduction'] }) {
    return this.connect().post({ permlink, title, body, tags });
  }

  /**
   * Informational price feed publication. Active key required.
   * MELEK has no internal stablecoin — the feed is informational.
   */
  async publishFeed({ exchangeRate }) {
    return this.connect().publishFeed({ exchangeRate });
  }
}
