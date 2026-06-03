/**
 * index.test.mjs — OFFLINE tests for the Tier-A tutorial lesson catalog (#44).
 *
 * No network, no chain reads — only the local catalog + markdown files. Run with:
 *   node --test tutorial/lessons/index.test.mjs
 *
 * The load-bearing test here is KEY-CUSTODY SAFETY: no lesson may instruct a user
 * to paste / type / send / share a private key or secret. The phrase "private
 * key" (and friends) is only allowed inside an explicit "never share / we never
 * ask" safety context. See `assertKeyCustodySafe` below.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LESSONS, lessonList, loadLesson } from './index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stagesPath = join(__dirname, '..', 'stages.json');

// The Tier-A lessons we expect to ship, by id.
const EXPECTED_IDS = [
  'welcome-create-account',
  'your-first-post',
  'comments-and-replies',
  'voting-and-curation',
  'transfers-and-memos',
  'your-profile',
  'claiming-rewards',
  'following-and-feeds',
];

test('LESSONS contains the Tier-A entries (6–8), all tier A, unique ids/files', () => {
  assert.ok(LESSONS.length >= 6 && LESSONS.length <= 8, `expected 6–8 lessons, got ${LESSONS.length}`);
  for (const l of LESSONS) {
    assert.equal(l.tier, 'A', `lesson ${l.id} must be tier A`);
    assert.equal(typeof l.id, 'string');
    assert.ok(l.id.length > 0);
    assert.equal(typeof l.file, 'string');
    assert.match(l.file, /\.md$/, `lesson ${l.id} file must be a .md`);
    assert.equal(typeof l.title, 'string');
    assert.ok(l.title.length > 0, `lesson ${l.id} must have a title`);
    assert.ok('stageRef' in l, `lesson ${l.id} must declare stageRef (may be null)`);
  }
  const ids = LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'lesson ids must be unique');
  const files = LESSONS.map((l) => l.file);
  assert.equal(new Set(files).size, files.length, 'lesson files must be unique');
});

test('the expected Tier-A topic ids are all present', () => {
  const ids = new Set(LESSONS.map((l) => l.id));
  for (const want of EXPECTED_IDS) {
    assert.ok(ids.has(want), `missing expected Tier-A lesson: ${want}`);
  }
});

test('every referenced markdown file exists and is non-trivial', () => {
  for (const l of LESSONS) {
    const p = join(__dirname, l.file);
    assert.ok(existsSync(p), `markdown file missing for ${l.id}: ${l.file}`);
    const body = readFileSync(p, 'utf8');
    assert.ok(body.trim().length >= 400, `lesson ${l.id} is too short (${body.trim().length} chars)`);
    assert.match(body, /^#\s+.+/m, `lesson ${l.id} must have a markdown H1 title`);
    // Each lesson teaches and closes: "what you'll learn" + a "you did it" close.
    assert.match(body, /what you'll learn/i, `lesson ${l.id} must have a "what you'll learn" section`);
    assert.match(body, /you did it/i, `lesson ${l.id} must have a "you did it" close`);
  }
});

test('non-null stageRefs resolve to a real stage key in stages.json', () => {
  const stages = JSON.parse(readFileSync(stagesPath, 'utf8'));
  const keys = new Set(stages.stages.map((s) => s.key));
  for (const l of LESSONS) {
    if (l.stageRef !== null) {
      assert.ok(keys.has(l.stageRef), `lesson ${l.id} stageRef "${l.stageRef}" not found in stages.json`);
    }
  }
});

test('loadLesson returns content for every id; soft-fails on unknown/bad', () => {
  for (const l of LESSONS) {
    const loaded = loadLesson(l.id);
    assert.ok(loaded, `loadLesson(${l.id}) returned null`);
    assert.equal(loaded.id, l.id);
    assert.equal(loaded.file, l.file);
    assert.ok(loaded.path.endsWith(l.file));
    assert.equal(typeof loaded.content, 'string');
    assert.ok(loaded.content.trim().length > 0);
  }
  assert.equal(loadLesson('no-such-lesson'), null, 'unknown id must soft-fail to null');
  assert.equal(loadLesson(undefined), null, 'undefined id must soft-fail to null');
  assert.equal(loadLesson(''), null, 'empty id must soft-fail to null');
});

test('lessonList returns a defensive copy of the metadata', () => {
  const list = lessonList();
  assert.equal(list.length, LESSONS.length);
  list[0].title = 'MUTATED';
  list.push({ id: 'x' });
  assert.notEqual(LESSONS[0].title, 'MUTATED', 'mutating the list must not touch LESSONS');
  assert.equal(LESSONS.length, list.length - 1, 'pushing to the list must not touch LESSONS');
});

/**
 * KEY-CUSTODY SAFETY.
 *
 * For each lesson, scan every line. If a line mentions a secret-credential token
 * (private key / master password / WIF / secret key / seed phrase), it MUST be in
 * a safety context — i.e. the line (or its immediate neighbours) tells the user
 * NOT to share it, or states that the Witness never asks for it. A line that
 * mentions a secret in any *instructional* way ("paste your private key…",
 * "enter your master password…") is a failure.
 */

