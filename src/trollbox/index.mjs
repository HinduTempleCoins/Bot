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
// Account-creation walkthrough (added Task #296/#308): a "make me an account" line opens a
// deterministic, STATEFUL, one-step-at-a-time walkthrough accurate to OUR signup flow
// (browser-side keygen → save the master password → ≤16-char lowercase name → Create button →
// Hathor's automatic welcome grant). State is a tiny opaque object the caller round-trips
// (HTTP: in the JSON body; chain: best-effort by carrying nothing and re-matching). Still NO LLM,
// still custody-safe: Hathor NEVER asks for, sees, or handles a private key or master password.
//
// Exports:
//   handleMessage({ user, text, state }, { now, deps, limiter }) -> Promise<{ reply, kind, state? }>
//   FAQ          -> array of { id, match(text)->bool, question, answer }
//   RateLimiter  -> token-bucket class (injectable clock)
//   sanitize(text)        -> cleaned string (strip control chars, cap length)
//   redactForLog({user,text}) -> safe one-line log string
//   matchFaq(text)        -> FAQ entry | null
//   SIGNUP_STEPS          -> ordered walkthrough steps { id, say }
//   SIGNUP_URL            -> the create-account page path users are pointed at
//   isSignupIntent(text)  -> does this line start the walkthrough?
//   advanceSignup(state, text) -> { reply, state, done } deterministic step transition

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
      'To sign up, open the create-account page and pick an account name. Your keys are generated ' +
      'right in your browser — write down the master password it shows you and keep it somewhere safe. ' +
      'We never see or ask for your private keys. Want me to walk you through it one step at a time? ' +
      'Just say "walk me through it".',
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

// ---- account-creation walkthrough -----------------------------------------
// A deterministic, stateful, one-step-at-a-time guide accurate to OUR signup flow. NO LLM.
// Custody rule (BRIEF.md §7): every step is read-only guidance. Hathor NEVER asks the user to
// type, paste, send, or reveal a private key or their master password. Keys are generated in the
// user's own browser; Hathor never sees them.

/** The create-account page the walkthrough points people at (relative path; the condenser hosts it). */
export const SIGNUP_URL = '/account/signup.html';

/**
 * Ordered walkthrough. Each `say` is Hathor's line for that step, in her plain, welcoming voice.
 * The steps mirror site/alpha/account/signup.html + the documented faucet flow exactly:
 *   1. pick a name (≤16 chars, lowercase/digits/hyphen)
 *   2. the browser generates the four keys — nothing is sent to us
 *   3. SAVE the master password (no reset exists; only the holder has it)
 *   4. click Create — the faucet writes the account on-chain
 *   5. Hathor's automatic welcome: delegated POWER + a small TESTS grant + an @-mention
 */
export const SIGNUP_STEPS = [
  {
    id: 'name',
    say:
      "Glad to help you join. First, pick an account name. It must be 3–16 characters, " +
      "lowercase letters, digits, or hyphens — for example `offgrid` or `mary-2`. " +
      "What name would you like? When you have one in mind, say `next`.",
  },
  {
    id: 'keys',
    say:
      "Good. Open the create-account page (" + SIGNUP_URL + ") and type that name in. " +
      "When you do, your four keys — owner, active, posting, and memo — are generated " +
      "right there in your browser. They never touch our server: I only ever see your name and " +
      "your *public* keys. I never ask for, see, or hold your private keys. Say `next` when the " +
      "page has shown you your keys.",
  },
  {
    id: 'save',
    say:
      "This is the most important step: SAVE your master password. Copy it or download the key " +
      "file the page offers and keep it somewhere safe and private. There is no \"forgot password\" " +
      "— you, and only you, hold it; nobody, including me, can recover or reset it. " +
      "Never paste it into chat or send it to anyone. Say `i saved them` once it's safely stored.",
  },
  {
    id: 'create',
    say:
      "Now click the Create button on the page. The faucet creates your account on-chain — you " +
      "don't pay anything and you don't sign anything here. It only takes a moment. " +
      "Say `done` once it confirms your account is live.",
  },
  {
    id: 'welcome',
    say:
      "You're all set — welcome aboard! In a few minutes I'll come find your new account: I delegate " +
      "you some POWER so you can post and vote right away, send you a small TESTS welcome grant, and " +
      "@-mention you on the Welcome post. From there, try `!help` for commands or ask me about the " +
      "tutorial. It's good to have you here.",
  },
];

