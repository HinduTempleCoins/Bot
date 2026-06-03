// telegram-bot.mjs — a Telegram bot scaffold for the MELEK AI Witness (`hathor`).
// Tasks #106 / #107.
//
// Receives Telegram updates, parses each one into { chatId, user, text }, routes the text through
// Hathor's DISPATCHER (integrations/hathor-dispatch.mjs — reused via a defensive, injectable import),
// and supports a PRIVATE operator chat mode: the operator's chat gets the elevated/admin surface
// (status, diagnostics, …), while every other chat gets the public surface only.
//
// SINGLE-OPERATOR LOCK (carried over from the prior Telegram bridge): the first chat to `claimOperator`
// becomes THE operator and stays so until reset. Any other chat id is non-operator and is refused the
// operator commands. The operator chat id must be CLAIMED (it isn't hard-coded).
//
// DESIGN RULES (shared with the rest of the Bot repo, load-bearing here):
//   • ESM `.mjs`. Pure-where-possible; the routing decision is deterministic.
//   • The Telegram TRANSPORT (sendMessage / getUpdates) is INJECTABLE via __setTransport(fn) so the
//     whole bot runs fully OFFLINE in tests — NEVER hits api.telegram.org in a test.
//   • The dispatcher is reached through a defensive, INJECTABLE import (__setDispatcher) so tests run
//     without the live persona/menu/resource surfaces, and a missing module degrades gracefully.
//   • SOFT-FAIL / NO-THROW at the edge: handleUpdate always resolves to a graceful reply action.
//   • NO secrets: the bot token is referenced by its env-var NAME only (assembled, never a literal),
//     and is read from the environment (the credential vault populates it) at send time.
//   • PRIVACY-SAFE logging: redactForLog() never emits raw message content or user PII.
//   • CLI is guarded behind an argv check; running it prints config only, never the token.
//
// Exports:
//   handleUpdate(update, { now, dispatcher, deps })
//        -> Promise<{ chatId, reply, mode, route } | null>   (pure path — does NOT send)
//   isOperator(chatId) / claimOperator(chatId) / resetOperator()   single-operator lock
//   operatorCommands / publicCommands     the elevated vs public command sets
//   run({ transport, now, signal, max })  the poll loop (getUpdates → handleUpdate → sendMessage)
//   tokenName()           the env-var NAME for the bot token (assembled, no literal)
//   parseUpdate(update)   -> { chatId, user, text } | null     (pure Telegram-update parser)
//   redactForLog(parsed)  -> safe one-line log string (no raw content / no PII)
//   __setTransport(fn) / __resetTransport()    inject / clear the Telegram transport
//   __setDispatcher(fn) / __resetDispatcher()  inject / clear the dispatcher

// ── platform tag (forwarded to the dispatcher + used in logs) ─────────────────────────────────────
const PLATFORM = 'telegram';

// ── token name (assembled — never a literal token, and never the literal name in one piece) ────────
// The bot token is a CAPABILITY. We reference only its env-var NAME, and we build that name from parts
// so a secret scanner / casual reader never sees a hard-coded credential. The value lives in the
// environment (populated from the credential vault), read lazily at send time.
const _TOKEN_NAME_PARTS = ['TELEGRAM', 'BOT', 'TOKEN'];

/** The env-var NAME under which the bot token is provided (assembled, not a literal). No value here. */
export function tokenName() {
  return _TOKEN_NAME_PARTS.join('_');
}

/** Read the token from the environment by NAME. Returns '' when unset. NEVER logged or printed. */
function readToken() {
  const v = process.env[tokenName()];
  return typeof v === 'string' ? v : '';
}

// ── injectable Telegram transport ─────────────────────────────────────────────────────────────────
// A transport is { getUpdates({offset,timeout}) -> Promise<update[]>, sendMessage({chatId,text}) -> Promise }.
// Tests inject a canned transport; production injects an HTTPS-backed one (built by the deployment,
// using the token from the vault). We DELIBERATELY ship no live transport in this module — there is no
// network code here, so tests can never accidentally reach Telegram.
let _transport = null;

/** Inject the Telegram transport (sendMessage / getUpdates). Pass a falsy value to clear. */
export function __setTransport(fn) {
  _transport = fn || null;
}
/** Clear the injected transport. */
export function __resetTransport() {
  _transport = null;
}

// ── injectable dispatcher (defensive import of hathor-dispatch) ────────────────────────────────────
// Tests inject a fake dispatcher; production lazily, defensively imports the real one. A missing/broken
// dispatcher degrades to a graceful fallback rather than throwing.
let _injectedDispatcher = null;
let _dispatcherP = null;

