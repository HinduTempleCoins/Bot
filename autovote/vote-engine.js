/**
 * autovote/vote-engine.js — the chain-agnostic worker loop.
 *
 * For each Graphene chain that has active rules, streams blocks, matches user
 * rules (fanbases + trails), fires due scheduled votes, and broadcasts vote ops
 * using each user's chosen auth method. Rules/trails/votes are scoped per
 * (chain, account); a melek-testnet rule never fires on hive and vice-versa.
 *
 * ── SIGNER SEAM (production) ───────────────────────────────────────────────
 * signAndBroadcast() is the single place a credential turns into a chain op.
 * It routes per auth method:
 *   postingkey → sign locally with the stored WIF (testnet/throwaway only)
 *   hivesigner → broadcast via the user's revocable OAuth bearer token (offline-capable)
 *   whalevault → NOT signable server-side (the extension only signs while the
 *                user's browser tab is open). Scheduled/automated votes for
 *                WhaleVault users are skipped here and surfaced to the in-browser
 *                client; we NEVER silently fall back to asking for a key.
 * For MELEK, posting-key is replaced by MELEK-Signer later (same seam). See MELEK_SIGNER.md.
 *
 * ── SAFETY ─────────────────────────────────────────────────────────────────
 * config.blockMainnetBroadcast (default ON) makes the engine refuse to broadcast
 * any vote on a mainnet chain (hive/steem/blurt). Multi-chain logic is exercised
 * on the MELEK testnet + mocks; mainnet ships present-but-unverified (beta).
 * ───────────────────────────────────────────────────────────────────────────
 */

import { chainFor } from './chain.js';
import { config } from './config.js';
import { getChain, isMainnet } from './chains.js';
import { voteViaHiveSigner } from './hivesigner.js';
import { optimalFireAtMs } from './curation-timing.mjs';
import {
  fanbaseMatches,
  fanbaseVoteWeight,
  trailMatches,
  trailVoteWeight,
  scheduleDue,
  underDailyCap,
  nextAllowedVoteTime,
} from './rules.js';

export class VoteEngine {
  constructor(store, opts = {}) {
    this.store = store;
    // chains: id -> Chain. Injectable for tests (opts.chains is a Map or object).
    this._chains = opts.chains
      ? (opts.chains instanceof Map ? opts.chains : new Map(Object.entries(opts.chains)))
      : new Map();
    this.voteIntervalMs = opts.voteIntervalMs || config.voteIntervalMs;
    this.log = opts.log || ((...a) => console.log('[engine]', ...a));
    this.hsBroadcast = opts.hsBroadcast || voteViaHiveSigner; // injectable for tests
    this.blockMainnet = opts.blockMainnet ?? config.blockMainnetBroadcast;
    this._lastVoteAt = new Map(); // "chain:owner" -> ms (in-process rate limiter)
    this._running = false;
    this._cursors = new Map(); // chainId -> last processed block
    this._lastPoll = new Map(); // chainId -> ms of last poll (per-chain cadence)
    this._startBlock = opts.startBlock; // for tests
    // pending key: `${chain}|${owner}|${author}|${permlink}`
    this._pending = new Map();
    // Curation-timing: when ON, fanbase/trail votes fire at the per-chain
    // curation-optimal moment (Hive=prompt, Steem/Blurt=+5min reverse-auction
    // edge) with the rule's own delayMs kept as a floor. Default OFF so live
    // behavior is unchanged until the operator opts in (alongside mainnet).
    this.curationTiming = opts.curationTiming ?? config.curationTiming;
  }

  /**
   * Compute the fireAt (ms) for a matched fanbase/trail vote.
   *  - curationTiming OFF → legacy flat behavior: eventTimeMs + delayMs.
   *  - curationTiming ON  → per-chain optimal moment from curation-timing.mjs,
   *    using postTimeMs as the post's creation time, with delayMs as a floor.
   * Pure given its inputs (clock injectable via `now`).
   */
  computeFireAt(chainId, { eventTimeMs, postTimeMs, delayMs, now = Date.now() }) {
    const floorMs = Number(delayMs) || 0;
    if (!this.curationTiming) return Number(eventTimeMs) + floorMs;
    return optimalFireAtMs(chainId, {
      nowMs: now,
      postTimeMs: postTimeMs ?? eventTimeMs,
      floorMs,
    });
  }

  chainFor(chainId) {
    if (this._chains.has(chainId)) return this._chains.get(chainId);
    const c = chainFor(chainId); // lazily build a real Chain
    this._chains.set(chainId, c);
    return c;
  }

