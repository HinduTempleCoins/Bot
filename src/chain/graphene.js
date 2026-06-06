/**
 * GrapheneAdapter — Steem/HIVE/BLURT-family chain client for the hathor account.
 *
 * Targets melek-chain by default. The same code targets any steemd-equivalent
 * daemon (including the future Hathor rebrand) by changing env vars only.
 *
 * Uses @hiveio/dhive — already a Bot dependency. The chain-id and address
 * prefix are passed at construction so dhive treats MELEK as its own network.
 *
 * Key custody (BRIEF.md §7, MELEK_SIGNER.md §6): this host NEVER holds a chain
 * private key. Read methods use the dhive client directly; every WRITE op funnels
 * through #broadcast(), which delegates signing to MELEK-Signer over HTTP (a
 * scoped bearer token via melek-signer-client.mjs / fromEnv()). When the signer
 * is unconfigured, broadcasts FAIL SOFT (read-only mode) — there is no local-key
 * fallback by construction.
 */

import { Client } from '@hiveio/dhive';
import { getAccount } from './keys.js';
import { fromEnv } from './melek-signer-client.mjs';

export class GrapheneAdapter {
  /**
   * @param {object} args
   * @param {string} args.rpcUrl
   * @param {string} args.chainId
   * @param {string} args.addressPrefix
   * @param {string} [args.network]
   * @param {object} [args.signer]  injected MELEK-Signer client (createSignerClient
   *   / createMockSigner shape: { broadcast(ops, {clientRef}) }). When omitted, the
   *   adapter builds one from MELEK_SIGNER_URL / MELEK_SIGNER_TOKEN via fromEnv().
   *   If neither is present, broadcasts FAIL SOFT (read-only mode) — there is no
   *   local-key fallback by construction (BRIEF.md §7, MELEK_SIGNER.md §6).
   */
  constructor({ rpcUrl, chainId, addressPrefix, network, signer } = {}) {
    this.network = network;
    this.client = new Client(rpcUrl, {
      chainId,
      addressPrefix,
      timeout: 15000,
    });
    this.account = getAccount();
    // Build the signer once. `null` means "not configured" → read-only mode.
    this.signer = signer !== undefined ? signer : fromEnv();
  }

  /**
   * Whether this adapter can broadcast (a MELEK-Signer client is wired).
   * Read-only methods work regardless.
   */
  canBroadcast() {
    return Boolean(this.signer && typeof this.signer.broadcast === 'function');
  }

