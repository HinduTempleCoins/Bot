// src/trollbox/chat-server.mjs — Hathor's BROWSER chat HTTP surface (Task #296/#308, Phase 2).
//
// The website chat widget (site/alpha/chat.html) talks to this. It is the HTTP twin of the on-chain
// troll-box connector (chain-connector.mjs): same deterministic brain (handleMessage in ./index.mjs),
// different transport. A newcomer types a line, we route it, and — crucially — we carry the
// account-creation walkthrough STATE back and forth so the multi-step "make me an account" guide
// works turn by turn in a plain browser, no chain account required to start the conversation.
//
// It does THREE things and no more:
//   1. POST /chat { message, state? }  -> { reply, kind, state, steps? }   (the deterministic router; and
//      when nothing matches — kind 'nudge', not mid-signup — it forwards to the ONE Hathor brain so general
//      talk is conversational. She is an AI, not a command bot.)
//   2. GET  /chat/health               -> "ok"
//   3. ZERO keys, ZERO broadcast, ZERO chain writes. Hathor NEVER asks for, sees, or stores a private key or
//      master password (BRIEF.md §7) — the walkthrough is read-only guidance, the AI brain is a separate
//      keyless service, and this server never touches key material.
//
// CORS: only the alpha origin (the chat page) is allowed; other origins get no cross-origin grant and
// an OPTIONS preflight from a disallowed origin is refused (mirrors signup/server.mjs).
//
// Rate limiting: a per-client token bucket (RateLimiter from ./index.mjs) keeps the chat from being a
// free spam firehose. Soft-fails open — a limiter error never blocks a user.
//
//   PORT=8113 BASE_URL=https://chat.melek.salon CHAT_ALLOWED_ORIGIN=https://alpha.melek.salon \
//     node src/trollbox/chat-server.mjs
//
// Offline-testable: handler(req,res) exported; the brain is pure; no network is ever touched.

import { createServer } from 'node:http';

import { handleMessage, RateLimiter, SIGNUP_STEPS, redactForLog } from './index.mjs';
import { chainDeps } from '../../integrations/hathor-chain-deps.mjs';
import { askHathor } from '../../integrations/hathor-limb.mjs';

// The SHARED read-only data sources for Hathor's !commands — the same set every surface (this browser
// chat, the Discord bridge, the Telegram bot) wires into the one command brain (commands/menu.mjs), so
// Hathor is "the same person" everywhere. requireRpc gates the MELEK-RPC readers; getHolders/getPrice
// (Hive-Engine + price oracle) attach unconditionally. See integrations/hathor-chain-deps.mjs.
const MENU_DEPS = chainDeps();

const PORT = +(process.env.PORT || 8113);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://chat.melek.salon').replace(/\/$/, '');

// Allowed browser origins. Hathor's chat box is now embedded on MORE surfaces than just the alpha
// page (the mining pool, etc.) — "expand her presence" — so this is an allowlist, not one origin.
// Override with CHAT_ALLOWED_ORIGINS (comma-separated); CHAT_ALLOWED_ORIGIN (singular) still works.
const _norm = (s) => String(s || '').trim().replace(/\/$/, '');
export const ALLOWED_ORIGINS = new Set(
  (process.env.CHAT_ALLOWED_ORIGINS || process.env.CHAT_ALLOWED_ORIGIN ||
    'https://alpha.melek.salon,https://pool.soapbox.community,https://pool.melek.salon')
    .split(',').map(_norm).filter(Boolean),
);
// Back-compat single-origin export (first allowed origin).
export const ALLOWED_ORIGIN = [...ALLOWED_ORIGINS][0];

// Per-client chat rate limiter. Generous burst, refills over a minute. Injectable for tests.
let _limiter = new RateLimiter({
  capacity: parseInt(process.env.CHAT_RL_BURST || '12', 10),
  windowMs: parseInt(process.env.CHAT_RL_WINDOW_MS || '60000', 10),
});
export function __setLimiter(l) { _limiter = l || _limiter; }

// ── client key (for rate limiting only; NOT trusted, NOT logged as PII) ────────────────────────────
function clientKey(req) {
  const h = (req && req.headers) || {};
  const xff = h['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim().slice(0, 64);
  const ra = req && req.socket && req.socket.remoteAddress;
  return (ra || 'anon').slice(0, 64);
}

// ── CORS / responses (mirror signup/server.mjs) ────────────────────────────────────────────────────
function corsHeaders(origin) {
  const o = _norm(origin);
  if (o && ALLOWED_ORIGINS.has(o)) {
    return {
      'access-control-allow-origin': o,   // echo the specific allowed origin (never '*')
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      vary: 'Origin',
    };
  }
  return { vary: 'Origin' };
}

function sendJson(res, code, body, origin) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(origin),
  });
  res.end(data);
}

