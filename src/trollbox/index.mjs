// src/trollbox/index.mjs — Hathor's condenser troll-box / signup-help chat surface (Task #37, Phase 2).
//
// A lightweight PUBLIC chat-help surface for the condenser's signup-help / chat box: newcomers
// type a line, we route it. NO LLM at this phase — everything is deterministic:
//   - a `!command` is delegated to the existing deterministic menu (commands/menu.mjs);
//   - a known signup question (keyword-matched) gets a canned, custody-safe answer;
//   - anything else gets a friendly "type !help" nudge.
//
// Conventions (shared with the rest of the Bot repo): ESM `.mjs`; pure/deterministic handlers;
// soft-fail / no-throw at the edge; CLI guarded behind an argv check; NO secrets; key-custody
// answers NEVER instruct anyone to send a private key (BRIEF.md §7). A simple per-user token
// bucket gives rate-limit awareness, with an injectable clock so it's testable offline.
//
// Exports:
//   handleMessage({ user, text }, { now, deps, limiter }) -> Promise<{ reply, kind }>
//   FAQ          -> array of { id, match(text)->bool, question, answer }
//   RateLimiter  -> token-bucket class (injectable clock)
//   sanitize(text)        -> cleaned string (strip control chars, cap length)
//   redactForLog({user,text}) -> safe one-line log string
//   matchFaq(text)        -> FAQ entry | null

// We import the menu defensively: the troll-box must still answer FAQs and nudge even if the
// menu module is missing or fails to load. Resolved lazily + memoized on first `!command`.
let _menuModulePromise = null;
async function loadMenu() {
  if (!_menuModulePromise) {
    _menuModulePromise = import('../../commands/menu.mjs').catch(() => null);
  }
  return _menuModulePromise;
}

// Allow tests / callers to inject a fake menu (or reset the cache).
export function __setMenuLoader(promiseOrNull) {
  _menuModulePromise = promiseOrNull;
}

// ---- sanitize --------------------------------------------------------------

export const MAX_LEN = 500;

/**
 * Clean an inbound chat line: drop control characters (except a plain space),
 * collapse runs of whitespace, trim, and hard-cap the length. Pure.
 * @param {unknown} text
 * @returns {string}
 */
export function sanitize(text) {
  if (typeof text !== 'string') return '';
  // Strip C0/C1 control chars (incl. tabs/newlines/NUL) — chat is single-line.
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/[\x00-\x1F\x7F-\x9F]/g, " ");
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_LEN ? collapsed.slice(0, MAX_LEN) : collapsed;
}

// ---- FAQ -------------------------------------------------------------------
// Canned, deterministic answers. Every answer is custody-safe: we NEVER tell anyone to send,
// type, paste, or share a private key with us. Where keys come up, the answer states the
// safety rule ("we never ask for your private key").

/** Does the (lowercased) text contain any of the phrases? */
function hasAny(text, phrases) {
  return phrases.some((p) => text.includes(p));
}

export const FAQ = [
  {
    id: 'signup',
    question: 'How do I sign up?',
    match: (t) =>
      hasAny(t, ['how do i sign up', 'how to sign up', 'how do i join', 'create an account', 'make an account', 'register']),
    answer:
      'To sign up, open the condenser signup page and pick an account name. Your keys are generated ' +
      'right in your browser — write down the master password it shows you and keep it somewhere safe. ' +
      'We never see or ask for your private keys. Type !help to see chain commands once you are in.',
  },
  {
    id: 'what-is-a-key',
    question: 'What is a key?',
    match: (t) =>
      hasAny(t, ['what is a key', 'whats a key', 'what are keys', "what's a key", 'what is a private key', 'explain keys']),
    answer:
      'Your keys are how you control your account — like a password, but you alone hold them. ' +
      'Signup gives you a master password that derives your posting, active, and owner keys. ' +
      'Keep them private: we never ask for your private key, and you should never paste it into chat ' +
      'or send it to anyone, including us.',
  },
  {
    id: 'forgot-password',
    question: 'I forgot my password.',
    match: (t) =>
      hasAny(t, ['forgot password', 'forgot my password', 'lost password', 'lost my password', 'lost my key', 'forgot my key', 'recover account']),
    answer:
      'There is no central "reset password" — you, and only you, hold your keys, so they cannot be ' +
      'recovered from us. Check wherever you saved your master password at signup. ' +
      'If you set up account recovery with a trusted partner you can use that. ' +
      'We can never ask for or restore your private key.',
  },
  {
    id: 'what-is-melek',
    question: 'What is MELEK?',
    match: (t) =>
      hasAny(t, ['what is melek', 'whats melek', "what's melek", 'about melek', 'tell me about melek']),
    answer:
      'MELEK is the blockchain this community runs on — a fast, fee-free social chain where posts, ' +
      'votes, and transfers are recorded on-chain. I am Hathor, a witness here to help newcomers ' +
      'get set up. Type !help to see what I can look up for you.',
  },
  {
    id: 'is-this-free',
    question: 'Is this free?',
    match: (t) =>
      hasAny(t, ['is this free', 'is it free', 'does it cost', 'do i have to pay', 'is signup free', 'how much does it cost']),
    answer:
      'Yes — creating an account and posting are free. There are no fees to sign up, post, or vote. ' +
      'You never need to pay us anything, and we never ask for payment or for your private keys.',
  },
];

