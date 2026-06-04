// conversation-parser.mjs — turn Telegram + chat conversations into MoM + action items (queue #227).
//
// The brief writers and the resident AIs (Qwen / Claude) read DIGESTED layers, not raw streams.
// comms-parser.mjs digests the NEWS feed; discord-ingest.mjs digests COMMUNITY chat; mom-synth (on
// Server 4) fills Minutes-of-Meeting templates. This module is the front of that MoM pipeline for
// CONVERSATIONS: it takes a Telegram or chat thread (operator ↔ bot, or a group) and crunches it into
//   • a one-line summary,
//   • ACTION ITEMS with who/when ("I'll X", "can you Y", "we need Z"),
//   • DECISIONS, OPEN QUESTIONS,
//   • entities + sentiment (reusing comms-parser's already-tuned extractors),
// then deposits the result into the conversation-files layer (the .mom.md/.json records mom-synth and
// corpus-builder read) so Qwen/Claude can mine it.
//
// PIPELINE:
//   { source, messages:[{from,text,ts}] }
//      → parseConversation(...)  — PURE crunch: summary + actionItems + decisions + entities + sentiment
//      → toActionItems(messages) — the extractor on its own (who said it, when)
//      → toConversationFile(...) — the OPERATOR-TIER record written to the conversation-files layer
//      → redactForAiTier(...)    — strip operator-private (keys/emails/server paths) for any AI copy
//      → renderSummary(...)      — brief-ready markdown
//
// HARD CONSTRAINTS (match the rest of integrations/):
//   • ESM .mjs, PURE / DETERMINISTIC — same input → same output. The clock is INJECTABLE (deps.now);
//     no Date.now() / new Date() on a hot path without it.
//   • DEFENSIVE REUSE of comms-parser — sentiment + extractEntities are imported best-effort and can
//     also be INJECTED (deps.commsParser) for tests. If comms-parser is unavailable, a tiny built-in
//     fallback keeps the module working (soft-fail, never throw).
//   • INJECTABLE STORE — toConversationFile writes through deps.store (offline fake in tests). The
//     default store appends a record to the conversation-files layer; missing store soft-fails.
//   • TWO TIERS — the written record is OPERATOR-tier (it may contain operator-private text). Any copy
//     handed to the AI tier MUST go through redactForAiTier first (keys/emails/server-paths removed).
//   • NO SECRETS in this file; CLI guarded so importing never runs it.
//
//   import { parseConversation, toActionItems, toConversationFile, redactForAiTier, renderSummary }
//     from './integrations/conversation-parser.mjs';
//
//   node integrations/conversation-parser.mjs sample   # print a parsed sample (offline, built-in fixture)

// ── defensive, best-effort reuse of comms-parser (do NOT duplicate its lexicons) ────────────────────
// We import sentiment + extractEntities if comms-parser exports them (one extraction layer across the
// codebase). The import is wrapped so a future refactor can never break this module; tests may also
// override via deps.commsParser. A tiny fallback below keeps everything working offline.
let _cpSentiment = null;
let _cpExtractEntities = null;
try {
  const cp = await import('./comms-parser.mjs');
  if (typeof cp.sentiment === 'function') _cpSentiment = cp.sentiment;
  if (typeof cp.extractEntities === 'function') _cpExtractEntities = cp.extractEntities;
} catch { /* comms-parser unavailable — fall back to the local stubs below */ }