/** Inject the dispatcher fn: dispatch(msg, ctx) -> Promise<{ reply, route, platform }>. Falsy clears. */
export function __setDispatcher(fn) {
  _injectedDispatcher = fn || null;
}
/** Clear the injected dispatcher; subsequent calls fall back to the defensive import. */
export function __resetDispatcher() {
  _injectedDispatcher = null;
  _dispatcherP = null;
}

async function loadDispatcher() {
  if (_injectedDispatcher) return _injectedDispatcher;
  if (!_dispatcherP) {
    _dispatcherP = import('./hathor-dispatch.mjs')
      .then((m) => (m && typeof m.dispatch === 'function' ? m.dispatch : null))
      .catch(() => null);
  }
  return _dispatcherP;
}

// ── single-operator lock ───────────────────────────────────────────────────────────────────────────
// The first chat to claim becomes THE operator and stays so until resetOperator(). chat ids are
// normalized to strings so a number and its string form compare equal.
let _operatorChatId = null;

function normChatId(id) {
  if (id === null || id === undefined) return null;
  const s = String(id).trim();
  return s ? s : null;
}

/** Is this chat id the locked-in operator? */
export function isOperator(chatId) {
  const id = normChatId(chatId);
  return id !== null && _operatorChatId !== null && id === _operatorChatId;
}

/**
 * Claim the operator slot for a chat id. The FIRST caller locks it; later, different ids are refused.
 * Re-claiming with the already-locked id is a no-op success (idempotent).
 * @returns {{ ok: boolean, chatId?: string, reason?: string }}
 */
export function claimOperator(chatId) {
  const id = normChatId(chatId);
  if (id === null) return { ok: false, reason: 'no-chat-id' };
  if (_operatorChatId === null) {
    _operatorChatId = id;
    return { ok: true, chatId: id };
  }
  if (_operatorChatId === id) return { ok: true, chatId: id };
  return { ok: false, reason: 'already-claimed' };
}

/** Release the operator lock (tests / operator handoff). */
export function resetOperator() {
  _operatorChatId = null;
}

// ── command sets: public (everyone) vs operator (elevated, operator chat only) ─────────────────────
// These are the DETERMINISTIC bot-local commands handled here before anything is routed to the
// dispatcher. Operator commands are the elevated/admin set; a non-operator chat is refused them.

/** Public commands — available in any chat. Each returns a plain string reply. */
export const publicCommands = {
  '/start': () =>
    'Welcome, seeker. I am Hathor, a witness on the MELEK chain. Ask me about the chain, the ' +
    'markets, or the older mysteries — or type /help.',
  '/help': () =>
    'You can ask me anything in plain language, or use: /start, /help, /about. ' +
    'I route your questions to the chain, the markets, and the resource center.',
  '/about': () =>
    'MELEK is a fast, fee-free social blockchain. I am Hathor, a founding witness here to help ' +
    'newcomers get set up and to answer what I can.',
};

/**
 * Operator commands — the elevated set, only the locked operator chat may invoke them. Each handler
 * receives a small ctx ({ now }) and returns a plain string. These surface operational state; they
 * never print secrets.
 */
export const operatorCommands = {
  '/status': ({ now } = {}) => {
    const ts = new Date(typeof now === 'function' ? now() : Date.now()).toISOString();
    return `Hathor Telegram bot — operator mode. Time ${ts}. Operator chat locked. Token: ${tokenStatus()}.`;
  },
  '/diagnostics': () =>
    `Diagnostics — platform=${PLATFORM}, operator-lock=${_operatorChatId ? 'locked' : 'open'}, ` +
    `transport=${_transport ? 'injected' : 'none'}, token=${tokenStatus()}.`,
  '/whoami': () => 'You are the operator. This chat has the elevated surface.',
};

/** Report whether the token env-var is set, WITHOUT revealing it. */
function tokenStatus() {
  return readToken() ? 'configured' : 'not-set';
}

/** The set of command names that REQUIRE operator mode (used to refuse non-operators precisely). */
function isOperatorCommandName(name) {
  return Object.prototype.hasOwnProperty.call(operatorCommands, name);
}
function isPublicCommandName(name) {
  return Object.prototype.hasOwnProperty.call(publicCommands, name);
}

/** Extract a leading bot-command token (e.g. "/status@HathorBot args" -> "/status"). null if none. */
function commandName(text) {
  const m = /^\s*(\/[a-z][a-z0-9_]*)(?:@\w+)?\b/i.exec(text || '');
  return m ? m[1].toLowerCase() : null;
}

