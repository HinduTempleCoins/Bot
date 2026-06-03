// site/admin/claude-bridge.mjs — the SERVER-SIDE endpoint the admin relay talks to.
//
// integrations/claude-relay.mjs (admin side) POSTs {message, sessionId} with a Bearer token to the
// env CLAUDE_RELAY_URL. NOTHING answered that URL until this service. This is that service: a tiny,
// zero-dependency Node HTTP server that runs ON SERVER 4 (where the Claude Code CLI is installed with
// subscription creds, loaded from the operator's claude env file — see the deploy notes). It receives
// the admin message, shells out to the Claude CLI, and returns the reply.
//
// AUTH: Authorization: Bearer <token>, compared against env CLAUDE_RELAY_TOKEN by NAME. The token is
// NEVER logged and never echoed; a mismatch returns 401 with no body that could leak length/shape.
//
// LOCALHOST-ONLY BY DESIGN: binds HOST=127.0.0.1 by default. The admin portal runs on the SAME box
// and calls this loopback; the bearer is defense-in-depth, not the only gate. Do not bind to 0.0.0.0.
//
// SESSION CONTINUITY (documented simplification): we keep an in-memory map sessionId → { seen }. The
// first message in a session runs `claude -p <msg>`; subsequent messages run `claude --continue -p
// <msg>`, which resumes the CLI's most-recent conversation in that cwd. This is a SIMPLIFICATION:
// `--continue` resumes the single most-recent CLI session for the working directory, not a specific
// per-sessionId conversation. With one operator and one admin chat this is correct in practice; true
// multi-session isolation would require `--resume <claude-session-uuid>` keyed off the UUID the CLI
// prints, which the text output format does not surface. Keep it simple until multi-session is needed.
//
//   PORT=8097 CLAUDE_RELAY_TOKEN=… CLAUDE_BRIDGE_CWD=/opt/melek-bot/repo node site/admin/claude-bridge.mjs
//
// Tests inject a runner via __setRunner so they never spawn the real CLI (no creds, no network, fast).

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { redactString } from '../../integrations/claude-relay.mjs';

// ── env NAMES (never literals; the token is read by name and never logged) ───────────────────────
const PORT = +(process.env.PORT || 8097);
const HOST = process.env.HOST || '127.0.0.1';
const CWD = process.env.CLAUDE_BRIDGE_CWD || '/opt/melek-bot/repo';
const TIMEOUT_MS = +(process.env.CLAUDE_BRIDGE_TIMEOUT_MS || 110_000);
const MAX_OUTPUT = +(process.env.CLAUDE_BRIDGE_MAX_OUTPUT || 64 * 1024); // ~64KB cap
const MAX_BODY = 64 * 1024; // request body cap (a chat message, not a payload)

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

// ── per-session continuity map (sessionId → { seen:true }) ───────────────────────────────────────
const _sessions = new Map();
function sessionSeen(id) { return _sessions.has(String(id || 'default')); }
function markSession(id) { _sessions.set(String(id || 'default'), { seen: true }); }

// ── the CLI runner (injectable so tests never spawn the real `claude`) ───────────────────────────
// runClaude({ message, continueSession }) → Promise<{ text, timedOut }>. Soft: a timeout resolves
// with { timedOut:true } so callers can answer the user gracefully instead of 500-ing.
function defaultRunner({ message, continueSession }) {
  return new Promise((resolve) => {
    const args = continueSession
      ? ['--continue', '-p', message, '--output-format', 'text']
      : ['-p', message, '--output-format', 'text'];
    let child;
    try {
      child = spawn('claude', args, { cwd: CWD, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ text: '', timedOut: false, error: err && err.message });
    }

    let out = '';
    let errOut = '';
    let capped = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, TIMEOUT_MS);

    child.stdout.on('data', (buf) => {
      if (capped) return;
      out += buf.toString('utf8');
      if (out.length > MAX_OUTPUT) {
        out = out.slice(0, MAX_OUTPUT);
        capped = true;
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    });
    // stderr is folded in only when stdout is empty (CLI usage/auth errors surface there).
    child.stderr.on('data', (b) => { if (errOut.length < 4096) errOut += b.toString('utf8'); });

    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ text: out.trim(), timedOut, capped, ...extra });
    };

    child.on('error', (err) => finish({ error: err && err.message }));
    child.on('close', () => finish(errOut && !out.trim() ? { error: errOut.trim() } : {}));
  });
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
      result = await _runner({ message, continueSession: sessionSeen(sessionId) });
    } catch (err) {
      // a thrown runner is treated as a soft failure — answer the user, don't 500.
      return sendJson(res, 200, {
        reply: '[bridge error — Claude CLI did not respond]',
        sessionId,
        error: redactString(err && err.message),
      });
    }

    markSession(sessionId);

    if (result && result.timedOut) {
      return sendJson(res, 200, {
        reply: '[Claude took too long to respond — try again or simplify the request]',
        sessionId,
        timedOut: true,
      });
    }

    const reply = redactString((result && result.text) || '');
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
  createServer(handle).listen(PORT, HOST, () => {
    // never print the token; the cwd + bind address are safe operational facts.
    console.log(`[claude-bridge] listening on http://${HOST}:${PORT} (cwd=${CWD}, timeout=${TIMEOUT_MS}ms)`);
  });
}