/**
 * Find the first FAQ entry whose matcher fires on the sanitized, lowercased text.
 * @param {string} text already-sanitized text
 * @returns {(typeof FAQ)[number] | null}
 */
export function matchFaq(text) {
  const t = (text || '').toLowerCase();
  if (!t) return null;
  return FAQ.find((f) => f.match(t)) || null;
}

// ---- RateLimiter -----------------------------------------------------------

/**
 * Per-user token bucket. Each user gets `capacity` tokens that refill at
 * `capacity / windowMs` tokens per ms. `allow(user)` spends one token and
 * returns whether it was available. Clock is injectable for tests.
 */
export class RateLimiter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.capacity=5]  max burst (tokens)
   * @param {number} [opts.windowMs=10000]  ms to fully refill from empty
   * @param {() => number} [opts.now]  clock; defaults to Date.now
   */
  constructor({ capacity = 5, windowMs = 10000, now = () => Date.now() } = {}) {
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
   * Spend a token for `user`. Returns true if allowed, false if rate-limited.
   * Unknown/blank users share a single "anon" bucket so the limiter still bites.
   * @param {string} user
   * @returns {boolean}
   */
  allow(user) {
    const key = typeof user === 'string' && user ? user : 'anon';
    const t = this._now();
    let b = this._buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, last: t };
      this._buckets.set(key, b);
    }
    this._refill(b, t);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }
}

// ---- redactForLog ----------------------------------------------------------

/**
 * Build a safe, single-line log string. Truncates the message and scrubs anything
 * that looks like a WIF private key (defense-in-depth — a user might paste one
 * despite our warnings; it must never land in a log). Pure.
 * @param {{ user?: string, text?: string }} msg
 * @returns {string}
 */
export function redactForLog({ user, text } = {}) {
  const safeUser = sanitize(user).slice(0, 32) || '(anon)';
  let body = sanitize(text);
  // Scrub WIF-shaped tokens (base58, ~50+ chars, common '5'/'K'/'L' lead) just in case.
  body = body.replace(/\b[5KL][1-9A-HJ-NP-Za-km-z]{50,}\b/g, '[REDACTED-KEY]');
  if (body.length > 80) body = body.slice(0, 80) + '…';
  return `[trollbox] user=${safeUser} text=${JSON.stringify(body)}`;
}

// ---- handleMessage ---------------------------------------------------------

/**
 * Route one inbound troll-box chat line.
 *
 * @param {{ user?: string, text?: string }} msg
 * @param {object} [ctx]
 * @param {() => number} [ctx.now]      clock for rate limiting; defaults to Date.now
 * @param {object} [ctx.deps]           data sources forwarded to the menu (getAccount/getWitness/getPrice)
 * @param {RateLimiter} [ctx.limiter]   shared limiter; one is created per-call if omitted (no limiting then)
 * @returns {Promise<{ reply: string, kind: 'command'|'faq'|'nudge'|'rate-limited' }>}
 */
export async function handleMessage({ user, text } = {}, ctx = {}) {
  const { now = () => Date.now(), deps = {}, limiter } = ctx;

  // Rate-limit first (only when a shared limiter is supplied; a per-call one would never bite).
  if (limiter && typeof limiter.allow === 'function') {
    let allowed = true;
    try {
      allowed = limiter.allow(typeof user === 'string' ? user : 'anon');
    } catch {
      allowed = true; // soft-fail: never block a user because the limiter threw.
    }
    if (!allowed) {
      return { reply: 'You are sending messages a little fast — give it a few seconds and try again.', kind: 'rate-limited' };
    }
  }

  const clean = sanitize(text);
  if (!clean) {
    return { reply: 'Hi! Ask me about signing up, or type !help to see what I can do.', kind: 'nudge' };
  }

  // 1) A `!command` -> delegate to the deterministic menu (defensively imported).
  if (/^\s*!/.test(clean)) {
    const menu = await loadMenu();
    if (menu && typeof menu.handle === 'function') {
      try {
        const reply = await menu.handle(clean, deps);
        if (reply) return { reply, kind: 'command' };
      } catch {
        // fall through to nudge on any menu failure — never throw at the edge.
      }
    }
    return { reply: 'That command is not available right now. Type !help for the list.', kind: 'command' };
  }

  // 2) A known signup question -> canned, custody-safe answer.
  const faq = matchFaq(clean);
  if (faq) {
    return { reply: faq.answer, kind: 'faq' };
  }

  // 3) Anything else -> a friendly nudge.
  return {
    reply: "I didn't catch that. Try asking how to sign up, what a key is, or type !help to see commands.",
    kind: 'nudge',
  };
}

// ---- CLI -------------------------------------------------------------------
// Guarded: only runs when invoked directly. Reads a line from argv and prints the route.
if (process.argv[1] && process.argv[1].endsWith('trollbox/index.mjs')) {
  const line = process.argv.slice(2).join(' ');
  const out = await handleMessage({ user: 'cli', text: line });
  console.log(`[${out.kind}] ${out.reply}`);
}
