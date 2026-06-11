// integrations/kill-switch.mjs — global emergency kill-switch + suspicious-activity audit ring buffer.
//
// WHY THIS EXISTS
//   Backlog items 291 ("Emergency shutdown — admin DM only") and 293 ("suspicious activity logging").
//   This is the GLOBAL on/off gate for the public surfaces (faucet, signup-help mailer, troll-box
//   command endpoint, etc.) plus a bounded in-memory audit log of suspicious events. It is DISTINCT
//   from rate-limit.mjs: that module is a per-key sliding-window throttle (one client can't mint
//   accounts without bound); THIS module is a single operator-controlled master switch — trip it and
//   every guarded action stops, regardless of who is calling — and a forensics ring buffer.
//
// DESIGN
//   • One boolean state ("open" = serving, "tripped" = shut down) + a reason/by/at record, kept in an
//     INJECTABLE store. Default is an in-memory Map (per-process); pass a JSON-file path for a store
//     that survives a restart (atomic temp+rename, soft-fail). No network, no global singleton needed.
//   • gate(action, fn): runs fn only when open; when tripped returns {ok:false,reason:'shutdown'} and
//     records a 'blocked' audit event. Never throws — a thrown fn is caught and surfaced as
//     {ok:false,reason:'error'} (NOT counted against the switch).
//   • SOFT-FAIL is CONFIGURABLE. The risk here is the OPPOSITE of the rate limiter: a kill-switch is a
//     safety control, so a broken/unreadable store should FAIL CLOSED (deny) by default — better to
//     stop serving than to keep serving during an emergency you can't read. Set failOpen:true to invert
//     (serve when state is unreadable) for low-stakes surfaces.
//   • Audit ring buffer: logEvent({type,severity,detail}) appends to a bounded array (oldest evicted
//     when full); recentEvents(n) returns the newest-first slice. Clock is injectable (now).
//
// CONFIG (env, all optional)
//   KS_STATE_FILE   JSON store path (if set, file-backed; otherwise in-memory Map)
//   KS_FAIL_OPEN    "1"/"true" -> serve when state unreadable (default: fail CLOSED / deny)
//   KS_RING_MAX     audit ring-buffer capacity (default 200)
//   KS_DISABLED     "1"/"true" -> switch can never trip (always open; for local dev)
//
// USAGE
//   import { KillSwitch } from '../integrations/kill-switch.mjs';
//   const ks = new KillSwitch();                  // in-memory; or { path: process.env.KS_STATE_FILE }
//   // operator (admin DM handler) trips it:
//   ks.trip('faucet drained', 'hathor');
//   // a public surface gates its work:
//   const out = await ks.gate('faucet-create', () => doTheWork());
//   if (!out.ok) return send(res, 503, { ok:false, reason: out.reason });   // 'shutdown'
//   // forensics:
//   ks.logEvent({ type: 'rate-spike', severity: 'warn', detail: { ip: '203.0.113.7', n: 99 } });
//   ks.recentEvents(10);                          // newest-first
//
//   node integrations/kill-switch.mjs        # worked example / self-check

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function envFlag(name) {
  const v = (process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
function envInt(name, dflt) {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

// Minimal escape for any string that might land in HTML (status pages / admin views). Never throws.
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMPTY = () => ({ open: true, reason: null, by: null, at: null, events: [] });

// ── Stores ──────────────────────────────────────────────────────────────────────
// A store is { read(): state|null, write(state): void }. read() returns null on failure so the
// caller can apply its fail-open/closed policy. write() is best-effort and never throws.

export class MemoryStore {
  constructor() { this._state = null; }
  read() { return this._state; }
  write(state) { try { this._state = JSON.parse(JSON.stringify(state)); } catch { /* best-effort */ } }
}

export class FileStore {
  constructor(path) { this.path = path; }
  read() {
    try {
      if (!existsSync(this.path)) return EMPTY(); // no file yet = clean/open, not a failure
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.open !== 'boolean') return null;
      if (!Array.isArray(parsed.events)) parsed.events = [];
      return parsed;
    } catch {
      return null; // unreadable/corrupt -> let policy decide (fail closed by default)
    }
  }
  write(state) {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2));
      renameSync(tmp, this.path);
    } catch {
      /* persistence is best-effort */
    }
  }
}

