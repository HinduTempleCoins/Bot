// src/chatSurface.js — Library of Ashurbanipal chat surface for Discord / Telegram (Task #96).
//
// Lets users ask the library bot for articles + facts from a chat box:
//   !ask <question>     → a GROUNDED answer from the library search, with source citations.
//   !library <topic>    → an article summary + link (alias: !wiki <topic>).
//   !price <symbol>     → a live price fact via the injected liveData backend (our steemd).
//   !help               → the command list.
//   (anything else)     → a friendly nudge toward !help.
//
// Conventions (shared with the rest of the Bot repo — see src/trollbox/index.mjs, the deterministic
// model this matches): ESM; pure/deterministic command routing; soft-fail / no-throw at the edge;
// CLI guarded behind an argv check; NO secrets; privacy-aware (we never echo user PII into logs);
// rate-limit awareness via a simple per-user token bucket with an injectable clock.
//
// GROUNDED-OR-HONEST INVARIANT: every !ask / !library answer is built from injected library search
// results and carries source citations. If the search returns nothing usable, we say so plainly
// ("I don't have a grounded source for that") — we NEVER fabricate an unsourced claim.
//
// Backends are INJECTED so tests run fully OFFLINE (no disk, no network, no LLM):
//   __setBackends({ search, factCheck, liveData })
//     search(query, { max })  → Promise<Array<{ title, excerpt|snippet, source|file|url, score? }>>
//                               (or a single { results: [...] } wrapper — both accepted)
//     factCheck(claim)        → Promise<{ verdict, confidence, reason, source, evidence_urls }>  (optional)
//     liveData(commandStr)    → Promise<{ ok, text, data }>  (the steemd runCommand shape)
//
// Exports:
//   handleCommand({ user, text }, { now }) → Promise<{ reply, kind }>
//   formatAnswer(searchResult)             → string (grounded answer w/ citations, or honest no-source)
//   COMMANDS                               → array of { name, usage, blurb } for !help
//   RateLimiter                            → token-bucket class (injectable clock)
//   redactForLog({ user, text })           → privacy-safe one-line log string
//   sanitize(text)                         → cleaned single-line string
//   __setBackends(...) / __resetBackends() → test injection helpers

// ── injectable backends ─────────────────────────────────────────────────────
// Default backends are inert: with nothing injected, search returns no results (so answers are the
// honest "no grounded source" reply) and liveData reports unavailable. This keeps the module safe to
// import anywhere — it never reaches for a network or an LLM on its own.
const DEFAULT_BACKENDS = {
  async search() { return []; },
  async factCheck() { return { verdict: 'UNVERIFIABLE', confidence: 0, reason: 'no backend', source: '', evidence_urls: [] }; },
  async liveData() { return { ok: false, text: 'Live data is not available right now.', data: null }; },
};

let _backends = { ...DEFAULT_BACKENDS };

/**
 * Inject backends for the chat surface. Any omitted key keeps its current value.
 * @param {Partial<typeof DEFAULT_BACKENDS>} backends
 */
export function __setBackends(backends = {}) {
  _backends = { ..._backends, ...backends };
}

/** Reset to the inert defaults (test teardown). */
export function __resetBackends() {
  _backends = { ...DEFAULT_BACKENDS };
}

// ── sanitize ─────────────────────────────────────────────────────────────────
export const MAX_LEN = 500;

/**
 * Clean an inbound chat line: strip control chars, collapse whitespace, trim, hard-cap length. Pure.
 * @param {unknown} text
 * @returns {string}
 */
export function sanitize(text) {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_LEN ? collapsed.slice(0, MAX_LEN) : collapsed;
}

// ── COMMANDS (for !help) ──────────────────────────────────────────────────────
export const COMMANDS = [
  { name: '!ask', usage: '!ask <question>', blurb: 'Ask the library — I answer from sourced material with citations.' },
  { name: '!library', usage: '!library <topic>', blurb: 'Get an article summary on a topic, with a link.' },
  { name: '!wiki', usage: '!wiki <topic>', blurb: 'Alias of !library.' },
  { name: '!price', usage: '!price <symbol>', blurb: 'Look up a live price (e.g. !price VKBT).' },
  { name: '!help', usage: '!help', blurb: 'Show this list.' },
];

