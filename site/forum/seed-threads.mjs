// seed-threads.mjs — the forum's Hathor-authored seed set, as forum-core ledger entries.
//
// The threads themselves are data in ./seed/*.mjs (launch, make, place, medicine, more). This module turns
// them into deterministic ledger entries with stable, readable ids (the slug), so a seed thread lives at
// /t/<slug> forever. Seed entries are NEVER written to the store: they are layered under it at read time,
// which makes seeding idempotent by construction — a restart cannot duplicate them, and editing a seed
// thread here simply changes it.
//
// Each seed thread: { slug, board, title, body, replies?: [string], date?: ISO, legacyId?: 't0' }.
// `legacyId` keeps the launch threads reachable at the /t/t0…t7 addresses they first went live at.

import launch from './seed/launch.mjs';
import make from './seed/make.mjs';
import place from './seed/place.mjs';
import medicine from './seed/medicine.mjs';
import more from './seed/more.mjs';

export const SEED_AUTHOR = 'hathor';
export const SEED_PARTS = { launch, make, place, medicine, more };

// Undated seed threads are spread across the seeding day in a pillar-interleaved order (Make first, then
// Place, then Medicine, then the rest), so recent activity shows the whole forum rather than one board.
const SEED_DAY = Date.parse('2026-10-19T00:00:00Z');
const STEP_MS = 6 * 60 * 1000;
const REPLY_GAP_MS = 3 * 60 * 60 * 1000;

function interleave(lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

const arr = (x) => (Array.isArray(x) ? x : []);

/** Every seed thread, in seeding order (launch threads first, then the interleaved pillars). */
export const SEED_THREADS = [...arr(launch), ...interleave([arr(make), arr(place), arr(medicine), arr(more)])];

/** legacy id → slug, for the launch threads' original addresses. */
export const LEGACY_IDS = Object.fromEntries(SEED_THREADS.filter((t) => t.legacyId).map((t) => [t.legacyId, t.slug]));

/**
 * The seed as ledger entries: one root post per thread (id = slug) plus its replies (id = `<slug>-r<n>`).
 * Deterministic. `seq` numbers are assigned in order so the engine's own sequence continues after them.
 */
export function seedEntries() {
  const out = [];
  let seq = 0;
  let undated = 0;
  for (const t of SEED_THREADS) {
    if (!t || !t.slug || !t.board || !t.title) continue;
    const dated = t.date ? Date.parse(t.date) : NaN;
    const ts = Number.isFinite(dated) ? dated : SEED_DAY + (undated++) * STEP_MS;
    out.push({
      kind: 'post', id: t.slug, threadId: t.slug, board: t.board, author: SEED_AUTHOR,
      title: String(t.title), body: String(t.body || ''), parentId: null, ts, seq: seq++, src: 'seed',
    });
    arr(t.replies).forEach((r, i) => {
      const body = typeof r === 'string' ? r : (r && r.body) || '';
      if (!body.trim()) return;
      out.push({
        kind: 'post', id: `${t.slug}-r${i + 1}`, threadId: t.slug, board: t.board, author: SEED_AUTHOR,
        title: '', body, parentId: t.slug, ts: ts + (i + 1) * REPLY_GAP_MS, seq: seq++, src: 'seed',
      });
    });
  }
  return out;
}

/** Boards the seed posts into (for the sitemap's programmatic-board list). */
export function seedBoards() {
  return [...new Set(SEED_THREADS.map((t) => t.board).filter(Boolean))];
}

export default { SEED_THREADS, LEGACY_IDS, seedEntries, seedBoards };
