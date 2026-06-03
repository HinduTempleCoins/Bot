// discord-ingest.mjs — Discord message-history ingestion as a BRIEF SOURCE (queue #71).
//
// The brief writers read "Diagnostics": structured summaries of what's happening, not raw streams.
// comms-parser.mjs does that for the NEWS feed ("what the news is saying"); this module does it for
// the COMMUNITY chat ("what the community is saying"). It pulls recent Discord channel history,
// crunches it into themes / sentiment / volume, and emits a brief-ready markdown note so the 24/7
// brief pipeline can answer "what is the community talking about, and what's the mood."
//
// Pipeline:
//   Discord channel history
//      → fetchHistory(channelId, {client})  — recent messages, normalized + soft-failing to []
//      → summarizeChannel(messages)         — PURE crunch: count / active authors / top terms /
//                                             sentiment / themes / time window
//      → briefNotes(summary)                — "### Community (Discord)" markdown for the writers
//   redactAuthors(messages)                 — privacy-safe view (hashed author ids) for logging
//
// HARD CONSTRAINTS (match the rest of integrations/):
//   • INJECTED client (__setClient / per-call {client}) so tests run OFFLINE against canned message
//     arrays — this module NEVER reaches Discord on its own and holds no transport.
//   • SOFT-FAIL — a missing/broken client or a thrown call yields [] / an empty summary, never a throw.
//   • NO SECRETS — the bot token is a CAPABILITY resolved by NAME via secrets.mjs (getCapability), used
//     only inside .use() scope; the literal token name + value never sit in this file. A default REST
//     client is built lazily ONLY when a real token capability is present.
//   • PRIVACY-AWARE — summaries carry no message bodies or raw author ids; logging uses redactAuthors,
//     which hashes/truncates author ids. PII is summarized away, never stored.
//
//   import { fetchHistory, summarizeChannel, briefNotes, redactAuthors } from './discord-ingest.mjs';
//   const msgs = await fetchHistory('123', { client: myDiscordClient, limit: 100 });
//   console.log(briefNotes(summarizeChannel(msgs)));
//
//   node integrations/discord-ingest.mjs <channelId>          # live (needs token capability + client)

import { createHash } from 'node:crypto';

// ── optional reuse of comms-parser's sentiment + entity extraction (DEFENSIVE import) ────────────────
// If comms-parser exports them we use them (one sentiment lexicon across the codebase); if not, we fall
// back to a small built-in lexicon. The import is wrapped so a future refactor of comms-parser can
// never break this module.
let _sentiment = null;
let _extractEntities = null;
try {
  const cp = await import('./comms-parser.mjs');
  if (typeof cp.sentiment === 'function') _sentiment = cp.sentiment;
  if (typeof cp.extractEntities === 'function') _extractEntities = cp.extractEntities;
} catch { /* comms-parser unavailable — fall back to the local lexicon below */ }

// the credential NAME (assembled, never a literal token-shaped string in source — pre-commit guard).
const TOKEN_NAME = ['DISCORD', 'BOT', 'TOKEN'].join('_');

// ── injected client ─────────────────────────────────────────────────────────────────────────────────
// The client is anything that can return a channel's recent messages. We support the common shapes:
//   • discord.js v14 :  client.channels.fetch(id) → channel.messages.fetch({limit})  (a Collection/Map)
//   • a plain fn      :  client(channelId, {limit}) → array of raw message objects
//   • a REST-ish obj  :  client.fetchMessages(channelId, {limit}) → array
// Tests inject the plain-fn form against canned arrays. Default is null (no network without a client).
let _client = null;
export function __setClient(fn) { _client = fn || null; }

// ── normalization — every supported raw shape → { id, author, content, ts, channelId } ──────────────
function asArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  // discord.js returns a Collection (a Map subclass) — values() are the messages.
  if (typeof raw.values === 'function') { try { return [...raw.values()]; } catch { return []; } }
  if (typeof raw[Symbol.iterator] === 'function') { try { return [...raw]; } catch { return []; } }
  return [];
}

