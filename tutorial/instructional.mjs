/**
 * tutorial/instructional.mjs — the LESSON REGISTRY for the Hathor Instructional Series.
 *
 * The series is a set of markdown files (00_INDEX.md + NN_slug.md), each with YAML front-matter:
 *
 *   lesson: 3                         # order in the series (falls back to the NN_ filename prefix)
 *   id: your-first-image              # stable id (falls back to the permlink / filename slug)
 *   permlink: hathors-guide-03-...    # the on-chain permlink of the published post by @hathor
 *   title: "..."
 *   requires: [how-to-post]           # prerequisite lesson ids (default: the previous lesson)
 *   call_phrase: "Hathor, check my image"   # a HINT only — never required (people paraphrase)
 *   check: { kind, params, explain }  # how Hathor verifies the work (see detector.js LESSON_CHECK_KINDS)
 *   reward: upvote
 *   faq: [{ q, a }, ...]
 *
 * The drafts are PRIVATE until the operator approves them, so this module never reads a hard-coded
 * path: the directory comes from `INSTRUCTIONAL_DIR` (or an explicit `dir`). Nothing is copied into the
 * public repo. A draft that does not yet carry `check`/`faq`/`requires` still loads — it gets honest
 * defaults (check kind `manual_review`, which is "queued for the operator", never a fail).
 *
 * Pure except for the directory read. Soft-fail: a malformed file is skipped and reported in
 * `registry.errors`, never thrown.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WITNESS_ACCOUNT = 'hathor';
export const DEFAULT_POST_BASE = 'https://melek.salon/@hathor';

// ---- a small YAML subset parser (front-matter only) ----------------------------------------------
//
// Supports what the series uses: scalars (quoted / bare / numbers / booleans / null), inline arrays
// `[a, "b c"]`, inline maps `{a: 1}`, nested maps by indentation, block lists `- x` and lists of maps
// `- q: ..\n  a: ..`, and `|` / `>` block scalars. It is not a general YAML implementation and does not
// pretend to be one; anything it cannot read becomes a string rather than an exception.

function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}

export function parseScalar(raw) {
  const s = stripComment(String(raw ?? '')).trim();
  if (s === '') return '';
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    return inner ? splitTopLevel(inner, ',').map((x) => parseScalar(x)) : [];
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {};
    for (const part of splitTopLevel(s.slice(1, -1), ',')) {
      const m = part.match(/^\s*([^:]+?)\s*:\s*(.*)$/s);
      if (m) obj[parseScalar(m[1])] = parseScalar(m[2]);
    }
    return obj;
  }
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  if (/^(null|~)$/i.test(s)) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

const indentOf = (line) => line.match(/^ */)[0].length;

function parseBlock(lines, start, indent) {
  // Decide map vs list from the first meaningful line at this indent.
  let i = start;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length) return { value: null, next: i };
  const first = lines[i];
  if (indentOf(first) < indent) return { value: null, next: i };
  const isList = first.trim().startsWith('- ') || first.trim() === '-';
  return isList ? parseList(lines, i, indentOf(first)) : parseMap(lines, i, indentOf(first));
}

function parseBlockScalar(lines, i, parentIndent, style) {
  const buf = [];
  let blockIndent = null;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === '') { buf.push(''); i++; continue; }
    const ind = indentOf(l);
    if (ind <= parentIndent) break;
    if (blockIndent == null) blockIndent = ind;
    buf.push(l.slice(Math.min(ind, blockIndent)));
    i++;
  }
  while (buf.length && buf[buf.length - 1] === '') buf.pop();
  const text = style === '>' ? buf.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ') : buf.join('\n');
  return { value: text, next: i };
}

function parseMap(lines, i, indent) {
  const obj = {};
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) { i++; continue; } // stray over-indented line: skip rather than throw
    const m = line.trim().match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:(\s+(.*))?$/);
    if (!m) { i++; continue; }
    const key = String(parseScalar(m[1]));
    const rest = (m[3] ?? '').trim();
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const r = parseBlockScalar(lines, i + 1, indent, rest[0]);
      obj[key] = r.value; i = r.next; continue;
    }
    if (rest !== '') { obj[key] = parseScalar(rest); i++; continue; }
    const r = parseBlock(lines, i + 1, indent + 1);
    obj[key] = r.value; i = r.next;
  }
  return { value: obj, next: i };
}

