/**
 * Tests for tutorial/state.js.
 *
 *   node --test tutorial/state.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TutorialState } from './state.js';

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'melek-tutorial-state-'));
  const path = join(dir, 'state.json');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('starts empty when file does not exist', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new TutorialState({ path });
    assert.equal(s.hasResponded('alice', 'intro_post'), false);
    assert.deepEqual(s.accounts(), []);
  } finally {
    cleanup();
  }
});

test('records a response and reports it', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new TutorialState({ path });
    s.recordResponse('alice', 'intro_post', {
      txId: '0xabc',
      action: 'comment_and_upvote',
      evidencePermlink: 'my-intro',
    });
    assert.equal(s.hasResponded('alice', 'intro_post'), true);
    assert.deepEqual(s.respondedStages('alice'), ['intro_post']);
  } finally {
    cleanup();
  }
});

test('survives reload (persistence works)', () => {
  const { path, cleanup } = makeStore();
  try {
    const s1 = new TutorialState({ path });
    s1.recordResponse('alice', 'intro_post', { action: 'comment_and_upvote' });
    const s2 = new TutorialState({ path });
    assert.equal(s2.hasResponded('alice', 'intro_post'), true);
  } finally {
    cleanup();
  }
});

test('multiple stages per account', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new TutorialState({ path });
    s.recordResponse('alice', 'intro_post', { action: 'comment_and_upvote' });
    s.recordResponse('alice', 'engage_three_posts', { action: 'comment_and_upvote' });
    assert.deepEqual(
      s.respondedStages('alice').sort(),
      ['engage_three_posts', 'intro_post'],
    );
  } finally {
    cleanup();
  }
});

test('multiple accounts are isolated', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new TutorialState({ path });
    s.recordResponse('alice', 'intro_post', { action: 'comment_and_upvote' });
    s.recordResponse('bob', 'intro_post', { action: 'comment_and_upvote' });
    assert.equal(s.hasResponded('alice', 'intro_post'), true);
    assert.equal(s.hasResponded('bob', 'intro_post'), true);
    assert.equal(s.hasResponded('carol', 'intro_post'), false);
  } finally {
    cleanup();
  }
});

test('malformed file is treated as empty (does not throw)', () => {
  const { path, cleanup } = makeStore();
  try {
    writeFileSync(path, '{ this is not json');
    const s = new TutorialState({ path });
    assert.equal(s.hasResponded('alice', 'intro_post'), false);
    // and we should be able to write into it cleanly afterward
    s.recordResponse('alice', 'intro_post', { action: 'comment_and_upvote' });
    const reloaded = new TutorialState({ path });
    assert.equal(reloaded.hasResponded('alice', 'intro_post'), true);
  } finally {
    cleanup();
  }
});

test('metadata.updated is set on write', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new TutorialState({ path });
    s.recordResponse('alice', 'intro_post', { action: 'comment_and_upvote' });
    const reloaded = new TutorialState({ path });
    assert.ok(reloaded.data._meta.updated, '_meta.updated should be set');
    assert.equal(reloaded.data._meta.version, 1);
  } finally {
    cleanup();
  }
});
