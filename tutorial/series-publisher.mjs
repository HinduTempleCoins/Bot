// series-publisher.mjs — turns the 29 staged tutorial lessons into the on-chain HATHOR TUTORIAL SERIES.
//
// The lessons in tutorial/lessons/ are the CONTENT (each already ends in the CryptoKannon "learn and earn"
// completion). This module orders them into the series (Track 1 MELEK → 2 Automation → 3 Platforms → 4 DeFi),
// assigns a stable on-chain permlink + title + tags to each, and stitches them together with resolved
// "← Previous / Next →" cross-links pointing at the real @hathor permlinks. PURE + offline: it produces the
// post-ready objects; it does NOT broadcast. Posting is a separate, operator-gated step (bin/hathor-post-once.sh),
// slated to roll out WITH PRANA.

import { writeFileSync, mkdirSync } from 'node:fs';
import { LESSONS, loadLesson } from './lessons/index.mjs';

const BASE = (process.env.HATHOR_POST_BASE || 'https://melek.salon/@hathor').replace(/\/$/, '');

// Track order + labels. `strand: null` = the core MELEK track (lessons 01–12).
export const SERIES_TRACKS = Object.freeze([
  { strand: null, key: 'melek', name: 'Track 1 — MELEK' },
  { strand: 'account-automation', key: 'automation', name: 'Track 2 — Automation' },
  { strand: 'platforms', key: 'platforms', name: 'Track 3 — Platforms' },
  { strand: 'defi', key: 'defi', name: 'Track 4 — DeFi' },
]);
const TRACK_BY_STRAND = new Map(SERIES_TRACKS.map((t) => [t.strand, t]));
const trackFor = (lesson) => TRACK_BY_STRAND.get(lesson.strand || null) || SERIES_TRACKS[0];

const pad2 = (n) => String(n).padStart(2, '0');

/** The lessons in canonical series order: by track, preserving each track's existing lesson order. */
export function seriesLessons(lessons = LESSONS) {
  const out = [];
  for (const track of SERIES_TRACKS) {
    for (const l of lessons) if ((l.strand || null) === track.strand) out.push(l);
  }
  return out;
}

/** Stable on-chain permlink for a lesson at 1-based series position n. Lowercase, hyphenated, safe. */
export function permlinkFor(n, lesson) {
  return `melek-tutorial-${pad2(n)}-${String(lesson.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, 96);
}
/** The post title (Graphene comment title field). */
export function titleFor(n, total, lesson) {
  return `MELEK Tutorial ${n}/${total} — ${lesson.title}`;
}
/** Tags (Graphene: <=5, lowercase, first = category). Category 'melek' for feed visibility + series grouping. */
export function tagsFor(lesson) {
  return ['melek', 'tutorial', 'hathor-tutorial', trackFor(lesson).key, 'learn'];
}

// Strip a lesson's own trailing "Next: …" pointer (we replace it with resolved series nav).
function stripOwnNext(md) {
  return String(md || '').replace(/\n+\**Next:.*\s*$/i, '').trimEnd();
}

/** Build the full ordered series of post objects with resolved cross-links. Pure. */
export function buildSeries({ lessons = LESSONS, load = loadLesson, base = BASE } = {}) {
  const ordered = seriesLessons(lessons);
  const total = ordered.length;
  const metas = ordered.map((lesson, i) => ({ n: i + 1, lesson, permlink: permlinkFor(i + 1, lesson) }));
  const urlOf = (m) => `${base}/${m.permlink}`;
  return metas.map((m, i) => {
    const prev = i > 0 ? metas[i - 1] : null;
    const next = i < metas.length - 1 ? metas[i + 1] : null;
    const track = trackFor(m.lesson);
    const loaded = load(m.lesson.id) || {};
    const content = stripOwnNext(loaded.content || '');
    const navTop = `*MELEK Tutorial — Part ${m.n} of ${total} · ${track.name}*`;
    const navBottom = [
      '---',
      `**The MELEK Tutorial** · Part ${m.n} of ${total} · ${track.name}`,
      [
        prev ? `[← Previous: ${prev.lesson.title}](${urlOf(prev)})` : '',
        next ? `[Next: ${next.lesson.title} →](${urlOf(next)})` : '**You’ve completed the series — well done.**',
      ].filter(Boolean).join('  ·  '),
      `Start at [Part 1](${urlOf(metas[0])}). Finish each lesson’s action, comment on this post that you did it, and I’ll upvote your comment — a real on-chain reward for doing the work.`,
    ].join('\n\n');
    const body = `${navTop}\n\n${content}\n\n${navBottom}\n`;
    return {
      n: m.n, total, id: m.lesson.id, strand: m.lesson.strand || null, track: track.key,
      permlink: m.permlink, title: titleFor(m.n, total, m.lesson), tags: tagsFor(m.lesson),
      prevPermlink: prev ? prev.permlink : null, nextPermlink: next ? next.permlink : null,
      url: urlOf(m), body,
    };
  });
}

/** A compact manifest (order, permlinks, titles, tags) — the posting plan. */
export function seriesManifest(series = buildSeries()) {
  return {
    series: 'MELEK Tutorial',
    total: series.length,
    generatedAt: new Date().toISOString().slice(0, 10),
    posts: series.map((p) => ({ n: p.n, permlink: p.permlink, title: p.title, track: p.track, tags: p.tags, prev: p.prevPermlink, next: p.nextPermlink })),
  };
}

/** Stage the series to disk (one .md per post + manifest.json). Writes; does NOT broadcast. */
export function stageSeries(outDir, series = buildSeries()) {
  mkdirSync(outDir, { recursive: true });
  for (const p of series) {
    const fm = [
      '---',
      `author: hathor`,
      `permlink: ${p.permlink}`,
      `title: "${p.title.replace(/"/g, '\\"')}"`,
      `tags: [${p.tags.join(', ')}]`,
      `series: MELEK Tutorial (${p.n}/${p.total})`,
      `status: STAGED — post via bin/hathor-post-once.sh on operator go / PRANA rollout`,
      '---',
      '',
    ].join('\n');
    writeFileSync(`${outDir}/${p.permlink}.md`, fm + p.body);
  }
  writeFileSync(`${outDir}/manifest.json`, JSON.stringify(seriesManifest(series), null, 2));
  return { count: series.length, outDir };
}

// CLI (guarded): stage the series to .local/hathor-posts/tutorial-series/
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('series-publisher.mjs')) {
  const out = process.argv[2] || '.local/hathor-posts/tutorial-series';
  const r = stageSeries(out);
  console.log(`staged ${r.count} tutorial posts → ${r.outDir}`);
  const s = buildSeries();
  console.log('first:', s[0].permlink, '|', s[0].title);
  console.log('last :', s[s.length - 1].permlink, '|', s[s.length - 1].title);
}
