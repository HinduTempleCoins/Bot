// llm-gateway.mjs — LiteLLM-style control plane in FRONT of every model call (queue #89).
//
// One job: govern model calls so a single resilient choke-point handles throttle, route, cost-cap,
// cache, fail over, and metrics — before any provider is touched. This sits ON TOP of llm-router.mjs
// (the provider ladder); the router still does the actual fan-out across Gemini/OpenRouter/etc.
//
//   import { Gateway } from './integrations/llm-gateway.mjs';
//   const gw = new Gateway({ ratePerSec: 2, burst: 5, budgetUsd: 10 });
//   const res = await gw.call({ prompt: 'Explain VKBT', taskHint: 'cheap' });
//   console.log(gw.metrics());   // counts/latency/cost/cacheHitRate — never secrets
//
// PURE control logic + an injectable backend. The backend is any async fn
//   ({ prompt, taskHint, ...opts }) => { text, provider?, model?, cost?, error? }
// Default backend wraps llm-router's complete() (mapping taskHint → task). Tests inject a fake.
//
// CLI:  node integrations/llm-gateway.mjs "your prompt"  [--task cheap|quality|long]
//       node integrations/llm-gateway.mjs --metrics
//
// SECURITY: this module never sees, logs, or returns API keys. It also never logs prompt bodies
// (a prompt may embed secrets); the cache keys on a hash of the prompt, and metrics expose only
// aggregate numbers. Anything passed to the optional logger is a redacted, key-free status line.

import { complete } from './llm-router.mjs';