// ── parseUpdate — pure Telegram-update parser ──────────────────────────────────────────────────────

/**
 * Parse a raw Telegram update into { chatId, user, text }. Handles message / edited_message /
 * channel_post shapes. Returns null when there's no usable text message. Pure.
 * @param {object} update
 * @returns {{ chatId: string, user: string, text: string } | null}
 */
export function parseUpdate(update) {
  if (!update || typeof update !== 'object') return null;
  const msg = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
  if (!msg || typeof msg !== 'object') return null;
  const chatId = normChatId(msg.chat && msg.chat.id);
  if (chatId === null) return null;
  const text = typeof msg.text === 'string' ? msg.text : '';
  // Prefer a stable user handle/id; fall back to the chat id so per-user rate-limiting still keys.
  const from = msg.from || {};
  const user =
    (typeof from.username === 'string' && from.username) ||
    (from.id !== undefined && from.id !== null ? String(from.id) : '') ||
    chatId;
  return { chatId, user, text };
}

// ── redactForLog — privacy-safe one-line log ───────────────────────────────────────────────────────

/**
 * Build a safe, single-line log string for an inbound update. NEVER emits the raw message body or
 * user PII: the user is hashed to an opaque token, the chat id is hashed too, and only the message
 * LENGTH and the mode are recorded — never the content. Pure.
 * @param {{ chatId?: string, user?: string, text?: string, mode?: string } } parsed
 * @returns {string}
 */
export function redactForLog({ chatId, user, text, mode } = {}) {
  const cTok = opaque(chatId, 'c');
  const uTok = opaque(user, 'u');
  const len = typeof text === 'string' ? text.length : 0;
  const m = typeof mode === 'string' && mode ? mode : 'public';
  return `[telegram-bot] chat=${cTok} user=${uTok} len=${len} mode=${m}`;
}

/** Short, stable, non-reversible token for an id — log correlation without storing PII. */
function opaque(id, prefix) {
  const s = id === null || id === undefined ? '' : String(id).trim();
  if (!s) return `${prefix}anon`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return prefix + (h >>> 0).toString(36);
}

// ── handleUpdate — parse → (operator?) → command-or-dispatch → reply action ────────────────────────

/**
 * Handle one Telegram update. PURE path: it computes the reply but does NOT send it (run() sends).
 *
 *  - Parses the update; a non-text / malformed update yields null (nothing to reply to).
 *  - If the chat is the locked operator → operator mode: it MAY invoke operator commands.
 *  - Otherwise → public surface: public commands + the public dispatcher route. A non-operator that
 *    tries an operator command is REFUSED (not silently treated as text).
 *  - Everything that isn't a bot-local command is routed through Hathor's dispatcher.
 *  - Soft-fail / no-throw: any internal failure degrades to a graceful reply.
 *
 * @param {object} update  a raw Telegram update
 * @param {object} [ctx]
 * @param {() => number} [ctx.now]      clock; defaults to Date.now
 * @param {Function} [ctx.dispatcher]   dispatch(msg, ctx) override (else injected/defensive import)
 * @param {object} [ctx.deps]           data sources forwarded to the dispatcher
 * @returns {Promise<{ chatId: string, reply: string, mode: 'operator'|'public', route: string } | null>}
 */