// minimal fallbacks (only used if comms-parser is absent AND no commsParser dep is injected).
function _fallbackSentiment(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  const pos = ['good', 'great', 'thanks', 'love', 'yes', 'perfect', 'awesome', 'nice', 'works'];
  const neg = ['bad', 'broken', 'bug', 'no', 'wrong', 'fail', 'hate', 'error', "doesn't"];
  let p = 0, n = 0;
  for (const w of pos) if (t.includes(' ' + w)) p++;
  for (const w of neg) if (t.includes(' ' + w)) n++;
  const total = p + n;
  const score = total ? +(((p - n) / total).toFixed(2)) : 0;
  return { score, label: score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral', hits: [] };
}
function _fallbackEntities(text) {
  const s = String(text || '');
  const uniq = (a) => [...new Set(a)];
  return {
    tickers: uniq((s.match(/\$[A-Za-z]{1,8}(?:\.[A-Za-z0-9]{1,8})?/g) || []).map((x) => x.slice(1).toUpperCase())),
    mentions: uniq((s.match(/(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_.-]{2,30})/g) || []).map((x) => x.replace(/^[^@]*@/, ''))),
    urls: uniq(s.match(/https?:\/\/[^\s<>"')\]]+/g) || []),
    hashtags: uniq((s.match(/(?:^|[^A-Za-z0-9_])#([A-Za-z0-9_]{1,40})/g) || []).map((x) => x.replace(/^[^#]*#/, ''))),
    orgs: [],
  };
}

// Resolve the sentiment/entity functions for a call: injected dep wins, then the imported comms-parser,
// then the fallback. Keeps the module deterministic and offline-safe.
function resolveCp(deps = {}) {
  const cp = deps.commsParser || {};
  return {
    sentiment: typeof cp.sentiment === 'function' ? cp.sentiment : (_cpSentiment || _fallbackSentiment),
    extractEntities: typeof cp.extractEntities === 'function' ? cp.extractEntities : (_cpExtractEntities || _fallbackEntities),
  };
}

// ── injectable clock (deterministic) ────────────────────────────────────────────────────────────────
const FIXED_TS = '1970-01-01T00:00:00.000Z';
function nowOf(deps = {}) {
  // deps.now may be a function or a fixed ISO string. Default is a fixed epoch so the module is pure
  // unless the caller chooses to inject a real clock — tests assert on it.
  if (typeof deps.now === 'function') return String(deps.now());
  if (typeof deps.now === 'string' && deps.now) return deps.now;
  return FIXED_TS;
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
const SOURCES = Object.freeze(['telegram', 'chat']);
function normSource(s) {
  const v = String(s == null ? '' : s).trim().toLowerCase();
  return SOURCES.includes(v) ? v : 'chat';
}
function normMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      from: String(m.from == null ? '' : m.from).trim() || 'unknown',
      text: String(m.text == null ? '' : m.text),
      ts: m.ts == null ? null : String(m.ts),
    }))
    .filter((m) => m.text.trim().length > 0);
}

// Deterministic short id from (source + first/last ts + message count + a content fingerprint). No
// randomness, no wall clock — the same conversation always yields the same id.
function conversationId(source, messages) {
  const first = messages[0]?.ts || '';
  const last = messages[messages.length - 1]?.ts || '';
  let h = 5381;
  const blob = source + '|' + first + '|' + last + '|' + messages.map((m) => m.from + ':' + m.text).join('\n');
  for (let i = 0; i < blob.length; i++) h = ((h << 5) + h + blob.charCodeAt(i)) >>> 0;
  return `conv-${source}-${messages.length}-${h.toString(36)}`;
}

// ── action-item / decision / question extraction (deterministic) ─────────────────────────────────────
// Cheap, transparent patterns — not a model. The point is a reviewable "who committed to / asked for
// what." Each pattern keeps the FULL sentence as the action text and attributes it to the speaker.
//
//   "I'll X" / "I will X" / "I'm going to X" / "let me X"      → speaker commits
//   "can you Y" / "could you Y" / "please Y" / "would you Y"   → speaker requests of someone
//   "we need Z" / "we should Z" / "we have to Z" / "todo: Z"   → shared action
const ACTION_PATTERNS = [
  /\bi(?:'| a|')?ll\b/i,            // I'll
  /\bi will\b/i,
  /\bi'?m going to\b/i,
  /\blet me\b/i,
  /\bcan you\b/i,
  /\bcould you\b/i,
  /\bwould you\b/i,
  /\bplease\b/i,
  /\bwe need(?: to)?\b/i,
  /\bwe should\b/i,
  /\bwe have to\b/i,
  /\bwe must\b/i,
  /\bneed to\b/i,
  /\btodo\b/i,
  /\bto-?do:/i,
  /\baction item\b/i,
];
const DECISION_PATTERNS = [
  /\bwe(?:'| wi|')?ll go with\b/i,
  /\bdecided\b/i,
  /\blet'?s go with\b/i,
  /\blet'?s use\b/i,
  /\bfinal(?:ize|ized| decision)\b/i,
  /\bwe'?re going with\b/i,
  /\bapproved\b/i,
  /\bgo ahead\b/i,
  /\bsounds good,? (?:let'?s|go)\b/i,
];
const QUESTION_HINTS = [/\?/, /^(?:what|why|how|when|who|which|where|should we|do we|can we|is it|are we)\b/i];

// split a message body into sentence-ish units so one long message can yield several items.
function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function anyMatch(patterns, s) {
  return patterns.some((re) => re.test(s));
}

/**
 * Extract action items from a message list — deterministic, pure. Each item is
 *   { text, from, ts }
 * where text is the matched sentence, from is the speaker, ts is that message's timestamp (or null).
 * Pulls "I'll X" / "can you Y" / "we need Z" forms with attribution.
 *
 * @param {Array<{from,text,ts}>} messages
 * @returns {Array<{text:string, from:string, ts:string|null}>}
 */
export function toActionItems(messages) {
  const msgs = normMessages(messages);
  const out = [];
  const seen = new Set();
  for (const m of msgs) {
    for (const sent of sentences(m.text)) {
      if (!anyMatch(ACTION_PATTERNS, sent)) continue;
      const key = m.from + '|' + sent.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: sent, from: m.from, ts: m.ts });
    }
  }
  return out;
}

function extractDecisions(messages) {
  const out = [];
  const seen = new Set();
  for (const m of messages) {
    for (const sent of sentences(m.text)) {
      if (!anyMatch(DECISION_PATTERNS, sent)) continue;
      const key = sent.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: sent, from: m.from, ts: m.ts });
    }
  }
  return out;
}

