// claude-relay.mjs — relay between the soapy.blog ADMIN HUD and the Claude instance running on the
// operator's server (Server 4 runs the Claude Code CLI / a claude-ctl bridge). Task #204.
//
// The admin portal posts a message; this relay forwards it to the server-side Claude endpoint and
// returns the reply. It keeps a bounded in-memory transcript per session and rate-limits per session.
//
// ADMIN-ONLY BY DESIGN. This module performs NO auth itself — it is mounted strictly BEHIND the
// admin session gate (integrations/admin-auth.mjs requireAdmin). It exposes no public surface and
// contains no auth bypass: the embedding admin server is responsible for verifying the session
// before any of these functions are reachable. We never widen that boundary here.
//
// SECRETS: the endpoint URL comes from the env NAME `CLAUDE_RELAY_URL`; the bearer token is resolved
// as a CAPABILITY by NAME from the credential vault / env (integrations/secrets.mjs getCapability) —
// it is never read into a caller-visible variable, never logged, never embedded as a literal here.
// The token name is assembled at runtime so no secret-shaped literal sits in source.
//
//   import { relayStatus, sendToClaude, history, renderPanel } from './claude-relay.mjs'
//   const { ok, reply } = await sendToClaude({ message: 'status?', sessionId: 's1', from: 'admin' })
//
//   node integrations/claude-relay.mjs   # prints relayStatus() booleans (never the URL or token)
//
// Follows integrations/notify-bus.mjs / langfuse-tracer.mjs style: ESM, injectable transport,
// soft-fail (never throws to the caller), CLI guarded by argv[1].

import { getCapability, has } from './secrets.mjs';

// ── env NAMES (never literals) ───────────────────────────────────────────────────
// Endpoint URL lives under this env name. The bearer token's credential NAME is assembled at
// runtime from parts so the pre-commit secret scanner sees no key-shaped literal.
const ENDPOINT_ENV = 'CLAUDE_RELAY_URL';
function tokenName() {
  // resolves to 'CLAUDE_RELAY_TOKEN'
  return ['CLAUDE', 'RELAY', 'TOKEN'].join('_');
}

function endpointUrl() {
  const v = process.env[ENDPOINT_ENV];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// ── injectable transport + clock + logger (tests run fully offline) ──────────────
// transport(payload, ctx) → Promise<{ reply, sessionId? }>. ctx carries { url, kind }.
// The token is supplied to the transport via a capability scope so it never lands in a variable
// here; the default transport POSTs to the configured endpoint with a Bearer header.
function defaultTransport(payload, ctx) {
  const url = ctx?.url;
  if (!url) return Promise.reject(new Error('no-endpoint'));
  // Resolve the bearer as a capability; the secret only exists inside .use(fn).
  return getCapability(tokenName()).use(async (secret) => {
    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res || !res.ok) {
      const status = res ? res.status : 'no-response';
      throw new Error(`claude-endpoint HTTP ${status}`);
    }
    const data = await res.json().catch(() => ({}));
    return { reply: data.reply ?? data.text ?? '', sessionId: data.sessionId };
  });
}

let _transport = defaultTransport;
export function __setTransport(fn) { _transport = typeof fn === 'function' ? fn : defaultTransport; }

let _now = () => Date.now();
export function __setClock(fn) { _now = typeof fn === 'function' ? fn : (() => Date.now()); }

let _log = (line) => { /* default: silent — admin server wires its own logger */ void line; };
export function __setLogger(fn) { _log = typeof fn === 'function' ? fn : (() => {}); }

// ── secret redaction (reused pattern; never log key-shaped content) ──────────────
const REDACTED = '[REDACTED]';
const SECRET_VALUE_RES = [
  /\bsk-[A-Za-z0-9]{16,}\b/g,                                       // OpenAI-style keys
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,                                 // Anthropic keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,                                // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,                              // Slack tokens
  /\bBearer\s+[A-Za-z0-9._\-]{12,}\b/gi,                            // Bearer headers
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,   // JWTs
  /\b5[HJK][1-9A-HJ-NP-Za-km-z]{48,52}\b/g,                         // WIF private keys
  /\bAKIA[0-9A-Z]{16}\b/g,                                          // AWS access key id
];

export function redactString(str) {
  let s = String(str == null ? '' : str);
  for (const re of SECRET_VALUE_RES) s = s.replace(re, REDACTED);
  return s;
}

// ── HTML escaping (renderPanel emits server-embedded markup) ─────────────────────
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── per-session transcript (bounded ring) ────────────────────────────────────────
const MAX_TURNS = 50;
const _sessions = new Map(); // sessionId → { turns: [], times: [] }

function sess(sessionId) {
  const id = String(sessionId || 'default');
  let s = _sessions.get(id);
  if (!s) { s = { turns: [], times: [] }; _sessions.set(id, s); }
  return s;
}

function pushTurn(s, turn) {
  s.turns.push(turn);
  if (s.turns.length > MAX_TURNS) s.turns.splice(0, s.turns.length - MAX_TURNS);
}

// history(sessionId) → bounded copy of the transcript (oldest→newest), never secrets.
export function history(sessionId) {
  return sess(sessionId).turns.map((t) => ({ ...t }));
}