  /**
   * The single broadcast chokepoint. Every write op in this adapter funnels
   * through here. All signing is delegated to MELEK-Signer (a scoped bearer
   * token over HTTP); this host never holds a chain private key. When the
   * signer is unconfigured we FAIL SOFT with a clear read-only-mode error and
   * NEVER fall back to local key signing.
   *
   * @param {Array} ops          Graphene op list: [["comment", {...}], ...]
   * @param {{clientRef?: string}} [meta]
   */
  async #broadcast(ops, { clientRef = '' } = {}) {
    if (!this.canBroadcast()) {
      throw new Error(
        'signer not configured — read-only mode: set MELEK_SIGNER_URL and ' +
        'MELEK_SIGNER_TOKEN to enable broadcasting (no local-key fallback by design)',
      );
    }
    return this.signer.broadcast(ops, { clientRef });
  }

  /**
   * Broadcast a top-level post or reply.
   * @param {{title: string, body: string, tags: string[], permlink: string, parentAuthor?: string, parentPermlink?: string}} args
   */
  async post({ title, body, tags, permlink, parentAuthor = '', parentPermlink = '' }) {
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
    return this.#broadcast([op], { clientRef: `post-${this.account}-${permlink}` });
  }

  /**
   * Cast a vote on a post. weight is 0..10000 (10000 = 100%).
   */
  async vote({ author, permlink, weight }) {
    const op = ['vote', { voter: this.account, author, permlink, weight }];
    return this.#broadcast([op], { clientRef: `vote-${this.account}-${author}-${permlink}` });
  }

  /**
   * Transfer liquid MELEK to another account.
   */
  async transfer({ to, amount, memo = '' }) {
    const op = ['transfer', { from: this.account, to, amount, memo }];
    return this.#broadcast([op], { clientRef: `transfer-${this.account}-${to}-${amount}` });
  }

  /**
   * Delegate vesting shares (MP) to another account.
   * vestingShares example: "1000.000000 VESTS"
   */
  async delegate({ to, vestingShares }) {
    const op = ['delegate_vesting_shares', {
      delegator: this.account,
      delegatee: to,
      vesting_shares: vestingShares,
    }];
    return this.#broadcast([op], { clientRef: `delegate-${this.account}-${to}` });
  }

  /**
   * Create a new account with delegated MP. Used by the onboarder surface.
   */
  async createAccount({ newAccountName, jsonMetadata, ownerKey, activeKey, postingKey, memoKey, fee, delegation }) {
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
    return this.#broadcast([op], { clientRef: `create-account-${newAccountName}` });
  }

  /**
   * Reply to an existing post or comment. Convenience wrapper around `post()`
   * that fixes the title to '' (replies have no title in the Graphene op),
   * derives a reasonable permlink if one isn't given, and routes through
   * the same broadcast path so error handling stays identical.
   *
   * @param {{
   *   parentAuthor: string,
   *   parentPermlink: string,
   *   body: string,
   *   permlink?: string,
   *   tags?: string[],
   * }} args
   */
  async reply({ parentAuthor, parentPermlink, body, permlink, tags = ['reply'] }) {
    if (!parentAuthor || !parentPermlink) {
      throw new Error('reply: parentAuthor and parentPermlink required');
    }
    const pl = permlink || `re-${parentAuthor}-${parentPermlink}-${Date.now()}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 255);
    return this.post({
      title: '',
      body,
      tags,
      permlink: pl,
      parentAuthor,
      parentPermlink,
    });
  }

  /**
   * Broadcast a custom_json op — the Graphene primitive that plugins (Hive-Engine,
   * SCOT, EVM bridges, SMT-equivalents) listen on. Posting auth is the cheap
   * common case; active auth is for higher-value plugins.
   *
   * @param {{
   *   id: string,             // plugin identifier, e.g. "ssc-mainnet-hive"
   *   json: object|string,    // payload (will JSON.stringify if not a string)
   *   requiredAuths?: string[],         // accounts whose active key must sign
   *   requiredPostingAuths?: string[],  // accounts whose posting key must sign
   * }} args
   */
  async customJson({ id, json, requiredAuths = [], requiredPostingAuths }) {
    const postingAuths = requiredPostingAuths ?? (requiredAuths.length ? [] : [this.account]);
    const payload = typeof json === 'string' ? json : JSON.stringify(json);
    const op = ['custom_json', {
      required_auths: requiredAuths,
      required_posting_auths: postingAuths,
      id,
      json: payload,
    }];
    return this.#broadcast([op], { clientRef: `custom_json-${id}` });
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
    const op = ['feed_publish', { publisher: this.account, exchange_rate: exchangeRate }];
    return this.#broadcast([op], { clientRef: `feed_publish-${this.account}` });
  }

  /**
   * Register or update the witness record. Used once at bootstrap
   * (after the on-chain account exists, before block production
   * starts) and any time signing key / url / props change. The op is
   * signed by the active key.
   *
   * @param {{ url: string, blockSigningKey: string, props?: object, fee?: string }} args
   */
  async registerWitness({ url, blockSigningKey, props, fee = '0.000 MELEK' }) {
    const op = ['witness_update', {
      owner: this.account,
      url,
      block_signing_key: blockSigningKey,
      props: props ?? {
        account_creation_fee: '0.000 MELEK',
        maximum_block_size: 131072,
      },
      fee,
    }];
    return this.#broadcast([op], { clientRef: `witness_update-register-${this.account}` });
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
    return this.#broadcast([op], { clientRef: `witness_update-disable-${this.account}` });
  }
}