// Tokens that name an actual secret credential.
const SECRET_TOKENS = [
  /private key/i,
  /master password/i,
  /\bWIF\b/,
  /secret key/i,
  /seed phrase/i,
];

// Safety-context cues — a secret mention is OK only near one of these.
const SAFETY_CUES = [
  /never/i,
  /\bnot\b/i,
  /don'?t/i,
  /do not/i,
  /no one/i,
  /\bnever ask/i,
  /will never/i,
  /keep .*(safe|offline|secret|private)/i,
  /stays? with you/i,
  /your (own )?(hands|control|device|machine|browser)/i,
  /only .*(you|your)/i,
  /\boffline\b/i,
  /should ever pass/i,
];

// Instructional verbs that, applied to a secret, are an outright failure regardless.
const SHARE_INSTRUCTION = [
  /\b(paste|type|enter|send|share|give|provide|submit|hand over|copy)\b[^.]{0,60}\b(private key|master password|secret key|seed phrase|WIF)\b/i,
  /\b(private key|master password|secret key|seed phrase|WIF)\b[^.]{0,40}\b(paste|type|enter|send|share|provide|submit)\b/i,
];

function assertKeyCustodySafe(id, body) {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Hard fail: any instruction to share a secret, anywhere.
    for (const re of SHARE_INSTRUCTION) {
      assert.ok(!re.test(line), `KEY-CUSTODY VIOLATION in ${id} line ${i + 1}: instructs sharing a secret -> ${line.trim()}`);
    }

    // Any mention of a secret token must sit in a safety context.
    const mentionsSecret = SECRET_TOKENS.some((re) => re.test(line));
    if (!mentionsSecret) continue;

    const neighbourhood = [lines[i - 1] || '', line, lines[i + 1] || ''].join(' ');
    const isSafetyContext = SAFETY_CUES.some((re) => re.test(neighbourhood));
    assert.ok(
      isSafetyContext,
      `KEY-CUSTODY: ${id} line ${i + 1} mentions a secret outside a never-share/we-never-ask context -> ${line.trim()}`,
    );
  }
}

test('no lesson instructs sharing a private key; secrets only in safety context', () => {
  for (const l of LESSONS) {
    const body = readFileSync(join(__dirname, l.file), 'utf8');
    assertKeyCustodySafe(l.id, body);
  }
});

test('lessons reinforce that the Witness never asks for keys', () => {
  // At least the account-creation lesson must carry the explicit promise.
  const welcome = readFileSync(join(__dirname, '01-welcome-create-account.md'), 'utf8');
  assert.match(welcome, /never ask you for a private key/i, 'welcome lesson must promise the Witness never asks for keys');
});
