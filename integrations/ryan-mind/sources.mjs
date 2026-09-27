// ryan-mind/sources.mjs — the source registry + one reader per source kind.
//
// Source kinds and the order the mind learns them in (stage):
//   0 writing  — the operator's papers written first (knowledge/scripture, synthesis, vankush, ...)
//   1 chat     — his Claude.ai export (conversations.json: conversations[].chat_messages[] {sender,text,created_at})
//   2 email    — Gmail-shaped threads/messages, read AFTER the chats and reconciled against them
//   3 thread   — forum threads he assembled (Bitcointalk / Steemit); third parties post in them
//
// Every reader returns SEGMENTS: {text, context, locator, date?, at?, speaker, own}. `at` is the EXACT
// timestamp (full ISO) when the source carries one (chats, emails, posts) — what he said WHEN is first-class. `own` marks the operator's
// own words — only own segments can supersede an earlier claim. Chat: only sender "human" is own; the
// assistant's words are NOT his and are skipped unless includeAssistant (then own=false).
// Readers are pure over the text they are handed; file I/O is in loadSourceText (CLI side).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha, slug, parseLooseDate, parseTimestamp, normalizeWs } from './util.mjs';
import { REPO_ROOT } from './store.mjs';

export const KINDS = ['writing', 'chat', 'email', 'thread'];
export const STAGE = { writing: 0, chat: 1, email: 2, thread: 3 };
/** Kinds whose own-voice claims may supersede earlier claims on contradiction. */
export const OWN_KINDS = new Set(['writing', 'chat', 'email']);

// ── registry ──────────────────────────────────────────────────────────────────────────────
export function loadRegistry(store) { const r = store.readJson('sources.json', []); return Array.isArray(r) ? r : []; }
export function saveRegistry(store, reg) { return store.writeJson('sources.json', reg); }

function defaultPrivacy(kind, absPath, repoRoot) {
  if (kind !== 'writing') return 'private';
  const rel = path.relative(repoRoot, absPath);
  if (!rel.startsWith('..') && !path.isAbsolute(rel) && rel.startsWith('knowledge' + path.sep)) return 'public';
  return 'private';
}

/**
 * Build a registry record. Deterministic id: kind + slug(title|basename) + hash(path).
 * @returns {{id,kind,date,date_basis,title,path,privacy,stage,author,content_hash,bytes,added}}
 */
export function makeSourceRecord({ path: p, kind, date, date_basis, title, privacy, author, text }, { repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const abs = path.resolve(p);
  const k = KINDS.includes(kind) ? kind : 'writing';
  const t = title || path.basename(abs).replace(/\.[^.]+$/, '');
  return {
    id: `${k}:${slug(path.basename(abs).replace(/\.[^.]+$/, ''), 40)}:${sha(abs, 6)}`,
    kind: k,
    date: date || null,
    date_basis: date ? (date_basis || 'explicit') : 'unknown',
    title: t,
    path: path.relative(repoRoot, abs).startsWith('..') ? abs : path.relative(repoRoot, abs),
    privacy: privacy === 'public' || privacy === 'private' ? privacy : defaultPrivacy(k, abs, repoRoot),
    stage: STAGE[k],
    author: author || null,
    content_hash: text != null ? sha(text, 16) : null,
    bytes: text != null ? Buffer.byteLength(text) : null,
    added: now.toISOString(),
  };
}

// ── dating a writing ──────────────────────────────────────────────────────────────────────
const DATE_KEYS = ['date', 'compiled', 'created', 'written', 'received_at', 'period'];

/**
 * Work out a writing's date and say HOW we know it (date_basis). Order: JSON metadata → a "Date:" line
 * in a markdown head → a sibling _index.json entry → git first-add date (injectable) → file mtime.
 */
export function dateWriting(absPath, text, { gitDate, statMtime } = {}) {
  let jsonMeta = null;
  if (/\.json$/i.test(absPath)) {
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        for (const k of DATE_KEYS) { const d = parseLooseDate(j[k]); if (d) return { date: d, date_basis: `metadata:${k}`, title: j.title, author: typeof j.author === 'string' ? j.author : null }; }
        jsonMeta = { title: typeof j.title === 'string' ? j.title : null, author: typeof j.author === 'string' ? j.author : null };
      }
    } catch { /* fall through */ }
  }
  let title = jsonMeta?.title || null;
  if (/\.md$/i.test(absPath)) {
    const head = String(text).split('\n').slice(0, 40);
    const h1 = head.find((l) => /^#\s+/.test(l)); if (h1) title = h1.replace(/^#\s+/, '').replace(/\*+/g, '').trim();
    for (const l of head) { const m = l.match(/^\W*(?:date|written|compiled)\W*:\s*(.+)$/i); const d = m && parseLooseDate(m[1]); if (d) return { date: d, date_basis: 'metadata:date-line', title }; }
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(path.dirname(absPath), '_index.json'), 'utf8'));
      const doc = (idx.documents || []).find((d) => d.file_md === path.basename(absPath));
      const d = doc && parseLooseDate(doc.date || doc.received_at);
      if (d) return { date: d, date_basis: doc.date ? 'index:date' : 'index:received_at', title: title || doc.title };
    } catch { /* no index */ }
  }
  const author = jsonMeta?.author || null;
  const g = typeof gitDate === 'function' ? parseLooseDate(gitDate(absPath)) : null;
  if (g) return { date: g, date_basis: 'git:first-add', title, author };
  const m = typeof statMtime === 'function' ? statMtime(absPath) : null;
  const md = parseLooseDate(m);
  return md ? { date: md, date_basis: 'mtime', title, author } : { date: null, title, author };
}