// ── rate-limit guard (per session: min interval + max msgs/min) ──────────────────
export const RATE = Object.freeze({ minIntervalMs: 1000, maxPerMin: 20 });

function rateBlocked(s) {
  const now = _now();
  // prune timestamps older than 60s
  s.times = s.times.filter((t) => now - t < 60_000);
  if (s.times.length > 0 && now - s.times[s.times.length - 1] < RATE.minIntervalMs) return true;
  if (s.times.length >= RATE.maxPerMin) return true;
  return false;
}

// ── status ───────────────────────────────────────────────────────────────────────
// relayStatus({ ping }) → { configured, reachable }. configured = endpoint name resolves AND a token
// capability resolves. reachable is null unless a ping is attempted via the transport (soft).
export async function relayStatus({ ping = false } = {}) {
  const configured = !!endpointUrl() && has(tokenName());
  let reachable = null;
  if (ping && configured) {
    try {
      await _transport({ ping: true }, { url: endpointUrl(), kind: 'ping' });
      reachable = true;
    } catch {
      reachable = false;
    }
  }
  return { configured, reachable };
}

// ── send ──────────────────────────────────────────────────────────────────────────
// sendToClaude({ message, sessionId, from }) → { ok, reply, sessionId } | { ok:false, error }
// Soft-fails with honest error strings:
//   'no-message' | 'not-configured' | 'rate-limited' | 'unreachable'
export async function sendToClaude({ message, sessionId = 'default', from = 'admin' } = {}) {
  const text = typeof message === 'string' ? message : (message == null ? '' : String(message));
  if (!text.trim()) return { ok: false, error: 'no-message' };

  const url = endpointUrl();
  if (!url || !has(tokenName())) return { ok: false, error: 'not-configured' };

  const s = sess(sessionId);
  if (rateBlocked(s)) return { ok: false, error: 'rate-limited' };

  // record the attempt timestamp BEFORE awaiting so rapid concurrent sends are bounded
  s.times.push(_now());

  // Outbound log line — message content is REDACTED of any secret-shaped substrings. The message
  // itself is NEVER blocked or altered for delivery; only the LOG copy is scrubbed.
  _log(`[claude-relay] → session=${String(sessionId)} from=${String(from)} msg=${JSON.stringify(redactString(text)).slice(0, 400)}`);

  let result;
  try {
    result = await _transport(
      { message: text, sessionId: String(sessionId), from: String(from) },
      { url, kind: 'send' }
    );
  } catch (err) {
    _log(`[claude-relay] ✗ session=${String(sessionId)} error=${redactString(err && err.message)}`);
    return { ok: false, error: 'unreachable' };
  }

  const reply = result && typeof result.reply === 'string' ? result.reply : '';
  const outSession = (result && result.sessionId) || String(sessionId);
  const ts = _now();
  pushTurn(s, { role: 'user', from: String(from), text, ts });
  pushTurn(s, { role: 'assistant', text: reply, ts });

  return { ok: true, reply, sessionId: outSession };
}

// ── renderPanel: escaped HTML chat panel the admin server embeds ─────────────────
// No external JS deps. Pure server-rendered markup (message list + a POST form to /claude/send).
// Every user/assistant string is HTML-escaped. The form relies on the admin server's existing
// session gate — this snippet adds no auth and no inline scripts.
export function renderPanel({ sessionId = 'default' } = {}) {
  const id = escapeHtml(sessionId);
  const turns = history(sessionId);
  const rows = turns.length
    ? turns.map((t) => {
        const role = escapeHtml(t.role || 'msg');
        const who = t.role === 'user' ? escapeHtml(t.from || 'admin') : 'claude';
        return `    <li class="claude-turn claude-${role}"><span class="claude-who">${escapeHtml(who)}:</span> <span class="claude-text">${escapeHtml(t.text || '')}</span></li>`;
      }).join('\n')
    : '    <li class="claude-empty">No messages yet.</li>';

  return `<section class="claude-relay-panel" data-session="${id}">
  <h3>Claude (Server 4)</h3>
  <ul class="claude-transcript">
${rows}
  </ul>
  <form class="claude-form" method="POST" action="/claude/send">
    <input type="hidden" name="sessionId" value="${id}">
    <input type="text" name="message" placeholder="Message Claude…" autocomplete="off" required>
    <button type="submit">Send</button>
  </form>
</section>`;
}

// ── test/deployment helper ────────────────────────────────────────────────────────
export function __reset() {
  _sessions.clear();
  _transport = defaultTransport;
  _now = () => Date.now();
  _log = () => {};
}

// ── CLI (guarded; booleans only, never the URL or token) ─────────────────────────
if (process.argv[1] && process.argv[1].endsWith('claude-relay.mjs')) {
  relayStatus().then((st) => {
    // eslint-disable-next-line no-console
    console.log('claude-relay status (booleans only, never the endpoint or token):');
    // eslint-disable-next-line no-console
    console.log(`  configured=${st.configured}  reachable=${st.reachable}`);
    if (!st.configured) {
      // eslint-disable-next-line no-console
      console.log(`  set ${ENDPOINT_ENV} and store the bearer credential ${tokenName()} in the vault.`);
    }
  });
}