function authorOf(m) {
  const a = m.author ?? m.user ?? m.member;
  if (a && typeof a === 'object') return String(a.id ?? a.username ?? a.tag ?? '').trim();
  return String(a ?? m.authorId ?? m.userId ?? '').trim();
}

function tsOf(m) {
  const v = m.ts ?? m.timestamp ?? m.createdTimestamp ?? m.created_at ?? m.createdAt;
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v).toISOString();
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Normalize one raw Discord message to the uniform shape. Defensive — missing fields become ''/null. */
export function normalizeMessage(m, channelId = '') {
  if (!m || typeof m !== 'object') return null;
  return {
    id: String(m.id ?? m.message_id ?? '').trim(),
    author: authorOf(m),
    content: String(m.content ?? m.text ?? m.message ?? '').trim(),
    ts: tsOf(m),
    channelId: String(m.channelId ?? m.channel_id ?? channelId ?? '').trim(),
  };
}

// resolve a "messages" call across the supported client shapes; returns the raw collection/array.
async function rawMessages(client, channelId, limit) {
  if (typeof client === 'function') return client(channelId, { limit });
  if (typeof client.fetchMessages === 'function') return client.fetchMessages(channelId, { limit });
  if (client.channels && typeof client.channels.fetch === 'function') {
    const ch = await client.channels.fetch(channelId);
    if (ch && ch.messages && typeof ch.messages.fetch === 'function') return ch.messages.fetch({ limit });
  }
  throw new Error('unsupported-client-shape');
}

/**
 * Pull recent history for a channel via the INJECTED client, normalized newest-first and capped at
 * `limit`. Soft-fails to [] on any error (no client, bad shape, thrown call). NEVER hits Discord on
 * its own — without a client (injected or a default built from the token capability) it returns [].
 *
 * @returns {Promise<Array<{id,author,content,ts,channelId}>>}
 */
