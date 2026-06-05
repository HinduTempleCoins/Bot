/**
 * autovote/vote-engine.js — the worker loop.
 *
 * Streams testnet blocks, matches user rules (fanbases + trails), fires due
 * scheduled votes, and broadcasts vote ops with each user's stored posting key.
 *
 * ── SIGNER SEAM (production) ───────────────────────────────────────────────
 * Today this reads `user.postingKey` (a WIF) straight from the store and signs
 * locally with dhive. That is a TESTNET-ONLY shortcut. In production this is the
 * single place that changes: instead of holding a WIF, each user authorizes via
 * OAuth and we broadcast through MELEK-Signer with a scoped, revocable bearer
 * token (vote-only scope). Replace `signAndBroadcast()` below with a call to the
 * MELEK-Signer client; the rest of the engine (matching, dedupe, rate-limit,
 * caps) is unchanged. See MELEK_SIGNER.md.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { Chain } from './chain.js';
import { config } from './config.js';
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
    this.chain = opts.chain || new Chain();
    this.pollIntervalMs = opts.pollIntervalMs || config.pollIntervalMs;
    this.voteIntervalMs = opts.voteIntervalMs || config.voteIntervalMs;
    this.log = opts.log || ((...a) => console.log('[engine]', ...a));
    this._lastVoteAt = new Map(); // owner -> ms (in-process rate limiter)
    this._running = false;
    this._cursor = opts.startBlock || null;
    // pending = matched-but-delayed actions waiting for their fireAt.
    // key: `${owner}|${author}|${permlink}` -> { owner, author, permlink, weight, fireAt, rule, ruleId }
    this._pending = new Map();
  }

  // ── SIGNER SEAM: the only place a key is used to broadcast ──
  async signAndBroadcast(owner, voteOp) {
    const user = this.store.getUser(owner);
    if (!user || !user.postingKey) throw new Error(`no posting key for ${owner}`);
    return this.chain.vote(voteOp, user.postingKey);
  }

  _pendKey(owner, author, permlink) {
    return `${owner}|${author}|${permlink}`;
  }

  /** Queue a vote to fire at fireAt (respecting delay), if not already done/queued. */
  enqueue({ owner, author, permlink, weight, fireAt, rule, ruleId }) {
    if (weight === 0) return;
    if (this.store.hasVoted(owner, author, permlink)) return; // dedupe vs log
    const key = this._pendKey(owner, author, permlink);
    if (this._pending.has(key)) return; // dedupe vs queue
    this._pending.set(key, { owner, author, permlink, weight, fireAt, rule, ruleId });
    this.log(`queued ${rule} vote: ${owner} -> @${author}/${permlink} w=${weight} in ${Math.max(0, fireAt - Date.now())}ms`);
  }

  /** Inspect a block's ops and queue any matching fanbase/trail actions. */
  processBlock(block) {
    const eventTimeMs = Date.parse(block.timestamp + 'Z') || Date.now();
    const users = this.store.allUsers();
    if (users.length === 0) return;

    for (const { type, payload } of block.ops) {
      if (type === 'comment') {
        // fanbase: top-level posts by tracked authors
        for (const f of this.store.data.fanbases) {
          if (fanbaseMatches(f, payload)) {
            this.enqueue({
              owner: f.owner,
              author: payload.author.toLowerCase(),
              permlink: payload.permlink,
              weight: fanbaseVoteWeight(f),
              fireAt: eventTimeMs + Number(f.delayMs || 0),
              rule: 'fanbase',
              ruleId: f.id,
            });
          }
        }
      } else if (type === 'vote') {
        // trail: follow upvotes by trailed leaders
        for (const t of this.store.data.trails) {
          if (trailMatches(t, payload)) {
            this.enqueue({
              owner: t.owner,
              author: payload.author.toLowerCase(),
              permlink: payload.permlink,
              weight: trailVoteWeight(t, Number(payload.weight)),
              fireAt: eventTimeMs + Number(t.delayMs || 0),
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

      // already voted (could have been voted by another rule)?
      if (this.store.hasVoted(p.owner, p.author, p.permlink)) {
        this._pending.delete(key);
        continue;
      }

      // per-owner rate limit (chain enforces ~3s between votes per account)
      const allowedAt = nextAllowedVoteTime(this._lastVoteAt.get(p.owner), this.voteIntervalMs);
      if (now < allowedAt) continue; // try again next tick

      // daily cap (per rule's configured cap)
      const cap = p.rule === 'trail'
        ? (this.store.data.trails.find((r) => r.id === p.ruleId)?.dailyCap ?? 0)
        : p.rule === 'fanbase'
        ? (this.store.data.fanbases.find((r) => r.id === p.ruleId)?.maxPerDay ?? 0)
        : 0;
      const todayCount = this.store.votesToday(p.owner).length;
      if (!underDailyCap(cap, todayCount)) {
        this.log(`daily cap reached for ${p.owner} (${cap}); dropping ${key}`);
        this._pending.delete(key);
        continue;
      }

      this._pending.delete(key);
      this._lastVoteAt.set(p.owner, now);
      try {
        const res = await this.signAndBroadcast(p.owner, {
          voter: p.owner,
          author: p.author,
          permlink: p.permlink,
          weight: p.weight,
        });
        const txId = res?.id || res?.tx_id || null;
        this.store.logVote({
          owner: p.owner, author: p.author, permlink: p.permlink,
          weight: p.weight, rule: p.rule, ruleId: p.ruleId, txId, ok: true,
        });
        if (p.rule === 'schedule') this.store.markScheduleDone(p.ruleId, true);
        this.log(`VOTED ${p.owner} -> @${p.author}/${p.permlink} w=${p.weight} tx=${txId}`);
      } catch (err) {
        this.store.logVote({
          owner: p.owner, author: p.author, permlink: p.permlink,
          weight: p.weight, rule: p.rule, ruleId: p.ruleId, ok: false,
          error: String(err?.message || err),
        });
        if (p.rule === 'schedule') this.store.markScheduleDone(p.ruleId, false);
        this.log(`VOTE FAILED ${p.owner} -> @${p.author}/${p.permlink}: ${err?.message || err}`);
      }
    }
  }

  async tick() {
    // 1. advance block cursor
    try {
      const head = await this.chain.headBlockNumber();
      if (this._cursor == null) this._cursor = head; // start from head on first run
      while (this._cursor < head) {
        const next = this._cursor + 1;
        const block = await this.chain.getBlockOps(next);
        if (!block) break;
        this.processBlock(block);
        this._cursor = next;
      }
    } catch (err) {
      this.log('block poll error:', err?.message || err);
    }
    // 2. due schedules + 3. flush
    this.queueDueSchedules();
    await this.flushPending();
  }

  async start() {
    if (this._running) return;
    this._running = true;
    this.log(`starting; rpc=${config.rpcUrl} interval=${this.pollIntervalMs}ms`);
    const loop = async () => {
      if (!this._running) return;
      await this.tick();
      if (this._running) this._timer = setTimeout(loop, this.pollIntervalMs);
    };
    loop();
  }

  stop() {
    this._running = false;
    clearTimeout(this._timer);
  }
}
