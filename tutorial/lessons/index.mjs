/**
 * tutorial/lessons/index.mjs — the tutorial lesson catalog (queue #44).
 *
 * The catalog is organized into TRACKS, taught in order:
 *
 *   Track 1 — MELEK (Tier A, "works-now, Graphene-only"): every step is something
 *     a user can DO today on a standard Graphene chain — create an account, post,
 *     comment, vote, transfer, set a profile, claim rewards, follow, share, power
 *     up, vote a witness, delegate. Lessons 01–12.
 *
 *   Track 2 — Account automation (Tier B, strand 'account-automation'): opt-in
 *     automation of your OWN account, safely, via MELEK-Signer — keys stay yours.
 *     Lessons 13–15. These teach an advanced motion the staged FSM does not gate
 *     on, so they carry `stageRef: null`.
 *
 *   Track 3 — Platforms (Tier C, strand 'platforms'): a lesson per platform we
 *     have built — KULA Arcade, the games, Move, Herald + Web Builder, the
 *     Gambling Education Center, the Forum, the Tools hub + Profile, REN naming,
 *     and the tokens/curation/witnessing graduation. Each ends with the
 *     CryptoKannon learn-and-earn completion: the learner DOES the thing → earns an
 *     upvote reward (honest, real-utility; sweepstakes/AMOE where a draw is
 *     involved; no returns promise). Lessons 16–24, all `stageRef: null`.
 *
 * The lesson *text* lives in the sibling markdown files; this module is the thin
 * metadata + loader layer over them. It is the lessons analogue of stages.json:
 * `stageRef` ties each lesson to a stage key in ../stages.json where one exists,
 * or `null` for lessons that teach a motion the staged FSM does not gate on
 * (account creation, voting, transfers, profile, rewards, following, the whole
 * automation strand, and the whole platforms strand).
 *
 * IMPORTANT: this module does not touch the FSM (../stages.json) or the
 * detector/reward/composer engines. The automation and platforms strands live
 * entirely here, off the linear FSM, exactly so those engines and their tests
 * stay untouched and green.
 *
 * Voice: the markdown is written in Hathor's Serene / Angelic register
 * (CHARACTER.md §2); this module does not generate any user-facing prose, it only
 * serves files.
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
 * The lesson catalog, in teaching order.
 *
 * Each entry:
 *   id       — stable kebab-case identifier (used by loadLesson)
 *   file     — markdown filename, relative to this directory
 *   title    — human title (matches the markdown H1 intent)
 *   tier     — 'A' (works-now MELEK), 'B' (opt-in automation), 'C' (platforms)
 *   stageRef — key in ../stages.json this lesson maps to, or null
 *   strand   — optional track tag: 'account-automation' | 'platforms'
 *   platform — optional platform slug (platforms strand only)
 */