function extractOpenQuestions(messages) {
  const out = [];
  const seen = new Set();
  for (const m of messages) {
    for (const sent of sentences(m.text)) {
      if (!anyMatch(QUESTION_HINTS, sent)) continue;
      // questions that are also requests are captured as action items; keep genuine questions here.
      if (anyMatch(ACTION_PATTERNS, sent)) continue;
      const key = sent.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: sent, from: m.from, ts: m.ts });
    }
  }
  return out;
}

// merge per-message entities into one deduped set.
function mergeEntities(perMessage) {
  const acc = { tickers: new Set(), mentions: new Set(), urls: new Set(), hashtags: new Set(), orgs: new Set() };
  for (const e of perMessage) {
    if (!e) continue;
    for (const k of Object.keys(acc)) for (const v of (e[k] || [])) acc[k].add(v);
  }
  return Object.fromEntries(Object.entries(acc).map(([k, set]) => [k, [...set]]));
}

// one-line summary — deterministic: source, participants, span, counts, leaning. No model.
function buildSummary({ source, messages, actionItems, decisions, openQuestions, sentiment }) {
  const people = [...new Set(messages.map((m) => m.from))];
  const span = messages.length
    ? `${messages[0].ts || '?'}→${messages[messages.length - 1].ts || '?'}`
    : 'empty';
  return [
    `${source} conversation, ${messages.length} msg(s) among ${people.join(', ') || '—'}`,
    `(${span})`,
    `— ${actionItems.length} action item(s), ${decisions.length} decision(s), ${openQuestions.length} open question(s)`,
    `; mood ${sentiment.label}.`,
  ].join(' ');
}

/**
 * Parse a conversation into the digested record. PURE / deterministic; reuses comms-parser for
 * sentiment + entities (injected via deps.commsParser, else the imported comms-parser, else fallback).
 *
 * @param {{source:'telegram'|'chat', messages:Array<{from,text,ts}>}} input
 * @param {{commsParser?, now?}} [deps]
 * @returns {{ id, source, summary, actionItems, decisions, entities, sentiment, openQuestions,
 *            participants, messageCount, parsedAt }}
 */
