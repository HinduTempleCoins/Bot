/**
 * GrapheneAdapter — Steem/HIVE/BLURT-family chain client for the hathor account.
 *
 * Targets melek-chain by default. The same code targets any steemd-equivalent
 * daemon (including the future Hathor rebrand) by changing env vars only.
 *
 * Uses @hiveio/dhive — already a Bot dependency. The chain-id and address
 * prefix are passed at construction so dhive treats MELEK as its own network.
 */

import { Client, PrivateKey } from '@hiveio/dhive';
import { getAccount, getPostingKey, getActiveKey, hasPostingKey, hasActiveKey } from './keys.js';

export class GrapheneAdapter {
  constructor({ rpcUrl, chainId, addressPrefix, network }) {
    this.network = network;
    this.client = new Client(rpcUrl, {
      chainId,
      addressPrefix,
      timeout: 15000,
    });
    this.account = getAccount();
  }

  /**
   * Broadcast a top-level post or reply.
   * @param {{title: string, body: string, tags: string[], permlink: string, parentAuthor?: string, parentPermlink?: string}} args
   */
  async post({ title, body, tags, permlink, parentAuthor = '', parentPermlink = '' }) {
    if (!hasPostingKey()) {
      throw new Error('cannot post: HATHOR_POSTING_KEY not configured');
    }
    const primaryTag = (parentPermlink && !parentAuthor) ? parentPermlink : (tags[0] || 'hathor');
    const op = ['comment', {
      parent_author: parentAuthor,
      parent_permlink: parentAuthor ? parentPermlink : primaryTag,
      author: this.account,
      permlink,
      title: parentAuthor ? '' : title,
      body,
      json_metadata: JSON.stringify({
        tags,
        app: 'hathor/0.1',
        format: 'markdown',
      }),
    }];
    return this.client.broadcast.sendOperations([op], PrivateKey.fromString(getPostingKey()));
  }

  /**
   * Cast a vote on a post. weight is 0..10000 (10000 = 100%).
   */
  async vote({ author, permlink, weight }) {
    if (!hasPostingKey()) {
      throw new Error('cannot vote: HATHOR_POSTING_KEY not configured');
    }
    const op = ['vote', { voter: this.account, author, permlink, weight }];
    return this.client.broadcast.sendOperations([op], PrivateKey.fromString(getPostingKey()));
  }

  /**
   * Transfer liquid MELEK to another account.
   */
  async transfer({ to, amount, memo = '' }) {
    if (!hasActiveKey()) {
      throw new Error('cannot transfer: HATHOR_ACTIVE_KEY not configured');
    }
    const op = ['transfer', { from: this.account, to, amount, memo }];
    return this.client.broadcast.sendOperations([op], PrivateKey.fromString(getActiveKey()));
  }

  /**
   * Delegate vesting shares (MP) to another account.
   * vestingShares example: "1000.000000 VESTS"
   */
  async delegate({ to, vestingShares }) {
    if (!hasActiveKey()) {
      throw new Error('cannot delegate: HATHOR_ACTIVE_KEY not configured');
    }
    const op = ['delegate_vesting_shares', {
      delegator: this.account,
      delegatee: to,
      vesting_shares: vestingShares,
    }];
    return this.client.broadcast.sendOperations([op], PrivateKey.fromString(getActiveKey()));
  }

  /**
   * Create a new account with delegated MP. Used by the onboarder surface.
   */
  async createAccount({ newAccountName, jsonMetadata, ownerKey, activeKey, postingKey, memoKey, fee, delegation }) {
    if (!hasActiveKey()) {
      throw new Error('cannot createAccount: HATHOR_ACTIVE_KEY not configured');
    }
    const auth = (key) => ({ weight_threshold: 1, account_auths: [], key_auths: [[key, 1]] });
    const op = ['account_create_with_delegation', {
      fee,
      delegation,
      creator: this.account,
      new_account_name: newAccountName,
      owner: auth(ownerKey),
      active: auth(activeKey),
      posting: auth(postingKey),
      memo_key: memoKey,
      json_metadata: jsonMetadata || '',
      extensions: [],
    }];
    return this.client.broadcast.sendOperations([op], PrivateKey.fromString(getActiveKey()));
  }

  async getAccountInfo() {
    const [acct] = await this.client.database.getAccounts([this.account]);
    return acct || null;
  }

  async getHeadBlockNumber() {
    const props = await this.client.database.getDynamicGlobalProperties();
    return props.head_block_number;
  }

  async getWitnessByAccount(account = this.account) {
    return this.client.database.call('get_witness_by_account', [account]);
  }

  /**
   * Publish an informational price feed. MELEK has no internal stablecoin,
   * so the feed is informational rather than enforcing conversion (see
   * HinduTempleCoins/melek-chain CLAUDE.md "Single token").
   * exchangeRate example: { base: "1.000 MELEK", quote: "1.000 USD" }
   */
  async publishFeed({ exchangeRate }) {
    if (!hasActiveKey()) {
      throw new Error('cannot publishFeed: HATHOR_ACTIVE_KEY not configured');
    }
    const op = ['feed_publish', { publisher: this.account, exchange_rate: exchangeRate }];
    return this.client.broadcast.sendOperations([op], PrivateKey.fromString(getActiveKey()));
  }

  /**
   * Retire the witness — the standard Graphene "go dark" move.
   *
   * Sets block_signing_key to the chain's null public key, which removes
   * the witness from the schedule. The op is signed by the active key.
   *
   * IMPORTANT: if the active key is compromised, this script is NOT your
   * tool — an attacker with the active key can already broadcast anything.
   * Go to the offline owner-key machine, rotate active+posting via
   * account_update, then come back. See SECURITY.md §6 and OPERATOR.md §10.
   *
   * The "null public key" is `{prefix}1111111111111111111111111111111114T1Anm`
   * — a Graphene convention indicating no signing authority.
   *
   * @param {{ url?: string, props?: object }} args optional overrides.
   *   url and props default to the existing witness record's values so
   *   nothing else changes; only block_signing_key is overwritten.
   */
  async disableWitness({ url, props } = {}) {
    if (!hasActiveKey()) {
      throw new Error('cannot disableWitness: HATHOR_ACTIVE_KEY not configured');
    }
    const prefix = this.client.addressPrefix;
    const nullPubkey = `${prefix}1111111111111111111111111111111114T1Anm`;
    const existing = await this.getWitnessByAccount();
    const op = ['witness_update', {
      owner: this.account,
      url: url ?? existing?.url ?? '',
      block_signing_key: nullPubkey,
      props: props ?? existing?.props ?? {
        account_creation_fee: '0.000 MELEK',
        maximum_block_size: 131072,
      },
      fee: '0.000 MELEK',
    }];
    return this.client.broadcast.sendOperations([op], PrivateKey.fromString(getActiveKey()));
  }
}