/** Map of step id -> index, for quick lookups. */
const STEP_INDEX = new Map(SIGNUP_STEPS.map((s, i) => [s.id, i]));

/** Phrases that OPEN the walkthrough. Matched on already-sanitized, lowercased text.
 * NOTE: the bare informational phrasings ("how do i sign up", "sign up", "register") are deliberately
 * left to the FAQ (which gives a custody-safe overview AND invites the walkthrough). The intent list
 * is the IMPERATIVE / "do it with me" phrasings + the explicit "walk me through it" follow-up. */
const SIGNUP_INTENT = [
  'make an account', 'make me an account', 'create an account', 'create account',
  'help me make an account', 'help me create', 'help me sign up', 'sign me up',
  'how do i join', 'how to join', 'i want to join',
  'how do i make an account', 'how do i create an account',
  'walk me through', 'guide me through', 'get an account', 'join melek', 'join the chain',
];

/** Phrases that advance to the NEXT step. */
const NEXT_WORDS = [
  'next', 'ok', 'okay', 'done', 'got it', 'i did', 'i did it', 'finished', 'continue',
  'i saved them', 'i saved it', 'saved', 'yes', 'yep', 'ready', 'whats next', "what's next",
  'what next', 'go on', 'proceed', 'created it', 'created', 'created my account',
];

/** Does this line begin the account-creation walkthrough? Expects sanitized text. */
export function isSignupIntent(text) {
  const t = (text || '').toLowerCase();
  if (!t) return false;
  return SIGNUP_INTENT.some((p) => t.includes(p));
}

/** Is this line a "move me forward" follow-up? */
function isNextWord(text) {
  const t = (text || '').toLowerCase().trim();
  if (!t) return false;
  // Whole-line match OR the line is short and contains the cue (avoid matching "next year" loosely
  // when it's a long sentence — keep it tight).
  return NEXT_WORDS.some((w) => t === w || (t.length <= 24 && t.includes(w)));
}

/**
 * Stateful walkthrough transition. PURE + deterministic.
 *
 * @param {{ step?: string }|null|undefined} state  prior walkthrough state (opaque to callers)
 * @param {string} text  the user's sanitized line
 * @returns {{ reply: string, state: { step: string }|null, done: boolean }}
 *
 * Behaviour:
 *  - No active walkthrough + a signup intent  -> emit step 0, state at step 0.
 *  - Active walkthrough + a "next" word       -> emit the following step (or finish).
 *  - Active walkthrough + a topical question  -> answer it, HOLD the current step.
 *  - Past the last step                       -> done:true, state cleared.
 */