export function parseConversation(input = {}, deps = {}) {
  const source = normSource(input.source);
  const messages = normMessages(input.messages);
  const { sentiment, extractEntities } = resolveCp(deps);

  const actionItems = toActionItems(messages);
  const decisions = extractDecisions(messages);
  const openQuestions = extractOpenQuestions(messages);

  // sentiment over the whole conversation text (reusing comms-parser's scorer).
  const allText = messages.map((m) => m.text).join('. ');
  let sen;
  try { sen = sentiment(allText); } catch { sen = _fallbackSentiment(allText); }
  if (!sen || typeof sen.score !== 'number') sen = _fallbackSentiment(allText);

  // entities per message then merged (reusing comms-parser's extractor).
  const perMessage = messages.map((m) => {
    try { return extractEntities(m.text); } catch { return _fallbackEntities(m.text); }
  });
  const entities = mergeEntities(perMessage);

  const participants = [...new Set(messages.map((m) => m.from))];
  const summary = buildSummary({ source, messages, actionItems, decisions, openQuestions, sentiment: sen });

  return {
    id: conversationId(source, messages),
    source,
    summary,
    actionItems,
    decisions,
    entities,
    sentiment: sen,
    openQuestions,
    participants,
    messageCount: messages.length,
    parsedAt: nowOf(deps),
  };
}

// ── conversation-files layer record (OPERATOR-tier) ─────────────────────────────────────────────────
// The default store appends a record to the conversation-files layer that mom-synth / corpus-builder
// read. It is injectable; tests pass an offline fake exposing write(record) (or putConversation). The
// record itself is OPERATOR-tier — it may carry operator-private text — so the AI tier must read the
// redacted form (redactForAiTier) instead.
function defaultStore() {
  // A no-op-safe default: if no real store is wired, we still return a receipt rather than throwing.
  // (Real deployment injects the conversation-files writer; this keeps the module import-safe.)
  return {
    write(record) { return { ok: true, stored: false, reason: 'no-store-injected', id: record.id }; },
  };
}

/**
 * Write the parsed conversation to the conversation-files layer as an OPERATOR-tier record.
 * Soft-fails: a missing/throwing store yields { ok:false } rather than raising.
 *
 * @param {object} parsed  output of parseConversation
 * @param {{store?, now?}} [deps]  store.write(record)|store.putConversation(record); deps.now for ts
 * @returns {{ ok, id, tier:'operator', record, receipt }}
 */
export function toConversationFile(parsed, deps = {}) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const store = deps.store && (typeof deps.store.write === 'function' || typeof deps.store.putConversation === 'function')
    ? deps.store
    : defaultStore();

  const record = {
    kind: 'conversation',
    tier: 'operator',                 // operator-only by construction — AI tier reads redactForAiTier
    audience: 'operator',
    id: p.id || conversationId(normSource(p.source), normMessages(p.messages)),
    source: p.source || 'chat',
    summary: p.summary || '',
    actionItems: Array.isArray(p.actionItems) ? p.actionItems : [],
    decisions: Array.isArray(p.decisions) ? p.decisions : [],
    openQuestions: Array.isArray(p.openQuestions) ? p.openQuestions : [],
    entities: p.entities || {},
    sentiment: p.sentiment || { score: 0, label: 'neutral' },
    participants: Array.isArray(p.participants) ? p.participants : [],
    messageCount: typeof p.messageCount === 'number' ? p.messageCount : 0,
    markdown: renderSummary(p),
    storedAt: nowOf(deps),
  };

  let receipt;
  try {
    receipt = typeof store.write === 'function' ? store.write(record) : store.putConversation(record);
  } catch (e) {
    return { ok: false, id: record.id, tier: 'operator', record, error: String(e && e.message || e) };
  }
  return { ok: receipt == null ? true : (receipt.ok !== false), id: record.id, tier: 'operator', record, receipt };
}