/** git first-add date of a path (CLI helper; returns '' when git is unavailable). */
export function gitFirstAdd(absPath) {
  try {
    const out = execFileSync('git', ['log', '--diff-filter=A', '--follow', '--format=%aI', '--', absPath], { cwd: path.dirname(absPath), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = out.trim().split('\n').filter(Boolean); return lines[lines.length - 1] || '';
  } catch { return ''; }
}

// ── readers ───────────────────────────────────────────────────────────────────────────────
const SKIP_JSON_KEYS = new Set(['source_file', 'file_md', 'file_json', 'keywords', 'key_themes', 'url', 'urls', 'id', 'ids', 'canonical',
  'companion_to', 'supersedes_summary_in', 'document_type', 'table_of_contents', 'word_count', 'author_titles', 'received_at', 'date', 'compiled', 'created', 'version', 'connects_to', 'hierophant_xref', 'feeds']);

function humanKey(k) { return String(k).replace(/^(part|section)_(\d+)_/i, '$1 $2: ').replace(/_/g, ' ').trim(); }

/** Walk a JSON document into text segments with a readable key-path context. */
export function readWritingJson(text) {
  let j; try { j = JSON.parse(text); } catch { return { ok: false, reason: 'bad json', segments: [] }; }
  const segments = [];
  const walk = (v, trail, loc) => {
    if (typeof v === 'string') {
      const s = v.trim(); if (s.length >= 30) segments.push({ text: s, context: trail.map(humanKey).join(' › '), locator: loc || '$', speaker: 'operator', own: true });
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, trail, `${loc}[${i}]`)); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) { if (SKIP_JSON_KEYS.has(k)) continue; walk(x, [...trail, k], loc ? `${loc}.${k}` : k); }
    }
  };
  walk(j, [], '');
  return { ok: true, title: j?.title || null, segments };
}

/** Markdown → paragraph segments; context is the heading trail. */
export function readWritingMarkdown(text) {
  const segments = []; const trail = [];
  let buf = []; let startLine = 0;
  const flush = (lineNo) => {
    const body = buf.join('\n').trim(); buf = [];
    if (body.length >= 30) segments.push({ text: body, context: trail.filter(Boolean).join(' › '), locator: `L${startLine + 1}`, speaker: 'operator', own: true });
    startLine = lineNo;
  };
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(i + 1); trail.length = h[1].length - 1; trail[h[1].length - 1] = h[2].replace(/\*+/g, '').trim(); return; }
    if (!line.trim()) { flush(i + 1); return; }
    if (!buf.length) startLine = i;
    buf.push(line);
  });
  flush(lines.length);
  return { ok: true, segments };
}

function messageText(m) {
  if (typeof m?.text === 'string' && m.text.trim()) return m.text;
  if (Array.isArray(m?.content)) return m.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).filter(Boolean).join('\n');
  return '';
}

/**
 * Claude.ai export: conversations.json = [ {uuid, name, created_at, chat_messages:[{uuid, sender, text, created_at, content?}]} ]
 * (also accepts {conversations:[...]}). Operator = sender "human".
 */
export function readChat(text, { includeAssistant = false } = {}) {
  let j; try { j = JSON.parse(text); } catch { return { ok: false, reason: 'bad json', segments: [] }; }
  const convs = Array.isArray(j) ? j : Array.isArray(j?.conversations) ? j.conversations : null;
  if (!convs) return { ok: false, reason: 'no conversations[]', segments: [] };
  const segments = [];
  convs.forEach((c, ci) => {
    (c?.chat_messages || []).forEach((m, mi) => {
      const human = m?.sender === 'human';
      if (!human && !includeAssistant) return;
      const t = messageText(m).trim(); if (!t) return;
      segments.push({
        text: t, context: c?.name || `conversation ${ci + 1}`, locator: `${c?.uuid || ci}#${m?.uuid || mi}`,
        date: parseLooseDate(m?.created_at || c?.created_at), at: parseTimestamp(m?.created_at || c?.created_at), speaker: human ? 'operator' : 'assistant', own: human,
      });
    });
  });
  return { ok: true, segments, conversations: convs.length };
}

