/**
 * tutorial/lessons/index.mjs — Tier-A tutorial lesson catalog (queue #44).
 *
 * Tier A = "works-now, Graphene-only": every step in these lessons is something
 * a user can actually DO today on a standard Graphene chain — create an account,
 * post, comment, vote, transfer, set a profile, claim rewards, follow. No SMTs,
 * no trading layer, no AI-on-chain features (those are Tier B / Tier C, gated on
 * infra that does not exist yet).
 *
 * The lesson *text* lives in the sibling markdown files; this module is the thin
 * metadata + loader layer over them. It is the lessons analogue of stages.json:
 * `stageRef` ties each lesson to a stage key in ../stages.json where one exists,
 * or `null` for lessons that teach a fundamental motion the staged FSM does not
 * gate on (account creation, voting, transfers, profile, rewards, following).
 *
 * Voice: the markdown is written in Hathor's Angelic register (CHARACTER.md §2);
 * this module does not generate any user-facing prose, it only serves files.
 *
 * Key-custody safety is a HARD invariant of the corpus, not just the loader:
 * no lesson ever instructs a user to paste, type, send, or share a private key /
 * master password / secret. The accompanying test asserts this against the files.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The Tier-A lesson catalog, in teaching order.
 *
 * Each entry:
 *   id       — stable kebab-case identifier (used by loadLesson)
 *   file     — markdown filename, relative to this directory
 *   title    — human title (matches the markdown H1 intent)
 *   tier     — always 'A' here
 *   stageRef — key in ../stages.json this lesson maps to, or null
 */
export const LESSONS = [
  {
    id: 'welcome-create-account',
    file: '01-welcome-create-account.md',
    title: 'Welcome — and how an account comes to be',
    tier: 'A',
    stageRef: null,
  },
  {
    id: 'your-first-post',
    file: '02-your-first-post.md',
    title: 'Your first post — an introduction',
    tier: 'A',
    stageRef: 'intro_post',
  },
  {
    id: 'comments-and-replies',
    file: '03-comments-and-replies.md',
    title: 'Comments and replies — the soul of the place',
    tier: 'A',
    stageRef: 'engage_three_posts',
  },
  {
    id: 'voting-and-curation',
    file: '04-voting-and-curation.md',
    title: 'Voting and curation — lifting good work',
    tier: 'A',
    stageRef: null,
  },
  {
    id: 'transfers-and-memos',
    file: '05-transfers-and-memos.md',
    title: 'Transfers and memos — moving value, and a note alongside it',
    tier: 'A',
    stageRef: null,
  },
  {
    id: 'your-profile',
    file: '06-your-profile.md',
    title: 'Your profile — the face you show',
    tier: 'A',
    stageRef: null,
  },
  {
    id: 'claiming-rewards',
    file: '07-claiming-rewards.md',
    title: 'Claiming rewards — collecting what your work earned',
    tier: 'A',
    stageRef: null,
  },
  {
    id: 'following-and-feeds',
    file: '08-following-and-feeds.md',
    title: 'Following and feeds — building the room you read in',
    tier: 'A',
    stageRef: null,
  },
];

/**
 * lessonList() — the catalog metadata (no file contents). Returns a shallow copy
 * so callers cannot mutate the canonical LESSONS array.
 */
export function lessonList() {
  return LESSONS.map((l) => ({ ...l }));
}

/**
 * loadLesson(id) — read a lesson's markdown body by id. Soft-fail: returns null
 * for an unknown id or a missing/unreadable file rather than throwing, so a
 * caller (composer, Discord/Telegram surface) can degrade gracefully.
 *
 * Returns { ...meta, path, content } on success, or null.
 */
export function loadLesson(id) {
  const meta = LESSONS.find((l) => l.id === id);
  if (!meta) return null;
  const path = join(__dirname, meta.file);
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf8');
    if (!content || !content.trim()) return null;
    return { ...meta, path, content };
  } catch {
    return null;
  }
}

/* ----------------------------- CLI ----------------------------- */

if (process.argv[1] && process.argv[1].endsWith('index.mjs')) {
  const arg = process.argv[2];
  if (arg) {
    const lesson = loadLesson(arg);
    if (!lesson) {
      console.error(`No Tier-A lesson with id "${arg}".`);
      process.exit(1);
    }
    console.log(lesson.content);
  } else {
    console.log('Tier-A tutorial lessons (works-now, Graphene-only):\n');
    for (const l of lessonList()) {
      console.log(`  ${l.id.padEnd(26)} ${l.title}`);
      console.log(`  ${''.padEnd(26)} file: ${l.file}  stage: ${l.stageRef ?? '(none)'}`);
    }
  }
}
