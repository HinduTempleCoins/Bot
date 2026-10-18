// comments.test.mjs — offline, node:test. Env-artifact import: set SOAPBOX_COMMENTS_DIR before
// importing the module, and SOAPBOX_COMMENTS_WRITE to toggle the write gate per case.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'soapbox-comments-test-'));
process.env.SOAPBOX_COMMENTS_DIR = DIR;

// Imported after the env is set — the module reads its dir at import time.
const { canPost, getThread, addComment, threadCount } = await import('./comments.mjs');

before(() => {
  process.env.SOAPBOX_COMMENTS_WRITE = '1';
});
after(() => {
  process.env.SOAPBOX_COMMENTS_WRITE = '';
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('canPost() is false by default (writes gated)', () => {
  delete process.env.SOAPBOX_COMMENTS_WRITE;
  assert.equal(canPost(), false);
  assert.deepEqual(getThread('coin:no-thread'), []);
});

test('addComment throws while gated, then works with the gate on', () => {
  delete process.env.SOAPBOX_COMMENTS_WRITE;
  assert.throws(() => addComment('coin:x', { author: 'a', body: 'hello' }),
    /read-only at launch/);
  process.env.SOAPBOX_COMMENTS_WRITE = '1';
  const entry = addComment('coin:x', { author: 'researcher', body: 'called it in March' });
  assert.equal(entry.author, 'researcher');
  assert.equal(entry.body, 'called it in March');
  assert.ok(entry.id, 'comment has an id');
  assert.ok(entry.ts, 'comment has a timestamp');
  const thread = getThread('coin:x');
  assert.equal(thread.length, 1);
  assert.equal(thread[0].body, 'called it in March');
});

test('addComment trims, caps the body at 4000 chars and rejects an empty one', () => {
  const trimmed = addComment('coin:trim', { body: '   spaced   ' });
  assert.equal(trimmed.body, 'spaced');
  const long = addComment('coin:cap', { body: 'x'.repeat(5000) });
  assert.equal(long.body.length, 4000);
  assert.equal(getThread('coin:cap')[0].body.length, 4000);
  assert.throws(() => addComment('coin:empty', { body: '   ' }), /empty comment/);
});

test('getThread hides entries with hidden: true (read side always open)', () => {
  addComment('coin:h', { body: 'visible' });
  const file = path.join(DIR, 'coin:h.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.push({ ...all[all.length - 1], id: 'hidden-1', body: 'removed', hidden: true });
  fs.writeFileSync(file, JSON.stringify(all));
  const visible = getThread('coin:h');
  assert.equal(visible.length, 1);
  assert.equal(visible[0].body, 'visible');
  assert.equal(threadCount('coin:h'), 1);
});

test('a ref like ../../etc/x is sanitised and cannot escape the data dir', () => {
  const entry = addComment('../../etc/x', { body: 'escape attempt' });
  assert.ok(entry.id, 'comment recorded anyway');
  // `../../etc/x` collapses to `______etc_x.json`: no slash, no traversal, a direct child of DIR.
  const escaped = path.join(DIR, '______etc_x.json');
  assert.ok(fs.existsSync(escaped), 'sanitised filename written inside DIR');
  const written = JSON.parse(fs.readFileSync(escaped, 'utf8'));
  assert.equal(written[0].body, 'escape attempt');
  assert.ok(!fs.existsSync('/etc/x.json'));
  assert.ok(!fs.existsSync(path.join(DIR, '..', 'x.json')));
});

test('threadCount matches the public (non-hidden) thread size', () => {
  addComment('coin:count', { body: 'one' });
  addComment('coin:count', { body: 'two' });
  const file = path.join(DIR, 'coin:count.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  const last = { ...all[all.length - 1], id: 'stuff', body: 'gaiden', hidden: true };
  const joined = all.concat([last]);
  fs.writeFileSync(file, JSON.stringify(joined));
  assert.equal(threadCount('coin:count'), 2);
});

test('a comment-less thread reads as empty and threadCount is 0', () => {
  assert.deepEqual(getThread('coin:ghost'), []);
  assert.equal(threadCount('coin:ghost'), 0);
});
