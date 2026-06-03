// notify-bus.mjs — cross-app notification bus (queue #135). PURE routing + injectable sender over a
// self-hosted ntfy/Gotify endpoint. The Android NotificationListener service captures device
// notifications and feeds them in as EVENTS; this bus routes each event to a topic/priority by rule,
// collapses repeats in a window, and pushes to the self-hosted server. No third party, no tokens logged.
//
// Pieces:
//   route(event, rules)  — PURE. Decide which topic/priority/tags an event maps to.
//   dedupe(events, opts) — PURE. Collapse repeats (same key) within a time window.
//   notify(payload,{send}) — push to ntfy/Gotify from env; injectable sender; soft-fails (never throws).
//
// Follows integrations/soapbox/macro.mjs: ESM, __setFetch hook, soft-fail, CLI guarded by argv[1].

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ntfy priority is 1..5 (5 = max/urgent). We accept named or numeric and normalize to that band.
export const PRIORITY = { min: 1, low: 2, default: 3, high: 4, max: 5, urgent: 5 };
export function normalizePriority(p) {
  if (p == null) return PRIORITY.default;
  if (typeof p === 'number') return Math.max(1, Math.min(5, Math.round(p)));
  const n = PRIORITY[String(p).toLowerCase()];
  return n || PRIORITY.default;
}

// ── route: PURE event → {topic, priority, tags} ─────────────────────────────────────────────────
// rules: ordered array of { match, topic, priority, tags }. `match` is either a function(event)->bool
// or an object of field→matcher, where a matcher is a string (substring, case-insensitive), a RegExp,
// an array (any-of), or a function(value, event)->bool. First matching rule wins. A rule with no
// `match` (or match:true) is a catch-all default. Returns null if nothing matches and no default.
function fieldMatches(matcher, value, event) {
  if (matcher == null) return value == null;
  if (typeof matcher === 'function') return !!matcher(value, event);
  if (matcher instanceof RegExp) return value != null && matcher.test(String(value));
  if (Array.isArray(matcher)) return matcher.some((m) => fieldMatches(m, value, event));
  if (typeof matcher === 'string') {
    return value != null && String(value).toLowerCase().includes(matcher.toLowerCase());
  }
  return matcher === value;
}

function ruleMatches(rule, event) {
  const m = rule.match;
  if (m == null || m === true) return true; // catch-all
  if (typeof m === 'function') return !!m(event);
  if (typeof m === 'object') {
    return Object.entries(m).every(([field, matcher]) => fieldMatches(matcher, event?.[field], event));
  }
  return false;
}

export function route(event, rules = []) {
  for (const rule of rules) {
    if (ruleMatches(rule, event)) {
      const tags = typeof rule.tags === 'function' ? rule.tags(event) : rule.tags;
      return {
        topic: typeof rule.topic === 'function' ? rule.topic(event) : rule.topic,
        priority: normalizePriority(typeof rule.priority === 'function' ? rule.priority(event) : rule.priority),
        tags: tags || [],
      };
    }
  }
  return null;
}

// ── dedupe: PURE. Collapse repeated events within a sliding window ───────────────────────────────
// key(event) identifies "the same notification" (default: app+title+message). windowMs is the collapse
// window. Keeps the FIRST occurrence in a run of repeats, annotates it with `count` and `lastTs`, and
// drops the rest. Events are processed in order; if no timestamp, index order is used as the clock.
export function dedupe(events = [], { windowMs = 60_000, key, now } = {}) {
  const keyOf = key || ((e) => `${e?.app ?? ''}|${e?.title ?? ''}|${e?.message ?? ''}`);
  const tsOf = (e, i) => (typeof e?.ts === 'number' ? e.ts : (typeof now === 'function' ? now(e, i) : i));
  const lastSeen = new Map(); // key → { ts, out (kept event reference) }
  const out = [];
  events.forEach((e, i) => {
    const k = keyOf(e);
    const ts = tsOf(e, i);
    const prev = lastSeen.get(k);
    if (prev && ts - prev.ts <= windowMs) {
      prev.out.count = (prev.out.count || 1) + 1;
      prev.out.lastTs = ts;
      prev.ts = ts; // sliding window — chain of repeats keeps collapsing
      return;
    }
    const kept = { ...e, count: 1, lastTs: ts };
    out.push(kept);
    lastSeen.set(k, { ts, out: kept });
  });
  return out;
}

// ── notify: push to the self-hosted ntfy/Gotify server. Injectable sender, soft-fail ─────────────
// Env (server-side only, never logged):
//   NOTIFY_BUS_URL    — base URL of the ntfy/Gotify server (e.g. https://ntfy.example.org)
//   NOTIFY_BUS_TOKEN  — optional bearer/access token for the server
//   NOTIFY_BUS_KIND   — 'ntfy' (default) | 'gotify'
// The default sender POSTs to ntfy (POST {base}/{topic}, body=message, X-Title/X-Priority/X-Tags
// headers) or Gotify (POST {base}/message?token=...). Pass {send} to inject your own transport for
// tests. Returns { ok, skipped?, status?, error? } and NEVER throws or logs the token.
function tagsHeader(tags) { return Array.isArray(tags) ? tags.join(',') : (tags || ''); }

async function defaultSend({ topic, title, message, priority, tags }, env) {
  const base = env.NOTIFY_BUS_URL;
  if (!base) return { ok: false, skipped: 'no-endpoint' };
  const kind = (env.NOTIFY_BUS_KIND || 'ntfy').toLowerCase();
  const token = env.NOTIFY_BUS_TOKEN; // used as a credential only — never logged
  try {
    if (kind === 'gotify') {
      const url = `${base.replace(/\/$/, '')}/message`;
      const headers = { 'content-type': 'application/json' };
      if (token) headers['X-Gotify-Key'] = token;
      const r = await _fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({ title: title || '', message: message || '', priority, extras: { tags } }),
      });
      return { ok: r.ok, status: r.status };
    }
    // ntfy
    const url = `${base.replace(/\/$/, '')}/${encodeURIComponent(topic || 'default')}`;
    const headers = { 'Title': title || '', 'Priority': String(priority), 'Tags': tagsHeader(tags) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await _fetch(url, { method: 'POST', headers, body: message || '' });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    // soft-fail: surface a sanitized message, never the token/headers
    return { ok: false, error: e?.message || 'send-failed' };
  }
}

export async function notify(payload = {}, { send, env = process.env } = {}) {
  const p = {
    topic: payload.topic,
    title: payload.title || '',
    message: payload.message || '',
    priority: normalizePriority(payload.priority),
    tags: payload.tags || [],
  };
  const sender = send || ((pp) => defaultSend(pp, env));
  try {
    const res = await sender(p, env);
    return res || { ok: false, error: 'no-result' };
  } catch (e) {
    return { ok: false, error: e?.message || 'send-failed' }; // soft-fail — never throw
  }
}

if (process.argv[1] && process.argv[1].endsWith('notify-bus.mjs')) {
  const res = await notify({
    topic: process.env.NOTIFY_BUS_TOPIC || 'melek',
    title: 'notify-bus test',
    message: process.argv[2] || 'hello from the notification bus',
    priority: 'default',
    tags: ['robot'],
  });
  console.log(res.ok ? 'sent' : `not sent (${res.skipped || res.error})`);
}
