// hathor-dispatch.mjs — the inbound-message DISPATCHER for the MELEK AI Witness (`hathor`),
// Task #65 ("Wire hathor-persona into the Discord/Telegram dispatcher — currently export-only").
//
// This is the thin ROUTING GLUE between a chat platform (Discord, Telegram, the condenser troll-box,
// …) and Hathor's persona/command/resource surfaces. A platform client receives a message and calls
// dispatch({ platform, user, text }); we classify it and route:
//
//   greeting / empty / first-contact  → hathor-discord dispositionGreeting (varied — never a script)
//   a `!command`                       → commands/menu.mjs (deterministic command handling)
//   a resource / factual question      → integrations/resource-center-chat.mjs (cited answers)
//   anything else                      → hathor-discord shapeReply (persona-shaped voice)
//
// DESIGN RULES (shared with the rest of the Bot repo, and load-bearing here):
//   • ESM `.mjs`; the routing is DETERMINISTIC (route() is a pure classifier, testable alone).
//   • The three downstream surfaces are reached through INJECTABLE handlers (__setHandlers) so the
//     whole dispatcher runs fully OFFLINE in tests — no network, no live persona/menu/resource needed.
//     In production we lean on the real modules via DEFENSIVE imports; a missing/broken module
//     degrades gracefully, it never throws.
//   • SOFT-FAIL / NO-THROW at the edge: dispatch() always resolves to a graceful reply, even if a
//     downstream handler throws.
//   • A per-user TOKEN-BUCKET rate limiter (injectable clock) gives rate-limit awareness.
//   • PRIVACY-SAFE logging: redactForLog() never emits raw content or user PII.
//   • NO secrets, NO keys; this module shapes routing only. CLI is guarded behind an argv check.
//
// Exports:
//   dispatch({ platform, user, text }, { now, seed, limiter, deps })
//        -> Promise<{ reply, route, platform }>   route ∈ greeting|command|resource|persona|rate-limited
//   route(text) -> 'greeting'|'command'|'resource'|'persona'   (pure classifier)
//   RateLimiter -> per-user token bucket (injectable clock)
//   redactForLog({ platform, user, text }) -> safe one-line log string (no raw content / no PII)
//   __setHandlers({ menu, persona, resource }) -> inject downstream handlers (tests / custom wiring)
//   __resetHandlers() -> clear injected handlers (revert to defensive imports)

// ── Defensive, injectable downstream handlers ────────────────────────────────────────────────────
// Tests (and bespoke wirings) inject these via __setHandlers; production falls back to the real
// modules via lazy, memoized, defensive imports. Each loader catches its own failure → null, so a
// missing module degrades the route rather than throwing.

let _injected = { menu: null, persona: null, resource: null };

/**
 * Inject downstream handlers so the dispatcher runs offline / against fakes.
 * @param {object} handlers
 * @param {{ handle?: Function }} [handlers.menu]      shape of commands/menu.mjs (handle(text, deps))
 * @param {{ dispositionGreeting?: Function, shapeReply?: Function }} [handlers.persona]
 *                                                     shape of integrations/hathor-discord.mjs
 * @param {{ handleChat?: Function }} [handlers.resource]
 *                                                     shape of integrations/resource-center-chat.mjs
 */
export function __setHandlers(handlers = {}) {
  if (handlers.menu !== undefined) _injected.menu = handlers.menu;
  if (handlers.persona !== undefined) _injected.persona = handlers.persona;
  if (handlers.resource !== undefined) _injected.resource = handlers.resource;
}

/** Clear all injected handlers; subsequent calls fall back to the defensive imports. */
export function __resetHandlers() {
  _injected = { menu: null, persona: null, resource: null };
  _menuP = _personaP = _resourceP = null;
}

let _menuP = null;
let _personaP = null;
let _resourceP = null;

