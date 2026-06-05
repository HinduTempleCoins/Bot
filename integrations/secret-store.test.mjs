// secret-store.test.mjs — OFFLINE tests for the daemon-free encrypted secret store.
// No network, no daemon, no real secrets. Uses a temp file + an in-process test key.
// Run: node --test integrations/secret-store.test.mjs

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the store at a throwaway temp file and set a deterministic in-process key BEFORE import.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-store-test-'));
const TMP_FILE = path.join(TMP_DIR, 'store.json.enc');
process.env.SECRET_STORE_FILE = TMP_FILE;
process.env.SECRET_STORE_KEY = 'test-master-key-NOT-A-REAL-SECRET';

const ss = await import('./secret-store.mjs');

const FAKE = 'sk-test-NOT-A-REAL-SECRET-0001';

beforeEach(() => {
  try { fs.rmSync(TMP_FILE, { force: true }); } catch {}
  try { fs.rmSync(`${TMP_FILE}.tmp`, { force: true }); } catch {}
});

after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

test('encrypt/decrypt round-trip: set then get returns the exact value', () => {
  ss.set('GEMINI_KEY', FAKE, { url: 'https://ai.google.dev' });
  assert.equal(ss.get('GEMINI_KEY'), FAKE);
  // The on-disk file must NOT contain the plaintext.
  const onDisk = fs.readFileSync(TMP_FILE, 'utf8');
  assert.ok(!onDisk.includes(FAKE), 'plaintext secret must not appear on disk');
});

test('set / get / note / list / remove / has full cycle', () => {
  ss.set('A', 'val-a');
  ss.note('B', 'freeform note body');
  assert.equal(ss.get('A'), 'val-a');
  assert.equal(ss.get('B'), 'freeform note body');
  assert.equal(ss.has('A'), true);
  assert.equal(ss.has('NOPE'), false);
  assert.deepEqual(ss.list().sort(), ['A', 'B']);
  assert.equal(ss.remove('A'), true);
  assert.equal(ss.remove('A'), false); // already gone
  assert.equal(ss.has('A'), false);
  assert.deepEqual(ss.list(), ['B']);
});

test('note items are typed as note; login items as login', () => {
  ss.set('LOGIN_ITEM', 'pw', { type: 'login' });
  ss.note('NOTE_ITEM', 'content');
  const all = ss.dump({ confirm: true });
  assert.equal(all.LOGIN_ITEM.type, 'login');
  assert.equal(all.NOTE_ITEM.type, 'note');
});

test('wrong master key → decrypt FAILS (soft-fail empty, not silent-wrong)', async () => {
  ss.set('SECRET', FAKE);
  assert.equal(ss.get('SECRET'), FAKE);
  // Re-import the module under a DIFFERENT key (fresh module registry via cache-busting query).
  const prevKey = process.env.SECRET_STORE_KEY;
  process.env.SECRET_STORE_KEY = 'a-completely-different-wrong-key';
  const ss2 = await import('./secret-store.mjs?wrongkey=1');
  // With the wrong key, the file cannot be decrypted: get() must return null, NOT garbage.
  assert.equal(ss2.get('SECRET'), null);
  assert.deepEqual(ss2.list(), []); // soft-fail to empty, no throw
  process.env.SECRET_STORE_KEY = prevKey;
});

test('missing file → empty soft-fail, no throw', () => {
  // beforeEach removed the file; reads must not throw.
  assert.doesNotThrow(() => ss.list());
  assert.deepEqual(ss.list(), []);
  assert.equal(ss.get('anything'), null);
  assert.equal(ss.has('anything'), false);
});

test('tampered file → decrypt fails, soft-fail empty (not silent-wrong)', () => {
  ss.set('X', FAKE);
  const env = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
  // Flip a byte in the ciphertext so the GCM auth tag no longer matches.
  const ctBuf = Buffer.from(env.ct, 'base64');
  ctBuf[0] ^= 0xff;
  env.ct = ctBuf.toString('base64');
  fs.writeFileSync(TMP_FILE, JSON.stringify(env));
  assert.equal(ss.get('X'), null); // detected, not returned as garbage
  assert.deepEqual(ss.list(), []);
});

test('importFromBitwarden maps name→value (login.password and notes) correctly', () => {
  const bwExport = {
    items: [
      { name: 'gemini', login: { password: 'gem-pw-FAKE', uris: [{ uri: 'https://ai.google.dev' }] }, notes: null },
      { name: 'deploy-notes', login: null, notes: 'ssh recipe here' },
      { name: 'no-data', login: null, notes: null }, // should be skipped
      { login: { password: 'orphan' } }, // missing name → skipped
    ],
  };
  const res = ss.importFromBitwarden(bwExport);
  assert.deepEqual(res.imported.sort(), ['deploy-notes', 'gemini']);
  assert.equal(res.skipped.length, 2);
  assert.equal(ss.get('gemini'), 'gem-pw-FAKE');
  assert.equal(ss.get('deploy-notes'), 'ssh recipe here');
  // url carried through from login.uris
  assert.equal(ss.dump({ confirm: true }).gemini.url, 'https://ai.google.dev');
});

test('importFromBitwarden accepts a JSON string and is idempotent on re-import', () => {
  const json = JSON.stringify({ items: [{ name: 'k', login: { password: 'p1' } }] });
  ss.importFromBitwarden(json);
  assert.equal(ss.get('k'), 'p1');
  ss.importFromBitwarden(json); // re-import same export
  assert.deepEqual(ss.list(), ['k']); // no duplicate, single entry
  // Re-import with an updated value upserts (does not add a second key).
  ss.importFromBitwarden(JSON.stringify({ items: [{ name: 'k', login: { password: 'p2' } }] }));
  assert.deepEqual(ss.list(), ['k']);
  assert.equal(ss.get('k'), 'p2');
});

test('list() returns names ONLY, never values', () => {
  ss.set('VISIBLE_NAME', FAKE);
  const names = ss.list();
  assert.deepEqual(names, ['VISIBLE_NAME']);
  assert.ok(!JSON.stringify(names).includes(FAKE), 'list() must not leak values');
});

test('dump() requires { confirm: true }', () => {
  ss.set('S', FAKE);
  assert.throws(() => ss.dump(), /confirm: true/);
  assert.throws(() => ss.dump({ confirm: false }), /confirm: true/);
  const all = ss.dump({ confirm: true });
  assert.equal(all.S.value, FAKE);
  // exportAll is an alias and also guarded.
  assert.throws(() => ss.exportAll(), /confirm: true/);
  assert.equal(ss.exportAll({ confirm: true }).S.value, FAKE);
});

test('set() returns a receipt without the value', () => {
  const r = ss.set('R', FAKE);
  assert.equal(r.name, 'R');
  assert.equal(r.type, 'login');
  assert.ok(r.updatedAt);
  assert.ok(!JSON.stringify(r).includes(FAKE), 'receipt must not contain the value');
});