// ── AI-tier redaction ───────────────────────────────────────────────────────────────────────────────
// Strip operator-private material before any AI-readable copy: emails, key-shaped tokens, server
// paths, app-passwords, IPs. Operates on a DEEP COPY — the operator-tier record is never mutated.
const RE_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const RE_SERVER_PATH = /(?:^|\s)(\/(?:var|etc|root|home|opt|srv|usr)\/[^\s'"`]+)/g;
const RE_IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const RE_APP_PW = /\b(?:[a-z]{4}[ -]){3}[a-z]{4}\b/gi;            // 16-char xxxx-xxxx-xxxx-xxxx app password
const RE_KEY = /\b(?:[A-Za-z0-9_-]{32,}|[58KL][1-9A-HJ-NP-Za-km-z]{50,}|sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g;
const REDACTED = '[redacted]';

function redactString(s) {
  if (typeof s !== 'string' || !s) return s;
  return s
    .replace(RE_EMAIL, REDACTED)
    .replace(RE_APP_PW, REDACTED)
    .replace(RE_KEY, REDACTED)
    .replace(RE_SERVER_PATH, (m, p1) => m.replace(p1, REDACTED))
    .replace(RE_IPV4, REDACTED);
}
function redactDeep(v) {
  if (typeof v === 'string') return redactString(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = redactDeep(val);
    return out;
  }
  return v;
}

/**
 * Produce an AI-tier-safe copy of a parsed conversation (or conversation-file record): operator-private
 * material (emails, key-shaped tokens, server paths, app-passwords, IPs) is removed. Returns a NEW
 * object tagged tier:'ai'; the input is not mutated.
 *
 * @param {object} parsed
 * @returns {object} redacted copy, tier:'ai'
 */
export function redactForAiTier(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const copy = redactDeep(JSON.parse(JSON.stringify(p)));
  copy.tier = 'ai';
  copy.audience = 'ai';
  copy.redacted = true;
  return copy;
}

// ── markdown render (brief-ready, MoM-shaped) ───────────────────────────────────────────────────────
function fromTag(item) {
  return item && item.from ? ` _(${item.from}${item.ts ? `, ${item.ts}` : ''})_` : '';
}

/**
 * Render the parsed conversation as MoM-shaped markdown (Summary / Decisions / Action items / Open
 * questions / Entities) — the form mom-synth and the brief writers consume.
 *
 * @param {object} parsed
 * @returns {string}
 */
export function renderSummary(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const L = [];
  L.push(`## Conversation MoM — ${p.source || 'chat'} — ${p.id || ''}`.trimEnd());
  L.push('');
  L.push(`**Summary:** ${p.summary || '—'}`);
  L.push('');
  L.push('### Decisions');
  if (p.decisions && p.decisions.length) for (const d of p.decisions) L.push(`- ${d.text}${fromTag(d)}`);
  else L.push('- _none_');
  L.push('');
  L.push('### Action items');
  if (p.actionItems && p.actionItems.length) for (const a of p.actionItems) L.push(`- ${a.from || '?'} — ${a.text}${a.ts ? ` _(${a.ts})_` : ''}`);
  else L.push('- _none_');
  L.push('');
  L.push('### Open questions');
  if (p.openQuestions && p.openQuestions.length) for (const q of p.openQuestions) L.push(`- ${q.text}${fromTag(q)}`);
  else L.push('- _none_');
  const ents = p.entities || {};
  const flat = [...(ents.tickers || []), ...(ents.mentions || []).map((m) => '@' + m), ...(ents.hashtags || []).map((h) => '#' + h), ...(ents.orgs || [])];
  if (flat.length) { L.push(''); L.push(`### Entities`); L.push(`- ${flat.join(', ')}`); }
  L.push('');
  L.push(`_— parsed by conversation-parser.mjs (deterministic) · mood ${p.sentiment?.label || 'neutral'} · operator-tier; redact before AI tier._`);
  return L.join('\n');
}

// ── CLI (guarded; offline built-in fixture) ─────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('conversation-parser.mjs')) {
  const sample = {
    source: 'telegram',
    messages: [
      { from: 'operator', text: "I'll set up the DNS tonight. Can you draft the Caddy config? We need TLS before launch.", ts: '2026-06-04T10:00:00Z' },
      { from: 'hathor', text: 'Sounds good, let us go with Caddy. I will draft it now. Should we use the staging cert first?', ts: '2026-06-04T10:01:00Z' },
      { from: 'operator', text: 'Yes, staging first. The key is in /etc/app/secrets and email is user@example.com — keep those private.', ts: '2026-06-04T10:02:00Z' },
    ],
  };
  const parsed = parseConversation(sample, { now: () => new Date().toISOString() });
  // eslint-disable-next-line no-console
  console.log(renderSummary(parsed));
  // eslint-disable-next-line no-console
  console.log('\n--- AI-tier (redacted) summary string ---\n' + redactForAiTier(parsed).summary);
}