async function loadMenu() {
  if (_injected.menu) return _injected.menu;
  if (!_menuP) _menuP = import('../commands/menu.mjs').catch(() => null);
  return _menuP;
}
async function loadPersona() {
  if (_injected.persona) return _injected.persona;
  if (!_personaP) _personaP = import('./hathor-discord.mjs').catch(() => null);
  return _personaP;
}
async function loadResource() {
  if (_injected.resource) return _injected.resource;
  if (!_resourceP) _resourceP = import('./resource-center-chat.mjs').catch(() => null);
  return _resourceP;
}

// ── Input hygiene ────────────────────────────────────────────────────────────────────────────────

export const MAX_LEN = 2000; // chat platforms cap around here; we hard-cap for safety.

/** Clean an inbound line: drop control chars, collapse whitespace, trim, cap length. Pure. */
function sanitize(text) {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ');
  const collapsed = stripped.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return collapsed.length > MAX_LEN ? collapsed.slice(0, MAX_LEN) : collapsed;
}

// ── route() — the pure classifier ────────────────────────────────────────────────────────────────
// Deterministic, no I/O. Decides which surface a message takes. The four buckets:
//   'greeting'  — empty / a bare hello / a first-contact opener
//   'command'   — starts with `!` (delegated to the deterministic menu)
//   'resource'  — an explicit !rc/!resource, OR a detected factual/resource question
//   'persona'   — everything else (general conversation → persona-shaped voice)

const GREETING_RE =
  /^(?:hi|hii+|hey+|hello+|yo|sup|greetings|good (?:morning|afternoon|evening|day)|gm|gn|howdy|hiya|namaste|peace|hail|hello there|wassup|what'?s up)[\s!.,?]*$/i;

// Command-prefixes that are explicitly the resource center (handled before the generic !command path).
const RESOURCE_CMD_RE = /^!\s*(rc|resource)\b/i;

// Heuristics for an un-prefixed factual / resource-seeking question. Deliberately conservative: a
// bare "what is a key?" stays persona unless it reads like a lookup. We look for a question shape
// AND a resource/factual cue. This is a routing heuristic, not a knowledge classifier.
const QUESTION_RE = /\?\s*$/;
const QUESTION_LEAD_RE =
  /^(?:what|whats|what's|which|who|where|when|how much|how many|how do|how does|is|are|does|do|can you (?:find|look ?up|tell me|show me)|tell me about|look ?up|find|show me|search|price of|cost of)\b/i;
const RESOURCE_CUE_RE =
  /\b(price|cost|worth|value|market|rate|exchange|stock|stocks|ticker|forex|commodit(?:y|ies)|gold|silver|oil|gas|weather|news|scam|fraud|law|legal|company|companies|token|trade|trading|invest|investing|crypto|coin|data|statistic|stats|how much|figures?)\b/i;

/**
 * Classify an inbound message into a route. Pure — no I/O, deterministic.
 * @param {string|null|undefined} text
 * @returns {'greeting'|'command'|'resource'|'persona'}
 */
export function route(text) {
  const clean = sanitize(text);
  if (!clean) return 'greeting'; // empty / first-contact → a disposition-greeting

  // Explicit resource command takes precedence over the generic command path.
  if (RESOURCE_CMD_RE.test(clean)) return 'resource';

  // Any other `!command` → the deterministic menu.
  if (/^!/.test(clean)) return 'command';

  // A bare greeting / hello → greeting.
  if (GREETING_RE.test(clean)) return 'greeting';

  // A detected factual / resource question → the resource center.
  const looksLikeQuestion = QUESTION_RE.test(clean) || QUESTION_LEAD_RE.test(clean);
  if (looksLikeQuestion && RESOURCE_CUE_RE.test(clean)) return 'resource';

  // Otherwise: general conversation → persona-shaped voice.
  return 'persona';
}

// ── RateLimiter — per-user token bucket, injectable clock ────────────────────────────────────────

/**
 * Per-user token bucket. Each user gets `capacity` tokens refilling at capacity/windowMs per ms.
 * allow(user) spends one token, returning whether it was available. Clock is injectable for tests.
 */
export class RateLimiter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.capacity=8]      max burst (tokens)
   * @param {number} [opts.windowMs=10000]  ms to fully refill from empty
   * @param {() => number} [opts.now]       clock; defaults to Date.now
   */
  constructor({ capacity = 8, windowMs = 10000, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.refillPerMs = capacity / windowMs;
    this._now = now;
    /** @type {Map<string, { tokens: number, last: number }>} */
    this._buckets = new Map();
  }

  _refill(b, t) {
    const elapsed = t - b.last;
    if (elapsed > 0) {
      b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
      b.last = t;
    }
  }

  /**
   * Spend a token for `key` (typically "platform:user"). Returns true if allowed, false if limited.
   * Blank keys share a single "anon" bucket so the limiter still bites.
   * @param {string} key
   * @returns {boolean}
   */
  allow(key) {
    const k = typeof key === 'string' && key ? key : 'anon';
    const t = this._now();
    let b = this._buckets.get(k);
    if (!b) {
      b = { tokens: this.capacity, last: t };
      this._buckets.set(k, b);
    }
    this._refill(b, t);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }
}

// ── redactForLog — privacy-safe one-line log ─────────────────────────────────────────────────────

/**
 * Build a safe, single-line log string for an inbound message. It NEVER emits the raw message body
 * or user PII: the user is hashed to a short opaque token, the platform is kept (operational), and
 * only the message LENGTH and the routing class are recorded — never the content. Pure.
 * @param {{ platform?: string, user?: string, text?: string }} msg
 * @returns {string}
 */
export function redactForLog({ platform, user, text } = {}) {
  const plat = typeof platform === 'string' && platform.trim()
    ? platform.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16) || 'unknown'
    : 'unknown';
  // Opaque, non-reversible user token (so we can correlate without storing who it is).
  const uTok = userToken(user);
  const len = typeof text === 'string' ? text.length : 0;
  const r = route(text);
  return `[hathor-dispatch] platform=${plat} user=${uTok} len=${len} route=${r}`;
}