/** Render the !help reply from COMMANDS. */
function helpText() {
  const lines = COMMANDS
    .filter((c) => c.name !== '!wiki') // fold the alias into !library's line
    .map((c) => `\`${c.usage}\` — ${c.blurb}`);
  return ['Library of Ashurbanipal — what I can do:', ...lines].join('\n');
}

// ── grounding helpers ─────────────────────────────────────────────────────────
// Honest fallback when no usable source is available — used everywhere a claim would otherwise be
// unsourced. This is the load-bearing grounded-or-honest guard: we say we don't have a source rather
// than make something up.
export const NO_SOURCE_REPLY =
  "I don't have a grounded source for that in the library. Try rephrasing, or `!library <topic>` for an article.";

/** Normalize the search backend's return into a flat array of result rows. */
function normalizeResults(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.results)) return raw.results;
  return [];
}

/** Pull a human snippet from a result row, whatever the backend calls it. */
function rowExcerpt(row) {
  const s = row.excerpt ?? row.snippet ?? row.summary ?? row.text ?? '';
  return sanitize(String(s)).slice(0, 320);
}

/** Pull a citation label/URL from a result row, whatever the backend calls it. */
function rowSource(row) {
  return sanitize(String(row.source ?? row.url ?? row.file ?? row.title ?? '')).slice(0, 160);
}

/**
 * Build a chat-friendly GROUNDED answer with source citations from a search result.
 * Never emits a bare unsourced claim: if there are no usable rows (or none with a citable source),
 * returns the honest NO_SOURCE_REPLY. Pure.
 * @param {Array|{results:Array}} searchResult
 * @returns {string}
 */
export function formatAnswer(searchResult) {
  const rows = normalizeResults(searchResult).filter((r) => r && (rowExcerpt(r) || rowSource(r)));
  // A grounded answer requires at least one row that carries a citable source.
  const cited = rows.filter((r) => rowSource(r));
  if (!cited.length) return NO_SOURCE_REPLY;

  const top = cited.slice(0, 3);
  const body = top
    .map((r) => {
      const title = sanitize(String(r.title ?? '')).slice(0, 120);
      const ex = rowExcerpt(r);
      const head = title ? `**${title}** — ` : '';
      return `${head}${ex || '(see source)'}`;
    })
    .join('\n');

  const sources = top.map((r, i) => `[${i + 1}] ${rowSource(r)}`).join('\n');
  return `${body}\n\nSources:\n${sources}`;
}

// ── RateLimiter (per-user token bucket, injectable clock) ─────────────────────
export class RateLimiter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.capacity=5]    max burst
   * @param {number} [opts.windowMs=10000] ms to fully refill from empty
   * @param {() => number} [opts.now]      injectable clock; defaults to Date.now
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

// ── redactForLog (privacy-safe) ───────────────────────────────────────────────
/**
 * Build a safe, single-line log string. Records ONLY the user handle and the command verb — never the
 * raw question/topic body (which can carry PII), and scrubs any WIF-shaped token as defense-in-depth.
 * Pure.
 * @param {{ user?: string, text?: string }} msg
 * @returns {string}
 */
export function redactForLog({ user, text } = {}) {
  const safeUser = sanitize(user).slice(0, 32) || '(anon)';
  const clean = sanitize(text);
  // Only the leading verb (e.g. "!ask") is kept; the rest of the line is omitted entirely.
  let verb = (clean.match(/^!?[a-z]+/i) || [''])[0].toLowerCase();
  verb = verb.replace(/\b[5KL][1-9A-HJ-NP-Za-km-z]{50,}\b/g, '[REDACTED-KEY]');
  if (!verb) verb = '(empty)';
  return `[chatSurface] user=${safeUser} cmd=${JSON.stringify(verb)}`;
}

