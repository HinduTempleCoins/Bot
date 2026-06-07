// integrations/rate-limit.mjs — repo-side abuse rate limiter for the public signup surfaces.
//
// WHY THIS EXISTS
//   The bounded spam-test against the live MELEK testnet (carryover #299) found the chain ALREADY
//   self-limits posting (5 custom_json / account / block; 300 s between root posts; 3 s between
//   replies/votes) — so on-chain spam is chain-bounded. The hole is the *faucet*: one client minted
//   5/5 funded accounts back-to-back in ~4.5 s with ZERO throttling. Account CREATION is the
//   highest-risk surface (each mint produces a funded account that then feeds the chain-side limits).
//   This module is the repo-side cap that sits in front of `/faucet/create` (and the signup-help
//   email endpoint) so one client can't mint accounts (or trigger emails) without bound.
//
// DESIGN
//   • Sliding-window counters, two INDEPENDENT keys per request: the client IP and a caller-supplied
//     fingerprint (e.g. a browser/device hash, or the requested account name as a weak fallback).
//     A request is allowed only if BOTH the per-IP and the per-fingerprint window are under cap.
//   • State is a single JSON file, atomically written (temp+rename), env-tunable paths/limits.
//   • SOFT-FAIL OPEN: if the state file is unreadable/corrupt, we start clean and ALLOW — a broken
//     limiter must never lock real users out of signup. (It still records going forward.)
//   • Pure-ish + offline-testable: the clock is injectable (`now`), no network, no global singletons
//     required (each Limiter owns its file). Never throws out of `check()`.
//
// CONFIG (env, all optional)
//   RL_STATE_FILE       state path (default integrations/.rate-limit-state.json)
//   RL_IP_MAX           max events per IP per window         (default 5)
//   RL_FP_MAX           max events per fingerprint per window (default 3)
//   RL_WINDOW_SEC       sliding window length in seconds      (default 3600 = 1 h)
//   RL_DISABLED         "1"/"true" to bypass entirely (always allow; for emergencies)
//
// USAGE
//   import { Limiter, clientIp } from '../integrations/rate-limit.mjs';
//   const rl = new Limiter({ scope: 'faucet' });           // one Limiter per surface
//   const ip = clientIp(req);
//   const v = rl.check({ ip, fingerprint: body.name });    // never throws
//   if (!v.allowed) return send(res, 429, { ok:false, reason:'rate-limited', retryAfter:v.retryAfter });
//   // ... do the work ...
//
//   node integrations/rate-limit.mjs        # worked example / self-check

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_PATH = join(__dirname, '.rate-limit-state.json');