export function advanceSignup(state, text) {
  const t = (text || '').toLowerCase();
  const curIdx = state && state.step != null && STEP_INDEX.has(state.step)
    ? STEP_INDEX.get(state.step)
    : -1;

  // Not in a walkthrough yet.
  if (curIdx < 0) {
    if (isSignupIntent(t)) {
      const step = SIGNUP_STEPS[0];
      return { reply: step.say, state: { step: step.id }, done: false };
    }
    return { reply: '', state: null, done: false };
  }

  // In a walkthrough. A "next"-style cue advances; anything else holds the step but still helps.
  if (isNextWord(t)) {
    const nextIdx = curIdx + 1;
    if (nextIdx >= SIGNUP_STEPS.length) {
      // Already at/over the final step -> finished. Clear state.
      return {
        reply: "That's everything — your account is on its way. Say `!help` any time, or ask me anything.",
        state: null,
        done: true,
      };
    }
    const step = SIGNUP_STEPS[nextIdx];
    const done = nextIdx === SIGNUP_STEPS.length - 1; // the welcome step is the end of the script
    return { reply: step.say, state: { step: step.id }, done };
  }

  // Mid-walkthrough question. If it's a known FAQ (key/password/free), answer it and hold position.
  const faq = matchFaq(t);
  if (faq) {
    const cur = SIGNUP_STEPS[curIdx];
    return {
      reply: faq.answer + ' (Say `next` when you are ready to continue.)',
      state: { step: cur.id },
      done: false,
    };
  }

  // Otherwise re-show the current step (deterministic, never lost).
  const cur = SIGNUP_STEPS[curIdx];
  return {
    reply: "No problem — here's where we are. " + cur.say,
    state: { step: cur.id },
    done: false,
  };
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
 * @param {{ user?: string, text?: string, state?: object }} msg
 * @param {object} [ctx]
 * @param {() => number} [ctx.now]      clock for rate limiting; defaults to Date.now
 * @param {object} [ctx.deps]           data sources forwarded to the menu (getAccount/getWitness/getPrice)
 * @param {RateLimiter} [ctx.limiter]   shared limiter; one is created per-call if omitted (no limiting then)
 * @returns {Promise<{ reply: string, kind: 'command'|'faq'|'signup'|'nudge'|'rate-limited', state?: object|null }>}
 *
 * `state` round-trips the account-creation walkthrough: pass back whatever `state` we return on the
 * next call. It is a tiny opaque object ({ signup: { step } }). Stateless transports may omit it —
 * the walkthrough still re-starts on an intent line, it just won't remember mid-conversation position.
 */
export async function handleMessage({ user, text, state } = {}, ctx = {}) {
  const { now = () => Date.now(), deps = {}, limiter } = ctx;
  const priorSignup = state && typeof state === 'object' ? state.signup : null;

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
    // Keep any in-progress walkthrough alive across a blank line.
    return { reply: 'Hi! Ask me about signing up, or type !help to see what I can do.', kind: 'nudge', state: priorSignup ? { signup: priorSignup } : null };
  }

  // 1) A `!command` -> delegate to the deterministic menu (defensively imported).
  // Commands are one-offs; they don't disturb an in-progress walkthrough, so we carry its state through.
  if (/^\s*!/.test(clean)) {
    const carry = priorSignup ? { signup: priorSignup } : null;
    const menu = await loadMenu();
    if (menu && typeof menu.handle === 'function') {
      try {
        const reply = await menu.handle(clean, deps);
        if (reply) return { reply, kind: 'command', state: carry };
      } catch {
        // fall through to nudge on any menu failure — never throw at the edge.
      }
    }
    return { reply: 'That command is not available right now. Type !help for the list.', kind: 'command', state: carry };
  }

  // 2) Account-creation walkthrough — STATEFUL and deterministic. Takes priority over the FAQ so an
  //    in-progress walkthrough is never derailed, and an explicit "make me an account" starts it.
  if (priorSignup || isSignupIntent(clean)) {
    const step = advanceSignup(priorSignup, clean);
    if (step.reply) {
      return { reply: step.reply, kind: 'signup', state: step.state ? { signup: step.state } : null, done: step.done };
    }
    // (Shouldn't happen — advanceSignup always replies when priorSignup or an intent is present.)
  }

  // 3) A known signup question -> canned, custody-safe answer (informational, not the walkthrough).
  const faq = matchFaq(clean);
  if (faq) {
    return { reply: faq.answer, kind: 'faq', state: null };
  }

  // 4) Anything else -> a friendly nudge.
  return {
    reply: "I didn't catch that. Try asking how to sign up, what a key is, or type !help to see commands.",
    kind: 'nudge',
    state: null,
  };
}

// ---- CLI -------------------------------------------------------------------
// Guarded: only runs when invoked directly.
//   - with args: route that single line and print it.
//   - no args:   run the full account-creation walkthrough as a stateful demo.
if (process.argv[1] && process.argv[1].endsWith('trollbox/index.mjs')) {
  const line = process.argv.slice(2).join(' ');
  if (line) {
    const out = await handleMessage({ user: 'cli', text: line });
    console.log(`[${out.kind}] ${out.reply}`);
  } else {
    // Stateful demo: a full create-account conversation.
    const script = ['make me an account', 'next', 'next', 'i saved them', 'done', 'next'];
    let state = null;
    for (const text of script) {
      const out = await handleMessage({ user: 'cli', text, state });
      state = out.state;
      console.log(`> ${text}`);
      console.log(`[${out.kind}${out.done ? ' · done' : ''}] ${out.reply}\n`);
    }
  }
}