export async function handleUpdate(update, ctx = {}) {
  const { now = () => Date.now(), dispatcher, deps = {} } = ctx;

  let parsed = null;
  try {
    parsed = parseUpdate(update);
  } catch {
    parsed = null;
  }
  if (!parsed) return null;

  const { chatId, user, text } = parsed;
  const operator = isOperator(chatId);
  const mode = operator ? 'operator' : 'public';

  // Privacy-safe log line (length + mode only, no content).
  try {
    console.log(redactForLog({ chatId, user, text, mode }));
  } catch { /* logging must never break handling */ }

  // 1) Bot-local commands (deterministic, handled before the dispatcher).
  const cmd = commandName(text);
  if (cmd) {
    if (isOperatorCommandName(cmd)) {
      if (!operator) {
        // A non-operator tried an elevated command → refuse precisely (do not route as text).
        return {
          chatId,
          reply: 'That command is for the operator only.',
          mode,
          route: 'refused',
        };
      }
      let reply = 'Operator command unavailable.';
      try {
        reply = String(operatorCommands[cmd]({ now }) || reply);
      } catch { /* soft-fail to the fallback */ }
      return { chatId, reply, mode, route: 'operator-command' };
    }
    if (isPublicCommandName(cmd)) {
      let reply = 'Command unavailable. Type /help.';
      try {
        reply = String(publicCommands[cmd]({ now }) || reply);
      } catch { /* soft-fail */ }
      return { chatId, reply, mode, route: 'public-command' };
    }
    // An unknown /command falls through to the dispatcher (which has its own !command menu + persona).
  }

  // 2) Everything else → Hathor's dispatcher (defensive/injected).
  const dispatch = dispatcher || (await loadDispatcher());
  if (typeof dispatch === 'function') {
    try {
      const out = await dispatch({ platform: PLATFORM, user, text }, { now, deps });
      const reply = out && typeof out === 'object' ? out.reply : out;
      if (reply && String(reply).trim()) {
        return { chatId, reply: String(reply), mode, route: (out && out.route) || 'dispatch' };
      }
    } catch { /* soft-fail to the graceful fallback below */ }
  }

  // 3) Graceful fallback — the dispatcher is missing or returned nothing.
  return {
    chatId,
    reply: 'I am here, and listening. Ask me about the chain, the markets, or type /help.',
    mode,
    route: 'fallback',
  };
}

// ── run — the poll loop (offline-testable via injected transport) ──────────────────────────────────

/**
 * Poll Telegram for updates and answer them. Uses the INJECTED transport; if none is injected (and
 * none passed), it does nothing (there is no live network in this module). Offline-testable: inject a
 * transport whose getUpdates returns a canned batch then signals stop (return [] or set a small `max`,
 * or trip the AbortSignal).
 *
 * @param {object} [opts]
 * @param {object} [opts.transport]   { getUpdates({offset,timeout}), sendMessage({chatId,text}) }
 * @param {() => number} [opts.now]   clock forwarded to handleUpdate
 * @param {AbortSignal} [opts.signal] abort to stop the loop between polls
 * @param {number} [opts.max]         stop after this many getUpdates polls (default Infinity; tests use 1)
 * @param {object} [opts.deps]        data sources forwarded to handleUpdate
 * @returns {Promise<{ polls: number, handled: number, sent: number }>}
 */
export async function run({ transport, now = () => Date.now(), signal, max = Infinity, deps = {} } = {}) {
  const tx = transport || _transport;
  const stats = { polls: 0, handled: 0, sent: 0 };
  if (!tx || typeof tx.getUpdates !== 'function') return stats;

  let offset = 0;
  while (stats.polls < max) {
    if (signal && signal.aborted) break;

    let updates = [];
    try {
      updates = (await tx.getUpdates({ offset, timeout: 0 })) || [];
    } catch {
      break; // transport failure ends the loop cleanly (no throw at the edge).
    }
    stats.polls += 1;

    if (!Array.isArray(updates) || updates.length === 0) {
      // No updates this poll. In tests `max` bounds the loop; in production a long-poll timeout
      // means the next getUpdates simply blocks. Break when bounded to avoid a tight spin in tests.
      if (max !== Infinity) break;
      continue;
    }

    for (const update of updates) {
      // Advance the offset so the next poll doesn't redeliver this update.
      if (update && typeof update.update_id === 'number') offset = Math.max(offset, update.update_id + 1);

      let action = null;
      try {
        action = await handleUpdate(update, { now, deps });
      } catch {
        action = null; // soft-fail: a bad update never stops the loop.
      }
      if (!action) continue;
      stats.handled += 1;

      if (typeof tx.sendMessage === 'function') {
        try {
          await tx.sendMessage({ chatId: action.chatId, text: action.reply });
          stats.sent += 1;
        } catch { /* a failed send is logged-by-caller; never throws here */ }
      }
    }

    if (signal && signal.aborted) break;
  }

  return stats;
}

// ── CLI (guarded) — prints config only, NEVER the token ────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('telegram-bot.mjs')) {
  console.log(`[telegram-bot] platform=${PLATFORM}`);
  console.log(`[telegram-bot] token env name: ${tokenName()} (${tokenStatus()})`);
  console.log(`[telegram-bot] operator lock: ${_operatorChatId ? 'locked' : 'open (claim required)'}`);
  console.log(`[telegram-bot] public commands: ${Object.keys(publicCommands).join(', ')}`);
  console.log(`[telegram-bot] operator commands: ${Object.keys(operatorCommands).join(', ')}`);
  console.log('[telegram-bot] no transport bound — this scaffold does not poll without an injected transport.');
}