function envInt(name, dflt) {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
function envFlag(name) {
  const v = (process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

// Best-effort client IP from a Node req. Honors X-Forwarded-For (first hop) when present — the
// faucet/signup servers sit behind a reverse proxy, so the socket address is the proxy. Falls back
// to the socket. Returns a stable string ('unknown' if nothing is derivable) — never throws.
export function clientIp(req) {
  try {
    const xff = req?.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      const first = xff.split(',')[0].trim();
      if (first) return first;
    }
    const real = req?.headers?.['x-real-ip'];
    if (typeof real === 'string' && real.trim()) return real.trim();
    return req?.socket?.remoteAddress || req?.connection?.remoteAddress || 'unknown';
  } catch {
    return 'unknown';
  }
}

const EMPTY = () => ({ _meta: { version: 1, updated: null }, buckets: {} });

export class Limiter {
  /**
   * @param {object} opts
   * @param {string} [opts.scope]        namespace so multiple surfaces share one file safely (e.g. 'faucet').
   * @param {string} [opts.path]         state file path (default RL_STATE_FILE or the module dir).
   * @param {number} [opts.ipMax]        max events per IP per window.
   * @param {number} [opts.fpMax]        max events per fingerprint per window.
   * @param {number} [opts.windowSec]    sliding window length (seconds).
   * @param {boolean}[opts.disabled]     bypass (always allow).
   * @param {()=>number}[opts.now]       injectable clock (ms since epoch); for offline tests.
   */
  constructor({
    scope = 'default',
    path = process.env.RL_STATE_FILE || DEFAULT_STATE_PATH,
    ipMax = envInt('RL_IP_MAX', 5),
    fpMax = envInt('RL_FP_MAX', 3),
    windowSec = envInt('RL_WINDOW_SEC', 3600),
    disabled = envFlag('RL_DISABLED'),
    now = Date.now,
  } = {}) {
    this.scope = String(scope);
    this.path = path;
    this.ipMax = ipMax;
    this.fpMax = fpMax;
    this.windowMs = windowSec * 1000;
    this.disabled = disabled;
    this.now = now;
    this.data = this.#load(); // soft-fail open: corrupt/missing -> clean
  }

  #load() {
    try {
      if (!existsSync(this.path)) return EMPTY();
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.buckets !== 'object') return EMPTY();
      if (!parsed._meta) parsed._meta = { version: 1, updated: null };
      return parsed;
    } catch {
      return EMPTY(); // SOFT-FAIL OPEN — never lock users out because state is unreadable
    }
  }

  #save() {
    try {
      this.data._meta.updated = new Date(this.now()).toISOString();
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      renameSync(tmp, this.path);
    } catch {
      /* persistence is best-effort; an unwritable disk must not break signup */
    }
  }

  #key(kind, id) {
    return `${this.scope}:${kind}:${id}`;
  }

  // Return the live (in-window) timestamps for a bucket, pruning expired entries in place.
  #live(key, nowMs) {
    const arr = Array.isArray(this.data.buckets[key]) ? this.data.buckets[key] : [];
    const cutoff = nowMs - this.windowMs;
    const kept = arr.filter((t) => typeof t === 'number' && t > cutoff);
    this.data.buckets[key] = kept;
    return kept;
  }

  /**
   * Decide whether a request is allowed, and (when allowed) record it against both keys.
   * Never throws. When over a cap, nothing is recorded for that request.
   *
   * @returns {{allowed:boolean, reason:?string, retryAfter:number,
   *            ip:{count:number,max:number}, fingerprint:{count:number,max:number}}}
   */
  check({ ip = 'unknown', fingerprint = 'unknown' } = {}) {
    if (this.disabled) {
      return { allowed: true, reason: null, retryAfter: 0,
        ip: { count: 0, max: this.ipMax }, fingerprint: { count: 0, max: this.fpMax } };
    }
    try {
      const nowMs = this.now();
      const ipKey = this.#key('ip', String(ip || 'unknown'));
      const fpKey = this.#key('fp', String(fingerprint || 'unknown'));
      const ipHits = this.#live(ipKey, nowMs);
      const fpHits = this.#live(fpKey, nowMs);

      const ipOver = ipHits.length >= this.ipMax;
      const fpOver = fpHits.length >= this.fpMax;

      if (ipOver || fpOver) {
        // Pruning may have changed the file; persist so old entries don't accumulate forever.
        this.#save();
        const oldest = ipOver ? Math.min(...ipHits) : Math.min(...fpHits);
        const retryAfter = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
        return {
          allowed: false,
          reason: ipOver ? 'ip-rate-limited' : 'fingerprint-rate-limited',
          retryAfter,
          ip: { count: ipHits.length, max: this.ipMax },
          fingerprint: { count: fpHits.length, max: this.fpMax },
        };
      }

      ipHits.push(nowMs);
      fpHits.push(nowMs);
      this.#save();
      return {
        allowed: true,
        reason: null,
        retryAfter: 0,
        ip: { count: ipHits.length, max: this.ipMax },
        fingerprint: { count: fpHits.length, max: this.fpMax },
      };
    } catch {
      // SOFT-FAIL OPEN: any unexpected error allows the request rather than blocking signup.
      return { allowed: true, reason: 'limiter-error-open', retryAfter: 0,
        ip: { count: 0, max: this.ipMax }, fingerprint: { count: 0, max: this.fpMax } };
    }
  }

  /** Current in-window count for a key (read-only; for tests/observability). */
  peek({ ip, fingerprint } = {}) {
    const nowMs = this.now();
    const out = {};
    if (ip !== undefined) out.ip = this.#live(this.#key('ip', String(ip)), nowMs).length;
    if (fingerprint !== undefined) out.fingerprint = this.#live(this.#key('fp', String(fingerprint)), nowMs).length;
    return out;
  }
}

// ── worked example / self-check ─────────────────────────────────────────────────
if (process.argv[1] && /rate-limit\.mjs$/.test(process.argv[1])) {
  let t = 1_000_000;
  const rl = new Limiter({ scope: 'demo', path: '/tmp/rl-demo-state.json', ipMax: 5, fpMax: 3,
    windowSec: 3600, now: () => t });
  console.log('faucet-shaped: ipMax=5 fpMax=3, one IP minting different accounts:');
  for (let i = 0; i < 7; i++) {
    const v = rl.check({ ip: '203.0.113.7', fingerprint: `acct-${i}` }); // distinct fp each time
    console.log(`  mint #${i + 1}: allowed=${v.allowed} reason=${v.reason ?? '-'} ipCount=${v.ip.count}/${v.ip.max} retryAfter=${v.retryAfter}s`);
    t += 1000;
  }
  console.log('-> IP cap stops the 6th mint even though every fingerprint is fresh.');
}
