// site/films/reviews-store.mjs — append-only JSONL store for SoapBox Films reviews.
//
// Same shape as site/hathor-live/reports-store.mjs: a flat file an operator can read, grep and back up.
// Nothing is rewritten. A review is one line; an edit is a newer review line from the same reviewer for
// the same film (the newest wins); a delete, a report or a moderation decision is a small patch line.
// The fold below turns the log into the current state.
//
// Identity is the hashed reviewer id (see reviewer.mjs) — never an email, account or raw key.
// Every function soft-fails: a missing file, a torn line or a full disk shortens the list, never throws.

import fs from 'node:fs';
import path from 'node:path';

let _io = null;
export function __setIO(io) { _io = io && typeof io === 'object' ? io : null; }

function io() {
  return _io || {
    read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } },
    append(p, line) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.appendFileSync(p, line, 'utf8');
        return true;
      } catch { return false; }
    },
  };
}

/** Reports from this many different reviewers hide a review until a moderator looks. */
export const REPORT_HIDE_THRESHOLD = 3;

/**
 * Fold the log. Returns every current review (including hidden/deleted ones, with `status`), newest
 * first. Line kinds:
 *   { kind:'review', id, film, rid, stars, title, text, name, at }
 *   { kind:'delete', id, rid, at }            — only honoured when rid matches the review's author
 *   { kind:'report', id, rid, reason, at }    — distinct reporters counted
 *   { kind:'moderate', id, status, at }       — status: 'published' | 'hidden' | 'removed'
 */
export function foldReviews(raw) {
  const reviews = new Map();      // id -> review
  const latestBy = new Map();     // film|rid -> id of the reviewer's newest review for that film
  const reports = new Map();      // id -> Set(rid)
  const patches = [];
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    if (!rec || typeof rec !== 'object' || !rec.id) continue;
    if (rec.kind === 'review') {
      if (!rec.film || !rec.rid) continue;
      const k = `${rec.film}|${rec.rid}`;
      const prev = latestBy.get(k);
      if (prev && reviews.has(prev)) reviews.get(prev).status = 'superseded';
      latestBy.set(k, rec.id);
      reviews.set(rec.id, { ...rec, status: 'published', reports: 0 });
    } else {
      patches.push(rec);
    }
  }
  for (const p of patches) {
    const r = reviews.get(p.id);
    if (!r) continue;
    if (p.kind === 'delete' && p.rid && p.rid === r.rid) r.status = 'deleted';
    else if (p.kind === 'report' && p.rid) {
      if (!reports.has(p.id)) reports.set(p.id, new Set());
      reports.get(p.id).add(p.rid);
      r.reports = reports.get(p.id).size;
      if (r.status === 'published' && !r.moderated && r.reports >= REPORT_HIDE_THRESHOLD) r.status = 'hidden';
    } else if (p.kind === 'moderate' && ['published', 'hidden', 'removed'].includes(p.status)) {
      if (r.status !== 'superseded' && r.status !== 'deleted') { r.status = p.status; r.moderated = p.at || true; }
    }
  }
  return [...reviews.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function readAll(file) { return foldReviews(io().read(file)); }

/** Only what the public sees. */
export function readPublished(file) { return readAll(file).filter((r) => r.status === 'published'); }

export function append(file, rec) {
  if (!file || !rec || typeof rec !== 'object' || !rec.id || !rec.kind) return false;
  try { return io().append(file, JSON.stringify(rec) + '\n'); } catch { return false; }
}

/**
 * Aggregate a list of published reviews into per-film stats:
 *   { count, avg (1 decimal), score (% of ratings >= 3.5 stars), verdict }
 * The verdict is our own naming (Lotus = most liked it, Wilted = most didn't), shown from one review up
 * but flagged `few` under 5 ratings so a single review never reads as a consensus.
 */
export const LIKED_AT = 3.5;
export const LOTUS_AT = 60;
export function aggregate(reviews) {
  const by = new Map();
  for (const r of reviews || []) {
    const s = +r.stars;
    if (!(s >= 0.5 && s <= 5)) continue;
    if (!by.has(r.film)) by.set(r.film, { film: r.film, count: 0, sum: 0, liked: 0, last: '' });
    const a = by.get(r.film);
    a.count += 1; a.sum += s; if (s >= LIKED_AT) a.liked += 1;
    if (String(r.at) > a.last) a.last = String(r.at);
  }
  const out = new Map();
  for (const [film, a] of by) {
    const score = Math.round((a.liked / a.count) * 100);
    out.set(film, {
      film, count: a.count, avg: Math.round((a.sum / a.count) * 10) / 10, score,
      verdict: score >= LOTUS_AT ? 'lotus' : 'wilted', few: a.count < 5, last: a.last,
    });
  }
  return out;
}
