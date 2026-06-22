/**
 * engine.mjs — the deterministic state machine.
 *
 * Given engine state and a parsed L1 op carrying a sidechain instruction, this
 * executes the right contract action and mutates state — exactly once, in L1
 * block order, single-threaded (security study §6 B item 5: double-spend
 * impossible by construction). The streamer (streamer.mjs) feeds blocks in;
 * this module is pure w.r.t. its inputs (no network, no clock, no randomness),
 * so the same L1 history always yields the same state + state hash.
 *
 * Op shape accepted (from a MELEK `custom_json`):
 *   id: config.sidechainId
 *   json: { contractName, contractAction, contractPayload }
 *   signer: required_active_auths[0] || required_posting_auths[0]
 *
 * Issuer auth (§6 A item 1): the signer is taken STRICTLY from the L1 auth
 * arrays — never from anything inside contractPayload. We trust L1 to have
 * validated the signature already.
 */

import { tokens } from '../contracts/tokens.mjs';
import { rewards, recordPostTags, tribesForPost } from '../contracts/rewards.mjs';
import { workerbee } from '../contracts/workerbee.mjs';
import { bridge } from '../contracts/bridge.mjs';
import { gateway, dexSettlement } from '../contracts/seams.mjs';
import { nft } from '../contracts/nft.mjs';
import { seeds } from '../contracts/seeds.mjs';
import { scot } from '../contracts/scot.mjs';
import { config } from '../config.mjs';
import { burnFee } from '../contracts/tokens.mjs';

// Contract registry. ONLY these first-party contracts exist; no user uploads.
const CONTRACTS = {
  tokens,
  rewards,
  workerbee,
  bridge,
  gateway,
  dexSettlement,
  nft,
  seeds,
  scot,
};

// Which auth level each action requires. Value-moving / supply-control ops
// require ACTIVE auth; everything else accepts POSTING. (§6 A item 1.)
const ACTIVE_REQUIRED = new Set([
  'tokens.create',
  'tokens.issue',
  'tokens.transfer',
  'tokens.stake',
  'tokens.unstake',
  // rewards: configuring a pool moves supply control, so it needs ACTIVE.
  // `vote` and `payout` accept POSTING: a vote is a posting-auth social signal
  // on L1, and payout is an idempotent crank anyone may turn (its result is
  // independent of the caller). This mirrors Scotbot's auth split.
  'rewards.setReward',
  'rewards.disableReward',
  // workerbee: forever-locking the stake token moves value (it is a permanent
  // commitment of the staked token), so it needs ACTIVE. `tick`/`runLottery`/
  // `claim` accept POSTING: tick is an idempotent crank anyone may turn (its
  // result is independent of the caller), and claim only mints the sender's own
  // already-accrued APIS. (Mirrors the rewards.payout/vote auth split.)
  'workerbee.foreverLock',
  // bridge: minting/burning wMELEK controls supply against locked MELEK — the
  // most supply-sensitive ops on the engine. ACTIVE auth required (the contract
  // also restricts the sender to config.bridge.account).
  'bridge.mintWrapped',
  'bridge.burnWrapped',
  'gateway.deposit',
  'gateway.withdraw',
  'dexSettlement.settle',
  // tokens.burn destroys supply → ACTIVE (it moves/removes value).
  'tokens.burn',
  // nft: collection/type/mint control supply; transfer/burn move value → all ACTIVE.
  'nft.createCollection',
  'nft.defineType',
  'nft.mint',
  'nft.transfer',
  'nft.burn',
  // seeds: register/mint control supply, plant burns → all ACTIVE.
  'seeds.register',
  'seeds.mint',
  'seeds.plant',
  // scot: createTribe creates a token + reward rule; mint issues supply → ACTIVE.
  'scot.createTribe',
  'scot.mint',
]);

export class Engine {
  constructor(state) {
    this.state = state;
    // per-L1-block rate metering: { blockNum -> { account -> count } }
    this._rate = { block: 0, counts: new Map() };
  }