// ── handleCommand (deterministic routing) ─────────────────────────────────────
/**
 * Route one inbound chat line. Deterministic: a known `!verb` dispatches; everything else nudges.
 * Soft-fails (never throws) at the edge.
 *
 * @param {{ user?: string, text?: string }} msg
 * @param {object} [ctx]
 * @param {() => number} [ctx.now]      clock for rate limiting; defaults to Date.now
 * @param {RateLimiter} [ctx.limiter]   shared limiter; if omitted, no rate limiting is applied
 * @returns {Promise<{ reply: string, kind: 'ask'|'library'|'price'|'help'|'nudge'|'rate-limited'|'error' }>}
 */
export async function handleCommand({ user, text } = {}, ctx = {}) {
  const { limiter } = ctx;

  // Rate-limit first (only when a shared limiter is supplied).
  if (limiter && typeof limiter.allow === 'function') {
    let allowed = true;
    try {
      allowed = limiter.allow(typeof user === 'string' ? user : 'anon');
    } catch {
      allowed = true; // soft-fail: never block a user because the limiter threw.
    }
    if (!allowed) {
      return { reply: 'You are asking a little fast — give it a few seconds and try again.', kind: 'rate-limited' };
    }
  }

  const clean = sanitize(text);
  if (!clean) {
    return { reply: 'Hi! Ask the library with `!ask <question>`, or type `!help`.', kind: 'nudge' };
  }

  const m = clean.match(/^!([a-z]+)\s*([\s\S]*)$/i);
  if (!m) {
    return {
      reply: "I didn't catch a command. Try `!ask <question>`, `!library <topic>`, or `!help`.",
      kind: 'nudge',
    };
  }
  const verb = m[1].toLowerCase();
  const rest = sanitize(m[2]);

  try {
    switch (verb) {
      case 'help':
        return { reply: helpText(), kind: 'help' };

      case 'ask': {
        if (!rest) return { reply: 'Usage: `!ask <question>` — e.g. `!ask what is oilahuasca`.', kind: 'ask' };
        const results = await _backends.search(rest, { max: 5 });
        return { reply: formatAnswer(results), kind: 'ask' };
      }

      case 'library':
      case 'wiki': {
        if (!rest) return { reply: 'Usage: `!library <topic>` — e.g. `!library Phoenix Protocol`.', kind: 'library' };
        const results = await _backends.search(rest, { max: 3 });
        const rows = normalizeResults(results).filter((r) => r && rowSource(r));
        if (!rows.length) {
          return {
            reply: `I don't have a library article on "${rest}" yet. Try a broader topic, or \`!ask\` a question.`,
            kind: 'library',
          };
        }
        const top = rows[0];
        const title = sanitize(String(top.title ?? rest)).slice(0, 120);
        const ex = rowExcerpt(top) || '(summary unavailable)';
        const link = rowSource(top);
        return { reply: `**${title}**\n${ex}\n\nSource: ${link}`, kind: 'library' };
      }

      case 'price': {
        if (!rest) return { reply: 'Usage: `!price <symbol>` — e.g. `!price VKBT`.', kind: 'price' };
        const res = await _backends.liveData(`price ${rest}`);
        const reply = res && typeof res.text === 'string' && res.text
          ? res.text
          : 'I could not fetch that price right now.';
        return { reply, kind: 'price' };
      }

      default:
        return {
          reply: `I don't know \`!${verb}\`. Type \`!help\` to see what I can do.`,
          kind: 'nudge',
        };
    }
  } catch {
    // Soft-fail: any backend error becomes a calm, sourced-honest message — never a throw, never a fabrication.
    return { reply: NO_SOURCE_REPLY, kind: 'error' };
  }
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────
// Only runs when invoked directly. Routes one argv line and prints the result. No backends are wired
// here (inert defaults), so without injection it demonstrates the honest no-source / help paths only.
if (process.argv[1] && process.argv[1].endsWith('chatSurface.js')) {
  const line = process.argv.slice(2).join(' ');
  const out = await handleCommand({ user: 'cli', text: line });
  // eslint-disable-next-line no-console
  console.log(`[${out.kind}] ${out.reply}`);
}