  // ── SIGNER SEAM: the only place a credential becomes a chain op ──
  async signAndBroadcast(chainId, owner, voteOp) {
    const user = this.store.getUser(chainId, owner);
    if (!user) throw new Error(`no user ${chainId}:${owner}`);

    if (this.blockMainnet && isMainnet(chainId)) {
      throw new Error(`mainnet broadcast blocked (${chainId}) — set AUTOVOTE_ALLOW_MAINNET=1 to enable`);
    }

    switch (user.authMethod) {
      case 'postingkey': {
        if (!user.postingKey) throw new Error(`no posting key for ${chainId}:${owner}`);
        return this.chainFor(chainId).vote(voteOp, user.postingKey);
      }
      case 'hivesigner': {
        if (!user.hsToken) throw new Error(`no hivesigner token for ${chainId}:${owner}`);
        return this.hsBroadcast(user.hsToken, voteOp);
      }
      case 'whalevault':
        // WhaleVault cannot sign server-side. Skip offline; the in-browser
        // client handles these while the tab is open.
        throw new Error('whalevault cannot sign server-side (in-browser only)');
      default:
        throw new Error(`unknown auth method ${user.authMethod} for ${chainId}:${owner}`);
    }
  }

  _pendKey(chain, owner, author, permlink) {
    return `${chain}|${owner}|${author}|${permlink}`;
  }

  /** Queue a vote to fire at fireAt, if not already done/queued. */
  enqueue({ chain, owner, author, permlink, weight, fireAt, rule, ruleId }) {
    if (weight === 0) return;
    // WhaleVault users get no offline/automated votes — only in-browser. Skip queueing.
    const user = this.store.getUser(chain, owner);
    if (user && user.authMethod === 'whalevault') return;
    if (this.store.hasVoted(chain, owner, author, permlink)) return;
    const key = this._pendKey(chain, owner, author, permlink);
    if (this._pending.has(key)) return;
    this._pending.set(key, { chain, owner, author, permlink, weight, fireAt, rule, ruleId });
    this.log(`queued ${rule} vote [${chain}]: ${owner} -> @${author}/${permlink} w=${weight} in ${Math.max(0, fireAt - Date.now())}ms`);
  }

  /** Inspect a chain's block and queue any matching fanbase/trail actions. */
  processBlock(chainId, block) {
    const eventTimeMs = Date.parse(block.timestamp + 'Z') || Date.now();
    for (const { type, payload } of block.ops) {
      if (type === 'comment') {
        for (const f of this.store.data.fanbases) {
          if (f.chain !== chainId) continue;
          if (fanbaseMatches(f, payload)) {
            this.enqueue({
              chain: chainId,
              owner: f.owner,
              author: payload.author.toLowerCase(),
              permlink: payload.permlink,
              weight: fanbaseVoteWeight(f),
              // Fanbase fires on the `comment` op itself, so eventTimeMs IS the
              // post's creation time — exactly what curation timing needs.
              fireAt: this.computeFireAt(chainId, {
                eventTimeMs,
                postTimeMs: eventTimeMs,
                delayMs: f.delayMs,
              }),
              rule: 'fanbase',
              ruleId: f.id,
            });
          }
        }
      } else if (type === 'vote') {
        for (const t of this.store.data.trails) {
          if (t.chain !== chainId) continue;
          if (trailMatches(t, payload)) {
            this.enqueue({
              chain: chainId,
              owner: t.owner,
              author: payload.author.toLowerCase(),
              permlink: payload.permlink,
              weight: trailVoteWeight(t, Number(payload.weight)),
              // Trail fires on a leader's `vote` op; we don't see the post's
              // creation time here, so use the leader's vote time as the
              // post-time proxy. On reverse-auction chains the leader usually
              // already waited out the window, so the proxy yields a prompt
              // follow; curation timing still clamps to never fire too early.
              fireAt: this.computeFireAt(chainId, {
                eventTimeMs,
                delayMs: t.delayMs,
              }),
              rule: 'trail',
              ruleId: t.id,
            });
          }
        }
      }
    }
  }

  /** Move due scheduled votes into the pending queue. */
  queueDueSchedules(now = Date.now()) {
    for (const s of this.store.data.schedules) {
      if (scheduleDue(s, now)) {
        this.enqueue({
          chain: s.chain,
          owner: s.owner,
          author: s.author,
          permlink: s.permlink,
          weight: s.weight,
          fireAt: now,
          rule: 'schedule',
          ruleId: s.id,
        });
      }
    }
  }

