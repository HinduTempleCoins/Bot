// captcha-handoff.mjs — the CAPTCHA-handoff PRODUCER (task #111).
//
// When an automated signup / provisioning flow (the browser-provisioning skill) hits a
// CAPTCHA, an SMS one-time-code prompt, or any other "a human must do this" gate, it does
// NOT try to defeat the gate. Instead it ENQUEUES a handoff request and notifies the
// operator (via the injected notifier → Telegram). A HUMAN reads the prompt, solves the
// CAPTCHA / reads the SMS code / approves the step, and taps the answer back in. The flow
// then resumes on that human-supplied answer.
//
//   HARD RULE: this module NEVER attempts to solve or bypass a CAPTCHA itself. There is no
//   solver code path here — by construction. It only PRODUCES a request for a human and
//   awaits the human's answer. (Memory: "Human taps CAPTCHA/SMS via Telegram (never
//   auto-defeat).")
//
// Pieces:
//   requestHandoff({ kind, context, screenshotRef, promptText, expiresInMs })
//        — enqueue a pending handoff, notify the operator, return { id, status:'pending' }.
//   listPending({ now })            — open handoffs not yet expired.
//   resolveHandoff(id, { answer, by })
//        — the operator's tap supplies the answer; mark resolved; return it to the flow.
//   awaitResolution(id, { pollFn, timeoutMs })
//        — the producer side waits (via injected poll) for the human's answer; times out
//          gracefully.
//   expireStale({ now })            — sweep expired handoffs.
//   redactForLog(handoff)           — log-safe view; the actual solution / SMS code is hidden.
//
// Injectable for OFFLINE tests: __setNotifier(fn), __setClock(fn), __setStore(store).
// Follows integrations/soapbox/macro.mjs + notify-bus.mjs: ESM .mjs, injectable hooks,
// soft-fail (never throws across the public surface), CLI guarded by argv[1], no secrets.

import crypto from 'node:crypto';

// ── injectable clock ─────────────────────────────────────────────────────────────────────────────
let _clock = () => Date.now();
export function __setClock(fn) { _clock = typeof fn === 'function' ? fn : (() => Date.now()); }

// ── injectable notifier (→ Telegram / notify-bus). Soft-fail; never throws. ────────────────────────
// A notifier is async fn(payload) where payload = { id, kind, promptText, context, screenshotRef,
// expiresAt }. Default is a no-op that reports "no-notifier" so tests stay offline and prod stays safe
// until a real Telegram sink is wired in.
let _notifier = async () => ({ ok: false, skipped: 'no-notifier' });
export function __setNotifier(fn) { _notifier = typeof fn === 'function' ? fn : (async () => ({ ok: false, skipped: 'no-notifier' })); }

// ── injectable store (in-memory default) ──────────────────────────────────────────────────────────
// A store is a Map-like: get(id), set(id, value), delete(id), values(). The default is a plain Map so
// the module works with zero setup and tests run with a fresh store via __setStore(new Map()).
function makeMemStore() { return new Map(); }
let _store = makeMemStore();
export function __setStore(store) { _store = store || makeMemStore(); }

// ── file-backed store: lets the browser-provisioning PROCESS and the soapy.blog admin PORTAL
// (separate processes) share the same handoff queue. Map-like over a JSON file; soft-fail (a bad
// read = empty, a bad write = dropped, never throws). Contains NO secrets — a pending handoff has
// answer:null until a human resolves it, and the resolved answer is the human's own CAPTCHA text.
export function makeFileStore(path) {
  const readAll = () => {
    try { return new Map(Object.entries(JSON.parse(fs.readFileSync(path, 'utf8') || '{}'))); }
    catch { return new Map(); }
  };
  const writeAll = (map) => {
    try {
      const dir = path.replace(/\/[^/]*$/, '');
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path, JSON.stringify(Object.fromEntries(map), null, 2));
    } catch { /* soft-fail: a dropped write just means the handoff isn't shared this tick */ }
  };
  return {
    get(id) { return readAll().get(id) || undefined; },
    set(id, v) { const m = readAll(); m.set(id, v); writeAll(m); return this; },
    delete(id) { const m = readAll(); const r = m.delete(id); writeAll(m); return r; },
    values() { return readAll().values(); },
  };
}

