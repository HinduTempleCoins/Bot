// comments.mjs — comments-under-graph (brief §6, the moat). The differentiator vs CMC: if a project
// was called out, they reply RIGHT ON THE PAGE. Right-of-reply, fact-and-debate, never a verdict
// machine. File-backed JSON per coin (no DB) — one thread per comments_ref ("coin:<id>").
//
// Posting is GATED behind SOAPBOX_COMMENTS_WRITE until real auth exists (no anonymous spam at launch).
// Reads are always open. Each comment is append-only; moderation = a hidden flag, never a delete, so
// the record of what was said stays honest.
//
//   import { getThread, addComment, canPost } from './comments.mjs'

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.SOAPBOX_COMMENTS_DIR || path.join(__dir, 'data', 'comments');

export function canPost() { return process.env.SOAPBOX_COMMENTS_WRITE === '1'; }

const safeRef = (ref) => String(ref || '').replace(/[^a-z0-9:_-]/gi, '_').slice(0, 80);
const fileFor = (ref) => path.join(DIR, `${safeRef(ref)}.json`);

/** All comments for a thread (oldest first). Hidden ones are filtered from the public read. */
export function getThread(ref) {
  try {
    const all = JSON.parse(fs.readFileSync(fileFor(ref), 'utf8'));
    return Array.isArray(all) ? all.filter((c) => !c.hidden) : [];
  } catch { return []; }
}

/**
 * Append a comment. Throws if writes are gated off. `kind` distinguishes a plain comment from a
 * project's official "right-of-reply" (rendered with a verified badge once we can verify ownership).
 */
export function addComment(ref, { author, body, kind = 'comment' } = {}) {
  if (!canPost()) throw new Error('comments are read-only at launch (set SOAPBOX_COMMENTS_WRITE=1 once auth exists)');
  const a = String(author || 'anon').slice(0, 40);
  const b = String(body || '').trim().slice(0, 4000);
  if (!b) throw new Error('empty comment');
  fs.mkdirSync(DIR, { recursive: true });
  const thread = (() => { try { return JSON.parse(fs.readFileSync(fileFor(ref), 'utf8')); } catch { return []; } })();
  const entry = { id: `${Date.now()}-${thread.length}`, author: a, body: b, kind, ts: new Date().toISOString() };
  thread.push(entry);
  fs.writeFileSync(fileFor(ref), JSON.stringify(thread, null, 2));
  return entry;
}

export function threadCount(ref) { return getThread(ref).length; }