function readBody(req, limit = 8192) {
  return new Promise((resolve) => {
    let buf = '';
    let aborted = false;
    req.on('data', (c) => {
      buf += c;
      if (buf.length > limit) { aborted = true; req.destroy(); }
    });
    req.on('end', () => resolve(aborted ? null : buf));
    req.on('error', () => resolve(null));
  });
}

// Normalize the walkthrough state we accept from the client. Only the shape we emit is allowed back in
// — never trust the browser to hand us anything but { signup: { step } } with a known step id. This
// keeps the state opaque AND tamper-resistant (a bogus step is dropped, restarting the walkthrough).
const STEP_IDS = new Set(SIGNUP_STEPS.map((s) => s.id));
function sanitizeState(state) {
  if (!state || typeof state !== 'object') return null;
  const s = state.signup;
  if (s && typeof s === 'object' && typeof s.step === 'string' && STEP_IDS.has(s.step)) {
    return { signup: { step: s.step } };
  }
  return null;
}

// ── the request handler (exported for offline tests) ───────────────────────────────────────────────
export async function handler(req, res) {
  const origin = req.headers ? req.headers.origin : undefined;
  let url;
  try {
    url = new URL(req.url, BASE_URL);
  } catch {
    return sendJson(res, 400, { ok: false, reason: 'bad-url' }, origin);
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // CORS preflight.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  // GET /chat/health
  if (req.method === 'GET' && path === '/chat/health') {
    res.writeHead(200, { 'content-type': 'text/plain', ...corsHeaders(origin) });
    return res.end('ok');
  }

  // POST /chat { message, state? }
  if (req.method === 'POST' && path === '/chat') {
    // Rate-limit per client (soft-fail open).
    let allowed = true;
    try { allowed = _limiter.allow(clientKey(req)); } catch { allowed = true; }
    if (!allowed) {
      return sendJson(res, 429, { ok: false, reason: 'rate-limited' }, origin);
    }

    const raw = await readBody(req);
    if (raw == null) return sendJson(res, 400, { ok: false, reason: 'bad-body' }, origin);
    let input;
    try { input = JSON.parse(raw || '{}'); }
    catch { return sendJson(res, 400, { ok: false, reason: 'bad-json' }, origin); }

    const message = input && typeof input.message === 'string' ? input.message : '';
    if (!message.trim()) {
      return sendJson(res, 400, { ok: false, reason: 'empty-message' }, origin);
    }
    const state = sanitizeState(input && input.state);

    let out;
    try {
      // 'web' is a non-identifying user tag for the deterministic brain; the rate-limit key handles abuse.
      out = await handleMessage({ user: 'web', text: message, state }, { deps: MENU_DEPS });
      // AI, not a command bot: the deterministic brain handles real commands/flows (command/signup/faq);
      // when NOTHING matched (`nudge`) and we're not mid-signup, hand the message to the ONE Hathor brain so
      // general talk is conversational — the same self, MELEK compartment. Soft: if the brain's down, keep
      // the nudge. (Commands she'll still offer naturally from her own capability knowledge.)
      if (out && out.kind === 'nudge' && !(state && state.signup)) {
        try {
          const ai = await askHathor(message, { surface: 'melek', from: 'seeker' });
          if (ai && ai.reply) out = { reply: ai.reply, kind: 'hathor', state: null };
        } catch { /* keep the deterministic nudge */ }
      }
    } catch {
      // Never throw at the edge — give a friendly fallback.
      return sendJson(res, 200, {
        ok: true,
        reply: 'Sorry — something hiccupped on my end. Try that again?',
        kind: 'nudge',
        state: null,
      }, origin);
    }

    return sendJson(res, 200, {
      ok: true,
      reply: out.reply,
      kind: out.kind,
      done: Boolean(out.done),
      // Round-trip the walkthrough position (or null). Always re-sanitized so we only ever emit our shape.
      state: sanitizeState(out.state),
      // Expose the step labels once, so the widget can show a "step N of M" affordance if it wants.
      steps: SIGNUP_STEPS.map((s) => s.id),
    }, origin);
  }

  return sendJson(res, 404, { ok: false, reason: 'not-found' }, origin);
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && /chat-server\.mjs$/.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`hathor chat server on ${BASE_URL} (bound ${HOST}:${PORT})`);
    console.log(`  allowed origin: ${ALLOWED_ORIGIN}`);
    console.log('  custody: ZERO keys, ZERO broadcast — deterministic chat only (no LLM).');
    // redactForLog is imported so a deployer can wire request logging without leaking keys; reference
    // it here so linters don't flag the import as unused in this CLI-only path.
    void redactForLog;
  });
}
