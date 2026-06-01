// index.test.js — the shared multi-bot store. Uses a temp root so it never touches store/.data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { Store } from './index.mjs';

function freshStore(tag) { return new Store(join(tmpdir(), `melek-store-${tag}-${process.pid}`)); }

test('append is idempotent on id; all/get read back', async () => {
  const s = freshStore('append');
  const a = await s.append('cheetah.findings', { id: 'f1', author: 'alice', source: 'x' });
  assert.equal(a.added, true);
  const dup = await s.append('cheetah.findings', { id: 'f1', author: 'alice' });
  assert.equal(dup.added, false);
  assert.equal((await s.all('cheetah.findings')).length, 1);
  assert.equal((await s.get('cheetah.findings', 'f1')).author, 'alice');
  await rm(s.root, { recursive: true, force: true });
});

test('append derives an id when none is given', async () => {
  const s = freshStore('derive');
  const r = await s.append('shared.flags', { kind: 'note', text: 'hi' });
  assert.ok(r.id && r.id.length === 16);
  assert.ok((await s.get('shared.flags', r.id)));
  await rm(s.root, { recursive: true, force: true });
});

test('update merges fields and creates if missing', async () => {
  const s = freshStore('update');
  await s.append('cheetah.findings', { id: 'f2', status: 'open' });
  const rec = await s.update('cheetah.findings', 'f2', { status: 'resolved-self-quote', by: 'hathor' });
  assert.equal(rec.status, 'resolved-self-quote');
  assert.equal(rec.by, 'hathor');
  const created = await s.update('shared.x', 'newid', { a: 1 });
  assert.equal(created.a, 1);
  await rm(s.root, { recursive: true, force: true });
});

test('remove deletes by id', async () => {
  const s = freshStore('remove');
  await s.append('ns.a', { id: 'z' });
  assert.equal(await s.remove('ns.a', 'z'), true);
  assert.equal(await s.remove('ns.a', 'z'), false);
  assert.equal((await s.all('ns.a')).length, 0);
  await rm(s.root, { recursive: true, force: true });
});

test('all() filters; namespaces() lists what exists', async () => {
  const s = freshStore('ns');
  await s.append('cheetah.whitelist', { id: 'w1', account: 'bob' });
  await s.append('cheetah.whitelist', { id: 'w2', account: 'carol' });
  const bobs = await s.all('cheetah.whitelist', (x) => x.account === 'bob');
  assert.equal(bobs.length, 1);
  assert.ok((await s.namespaces()).includes('cheetah.whitelist'));
  await rm(s.root, { recursive: true, force: true });
});

test('bad namespace names are rejected', async () => {
  const s = freshStore('bad');
  await assert.rejects(() => s.all('../escape'));
  await assert.rejects(() => s.all('has space'));
  await rm(s.root, { recursive: true, force: true });
});