  /**
   * Process one sidechain op. Returns a result record (also pushed to the
   * engine's processed log in state).
   *
   * @param {object} op {sender, authLevel, json, txId, blockNum, blockId}
   */
  process(op) {
    const { sender, authLevel, blockNum, blockId, txId } = op;

    // reset rate counters when L1 block advances
    if (this._rate.block !== blockNum) {
      this._rate = { block: blockNum, counts: new Map() };
    }
    const used = this._rate.counts.get(sender) || 0;

    // hard ceiling regardless of fee (§6 E item 11)
    if (used >= config.maxTxPerAccountPerBlock) {
      return this._log(op, { ok: false, error: 'rate limit: max tx/account/block exceeded' });
    }
    this._rate.counts.set(sender, used + 1);

    // parse instruction
    let instr;
    try {
      instr = typeof op.json === 'string' ? JSON.parse(op.json) : op.json;
    } catch {
      return this._log(op, { ok: false, error: 'malformed json' });
    }
    const { contractName, contractAction, contractPayload = {} } = instr || {};
    const contract = CONTRACTS[contractName];
    if (!contract) return this._log(op, { ok: false, error: `unknown contract ${contractName}` });
    const action = contract[contractAction];
    if (typeof action !== 'function') {
      return this._log(op, { ok: false, error: `unknown action ${contractName}.${contractAction}` });
    }

    // auth-level enforcement (§6 A item 1)
    const key = `${contractName}.${contractAction}`;
    if (ACTIVE_REQUIRED.has(key) && authLevel !== 'active') {
      return this._log(op, { ok: false, error: `${key} requires active auth` });
    }

    // resource fee beyond the free allowance (§6 E item 11). Free for the
    // first N tx/account/block; excess burns the resource fee in APIS.
    if (used >= config.freeTxPerAccountPerBlock) {
      const feeRes = burnFee(this.state, sender, config.resourceFee);
      if (!feeRes.ok) {
        return this._log(op, { ok: false, error: `resource fee: ${feeRes.error}` });
      }
    }

    const ctx = { sender, authLevel, blockNum, blockId, txId };
    let result;
    try {
      result = action(this.state, ctx, contractPayload);
    } catch (e) {
      // contracts shouldn't throw on user error; an internal throw is logged,
      // never mutates beyond what happened, and does not crash the engine.
      result = { ok: false, error: `internal: ${e.message}` };
    }
    return this._log(op, result);
  }

  _log(op, result) {
    this.state.insert('processed', {
      block: op.blockNum,
      txId: op.txId,
      sender: op.sender,
      action: (() => {
        try {
          const j = typeof op.json === 'string' ? JSON.parse(op.json) : op.json;
          return `${j?.contractName}.${j?.contractAction}`;
        } catch {
          return 'malformed';
        }
      })(),
      ok: result.ok,
      error: result.ok ? null : result.error,
    });
    return result;
  }

  /**
   * Fold an L1 SOCIAL op into the SCOT/rewards layer. This is the bridge that was missing — the
   * engine now turns real L1 votes/comments into tribe rewards (not just custom_json token ops):
   *   - comment → remember the post's tribe tags (so a later vote can map post→tribe)
   *   - vote    → for every tribe the post belongs to, record a stake-weighted reward vote
   *               (the VOTER needs staked tribe-token to give out rewards; the AUTHOR needs none).
   * @param {object} s { kind:'comment'|'vote', author, permlink, tags?, voter?, blockNum, blockId, txId }
   */
  processSocial(s) {
    if (!s) return;
    if (s.kind === 'comment') {
      recordPostTags(this.state, { author: s.author, permlink: s.permlink, tags: s.tags });
      return;
    }
    if (s.kind === 'vote') {
      const symbols = tribesForPost(this.state, s.author, s.permlink);
      for (const symbol of symbols) {
        const ctx = { sender: s.voter, authLevel: 'posting', blockNum: s.blockNum, blockId: s.blockId, txId: s.txId };
        try { rewards.vote(this.state, ctx, { author: s.author, permlink: s.permlink, symbol }); }
        catch { /* soft-fail-never-throw: a no-stake voter / bad post is just skipped */ }
      }
    }
  }

  /**
   * Crank payouts at the end of each L1 block (idempotent; emits ONLY matured, unpaid posts).
   * Anyone-can-turn deterministic crank — runs every tribe's matured windows.
   */
  crankPayouts(ctx) {
    for (const rule of this.state.find('rewardRules', {})) {
      if (rule.enabled === false) continue;
      try { rewards.payout(this.state, { sender: 'engine', authLevel: 'posting', ...ctx }, { symbol: rule.symbol }); }
      catch { /* soft-fail */ }
    }
  }

  /**
   * Advance the WorkerBee issuance lottery one step at the end of each L1 block
   * (idempotent within a block; emits ONLY the elapsed scheduled emission split
   * by APIS-Hash share). Anyone-can-turn deterministic crank.
   */
  crankWorkerbee(ctx) {
    try { workerbee.tick(this.state, { sender: 'engine', authLevel: 'posting', ...ctx }); }
    catch { /* soft-fail-never-throw */ }
  }

  /** Mark an L1 block as fully processed and (optionally) persist + hash. */
  commitBlock(blockNum, blockId, persist = true) {
    this.state.meta.lastBlock = blockNum;
    this.state.meta.lastBlockId = blockId;
    if (persist) this.state.persist();
    return this.state.hash();
  }
}