export class KillSwitch {
  /**
   * @param {object} opts
   * @param {string}  [opts.path]      JSON store path -> file-backed; omit for in-memory.
   * @param {object}  [opts.store]     explicit store ({read,write}); overrides path. For tests.
   * @param {boolean} [opts.failOpen]  when state is unreadable, serve (true) or deny (false=default).
   * @param {number}  [opts.ringMax]   audit ring-buffer capacity.
   * @param {boolean} [opts.disabled]  switch can never trip (always open).
   * @param {()=>number}[opts.now]     injectable clock (ms since epoch).
   */
  constructor({
    path = process.env.KS_STATE_FILE || null,
    store = null,
    failOpen = envFlag('KS_FAIL_OPEN'),
    ringMax = envInt('KS_RING_MAX', 200),
    disabled = envFlag('KS_DISABLED'),
    now = Date.now,
  } = {}) {
    this.store = store || (path ? new FileStore(path) : new MemoryStore());
    this.failOpen = failOpen;
    this.ringMax = ringMax;
    this.disabled = disabled;
    this.now = now;
  }

  // Load current state, applying the fail policy when the store can't be read. Never throws.
  #state() {
    let s;
    try { s = this.store.read(); } catch { s = null; }
    if (s && typeof s === 'object' && typeof s.open === 'boolean') {
      if (!Array.isArray(s.events)) s.events = [];
      return s;
    }
    if (s === undefined || s === null && this.store instanceof MemoryStore) {
      // Fresh in-memory store has never been written — that's a clean OPEN state, not a failure.
      return EMPTY();
    }
    // Store reported a failure (null from a file store): apply policy.
    const base = EMPTY();
    base.open = !!this.failOpen; // fail CLOSED by default
    base.reason = this.failOpen ? 'state-unreadable-open' : 'state-unreadable-closed';
    return base;
  }

  #persist(s) { try { this.store.write(s); } catch { /* best-effort */ } }

  /** True when the gate is OPEN (actions allowed). Never throws. */
  isOpen() {
    if (this.disabled) return true;
    try { return this.#state().open === true; } catch { return !!this.failOpen; }
  }

  /** Snapshot of the switch state ({open,reason,by,at}). Never throws. */
  status() {
    const s = this.#state();
    return { open: s.open === true, reason: s.reason ?? null, by: s.by ?? null, at: s.at ?? null,
      disabled: this.disabled };
  }

  /**
   * Trip the switch CLOSED (shutdown). Operator-only path (e.g. an admin-DM handler). Records an
   * audit event. No-op (returns current status) when disabled. Never throws.
   */
  trip(reason = 'unspecified', by = 'unknown') {
    if (this.disabled) return this.status();
    try {
      const s = this.#state();
      s.open = false;
      s.reason = String(reason || 'unspecified');
      s.by = String(by || 'unknown');
      s.at = new Date(this.now()).toISOString();
      this.#append(s, { type: 'trip', severity: 'critical', detail: { reason: s.reason, by: s.by } });
      this.#persist(s);
      return { open: false, reason: s.reason, by: s.by, at: s.at, disabled: false };
    } catch {
      return this.status();
    }
  }

  /** Reset the switch back to OPEN (serving). Records an audit event. Never throws. */
  reset(by = 'unknown') {
    try {
      const s = this.#state();
      s.open = true;
      s.reason = null;
      s.by = String(by || 'unknown');
      s.at = new Date(this.now()).toISOString();
      this.#append(s, { type: 'reset', severity: 'info', detail: { by: s.by } });
      this.#persist(s);
      return { open: true, reason: null, by: s.by, at: s.at, disabled: this.disabled };
    } catch {
      return this.status();
    }
  }

  /**
   * Run `fn` only when the gate is open. When tripped, returns {ok:false,reason:'shutdown'} and logs
   * a 'blocked' audit event — fn is NOT called. Awaits async fns. A thrown fn is caught and surfaced
   * as {ok:false,reason:'error'} (it does NOT trip the switch). Never throws.
   *
   * @param {string} action  label for the audit log (e.g. 'faucet-create').
   * @param {Function} fn     the guarded work; may be sync or async.
   * @returns {Promise<{ok:boolean, reason?:string, value?:*}>}
   */
  async gate(action, fn) {
    const label = String(action || 'action');
    if (!this.isOpen()) {
      const s = this.#state();
      this.#append(s, { type: 'blocked', severity: 'warn', detail: { action: label } });
      this.#persist(s);
      return { ok: false, reason: 'shutdown' };
    }
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (err) {
      // The guarded work failed — surface it, but do NOT trip the switch (operator decides that).
      return { ok: false, reason: 'error', error: String(err?.message ?? err) };
    }
  }

  // Append an event to the bounded ring buffer of `s.events`, evicting oldest. Mutates `s`.
  #append(s, { type = 'event', severity = 'info', detail = null } = {}) {
    if (!Array.isArray(s.events)) s.events = [];
    s.events.push({
      type: String(type),
      severity: String(severity),
      detail: detail ?? null,
      at: new Date(this.now()).toISOString(),
      ts: this.now(),
    });
    const overflow = s.events.length - this.ringMax;
    if (overflow > 0) s.events.splice(0, overflow); // evict oldest
  }

  /**
   * Record a suspicious-activity event into the bounded ring buffer (item 293). Does NOT change the
   * switch state — purely a forensics log. Never throws. Returns the count after insert.
   *
   * @param {{type:string, severity?:string, detail?:*}} ev
   * @param {number} [now]  optional explicit ms timestamp (defaults to the injected clock).
   */
  logEvent({ type = 'event', severity = 'info', detail = null } = {}, now) {
    try {
      const s = this.#state();
      const clock = typeof now === 'number' ? () => now : this.now;
      const saved = this.now;
      this.now = clock;
      this.#append(s, { type, severity, detail });
      this.now = saved;
      this.#persist(s);
      return { count: s.events.length };
    } catch {
      return { count: 0 };
    }
  }

  /** Newest-first slice of the audit ring buffer (default last 20). Never throws. */
  recentEvents(n = 20) {
    try {
      const s = this.#state();
      const evs = Array.isArray(s.events) ? s.events.slice() : [];
      const lim = Number.isFinite(n) && n > 0 ? n : evs.length;
      return evs.slice(-lim).reverse(); // newest first
    } catch {
      return [];
    }
  }
}

// ── worked example / self-check ─────────────────────────────────────────────────
if (process.argv[1] && /kill-switch\.mjs$/.test(process.argv[1])) {
  (async () => {
    let t = 1_000_000;
    const ks = new KillSwitch({ now: () => t });
    console.log('open?', ks.isOpen());
    let r = await ks.gate('faucet-create', () => 'minted account');
    console.log('gate while open:', r);
    t += 1000;
    ks.logEvent({ type: 'rate-spike', severity: 'warn', detail: { ip: '203.0.113.7', n: 99 } });
    t += 1000;
    console.log('trip ->', ks.trip('faucet drained', 'hathor'));
    r = await ks.gate('faucet-create', () => 'minted account');
    console.log('gate while tripped:', r, '(fn NOT run)');
    t += 1000;
    console.log('reset ->', ks.reset('hathor'));
    console.log('recent events (newest first):');
    for (const e of ks.recentEvents(5)) console.log('  ', e.type, e.severity, e.at);
  })();
}