// Default to a file store when CAPTCHA_HANDOFF_FILE is set (prod), else in-memory (tests/dev).
if (process.env.CAPTCHA_HANDOFF_FILE) {
  try { _store = makeFileStore(process.env.CAPTCHA_HANDOFF_FILE); } catch { /* keep mem store */ }
}

// ── statuses ───────────────────────────────────────────────────────────────────────────────────────
export const PENDING = 'pending';
export const RESOLVED = 'resolved';
export const EXPIRED = 'expired';
export const KINDS = ['captcha', 'sms', 'human'];

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes — a human-attention window

function normalizeKind(kind) {
  const k = String(kind || 'human').toLowerCase();
  return KINDS.includes(k) ? k : 'human';
}

function isExpiredAt(h, now) {
  return typeof h.expiresAt === 'number' && now >= h.expiresAt;
}

// ── requestHandoff: PRODUCE a request for a human. NEVER solves it. ─────────────────────────────────
// Returns { id, status:'pending', expiresAt, notified } on success, or { ok:false, error } if the
// inputs are unusable. Notifying the operator is best-effort: a failed notify does NOT fail the enqueue
// (the handoff is still pollable / resolvable), it is reported via `notified`.
export async function requestHandoff({ kind, context, screenshotRef, promptText, expiresInMs } = {}) {
  try {
    const now = _clock();
    const ttl = Number.isFinite(expiresInMs) && expiresInMs > 0 ? expiresInMs : DEFAULT_TTL_MS;
    const id = crypto.randomUUID();
    const handoff = {
      id,
      kind: normalizeKind(kind),
      context: context ?? null,
      screenshotRef: screenshotRef ?? null,
      promptText: promptText || defaultPrompt(normalizeKind(kind)),
      status: PENDING,
      createdAt: now,
      expiresAt: now + ttl,
      answer: null,     // filled ONLY by a human via resolveHandoff
      resolvedAt: null,
      resolvedBy: null,
    };
    _store.set(id, handoff);

    // Notify the operator. The notify payload deliberately carries the PROMPT for the human to act on
    // — it never carries any solution (there is none yet) and never asks the bot to solve anything.
    let notified = { ok: false };
    try {
      notified = (await _notifier({
        id,
        kind: handoff.kind,
        promptText: handoff.promptText,
        context: handoff.context,
        screenshotRef: handoff.screenshotRef,
        expiresAt: handoff.expiresAt,
      })) || { ok: false };
    } catch (e) {
      notified = { ok: false, error: e?.message || 'notify-failed' }; // soft-fail
    }

    return { id, status: PENDING, expiresAt: handoff.expiresAt, notified };
  } catch (e) {
    return { ok: false, error: e?.message || 'request-failed' };
  }
}

function defaultPrompt(kind) {
  if (kind === 'captcha') return 'A signup flow hit a CAPTCHA. Please solve it and send back the answer.';
  if (kind === 'sms') return 'A signup flow needs an SMS verification code. Please read it and send it back.';
  return 'A signup flow needs a human step completed. Please review and approve / answer.';
}

// ── getHandoff: read a single handoff by id (full object, incl. answer for the resuming flow) ────────
// The producer's resuming flow reads this to get the human's answer; pass through redactForLog before
// logging. Returns null if unknown.
export function getHandoff(id) {
  return _store.get(id) || null;
}

