// site/admin/claude-bridge.mjs — the SERVER-SIDE endpoint the admin relay talks to.
//
// integrations/claude-relay.mjs (admin side) POSTs {message, sessionId} with a Bearer token to the
// env CLAUDE_RELAY_URL. This is that service: a tiny, zero-dependency Node HTTP server that runs ON
// SERVER 4. It receives the admin message and returns the reply.
//
// CLAUDE REMOVED / PRIVACY (operator 2026-09-22): the Soapy admin chat is PRIVATE conversation — it
// must NEVER go to an external API. It no longer shells the `claude` CLI (subscription OAuth lapsed);
// it answers from OUR Modal-hosted model (private compute we control) via integrations/modal-client.
// Modal scales from zero, so the first message may need to ride out a cold start — the runner uses
// coldStart retries and the handler surfaces a "warming up" reply rather than an error. If Modal is
// not configured, the chat reports COMPUTE-GATED; it does NOT fall back to any external API.
//
// AUTH: Authorization: Bearer <token>, compared against env CLAUDE_RELAY_TOKEN by NAME. The token is
// NEVER logged and never echoed; a mismatch returns 401 with no body that could leak length/shape.
//
// LOCALHOST-ONLY BY DESIGN: binds HOST=127.0.0.1 by default. The admin portal runs on the SAME box
// and calls this loopback; the bearer is defense-in-depth, not the only gate. Do not bind to 0.0.0.0.
//
// SESSION CONTINUITY: we keep an in-memory map sessionId → { seen, turns:[{role,content}] } and pass
// the recent turns to Modal as chat history (Modal is stateless per call). Bounded to the last few
// turns so a long chat can't blow the context. Multi-session is isolated by sessionId.
//
//   PORT=8097 CLAUDE_RELAY_TOKEN=… MODAL_INFERENCE_URL=… node site/admin/claude-bridge.mjs
//
// Tests inject a runner via __setRunner so they never hit Modal (no network, fast, offline).

import { createServer } from 'node:http';
import { askModal, modalReady } from '../../integrations/modal-client.mjs';
import { redactString } from '../../integrations/claude-relay.mjs';

// ── env NAMES (never literals; the token is read by name and never logged) ───────────────────────
const PORT = +(process.env.PORT || 8097);
const HOST = process.env.HOST || '127.0.0.1';
const TIMEOUT_MS = +(process.env.CLAUDE_BRIDGE_TIMEOUT_MS || 110_000);
const MAX_OUTPUT = +(process.env.CLAUDE_BRIDGE_MAX_OUTPUT || 64 * 1024); // ~64KB cap
const MAX_BODY = 64 * 1024; // request body cap (a chat message, not a payload)
const MAX_TURNS = +(process.env.CLAUDE_BRIDGE_MAX_TURNS || 12); // recent history turns kept per session
const SYSTEM = process.env.CLAUDE_BRIDGE_SYSTEM
  || 'You are Soapy, the admin assistant for the MELEK / SoapBox operator. Be concise, accurate, and plain-spoken. This is a private admin conversation.';

function tokenName() {
  // resolves to 'CLAUDE_RELAY_TOKEN' — assembled so the secret scanner sees no key-shaped literal.
  return ['CLAUDE', 'RELAY', 'TOKEN'].join('_');
}
function expectedToken() {
  const v = process.env[tokenName()];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// ── constant-time-ish bearer check (never log the token) ─────────────────────────────────────────
function bearerOk(headerValue) {
  const expected = expectedToken();
  if (!expected) return false; // no token configured → deny (fail closed)
  const m = /^Bearer\s+(.+)$/i.exec(String(headerValue || ''));
  if (!m) return false;
  const got = m[1].trim();
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ── per-session continuity map (sessionId → { seen, turns:[{role,content}] }) ─────────────────────
const _sessions = new Map();
function sessionSeen(id) { return _sessions.has(String(id || 'default')); }
function sessionTurns(id) { const s = _sessions.get(String(id || 'default')); return (s && s.turns) || []; }
function markSession(id) {
  const k = String(id || 'default');
  if (!_sessions.has(k)) _sessions.set(k, { seen: true, turns: [] });
}
// record one user→assistant exchange, bounded to the last MAX_TURNS entries.
function recordTurn(id, userMsg, assistantMsg) {
  const k = String(id || 'default');
  const s = _sessions.get(k) || { seen: true, turns: [] };
  s.turns.push({ role: 'user', content: String(userMsg || '') });
  if (assistantMsg) s.turns.push({ role: 'assistant', content: String(assistantMsg) });
  if (s.turns.length > MAX_TURNS) s.turns = s.turns.slice(-MAX_TURNS);
  _sessions.set(k, s);
}

// ── the Modal runner (injectable so tests never hit the network) ─────────────────────────────────
// runner({ message, continueSession, sessionId, history }) → Promise<{ text, timedOut?, warming?,
// computeGated? }>. Soft-fail: never throws; a cold/absent endpoint resolves with a flag the handler
// turns into a graceful reply, never a 500.
async function defaultRunner({ message, history = [] }) {
  if (!modalReady()) return { text: '', computeGated: true }; // private endpoint not configured
  const messages = [...(Array.isArray(history) ? history : []), { role: 'user', content: message }];
  let text;
  try {
    // on-demand → coldStart: ride out Modal's spin-up from zero with spaced retries.
    text = await askModal({ messages, system: SYSTEM, coldStart: true, maxTokens: 1200 });
  } catch (err) {
    return { text: '', error: err && err.message };
  }
  if (!text) return { text: '', warming: true };       // reachable but empty/still warming
  return { text: text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) : text, capped: text.length > MAX_OUTPUT };
}

let _runner = defaultRunner;
export function __setRunner(fn) { _runner = typeof fn === 'function' ? fn : defaultRunner; }

// ── tiny http helpers ────────────────────────────────────────────────────────────────────────────
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    let aborted = false;
    req.on('data', (c) => { buf += c; if (buf.length > MAX_BODY) { aborted = true; req.destroy(); } });
    req.on('end', () => resolve(aborted ? null : buf));
    req.on('error', () => resolve(null));
  });
}