function parseList(lines, i, indent) {
  const arr = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) { i++; continue; }
    const t = line.trim();
    if (!(t.startsWith('- ') || t === '-')) break;
    const item = t === '-' ? '' : t.slice(2);
    if (item === '') {
      const r = parseBlock(lines, i + 1, indent + 1);
      arr.push(r.value); i = r.next; continue;
    }
    // "- key: value" starts a map item whose keys continue at indent+2.
    if (/^("[^"]*"|'[^']*'|[A-Za-z_][\w-]*)\s*:(\s|$)/.test(item)) {
      const synthetic = [' '.repeat(indent + 2) + item];
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > indent)) synthetic.push(lines[j++]);
      arr.push(parseMap(synthetic, 0, indent + 2).value);
      i = j; continue;
    }
    arr.push(parseScalar(item)); i++;
  }
  return { value: arr, next: i };
}

/** Parse a YAML front-matter block (the text between the --- fences). Never throws. */
export function parseYaml(text) {
  try {
    const lines = String(text || '').replace(/\r/g, '').replace(/\t/g, '  ').split('\n');
    const r = parseBlock(lines, 0, 0);
    return r.value && typeof r.value === 'object' && !Array.isArray(r.value) ? r.value : {};
  } catch {
    return {};
  }
}

/** Split `---\nfront\n---\nbody` → { meta, body }. A file without front-matter is all body. */
export function splitFrontMatter(src) {
  const s = String(src || '').replace(/^﻿/, '').replace(/\r/g, '');
  const m = s.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: s };
  return { meta: parseYaml(m[1]), body: m[2] };
}

// ---- lessons --------------------------------------------------------------------------------------

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

function normalizeFaq(faq) {
  return asArray(faq)
    .map((f) => (f && typeof f === 'object' ? { q: String(f.q ?? f.question ?? '').trim(), a: String(f.a ?? f.answer ?? '').trim() } : null))
    .filter((f) => f && f.q && f.a);
}

function normalizeCheck(check) {
  if (typeof check === 'string' && check.trim()) return { kind: check.trim(), params: {}, explain: '' };
  if (!check || typeof check !== 'object' || !check.kind) {
    return { kind: 'manual_review', params: {}, explain: '', defaulted: true };
  }
  const params = check.params && typeof check.params === 'object' ? check.params : {};
  return { kind: String(check.kind).trim(), params, explain: String(check.explain || '').trim() };
}

/** The "Try this:" line of a lesson body — what the reader is asked to DO. */
export function tryThisOf(body) {
  const m = String(body || '').match(/\*\*Try this:\*\*\s*([\s\S]*?)(?:\n\s*\n|$)/);
  return m ? m[1].trim() : '';
}

/**
 * Turn one parsed file into a lesson. `fileName` supplies fallbacks for `lesson` (the NN_ prefix) and
 * `id` (the slug after it).
 */