/** Drop quoted reply text and signatures so an email segment is only the writer's own words. */
export function stripQuoted(body) {
  const out = [];
  for (const line of String(body ?? '').replace(/\r/g, '').split('\n')) {
    if (/^\s*>/.test(line)) continue;
    if (/^On .{4,200}wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)/i.test(line.trim())) break;
    if (/^--\s*$/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

function addrOf(from) { const m = String(from ?? '').match(/<([^>]+)>/); return (m ? m[1] : String(from ?? '')).trim().toLowerCase(); }

/**
 * Gmail-shaped input: {threads:[{id, subject?, messages:[{id, date|internalDate, subject, from, body|text|snippet}]}]}
 * or {messages:[...]} or a bare array of messages. own = from-address is in config.self_emails.
 */
export function readEmail(text, { selfEmails = [] } = {}) {
  let j; try { j = JSON.parse(text); } catch { return { ok: false, reason: 'bad json', segments: [] }; }
  const self = new Set(selfEmails.map((e) => String(e).toLowerCase()));
  const threads = Array.isArray(j?.threads) ? j.threads
    : Array.isArray(j?.messages) ? [{ id: 'messages', messages: j.messages }]
      : Array.isArray(j) ? [{ id: 'messages', messages: j }] : null;
  if (!threads) return { ok: false, reason: 'no threads[] / messages[]', segments: [] };
  const segments = [];
  threads.forEach((t, ti) => {
    (t?.messages || []).forEach((m, mi) => {
      const body = stripQuoted(m?.body ?? m?.text ?? m?.snippet ?? '');
      if (!body) return;
      const from = addrOf(m?.from);
      const own = self.has(from);
      segments.push({
        text: body, context: m?.subject || t?.subject || '(no subject)', locator: `${t?.id ?? ti}#${m?.id ?? mi}`,
        date: parseLooseDate(m?.date ?? (m?.internalDate != null ? Number(m.internalDate) : null)),
        at: parseTimestamp(m?.date ?? (m?.internalDate != null ? Number(m.internalDate) : null)), speaker: own ? 'operator' : from || 'unknown', own,
      });
    });
  });
  return { ok: true, segments, threads: threads.length };
}

/** Forum thread: {title, url, posts:[{author, date, body}]}. own = author in config.self_handles. */
export function readThread(text, { selfHandles = [] } = {}) {
  let j; try { j = JSON.parse(text); } catch { return { ok: false, reason: 'bad json', segments: [] }; }
  const self = new Set(selfHandles.map((h) => String(h).toLowerCase().replace(/^@/, '')));
  const posts = Array.isArray(j?.posts) ? j.posts : Array.isArray(j) ? j : null;
  if (!posts) return { ok: false, reason: 'no posts[]', segments: [] };
  const segments = [];
  posts.forEach((p, i) => {
    const t = stripQuoted(p?.body ?? p?.text ?? ''); if (!t) return;
    const who = String(p?.author ?? '').toLowerCase().replace(/^@/, '');
    segments.push({ text: t, context: j?.title || '(thread)', locator: `post${i}`, date: parseLooseDate(p?.date), at: parseTimestamp(p?.date), speaker: self.has(who) ? 'operator' : who || 'unknown', own: self.has(who) });
  });
  return { ok: true, title: j?.title || null, segments };
}

/** Dispatch by kind. `config` is the data-dir config.json ({self_emails, self_handles}). */
export function readSource(kind, filePath, text, config = {}, opts = {}) {
  if (kind === 'chat') return readChat(text, opts);
  if (kind === 'email') return readEmail(text, { selfEmails: config.self_emails || [] });
  if (kind === 'thread') return readThread(text, { selfHandles: config.self_handles || [] });
  if (/\.json$/i.test(filePath)) return readWritingJson(text);
  return readWritingMarkdown(text);
}

/** Read a file's text; a chat .zip yields its conversations.json (via `unzip -p`). null on failure. */
export function loadSourceText(filePath) {
  try {
    if (/\.zip$/i.test(filePath)) return execFileSync('unzip', ['-p', filePath, 'conversations.json'], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
    return fs.readFileSync(filePath, 'utf8');
  } catch { return null; }
}

export { normalizeWs };