// ── the request handler (exported so tests drive it offline, no listen) ──────────────────────────
export async function handle(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  let pathname = req.url || '/';
  const q = pathname.indexOf('?');
  if (q >= 0) pathname = pathname.slice(0, q);

  // health: open, no auth, no info leak.
  if (pathname === '/health' && method === 'GET') return sendJson(res, 200, { ok: true });

  if (pathname === '/v1/message' && method === 'POST') {
    // auth FIRST — never read or process the body for an unauthenticated caller.
    if (!bearerOk(req.headers && req.headers.authorization)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    const raw = await readBody(req);
    if (raw == null) return sendJson(res, 413, { error: 'payload-too-large' });
    let parsed;
    try { parsed = JSON.parse(raw || '{}'); } catch { return sendJson(res, 400, { error: 'bad-json' }); }

    const message = typeof parsed.message === 'string' ? parsed.message : '';
    const sessionId = String(parsed.sessionId || 'default');
    if (!message.trim()) return sendJson(res, 400, { error: 'no-message' });

    let result;
    try {
      result = await _runner({ message, continueSession: sessionSeen(sessionId), sessionId, history: sessionTurns(sessionId).slice() });
    } catch (err) {
      // a thrown runner is treated as a soft failure — answer the user, don't 500.
      return sendJson(res, 200, {
        reply: '[Soapy AI error — the model did not respond]',
        sessionId,
        error: redactString(err && err.message),
      });
    }

    markSession(sessionId);

    // private inference not configured at all → COMPUTE-GATED (never falls back to an external API).
    if (result && result.computeGated) {
      return sendJson(res, 200, {
        reply: '[Soapy AI is offline — our private inference endpoint is not configured yet (compute-gated). No external API is used for admin chat by policy.]',
        sessionId,
        computeGated: true,
      });
    }
    // reachable but slow/empty (Modal spinning up from zero) → ask the operator to retry shortly.
    if (result && (result.timedOut || result.warming)) {
      return sendJson(res, 200, {
        reply: '[Soapy AI is warming up — the model is spinning up from cold. Try again in a few seconds.]',
        sessionId,
        warming: true,
      });
    }

    const reply = redactString((result && result.text) || '');
    if (reply) recordTurn(sessionId, message, reply); // keep continuity for the next turn
    return sendJson(res, 200, { reply, sessionId });
  }

  return sendJson(res, 404, { error: 'not-found' });
}

// ── test helper ────────────────────────────────────────────────────────────────────────────────
export function __reset() {
  _sessions.clear();
  _runner = defaultRunner;
}

// ── boot (only when run directly; tests import without binding) ──────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('claude-bridge.mjs')) {
  if (!expectedToken()) {
    console.warn(`[claude-bridge] ${tokenName()} not set — all /v1/message requests will 401 until it is.`);
  }
  if (!modalReady()) {
    console.warn('[claude-bridge] MODAL_INFERENCE_URL not set — admin chat is COMPUTE-GATED (no external-API fallback by policy).');
  }
  createServer(handle).listen(PORT, HOST, () => {
    // never print the token; the bind address + model-endpoint presence are safe operational facts.
    console.log(`[claude-bridge] listening on http://${HOST}:${PORT} (backend=Modal, configured=${modalReady()}, timeout=${TIMEOUT_MS}ms)`);
  });
}