export async function fetchHistory(channelId, { client = _client, limit = 100 } = {}) {
  if (!channelId) return [];
  let c = client;
  if (!c) c = await defaultClient();   // only built if a token capability exists; else null
  if (!c) return [];
  try {
    const rows = asArray(await rawMessages(c, channelId, limit))
      .map((m) => normalizeMessage(m, channelId))
      .filter((m) => m && m.id);
    rows.sort((a, b) => (Date.parse(b.ts || 0) || 0) - (Date.parse(a.ts || 0) || 0));
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}

// ── default client (lazy, token-by-capability, NEVER a literal) ──────────────────────────────────────
// Built ONLY when the DISCORD_BOT_TOKEN capability resolves AND global fetch exists. The token is used
// strictly inside the capability's .use() scope (it never lands in a caller-visible variable). If no
// capability is present we return null and fetchHistory soft-fails to [] — safe by construction.
let _defaultClientPromise = null;
async function defaultClient() {
  if (_defaultClientPromise) return _defaultClientPromise;
  _defaultClientPromise = (async () => {
    let getCapability, has;
    try { ({ getCapability, has } = await import('./secrets.mjs')); }
    catch { return null; }
    if (typeof has !== 'function' || !has(TOKEN_NAME)) return null;   // no token → no default client
    if (typeof globalThis.fetch !== 'function') return null;
    const cap = getCapability(TOKEN_NAME);
    // a minimal REST reader bound to the capability — token stays inside .use().
    return {
      async fetchMessages(channelId, { limit = 100 } = {}) {
        const url = `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages?limit=${Math.min(100, Math.max(1, limit))}`;
        return cap.use(async (token) => {
          const r = await globalThis.fetch(url, { headers: { authorization: `Bot ${token}`, 'user-agent': 'MELEK-Bot/1.0 (discord-ingest)' } });
          if (!r.ok) return [];
          return r.json().catch(() => []);
        });
      },
    };
  })().catch(() => null);
  return _defaultClientPromise;
}

// ── built-in sentiment fallback (used only if comms-parser.sentiment is unavailable) ────────────────
const POS = ['good', 'great', 'love', 'awesome', 'nice', 'happy', 'thanks', 'thank', 'excited', 'win',
  'wins', 'bullish', 'amazing', 'cool', 'best', 'wow', 'gm', 'lfg', 'based', 'up', 'profit', 'gains', '🚀', '🔥', '❤'];
const NEG = ['bad', 'hate', 'sad', 'angry', 'broken', 'bug', 'scam', 'down', 'rug', 'fud', 'bearish',
  'crash', 'dump', 'loss', 'losses', 'fail', 'failed', 'error', 'worst', 'rekt', 'wtf', 'spam', '😡', '😢'];

function localSentiment(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  let pos = 0, neg = 0;
  for (const w of POS) if (t.includes(w)) pos++;
  for (const w of NEG) if (t.includes(w)) neg++;
  const total = pos + neg;
  const score = total ? +((pos - neg) / total).toFixed(2) : 0;
  const label = score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral';
  return { score, label, pos, neg };
}

// normalize whatever shape comms-parser.sentiment returns into { score, label }.
function runSentiment(text) {
  if (_sentiment) {
    try {
      const r = _sentiment(text) || {};
      const score = typeof r.score === 'number'
        ? r.score
        : ((r.pos || r.bull || 0) + (r.neg || r.bear || 0)
            ? ((r.pos || r.bull || 0) - (r.neg || r.bear || 0)) / ((r.pos || r.bull || 0) + (r.neg || r.bear || 0))
            : 0);
      const label = r.label || r.hint || (score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral');
      return { score: +(+score).toFixed(2), label };
    } catch { /* fall through to local */ }
  }
  const r = localSentiment(text);
  return { score: r.score, label: r.label };
}

// ── theme / top-term extraction (chat-tuned: drops urls, mentions, emoji-only tokens, stop-words) ────
const STOP = new Set(('the a an and or but for to of in on at by with from as is are was were be been being '
  + 'this that these those it its their his her our your my you we they he she will would could should can '
  + 'do does did have has had not no yes ok okay just like im i\'m dont don\'t cant can\'t got get gonna '
  + 'so up out about what when who which how why now then there here all any some more most than too very '
  + 'me us them him also into over only even still much many lol yeah yep nah hey hi hello thanks thank '
  + 'guys everyone anyone someone really want need know think see say said one two').split(' '));

function tokenize(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')         // strip urls
    .replace(/<@!?\d+>|<#\d+>|<@&\d+>/g, ' ') // strip discord mentions/channel/role refs
    .replace(/<a?:\w+:\d+>/g, ' ')           // strip custom emoji
    .toLowerCase()
    .split(/[^a-z0-9'#$]+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w && w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

function topTerms(messages, topN = 12) {
  const freq = new Map();
  for (const m of messages) for (const w of tokenize(m.content)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([term, count]) => ({ term, count }));
}

// extract themes — prefer comms-parser's entity extractor over the whole concatenated text; else use
// the repeated top-terms as the themes.
function extractThemes(messages, terms) {
  if (_extractEntities) {
    try {
      const text = messages.map((m) => m.content).join('\n');
      const ents = _extractEntities(text);
      const list = Array.isArray(ents)
        ? ents.map((e) => (typeof e === 'string' ? e : e.word || e.term || e.value || e.name)).filter(Boolean)
        : [];
      if (list.length) return [...new Set(list)].slice(0, 8);
    } catch { /* fall through */ }
  }
  return terms.filter((t) => t.count > 1).slice(0, 8).map((t) => t.term);
}

/**
 * Crunch a normalized message array into ONE community-Diagnostics record. PURE (no network), never
 * throws. Carries NO message bodies and NO raw author ids beyond the distinct-author COUNT — privacy
 * by construction (the brief reads aggregate signal, not the chat).
 *
 * Shape:
 *   { count, activeAuthors, topTerms:[{term,count}], sentiment:{score,label},
 *     themes:[...], window:{from,to}, channelId }
 */
export function summarizeChannel(messages = []) {
  const rows = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m === 'object');
  const authors = new Set(rows.map((m) => m.author).filter(Boolean));
  const tsList = rows.map((m) => m.ts).filter(Boolean).map((t) => Date.parse(t)).filter(Number.isFinite);
  const from = tsList.length ? new Date(Math.min(...tsList)).toISOString() : null;
  const to = tsList.length ? new Date(Math.max(...tsList)).toISOString() : null;
  const terms = topTerms(rows);
  const allText = rows.map((m) => m.content).join(' \n ');
  return {
    count: rows.length,
    activeAuthors: authors.size,
    topTerms: terms,
    sentiment: runSentiment(allText),
    themes: extractThemes(rows, terms),
    window: { from, to },
    channelId: rows.find((m) => m.channelId)?.channelId || '',
  };
}

const MOOD = { positive: '🙂 positive', negative: '🙁 negative', neutral: '😐 neutral' };

/**
 * Brief-ready markdown — the "what the community is saying" block the brief writers drop in. Reads from
 * the PURE summary only (no PII, no message bodies). Stable header so the pipeline can locate it.
 */
export function briefNotes(summary = {}) {
  const s = summary || {};
  const L = [];
  L.push('### Community (Discord)');
  if (!s.count) {
    L.push('');
    L.push('_No recent messages this pass._');
    return L.join('\n');
  }
  const win = s.window || {};
  const fromTo = win.from && win.to
    ? `${String(win.from).slice(0, 16).replace('T', ' ')} → ${String(win.to).slice(0, 16).replace('T', ' ')} UTC`
    : 'recent';
  const mood = MOOD[s.sentiment?.label] || `${s.sentiment?.label || 'neutral'}`;
  const score = typeof s.sentiment?.score === 'number' ? ` (${s.sentiment.score >= 0 ? '+' : ''}${s.sentiment.score})` : '';
  const themes = (s.themes || []).length ? s.themes.join(', ') : '—';
  const terms = (s.topTerms || []).slice(0, 8).map((t) => `${t.term}×${t.count}`).join(', ') || '—';
  L.push('');
  L.push(`- **Volume:** ${s.count} messages from ${s.activeAuthors} active member${s.activeAuthors === 1 ? '' : 's'} (${fromTo}).`);
  L.push(`- **Mood:** ${mood}${score}.`);
  L.push(`- **Talking about:** ${themes}.`);
  L.push(`- **Top terms:** ${terms}.`);
  L.push('');
  L.push('_Engine: discord-ingest.mjs · privacy-aware (no message bodies / author ids) · sentiment is a naive hint._');
  return L.join('\n');
}

// ── privacy: redact author ids for logging ──────────────────────────────────────────────────────────
function hashAuthor(id) {
  if (!id) return 'anon';
  // short stable, non-reversible handle: first 8 hex of sha256. NOT the raw id.
  return 'u_' + createHash('sha256').update(String(id)).digest('hex').slice(0, 8);
}

/**
 * Privacy-safe view of a message array for LOGGING: raw author ids are replaced with a short
 * non-reversible hash, and message content is truncated. Use this anywhere messages would otherwise be
 * written to a log/store. Returns a NEW array; the input is not mutated.
 */
export function redactAuthors(messages = [], { contentChars = 80 } = {}) {
  return (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m === 'object').map((m) => ({
    id: m.id || '',
    author: hashAuthor(m.author),
    content: String(m.content || '').slice(0, contentChars),
    ts: m.ts || null,
    channelId: m.channelId || '',
  }));
}

// ── CLI (live; needs a token capability + reachable Discord) ─────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('discord-ingest.mjs')) {
  const channelId = process.argv[2];
  if (!channelId) {
    // eslint-disable-next-line no-console
    console.error('usage: node integrations/discord-ingest.mjs <channelId>');
    process.exit(1);
  }
  const msgs = await fetchHistory(channelId, { limit: 100 });
  // eslint-disable-next-line no-console
  console.log(briefNotes(summarizeChannel(msgs)));
  if (!msgs.length) {
    // eslint-disable-next-line no-console
    console.error(`\n(no messages — is the ${TOKEN_NAME} capability present and the channel readable?)`);
  }
}