/** Short, stable, non-reversible token for a user id — for log correlation without storing PII. */
function userToken(user) {
  const s = typeof user === 'string' && user.trim() ? user.trim() : '';
  if (!s) return 'anon';
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'u' + (h >>> 0).toString(36);
}

// ── dispatch() — the routing glue ────────────────────────────────────────────────────────────────

const FALLBACK_REPLIES = {
  greeting: 'Welcome, seeker. Ask me about the chain, the markets, or the older mysteries — or type !help.',
  command: 'That command is not available right now. Type !help for the list.',
  resource: 'I could not reach the Resource Center just now. Please try again shortly.',
  persona: 'I am here, and listening. Ask, and I will turn it over with you.',
};

/**
 * Dispatch one inbound message to the right Hathor surface and return a reply.
 *
 * @param {object} msg
 * @param {string} [msg.platform]  'discord' | 'telegram' | 'trollbox' | …  (logged, forwarded back)
 * @param {string} [msg.user]      the seeker's id/handle (used for rate-limit key + greeting warmth)
 * @param {string} [msg.text]      the raw inbound text
 * @param {object} [ctx]
 * @param {() => number} [ctx.now]       clock for rate limiting; defaults to Date.now
 * @param {number|string} [ctx.seed]    seed for greeting/shape variation; defaults to a clock-derived value
 * @param {RateLimiter} [ctx.limiter]   shared limiter; if omitted, no limiting is applied this call
 * @param {object} [ctx.deps]           data sources forwarded to the menu (getAccount/getWitness/getPrice)
 * @param {object} [ctx.resourceCtx]    extra ctx forwarded to the resource handler (e.g. topK)
 * @returns {Promise<{ reply: string, route: 'greeting'|'command'|'resource'|'persona'|'rate-limited', platform: string }>}
 */