export function lessonFromSource(src, fileName = '') {
  const { meta, body } = splitFrontMatter(src);
  const base = path.basename(String(fileName || ''), '.md');
  const fm = base.match(/^(\d+)[_-](.*)$/);
  const n = Number.isFinite(Number(meta.lesson)) && meta.lesson !== '' && meta.lesson != null
    ? Number(meta.lesson)
    : (fm ? Number(fm[1]) : NaN);
  const permlink = String(meta.permlink || '').trim();
  const id = slug(meta.id || (fm ? fm[2] : '') || permlink || base);
  const titleFromBody = (String(body).match(/^#\s+(.+)$/m) || [])[1];
  return {
    n,
    id,
    permlink,
    title: String(meta.title || titleFromBody || id).trim(),
    // "Hathor's Guide, Part 03 — Your First Image" → "Your First Image" (replies already say "Lesson 3").
    shortTitle: String(meta.title || titleFromBody || id).trim().replace(/^.*?\bPart\s*\d+\s*[—–:-]\s*/i, '').trim(),
    tags: asArray(meta.tags).map(String),
    requires: meta.requires === undefined ? null : asArray(meta.requires).map((r) => slug(r)),
    callPhrase: String(meta.call_phrase || '').trim(),
    check: normalizeCheck(meta.check),
    reward: String(meta.reward || 'upvote').trim(),
    faq: normalizeFaq(meta.faq),
    surfaces: asArray(meta.surfaces_covered).map(String),
    status: String(meta.status || '').trim(),
    body: String(body || '').trim(),
    tryThis: tryThisOf(body),
    file: fileName ? path.basename(fileName) : '',
  };
}

/**
 * Build the registry from an array of `{ name, src }` (pure) — used by loadRegistry and by tests.
 * `requires` defaults to the previous lesson in order, so the series is linear unless a lesson says
 * otherwise.
 */
export function buildRegistry(files = [], { base = DEFAULT_POST_BASE, witness = WITNESS_ACCOUNT } = {}) {
  const errors = [];
  const lessons = [];
  for (const f of files) {
    try {
      if (/^0+_?index/i.test(path.basename(f.name || ''))) continue; // 00_INDEX.md is the table of contents
      const l = lessonFromSource(f.src, f.name);
      if (!Number.isFinite(l.n)) { errors.push(`${f.name}: no lesson number`); continue; }
      if (!l.permlink) { errors.push(`${f.name}: no permlink`); continue; }
      lessons.push(l);
    } catch (err) {
      errors.push(`${f.name}: ${String(err && err.message ? err.message : err)}`);
    }
  }
  lessons.sort((a, b) => a.n - b.n);
  const baseUrl = String(base || DEFAULT_POST_BASE).replace(/\/$/, '');
  lessons.forEach((l, i) => {
    if (l.requires === null) l.requires = i > 0 ? [lessons[i - 1].id] : [];
    l.url = `${baseUrl}/${l.permlink}`;
    l.nextId = i < lessons.length - 1 ? lessons[i + 1].id : null;
    l.prevId = i > 0 ? lessons[i - 1].id : null;
  });
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const byPermlink = new Map(lessons.map((l) => [l.permlink, l]));

  return {
    witness,
    lessons,
    errors,
    get size() { return lessons.length; },
    byId: (id) => byId.get(slug(id)) || null,
    byPermlink: (p) => byPermlink.get(String(p || '')) || null,
    byNumber: (n) => lessons.find((l) => l.n === Number(n)) || null,
    next: (id) => { const l = byId.get(slug(id)); return l && l.nextId ? byId.get(l.nextId) : null; },
    first: () => lessons[0] || null,
    /** Prerequisites in series order, transitively (requires of requires). */
    prerequisitesOf(id) {
      const seen = new Set();
      const walk = (x) => {
        const l = byId.get(x);
        if (!l) return;
        for (const r of l.requires || []) if (!seen.has(r)) { seen.add(r); walk(r); }
      };
      walk(slug(id));
      return lessons.filter((l) => seen.has(l.id));
    },
    /** The first lesson (in order) the account has not completed. */
    firstUnfinished(doneIds = []) {
      const done = new Set(doneIds);
      return lessons.find((l) => !done.has(l.id)) || null;
    },
    /** A lesson named in free text: "lesson 3", "part 03", "#3", or a title/id match. Language-neutral digits. */
    findInText(text) {
      const t = String(text || '');
      const num = t.match(/(?:lesson|part|parte|lecci[oó]n|li[cç][aã]o|aula|leçon|lektion|lezione|pelajaran|পাঠ|পর্ব|पाठ|урок|ders|第|レッスン|레슨|aralin|#)\s*0*(\d{1,2})/i);
      if (num) { const l = lessons.find((x) => x.n === Number(num[1])); if (l) return l; }
      const lower = t.toLowerCase();
      let best = null, bestScore = 0;
      for (const l of lessons) {
        if (lower.includes(l.permlink)) return l;
        const words = l.title.toLowerCase().replace(/hathor'?s guide,? part \d+ ?[—-]?/i, '').match(/[a-z]{4,}/g) || [];
        const score = words.filter((w) => lower.includes(w)).length;
        if (score > bestScore) { best = l; bestScore = score; }
      }
      return bestScore >= 2 ? best : null;
    },
  };
}

/** Read the series directory (INSTRUCTIONAL_DIR). Soft-fail: a missing dir is an empty registry. */
export function loadRegistry({ dir = process.env.INSTRUCTIONAL_DIR || '', base, witness } = {}) {
  if (!dir) {
    const r = buildRegistry([], { base, witness });
    r.errors.push('INSTRUCTIONAL_DIR not set');
    return r;
  }
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort(); } catch (err) {
    const r = buildRegistry([], { base, witness });
    r.errors.push(`cannot read ${path.basename(dir)}: ${err.code || err.message}`);
    return r;
  }
  const files = [];
  for (const name of names) {
    try { files.push({ name, src: readFileSync(path.join(dir, name), 'utf8') }); } catch { /* skipped */ }
  }
  return buildRegistry(files, { base, witness });
}

// ---- CLI (guarded): summarize the registry -------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reg = loadRegistry({ dir: process.argv[2] || process.env.INSTRUCTIONAL_DIR });
  for (const l of reg.lessons) {
    process.stdout.write(`${String(l.n).padStart(2, '0')} ${l.id.padEnd(34)} check=${l.check.kind}${l.check.defaulted ? '(default)' : ''} faq=${l.faq.length} requires=[${l.requires.join(',')}]\n`);
  }
  if (reg.errors.length) process.stdout.write(`errors: ${reg.errors.join('; ')}\n`);
}