export const LESSONS = [
  // ---- Track 1 — MELEK (Tier A, works-now Graphene) ----
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
    stageRef: 'send_first_transfer',
  },
  {
    id: 'your-profile',
    file: '06-your-profile.md',
    title: 'Your profile — the face you show',
    tier: 'A',
    stageRef: 'set_profile',
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
    stageRef: 'follow_three_authors',
  },
  {
    id: 'sharing-what-you-know',
    file: '09-sharing-what-you-know.md',
    title: 'Sharing what you know — your first real post',
    tier: 'A',
    stageRef: 'share_what_you_know',
  },
  {
    id: 'power-up-your-account',
    file: '10-power-up-your-account.md',
    title: 'Powering up — turning MELEK into weight',
    tier: 'A',
    stageRef: 'power_up',
  },
  {
    id: 'witnessing-and-governance',
    file: '11-witnessing-and-governance.md',
    title: 'Witnessing — who keeps the chain, and how you choose them',
    tier: 'A',
    stageRef: 'vote_for_a_witness',
  },
  {
    id: 'delegation',
    file: '12-delegation.md',
    title: 'Delegation — lending weight without giving it away',
    tier: 'A',
    stageRef: 'delegate_some_mp',
  },

  // ---- Track 2 — Account automation (Tier B, via MELEK-Signer) ----
  {
    id: 'automating-your-account-safely',
    file: '13-automating-your-account-safely.md',
    title: 'Automating your account safely — keys stay yours',
    tier: 'B',
    stageRef: null,
    strand: 'account-automation',
  },
  {
    id: 'account-health-and-curation-bots',
    file: '14-account-health-and-curation-bots.md',
    title: 'Account-health and curation bots — help that keeps your keys safe',
    tier: 'B',
    stageRef: null,
    strand: 'account-automation',
  },
  {
    id: 'running-your-own-bot',
    file: '15-running-your-own-bot.md',
    title: 'Running your own bot — trading and arbitrage, the careful way',
    tier: 'B',
    stageRef: null,
    strand: 'account-automation',
  },

  // ---- Track 3 — Platforms (Tier C, learn-and-earn per platform) ----
  {
    id: 'kula-arcade',
    file: '16-kula-arcade.md',
    title: 'KULA Arcade — free, provably-fair play, and how to verify a draw',
    tier: 'C',
    stageRef: null,
    strand: 'platforms',
    platform: 'kula-arcade',
  },
  {
    id: 'games-and-idle-games',
    file: '17-games-and-idle-games.md',
    title: 'Games and idle games — the coffee-break arcade, and saving your score',
    tier: 'C',
    stageRef: null,
    strand: 'platforms',
    platform: 'games',
  },
  {
    id: 'melek-move',
    file: '18-melek-move.md',
    title: 'MELEK Move — walk-to-earn, the step counter that rewards walking',
    tier: 'C',
    stageRef: null,
    strand: 'platforms',
    platform: 'move',
  },
  {
    id: 'herald-web-builder',
    file: '19-herald-web-builder.md',
    title: 'Herald and the Web Builder — launch your own site, and the backlink network',
    tier: 'C',
    stageRef: null,
    strand: 'platforms',
    platform: 'herald',
  },
  {
    id: 'gambling-education-center',
    file: '20-gambling-education-center.md',
    title: 'The Gambling Education Center — odds, house edge, and where to get help',
    tier: 'C',
    stageRef: null,
    strand: 'platforms',
    platform: 'gambling-education',
  },
  {
    id: 'the-forum',
    file: '21-the-forum.md',
    title: 'The Forum — find your board, post, and earn merit',
    tier: 'C',
    stageRef: null,
    strand: 'platforms',
    platform: 'forum',
  },
  {
    id: 'tools-hub-and-profile',
    file: '22-tools-hub-and-profile.md',
    title: 'The Tools hub and your Profile — the everyday tools, and one portable you',
    tier: 'C',
    stageRef: null,
    strand: 'platforms',
    platform: 'tools-hub',
  },
  {
    id: 'ren-naming',
    file: '23-ren-naming.md',
    title: 'REN naming — claim your .melek name',
    tier: 'C',
    stageRef: null,
    strand: 'platforms',
    platform: 'ren',
  },
  {
    id: 'tokens-curation-witnessing',
    file: '24-tokens-curation-witnessing.md',
    title: 'Tokens, curation, and witnessing — the graduation',
    tier: 'C',
    stageRef: null,
    strand: 'platforms',
    platform: 'melek-graduation',
  },
];

/** The set of platform slugs a platforms-strand lesson may reference. */
export const PLATFORMS = Object.freeze([
  'kula-arcade',
  'games',
  'move',
  'herald',
  'gambling-education',
  'forum',
  'tools-hub',
  'ren',
  'melek-graduation',
]);

/**
 * lessonList() — the catalog metadata (no file contents). Returns a shallow copy
 * so callers cannot mutate the canonical LESSONS array.
 */
export function lessonList() {
  return LESSONS.map((l) => ({ ...l }));
}

/**
 * lessonsInStrand(strand) — the catalog entries belonging to one strand
 * ('account-automation' | 'platforms'), as defensive copies, in teaching order.
 */
export function lessonsInStrand(strand) {
  return LESSONS.filter((l) => l.strand === strand).map((l) => ({ ...l }));
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
      console.error(`No tutorial lesson with id "${arg}".`);
      process.exit(1);
    }
    console.log(lesson.content);
  } else {
    console.log('Tutorial lessons (Track 1 MELEK · Track 2 automation · Track 3 platforms):\n');
    for (const l of lessonList()) {
      const tag = l.strand ? `  [${l.strand}]` : '';
      console.log(`  ${l.id.padEnd(34)} (${l.tier}) ${l.title}${tag}`);
      console.log(`  ${''.padEnd(34)} file: ${l.file}  stage: ${l.stageRef ?? '(none)'}`);
    }
  }
}