  /** Fire any pending votes whose fireAt has passed, honoring rate-limit + caps. */
  async flushPending(now = Date.now()) {
    for (const [key, p] of this._pending) {
      if (p.fireAt > now) continue;

      if (this.store.hasVoted(p.chain, p.owner, p.author, p.permlink)) {
        this._pending.delete(key);
        continue;
      }

      // per-(chain,owner) rate limit
      const rlKey = `${p.chain}:${p.owner}`;
      const allowedAt = nextAllowedVoteTime(this._lastVoteAt.get(rlKey), this.voteIntervalMs);
      if (now < allowedAt) continue;

      // daily cap (per rule's configured cap)
      const cap = p.rule === 'trail'
        ? (this.store.data.trails.find((r) => r.id === p.ruleId)?.dailyCap ?? 0)
        : p.rule === 'fanbase'
        ? (this.store.data.fanbases.find((r) => r.id === p.ruleId)?.maxPerDay ?? 0)
        : 0;
      const todayCount = this.store.votesToday(p.chain, p.owner).length;
      if (!underDailyCap(cap, todayCount)) {
        this.log(`daily cap reached for ${p.chain}:${p.owner} (${cap}); dropping ${key}`);
        this._pending.delete(key);
        continue;
      }

      this._pending.delete(key);
      this._lastVoteAt.set(rlKey, now);
      try {
        const res = await this.signAndBroadcast(p.chain, p.owner, {
          voter: p.owner,
          author: p.author,
          permlink: p.permlink,
          weight: p.weight,
        });
        const txId = res?.id || res?.tx_id || res?.result?.id || null;
        this.store.logVote({
          chain: p.chain, owner: p.owner, author: p.author, permlink: p.permlink,
          weight: p.weight, rule: p.rule, ruleId: p.ruleId, txId, ok: true,
        });
        if (p.rule === 'schedule') this.store.markScheduleDone(p.ruleId, true);
        this.log(`VOTED [${p.chain}] ${p.owner} -> @${p.author}/${p.permlink} w=${p.weight} tx=${txId}`);
      } catch (err) {
        this.store.logVote({
          chain: p.chain, owner: p.owner, author: p.author, permlink: p.permlink,
          weight: p.weight, rule: p.rule, ruleId: p.ruleId, ok: false,
          error: String(err?.message || err),
        });
        if (p.rule === 'schedule') this.store.markScheduleDone(p.ruleId, false);
        this.log(`VOTE FAILED [${p.chain}] ${p.owner} -> @${p.author}/${p.permlink}: ${err?.message || err}`);
      }
    }
  }

  /** Advance the block cursor for one chain (respecting its poll cadence). */
  async pollChain(chainId, now = Date.now()) {
    const entry = getChain(chainId);
    if (!entry || !entry.stream) return;
    const cadence = entry.pollIntervalMs || config.pollIntervalMs;
    if (now - (this._lastPoll.get(chainId) || 0) < cadence) return; // be polite to public RPCs
    this._lastPoll.set(chainId, now);

    const chain = this.chainFor(chainId);
    try {
      const head = await chain.headBlockNumber();
      let cursor = this._cursors.get(chainId);
      if (cursor == null) { cursor = this._startBlock ?? head; this._cursors.set(chainId, cursor); }
      // Bound work per tick so a cold start doesn't fetch thousands of blocks.
      let budget = 50;
      while (cursor < head && budget-- > 0) {
        const next = cursor + 1;
        const block = await chain.getBlockOps(next);
        if (!block) break;
        this.processBlock(chainId, block);
        cursor = next;
        this._cursors.set(chainId, cursor);
      }
    } catch (err) {
      this.log(`block poll error [${chainId}]:`, err?.message || err);
    }
  }

  /** Chains with at least one active (server-signable) rule. */
  _chainsToStream() {
    const set = new Set();
    for (const r of [...this.store.data.fanbases, ...this.store.data.trails]) {
      if (r.paused) continue;
      const u = this.store.getUser(r.chain, r.owner);
      // WhaleVault users can't be auto-served offline; their rules don't need streaming.
      if (u && u.authMethod === 'whalevault') continue;
      set.add(r.chain);
    }
    return [...set];
  }

  async tick(now = Date.now()) {
    for (const chainId of this._chainsToStream()) {
      await this.pollChain(chainId, now);
    }
    this.queueDueSchedules(now);
    await this.flushPending(now);
  }

  async start() {
    if (this._running) return;
    this._running = true;
    this.log(`starting (chain-agnostic); mainnet-broadcast=${this.blockMainnet ? 'BLOCKED' : 'ALLOWED'}`);
    const loop = async () => {
      if (!this._running) return;
      await this.tick();
      if (this._running) this._timer = setTimeout(loop, config.pollIntervalMs);
    };
    loop();
  }

  stop() {
    this._running = false;
    clearTimeout(this._timer);
  }
}