// ── listPending: open handoffs not yet expired ──────────────────────────────────────────────────────
export function listPending({ now } = {}) {
  const t = typeof now === 'number' ? now : _clock();
  const out = [];
  for (const h of _store.values()) {
    if (h.status === PENDING && !isExpiredAt(h, t)) out.push(h);
  }
  // stable order: oldest first
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

// ── resolveHandoff: the HUMAN supplies the answer (CAPTCHA solution / SMS code / approval) ───────────
// `answer` is the human's solution; `by` is who tapped it (operator id / handle). Expired or unknown
// handoffs return { ok:false }. The answer is returned so the waiting flow can resume.
export function resolveHandoff(id, { answer, by } = {}) {
  const h = _store.get(id);
  if (!h) return { ok: false, error: 'unknown' };
  const now = _clock();
  if (h.status === RESOLVED) return { ok: true, id, status: RESOLVED, answer: h.answer, by: h.resolvedBy };
  if (h.status === EXPIRED || isExpiredAt(h, now)) {
    h.status = EXPIRED;
    return { ok: false, error: 'expired' };
  }
  h.status = RESOLVED;
  h.answer = answer ?? null;          // supplied by a human — the bot never fills this in
  h.resolvedAt = now;
  h.resolvedBy = by ?? null;
  return { ok: true, id, status: RESOLVED, answer: h.answer, by: h.resolvedBy };
}

// ── awaitResolution: the PRODUCER side waits for the human's answer ──────────────────────────────────
// pollFn(id) returns the current handoff (or its status) — defaults to reading the in-memory store. We
// poll until the handoff is RESOLVED (→ { ok:true, answer }), EXPIRED (→ { ok:false, error:'expired' }),
// or the overall timeoutMs elapses (→ { ok:false, error:'timeout' }). intervalMs controls poll spacing;
// in tests pass a pollFn that flips state so this resolves immediately without real timers.
export async function awaitResolution(id, { pollFn, timeoutMs = 5 * 60 * 1000, intervalMs = 1000 } = {}) {
  const poll = typeof pollFn === 'function' ? pollFn : ((hid) => _store.get(hid));
  const start = _clock();
  // Loop with a guard so an injected synchronous pollFn can't spin forever; the deadline is checked
  // against the (injectable) clock so tests stay offline and instant.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let cur;
    try { cur = await poll(id); } catch (e) { return { ok: false, error: e?.message || 'poll-failed' }; }
    // A pollFn that returns nullish (or a non-status value) means "no fresh view" — fall through to the
    // store as the source of truth. This keeps awaitResolution correct whether the caller injects a full
    // handoff, just a status string, or nothing at all.
    if (cur == null) cur = _store.get(id);
    const status = cur && typeof cur === 'object' ? cur.status : cur;
    if (status === RESOLVED) {
      const answer = cur && typeof cur === 'object' ? cur.answer : (_store.get(id)?.answer ?? null);
      return { ok: true, id, status: RESOLVED, answer: answer ?? null };
    }
    if (status === EXPIRED) return { ok: false, error: 'expired' };
    // also treat a clock-expired pending as expired without waiting for a sweep
    if (cur && typeof cur === 'object' && cur.status === PENDING && isExpiredAt(cur, _clock())) {
      return { ok: false, error: 'expired' };
    }
    if (_clock() - start >= timeoutMs) return { ok: false, error: 'timeout' };
    // wait one interval before polling again; skip the timer entirely when intervalMs<=0 (tests)
    if (intervalMs > 0) await sleep(intervalMs);
    else await Promise.resolve();
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── expireStale: sweep handoffs past their deadline ─────────────────────────────────────────────────
// Marks still-PENDING handoffs whose deadline has passed as EXPIRED. Returns the list of ids swept.
export function expireStale({ now } = {}) {
  const t = typeof now === 'number' ? now : _clock();
  const swept = [];
  for (const h of _store.values()) {
    if (h.status === PENDING && isExpiredAt(h, t)) {
      h.status = EXPIRED;
      swept.push(h.id);
    }
  }
  return swept;
}

// ── redactForLog: never log the actual SMS code / CAPTCHA solution in plaintext ──────────────────────
// Returns a shallow copy safe for logs: the `answer` (the human's solution) is replaced with a presence
// marker, never the value. promptText/context are descriptive (no solution), so they pass through.
export function redactForLog(handoff) {
  if (!handoff || typeof handoff !== 'object') return handoff;
  const { answer, ...rest } = handoff;
  return {
    ...rest,
    answer: answer == null || answer === '' ? null : '[redacted]',
  };
}

// ── CLI demo (guarded) — request a handoff and show the operator prompt; no solving, no network ──────
if (process.argv[1] && process.argv[1].endsWith('captcha-handoff.mjs')) {
  __setNotifier(async (p) => { console.log('[notify operator]', JSON.stringify(p)); return { ok: true }; });
  const kind = process.argv[2] || 'captcha';
  const res = await requestHandoff({
    kind,
    context: { service: 'example-signup', step: 'verify' },
    promptText: process.argv[3],
    expiresInMs: 10 * 60 * 1000,
  });
  console.log('enqueued:', JSON.stringify(res));
  console.log('pending:', listPending().map(redactForLog));
  console.log('NOTE: a HUMAN solves this via Telegram — this tool never auto-defeats a CAPTCHA.');
}