export async function dispatch({ platform, user, text } = {}, ctx = {}) {
  const { now = () => Date.now(), seed, limiter, deps = {}, resourceCtx = {} } = ctx;
  const plat = typeof platform === 'string' && platform.trim() ? platform.trim() : 'unknown';

  // 1) Rate-limit (only when a shared limiter is supplied; a per-call one would never bite).
  if (limiter && typeof limiter.allow === 'function') {
    let allowed = true;
    try {
      const key = `${plat}:${typeof user === 'string' && user ? user : 'anon'}`;
      allowed = limiter.allow(key);
    } catch {
      allowed = true; // soft-fail: never block a user because the limiter threw.
    }
    if (!allowed) {
      return {
        reply: 'You are sending messages a little fast — give it a few seconds and try again.',
        route: 'rate-limited',
        platform: plat,
      };
    }
  }

  const r = route(text);
  // A seed that varies the persona output; derive from the clock if not given (never user content).
  const useSeed = seed !== undefined ? seed : (typeof now === 'function' ? now() : Date.now());

  try {
    if (r === 'greeting') return { reply: await doGreeting({ user, seed: useSeed }), route: r, platform: plat };
    if (r === 'command') return { reply: await doCommand({ text, deps }), route: r, platform: plat };
    if (r === 'resource') return { reply: await doResource({ user, text, now, ctx: resourceCtx }), route: r, platform: plat };
    return { reply: await doPersona({ text, seed: useSeed }), route: r, platform: plat };
  } catch {
    // Belt-and-braces: a downstream handler threw despite its own guards. Soft-fail gracefully.
    return { reply: FALLBACK_REPLIES[r] || FALLBACK_REPLIES.persona, route: r, platform: plat };
  }
}

// ── per-route handlers (each soft-fails to a graceful fallback) ───────────────────────────────────

async function doGreeting({ user, seed }) {
  const persona = await loadPersona();
  if (persona && typeof persona.dispositionGreeting === 'function') {
    try {
      const g = persona.dispositionGreeting({ user, context: 'open', seed });
      if (g && String(g).trim()) return String(g);
    } catch { /* fall through */ }
  }
  return FALLBACK_REPLIES.greeting;
}

async function doCommand({ text, deps }) {
  const menu = await loadMenu();
  if (menu && typeof menu.handle === 'function') {
    try {
      const reply = await menu.handle(sanitize(text), deps);
      if (reply && String(reply).trim()) return String(reply);
    } catch { /* fall through */ }
  }
  return FALLBACK_REPLIES.command;
}

async function doResource({ user, text, now, ctx }) {
  const resource = await loadResource();
  if (resource && typeof resource.handleChat === 'function') {
    try {
      const out = await resource.handleChat({ user, text: sanitize(text) }, { now, ...(ctx || {}) });
      const reply = out && typeof out === 'object' ? out.reply : out;
      if (reply && String(reply).trim()) return String(reply);
    } catch { /* fall through */ }
  }
  return FALLBACK_REPLIES.resource;
}

async function doPersona({ text, seed }) {
  const clean = sanitize(text);
  const persona = await loadPersona();
  if (persona && typeof persona.shapeReply === 'function') {
    try {
      // The persona layer shapes the user's line into Hathor's voice (no LLM at this layer — the
      // dispatcher is the routing glue; a richer LLM-backed reply is wired in by the platform client
      // using persona.systemPrompt). We pass the cleaned text through as the body to shape.
      const shaped = persona.shapeReply(clean, { tone: 'warm', seed });
      if (shaped && String(shaped).trim()) return String(shaped);
    } catch { /* fall through */ }
  }
  return FALLBACK_REPLIES.persona;
}

// ── CLI: demonstrate routing (offline; uses the real modules if present) ──────────────────────────
if (process.argv[1] && process.argv[1].endsWith('hathor-dispatch.mjs')) {
  const line = process.argv.slice(2).join(' ');
  const out = await dispatch({ platform: 'cli', user: 'seeker', text: line });
  console.log(`route=${out.route}\n${out.reply}`);
}