// ── tiny stable hash (FNV-1a) — used for cache keys so we NEVER store/log raw prompts ──────────
function hashKey(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ── token-bucket rate limiter (per-key) ───────────────────────────────────────────────────────
// Refills `ratePerSec` tokens/sec up to `burst`. take() returns false when empty (caller rejects).
class TokenBucket {
  constructor(ratePerSec, burst, now = Date.now()) {
    this.ratePerSec = Math.max(0, ratePerSec);
    this.capacity = Math.max(1, burst ?? Math.max(1, ratePerSec));
    this.tokens = this.capacity;
    this.last = now;
  }

  _refill(now) {
    if (now <= this.last) return;
    const elapsed = (now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerSec);
    this.last = now;
  }

  take(now = Date.now(), n = 1) {
    this._refill(now);
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

// Default backend: adapt the llm-router. taskHint maps onto the router's `task` routing knob.
async function routerBackend({ prompt, taskHint, ...opts }) {
  const res = await complete(prompt, { ...opts, task: taskHint });
  // Router returns { text, provider, model, error }. Cost is unknown to the router → 0 unless an
  // estimator is configured at the gateway level.
  return res;
}

const DEFAULTS = {
  ratePerSec: 5, // tokens refilled per second per key
  burst: 10, // bucket capacity
  budgetUsd: Infinity, // hard cost cap; reject calls once spend would exceed it
  cacheTtlMs: 60_000, // cache entry lifetime
  cacheMax: 500, // max cached entries (LRU-ish prune)
  estimateCost: null, // optional ({prompt,result}) => usd; falls back to result.cost ?? 0
  now: () => Date.now(), // injectable clock (tests)
  log: null, // optional (msg) => void; only key-free status lines passed
};

export class Gateway {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this._buckets = new Map(); // key → TokenBucket
    this._cache = new Map(); // cacheKey → { value, expires }
    this._m = {
      count: 0,
      cacheHits: 0,
      cacheMisses: 0,
      rateLimited: 0,
      budgetRejected: 0,
      failovers: 0,
      errors: 0,
      totalLatencyMs: 0,
      totalCostUsd: 0,
    };
  }

  _now() {
    return this.cfg.now();
  }

  _log(msg) {
    if (typeof this.cfg.log === 'function') this.cfg.log(`[llm-gateway] ${msg}`);
  }

  _bucket(key) {
    let b = this._buckets.get(key);
    if (!b) {
      b = new TokenBucket(this.cfg.ratePerSec, this.cfg.burst, this._now());
      this._buckets.set(key, b);
    }
    return b;
  }

  _cacheGet(cacheKey) {
    const hit = this._cache.get(cacheKey);
    if (!hit) return undefined;
    if (hit.expires <= this._now()) {
      this._cache.delete(cacheKey);
      return undefined;
    }
    // refresh recency for LRU prune
    this._cache.delete(cacheKey);
    this._cache.set(cacheKey, hit);
    return hit.value;
  }

  _cacheSet(cacheKey, value) {
    if (this.cfg.cacheTtlMs <= 0) return;
    this._cache.set(cacheKey, { value, expires: this._now() + this.cfg.cacheTtlMs });
    while (this._cache.size > this.cfg.cacheMax) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
  }

  _costOf(prompt, result) {
    if (typeof this.cfg.estimateCost === 'function') {
      const c = Number(this.cfg.estimateCost({ prompt, result }));
      return Number.isFinite(c) ? c : 0;
    }
    const c = Number(result?.cost);
    return Number.isFinite(c) ? c : 0;
  }

  /**
   * Govern a single model call.
   *
   * @param {object} req
   * @param {string} req.prompt
   * @param {string} [req.taskHint]            routing hint passed to the backend ('cheap'|'quality'|'long')
   * @param {string} [req.key='default']       rate-limit bucket key (per-tenant/per-account throttle)
   * @param {boolean} [req.noCache=false]      bypass cache read+write for this call
   * @param {Function} backend                 primary backend ({prompt,taskHint,...}) => {text,...}
   * @param {Function} [secondary]             failover backend, same shape; called on primary error/throw
   * @returns {Promise<object>} backend result, plus { cached?, failedOver?, rejected? }
   */
  async call(req = {}, backend, secondary) {
    const {
      prompt = '',
      taskHint,
      key = 'default',
      noCache = false,
      ...rest
    } = req;
    const primary = typeof backend === 'function' ? backend : routerBackend;

    // 1) rate limit (per key)
    if (!this._bucket(key).take(this._now())) {
      this._m.rateLimited += 1;
      this._log(`rate-limited key=${key}`);
      return { text: '', error: 'rate_limited', rejected: 'rate_limit' };
    }

    // 2) budget cap — reject when we are already at/over the cap
    if (this._m.totalCostUsd >= this.cfg.budgetUsd) {
      this._m.budgetRejected += 1;
      this._log('budget cap reached');
      return { text: '', error: 'budget_exceeded', rejected: 'budget' };
    }

    // 3) cache (hash of prompt+taskHint — never the raw prompt)
    const cacheKey = `${hashKey(prompt)}:${taskHint || 'default'}`;
    if (!noCache) {
      const cached = this._cacheGet(cacheKey);
      if (cached !== undefined) {
        this._m.count += 1;
        this._m.cacheHits += 1;
        this._log('cache hit');
        return { ...cached, cached: true };
      }
      this._m.cacheMisses += 1;
    }

    // 4) call backend, fail over on error/throw
    const start = this._now();
    let result;
    let failedOver = false;
    try {
      result = await primary({ prompt, taskHint, ...rest });
      // router-style soft error (never throws) also triggers failover
      if (result?.error && !result?.text && typeof secondary === 'function') {
        throw new Error(result.error);
      }
    } catch (primaryErr) {
      this._m.errors += 1;
      this._log(`primary failed (${primaryErr?.message || 'error'})`);
      if (typeof secondary === 'function') {
        try {
          result = await secondary({ prompt, taskHint, ...rest });
          failedOver = true;
          this._m.failovers += 1;
          this._log('failed over to secondary');
        } catch (secErr) {
          this._log(`secondary failed (${secErr?.message || 'error'})`);
          this._m.count += 1;
          this._m.totalLatencyMs += this._now() - start;
          return { text: '', error: 'all_backends_failed', failedOver: true };
        }
      } else {
        this._m.count += 1;
        this._m.totalLatencyMs += this._now() - start;
        return { text: '', error: 'backend_failed' };
      }
    }

    // 5) metrics + cache the good result
    const latency = this._now() - start;
    const cost = this._costOf(prompt, result);
    this._m.count += 1;
    this._m.totalLatencyMs += latency;
    this._m.totalCostUsd += cost;

    const out = { ...result, latencyMs: latency, cost };
    if (failedOver) out.failedOver = true;
    if (!noCache && result?.text) this._cacheSet(cacheKey, { ...result });
    return out;
  }

  /**
   * Aggregate metrics. No secrets, no prompts — counts/latency/cost/rates only.
   */
  metrics() {
    const m = this._m;
    const lookups = m.cacheHits + m.cacheMisses;
    return {
      count: m.count,
      cacheHits: m.cacheHits,
      cacheMisses: m.cacheMisses,
      cacheHitRate: lookups ? m.cacheHits / lookups : 0,
      rateLimited: m.rateLimited,
      budgetRejected: m.budgetRejected,
      failovers: m.failovers,
      errors: m.errors,
      totalCostUsd: Number(m.totalCostUsd.toFixed(6)),
      avgLatencyMs: m.count ? Math.round(m.totalLatencyMs / m.count) : 0,
      budgetUsd: this.cfg.budgetUsd,
      budgetRemainingUsd:
        this.cfg.budgetUsd === Infinity
          ? Infinity
          : Number((this.cfg.budgetUsd - m.totalCostUsd).toFixed(6)),
    };
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('llm-gateway.mjs');

if (isMain) {
  const args = process.argv.slice(2);
  const gw = new Gateway({ log: (m) => console.error(m) });
  if (args[0] === '--metrics') {
    console.log(JSON.stringify(gw.metrics(), null, 2));
    process.exit(0);
  }
  const task = args.includes('--task') ? args[args.indexOf('--task') + 1] : undefined;
  const prompt = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--task').join(' ').trim();
  if (!prompt) {
    console.error('usage: node integrations/llm-gateway.mjs "your prompt" [--task cheap|quality|long]');
    console.error('       node integrations/llm-gateway.mjs --metrics');
    process.exit(1);
  }
  const res = await gw.call({ prompt, taskHint: task });
  if (res.error) {
    console.error(`\n✗ ${res.error}`);
    process.exit(2);
  }
  console.error(`\n✓ ${res.provider ? `answered by ${res.provider}` : 'answered'}${res.cached ? ' (cached)' : ''}\n`);
  console.log(res.text);
  console.error('\nmetrics:', JSON.stringify(gw.metrics()));
}
